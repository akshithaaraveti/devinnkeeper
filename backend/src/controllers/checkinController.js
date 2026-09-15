import { LockService } from '../lock/lock.service.js';
import { sendCheckInEmail } from '../utils/emailNotifier.js';
import { createPaymentOrderForReservation } from './razorpayController.js';
import { prisma } from '../utils/db.js';
import { createNotification, NotificationType, NotificationPriority } from '../utils/notificationService.js';
import crypto from 'crypto';
import { verifyWithDeepFace } from '../services/deepfaceVerificationService.js';
import { verifyCheckInAccessToken } from '../utils/checkinAccess.js';

const lockService = new LockService();

export async function getGuestCheckInAccess(req, res) {
  try {
    const reservationId = Number(req.query?.resId || req.query?.reservationId);
    const access = verifyCheckInAccessToken(req.query?.token, reservationId);
    if (!Number.isInteger(reservationId) || !access) {
      return res.status(401).json({ error: 'This check-in link is invalid or expired.' });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { guest: true, room: true, payments: true },
    });
    if (!reservation || !reservation.guest || (access.guestId && Number(access.guestId) !== Number(reservation.guestId))) {
      return res.status(404).json({ error: 'Reservation not found for this check-in link.' });
    }

    return res.json({
      reservation: {
        ...reservation,
        roomNumber: reservation.room?.room_number || reservation.roomId,
      },
    });
  } catch {
    return res.status(500).json({ error: 'Unable to open this check-in link.' });
  }
}

// Step 0: Create New Room Booking with Selected Room and Payment Gateway Details
export async function createBookingWithPayment(req, res) {
  try {
    const {
      firstName,
      lastName,
      email,
      phone,
      roomId,
      checkIn,
      checkOut,
      paymentMethod
    } = req.body;

    if (!firstName || !lastName || !roomId || !checkIn || !checkOut) {
      return res.status(400).json({ error: 'Missing required guest or room details.' });
    }

    if (roomId) {
      const room = await prisma.room.findUnique({ where: { id: Number(roomId) } });
      if (room) {
        const st = String(room.status || '').toLowerCase();
        let reason = null;
        if (st === 'dirty') reason = 'dirty';
        else if (st === 'maintenance' || st === 'under_maintenance' || st === 'out_of_service') reason = 'under maintenance';
        else if (st === 'occupied') reason = 'occupied';
        else if (room.availability === false) reason = 'unavailable';

        if (reason) {
          return res.status(400).json({
            error: `Room ${room.room_number || room.id} is ${reason} and cannot be reserved for a new booking.`
          });
        }
      }
    }

    // 1. Create or Find Guest (Match strictly by unique Email or Phone)
    let guest = null;
    if (email && email.trim()) {
      guest = await prisma.guest.findFirst({ where: { email: email.trim().toLowerCase() } });
    } else if (phone && phone.trim()) {
      guest = await prisma.guest.findFirst({ where: { phone: phone.trim() } });
    }

    if (!guest) {
      guest = await prisma.guest.create({
        data: {
          firstName,
          lastName,
          email,
          phone
        }
      });
    }

    // 2. Create Reservation
    const parsedCheckIn = new Date(checkIn);
    const parsedCheckOut = new Date(checkOut);
    if (isNaN(parsedCheckIn.getTime()) || isNaN(parsedCheckOut.getTime())) {
      return res.status(400).json({ error: 'Provided check-in or check-out date is invalid.' });
    }
    const room = await prisma.room.findUnique({ where: { id: Number(roomId) } });
    const nights = Math.max(1, Math.ceil((parsedCheckOut.getTime() - parsedCheckIn.getTime()) / (1000 * 3600 * 24)));
    const charges = room?.current_price ? nights * Number(room.current_price) : NaN;
    if (!Number.isFinite(charges) || charges <= 0) {
      return res.status(400).json({ error: 'Unable to calculate a valid reservation amount.' });
    }

    const reservation = await prisma.reservation.create({
      data: {
        guestId: guest.id,
        roomId: Number(roomId),
        checkIn: parsedCheckIn,
        checkOut: parsedCheckOut,
        status: 'confirmed',
        totalCharges: charges,
        paidAmount: 0,
        source: 'Direct Web Booking',
        verificationStatus: 'UNVERIFIED',
        digitalKeyStatus: 'INACTIVE',
        notes: `Payment pending via ${paymentMethod || 'Razorpay'}`
      },
      include: {
        guest: true
      }
    });

    // Send the check-in email only after the reservation has been committed.
    const guestRecipientEmail = email || guest?.email;
    let emailDelivery;
    if (guestRecipientEmail) {
      try {
        const result = await sendCheckInEmail({
        guestEmail: guestRecipientEmail,
        guestName: `${firstName} ${lastName}`,
        reservationId: reservation.id,
        guestId: guest.id,
        roomId: Number(roomId),
        checkInDate: parsedCheckIn
        });
        emailDelivery = {
          success: result.success,
          emailSent: result.emailSent === true,
          category: result.category,
          error: result.success ? undefined : result.error,
          messageId: result.messageId,
        };
      } catch (error) {
        emailDelivery = { success: false, emailSent: false, category: 'unknown', error: 'Unable to deliver the check-in email.' };
        console.error('[CHECK-IN EMAIL] controller delivery failure:', error.message);
      }
    } else {
      emailDelivery = { success: false, emailSent: false, category: 'invalid-recipient', error: 'Guest email address is missing or invalid.' };
    }

    // 5. Fire NEW_RESERVATION notification
    try {
      const room = await prisma.room.findUnique({ where: { id: Number(roomId) } });
      await createNotification({
        type: NotificationType.NEW_RESERVATION,
        title: 'New Reservation',
        message: `New reservation created for ${firstName} ${lastName}${room ? ` – Room ${room.room_number}` : ''}`,
        priority: NotificationPriority.NORMAL,
        guestId: guest.id,
        reservationId: reservation.id,
        roomId: Number(roomId),
        metadata: { guestName: `${firstName} ${lastName}`, roomId: Number(roomId), reservationId: reservation.id },
      });
    } catch (notifErr) {
      console.error('[checkinController] NEW_RESERVATION notification failed:', notifErr.message);
    }

    const { order, payment } = await createPaymentOrderForReservation(reservation);

    res.status(201).json({
      success: true,
      message: 'Room reserved successfully. Complete the Razorpay payment to confirm check-in.',
      reservation,
      payment,
      emailDelivery,
      razorpay: {
        keyId: process.env.RAZORPAY_KEY_ID,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Step 1: Verify that the face in the ID image matches the selfie with DeepFace.
export async function verifyGuestId(req, res) {
  try {
    const { reservationId, guestId, dlImageUrl, selfieImageUrl } = req.body;

    if (!reservationId) {
      return res.status(400).json({ error: 'Reservation ID is required' });
    }

    const existingRes = await prisma.reservation.findUnique({
      where: { id: Number(reservationId) },
      include: { guest: true }
    });

    if (!existingRes) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    if (guestId && Number(guestId) !== Number(existingRes.guestId)) {
      return res.status(400).json({ error: 'This guest is not included in the selected reservation and cannot check in.' });
    }

    if (existingRes.status === 'cancelled' || existingRes.status === 'no_show') {
      return res.status(400).json({ error: 'Selected reservation is cancelled or inactive for check-in.' });
    }

    if ((existingRes.status || '').toLowerCase().includes('check')) {
      return res.status(400).json({ error: 'You have already checked-in' });
    }

    if (req.checkInAccess && Number(req.checkInAccess.reservationId) !== Number(existingRes.id)) {
      return res.status(403).json({ error: 'This check-in link is not valid for the selected reservation.' });
    }

    if (typeof dlImageUrl !== 'string' || !dlImageUrl.trim()) {
      return res.status(400).json({ error: 'An ID image is required for face verification.' });
    }
    if (typeof selfieImageUrl !== 'string' || !selfieImageUrl.trim()) {
      return res.status(400).json({ error: 'A selfie image is required for face verification.' });
    }

    const faceVerification = await verifyWithDeepFace({
      idImageData: dlImageUrl,
      selfieImageData: selfieImageUrl,
    });
    const faceVerified = faceVerification.verified === true;
    const reason = faceVerification.reason || (faceVerified
      ? 'Face match successful.'
      : 'Face does not match the ID image.');

    const verificationResult = {
      verified: faceVerified,
      faceVerified,
      ...(typeof faceVerification.distance === 'number' ? { faceDistance: faceVerification.distance } : {}),
      ...(typeof faceVerification.threshold === 'number' ? { faceThreshold: faceVerification.threshold } : {}),
      ...(typeof faceVerification.model === 'string' ? { model: faceVerification.model } : {}),
      reason,
    };

    if (!faceVerified) {
      try {
        await createNotification({
          type: NotificationType.IDENTITY_VERIFICATION_FAILED,
          title: 'Identity Verification Failed',
          message: `Face identity verification failed for Reservation #${existingRes.id}: ${verificationResult.reason}`,
          priority: NotificationPriority.HIGH,
          guestId: existingRes.guestId,
          reservationId: existingRes.id,
          roomId: existingRes.roomId,
          metadata: { reservationId: existingRes.id, roomId: existingRes.roomId },
        });
      } catch (notifErr) {
        console.error('[checkinController] IDENTITY_VERIFICATION_FAILED notification failed:', notifErr.message);
      }
      return res.status(400).json({
        success: false,
        message: verificationResult.reason,
        verificationStatus: 'REJECTED',
        verification: verificationResult,
        reservation: existingRes,
      });
    }

    const reservation = await prisma.reservation.update({
      where: { id: Number(reservationId) },
      data: {
        dlImageUrl: dlImageUrl.slice(0, 5000),
        selfieImageUrl: selfieImageUrl.slice(0, 5000),
        verificationStatus: 'VERIFIED',
      },
      include: { guest: true }
    });

    await createNotification({
      type: NotificationType.IDENTITY_VERIFIED,
      title: 'Identity Verification Completed',
      message: `Face identity verification completed for Reservation #${reservation.id}.`,
      priority: NotificationPriority.NORMAL,
      guestId: reservation.guestId,
      reservationId: reservation.id,
      roomId: reservation.roomId,
      metadata: { reservationId: reservation.id, roomId: reservation.roomId },
    });

    res.json({
      success: true,
      message: verificationResult.reason,
      verificationStatus: reservation.verificationStatus,
      verification: verificationResult,
      reservation
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Step 2: Create a Razorpay order for an existing reservation.
export async function processCheckInPayment(req, res) {
  try {
    const reservationId = Number(req.body?.reservationId);
    if (!Number.isInteger(reservationId) || reservationId <= 0) {
      return res.status(400).json({ error: 'Reservation ID is required' });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { guest: true }
    });

    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    if (req.checkInAccess && Number(req.checkInAccess.reservationId) !== reservationId) {
      return res.status(403).json({ error: 'This check-in link is not valid for the selected reservation.' });
    }

    if (reservation.verificationStatus !== 'VERIFIED') {
      return res.status(400).json({ error: 'ID Verification (Driver License & Selfie) must be completed and verified before processing check-in payment.' });
    }

    if ((reservation.status || '').toLowerCase().includes('check')) {
      return res.status(400).json({ error: 'You have already checked-in' });
    }

    const { order, payment } = await createPaymentOrderForReservation(reservation);

    res.json({
      success: true,
      message: 'Razorpay order created. Complete and verify payment before check-in.',
      razorpay: {
        keyId: process.env.RAZORPAY_KEY_ID,
        orderId: order.id,
        amount: order.amount,
        currency: order.currency,
      },
      payment,
      reservation
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Alternative to Razorpay: record a manual/cash/card-at-desk payment collected by front desk staff.
export async function processManualCheckInPayment(req, res) {
  try {
    const reservationId = Number(req.body?.reservationId);
    const method = String(req.body?.method || 'Cash').trim() || 'Cash';
    if (!Number.isInteger(reservationId) || reservationId <= 0) {
      return res.status(400).json({ error: 'Reservation ID is required' });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { guest: true }
    });

    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    if (reservation.verificationStatus !== 'VERIFIED') {
      return res.status(400).json({ error: 'ID Verification (Driver License & Selfie) must be completed and verified before processing check-in payment.' });
    }

    if ((reservation.status || '').toLowerCase().includes('check')) {
      return res.status(400).json({ error: 'You have already checked-in' });
    }

    const amount = Number(reservation.totalCharges) || 0;
    if (amount <= 0) {
      return res.status(400).json({ error: 'Reservation has no outstanding balance to collect.' });
    }

    const gName = reservation.guest ? `${reservation.guest.firstName} ${reservation.guest.lastName}`.trim() : 'Guest';
    const payment = await prisma.payment.create({
      data: {
        reservationId: reservation.id,
        amount,
        method,
        paymentStatus: 'Paid',
        gatewayStatus: 'manual',
        notes: `Manual payment (${method}) collected at front desk for ${gName} (Reservation #${reservation.id})`,
      }
    });

    try {
      await createNotification({
        type: NotificationType.PAYMENT_RECEIVED,
        title: 'Payment Received',
        message: `Payment of ₹${amount} recorded via ${method} for Reservation #${reservation.id}.`,
        priority: NotificationPriority.NORMAL,
        reservationId: reservation.id,
        guestId: reservation.guestId,
        metadata: { paymentId: payment.id, amount, method, status: payment.paymentStatus },
      });
    } catch (notifErr) {
      console.error('[checkinController] PAYMENT_RECEIVED notification failed:', notifErr.message);
    }

    res.json({
      success: true,
      message: `Payment of ₹${amount} recorded via ${method}.`,
      payment,
      reservation
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function issueDigitalKey(reservation) {
  if (reservation.digitalKeyStatus === 'ACTIVE' && reservation.digitalKey && reservation.digitalPin && reservation.lockId) {
    const storedKeyPayload = JSON.parse(reservation.digitalKey);
    return {
      digitalPin: reservation.digitalPin,
      lockId: reservation.lockId,
      keyPayload: storedKeyPayload,
      qrPayload: {
        type: 'innkeeper-digital-access',
        reservationId: reservation.id,
        lockId: reservation.lockId,
        digitalPin: reservation.digitalPin,
        validFrom: storedKeyPayload.validFrom,
        validUntil: storedKeyPayload.validUntil,
      },
    };
  }

  const roomNumber = reservation.roomId ? `ROOM-${reservation.roomId}` : 'ROOM-101';
  const lockId = `LOCK-${roomNumber}-${crypto.randomBytes(8).toString('hex')}`;
  const digitalPin = crypto.randomInt(100000, 1000000).toString();
  const validFrom = new Date();
  const validUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const keyPayload = lockService.generateDigitalKeyPayload(String(reservation.id), lockId, validFrom, validUntil);

  return {
    digitalPin,
    lockId,
    keyPayload,
    qrPayload: {
      type: 'innkeeper-digital-access',
      reservationId: reservation.id,
      lockId,
      digitalPin,
      validFrom,
      validUntil,
    },
  };
}

// Complete Guest Check-In Endpoint. This is the only endpoint that changes a reservation to checked_in.
export async function completeGuestCheckIn(req, res) {
  try {
    const { reservationId } = req.body;
    if (!reservationId) {
      return res.status(400).json({ error: 'Reservation ID is required' });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: Number(reservationId) },
      include: { guest: true }
    });

    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    if (!reservation.guest || !reservation.guestId) {
      return res.status(400).json({ error: 'This reservation has no associated guest.' });
    }

    if (req.checkInAccess && Number(req.checkInAccess.guestId) !== Number(reservation.guestId)) {
      return res.status(403).json({ error: 'This check-in link does not belong to the reservation guest.' });
    }

    if (reservation.status === 'checked_in') {
      const key = await issueDigitalKey(reservation);
      let updated = reservation;
      if (!reservation.digitalPin || !reservation.digitalKey || reservation.digitalKeyStatus !== 'ACTIVE') {
        updated = await prisma.reservation.update({
          where: { id: Number(reservationId) },
          data: {
            digitalPin: key.digitalPin,
            digitalKey: JSON.stringify(key.keyPayload),
            digitalKeyStatus: 'ACTIVE',
            lockId: key.lockId,
          },
          include: { guest: true }
        });
      }
      return res.json({
        success: true,
        message: `Reservation is already checked in. Digital lock key retrieved.`,
        ...key,
        reservation: updated
      });
    }

    const paymentWhere = {
      reservationId: reservation.id,
      paymentStatus: 'Paid',
    };
    const paidPayments = await prisma.payment.aggregate({
      _sum: { amount: true },
      where: paymentWhere,
    });
    const paidSum = Number(paidPayments._sum.amount || 0);
    const paidAmount = Math.max(paidSum, Number(reservation.paidAmount || 0));
    const totalCharges = Number(reservation.totalCharges || 0);
    if (totalCharges > 0 && paidAmount < totalCharges) {
      return res.status(402).json({ error: 'Verified payment is required before completing check-in.' });
    }

    if (reservation.verificationStatus !== 'VERIFIED') {
      return res.status(400).json({ error: 'Driving Licence verification must be completed before finalizing check-in.' });
    }

    const key = await issueDigitalKey(reservation);
    const updated = await prisma.reservation.update({
      where: { id: Number(reservationId) },
      data: {
        status: 'checked_in',
        verificationStatus: 'VERIFIED',
        paidAmount: Math.max(paidAmount, totalCharges),
        digitalPin: key.digitalPin,
        digitalKey: JSON.stringify(key.keyPayload),
        digitalKeyStatus: 'ACTIVE',
        lockId: key.lockId,
      },
      include: { guest: true }
    });

    await createNotification({
      type: NotificationType.DIGITAL_KEY_GENERATED,
      title: 'Digital Key Generated',
      message: `Digital access credential generated for Reservation #${updated.id}.`,
      priority: NotificationPriority.NORMAL,
      guestId: updated.guestId,
      reservationId: updated.id,
      roomId: updated.roomId,
      metadata: { reservationId: updated.id, roomId: updated.roomId },
    });

    // 2. Update room status to occupied
    if (reservation.roomId) {
      try {
        await prisma.room.update({
          where: { id: reservation.roomId },
          data: { status: 'occupied', availability: false }
        });
      } catch (e) {
        console.log('Room status update note:', e.message);
      }
    }

    const gName = reservation.guest ? `${reservation.guest.firstName} ${reservation.guest.lastName}`.trim() : 'Guest';

    // Fire GUEST_CHECKED_IN notification
    try {
      const roomObj = reservation.roomId ? await prisma.room.findUnique({ where: { id: reservation.roomId } }) : null;
      await createNotification({
        type: NotificationType.GUEST_CHECKED_IN,
        title: 'Guest Checked In',
        message: `${gName} has checked into${roomObj ? ` Room ${roomObj.room_number}` : ' the hotel'}`,
        priority: NotificationPriority.NORMAL,
        guestId: reservation.guestId,
        reservationId: reservation.id,
        roomId: reservation.roomId,
        metadata: { guestName: gName, roomId: reservation.roomId, reservationId: reservation.id },
      });
    } catch (notifErr) {
      console.error('[checkinController] GUEST_CHECKED_IN notification failed:', notifErr.message);
    }

    res.json({
      success: true,
      message: `Check-in completed for ${gName}! Status set to Checked-In.`,
      digitalPin: key.digitalPin,
      lockId: key.lockId,
      qrPayload: key.qrPayload,
      reservation: updated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Generate or retrieve digital lock key for a reservation
export async function generateDigitalLockKey(req, res) {
  try {
    const { reservationId } = req.body;
    if (!reservationId) {
      return res.status(400).json({ error: 'Reservation ID is required' });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: Number(reservationId) },
      include: { guest: true }
    });

    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    if (req.checkInAccess && Number(req.checkInAccess.reservationId) !== Number(reservation.id)) {
      return res.status(403).json({ error: 'This check-in link is not valid for the selected reservation.' });
    }

    const key = await issueDigitalKey(reservation);
    const updated = await prisma.reservation.update({
      where: { id: Number(reservationId) },
      data: {
        digitalPin: key.digitalPin,
        digitalKey: JSON.stringify(key.keyPayload),
        digitalKeyStatus: 'ACTIVE',
        lockId: key.lockId,
      },
      include: { guest: true }
    });

    try {
      await createNotification({
        type: NotificationType.DIGITAL_KEY_GENERATED,
        title: 'Digital Key Generated',
        message: `Digital access credential generated for Reservation #${updated.id}.`,
        priority: NotificationPriority.NORMAL,
        guestId: updated.guestId,
        reservationId: updated.id,
        roomId: updated.roomId,
        metadata: { reservationId: updated.id, roomId: updated.roomId },
      });
    } catch (notifErr) {
      console.error('[checkinController] DIGITAL_KEY_GENERATED notification failed:', notifErr.message);
    }

    return res.json({
      success: true,
      message: 'Digital lock key generated successfully.',
      ...key,
      reservation: updated
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

// Step 3: Simulate Room Door Unlock using Key / PIN
export async function unlockDoor(req, res) {
  try {
    const { reservationId, digitalPin } = req.body;

    const reservation = await prisma.reservation.findUnique({
      where: { id: Number(reservationId) }
    });

    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    if (reservation.digitalKeyStatus !== 'ACTIVE' && reservation.status !== 'checked_in') {
      return res.status(403).json({ success: false, message: 'Digital Key is inactive or revoked.' });
    }

    if (digitalPin && reservation.digitalPin && digitalPin !== reservation.digitalPin) {
      return res.status(401).json({ success: false, message: 'Invalid Digital Key PIN code.' });
    }

    res.json({
      success: true,
      message: `Door [${reservation.lockId || 'ROOM-LOCK'}] unlocked successfully! Access granted.`,
      unlockedAt: new Date().toISOString()
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
