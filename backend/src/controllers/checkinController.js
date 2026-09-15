import { LockService } from '../lock/lock.service.js';
import { sendCheckInEmail } from '../utils/emailNotifier.js';
import { createPaymentOrderForReservation } from './razorpayController.js';
import { prisma } from '../utils/db.js';
import { createNotification, NotificationType, NotificationPriority } from '../utils/notificationService.js';
import crypto from 'crypto';
import { verifyDrivingLicenceWithGemini } from '../services/geminiVerificationService.js';
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

// Step 1: Verify the Driving Licence document with Gemini and the guest's face with DeepFace.
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

    let verification;
    try {
      verification = await verifyDrivingLicenceWithGemini({ imageData: dlImageUrl, guest: existingRes.guest });
    } catch (verificationError) {
      return res.status(400).json({
        success: false,
        verificationStatus: 'REJECTED',
        error: verificationError.message || 'Unable to verify the Driving Licence.',
      });
    }

    if (typeof dlImageUrl !== 'string') {
      return res.status(400).json({ error: 'A Driving Licence image is required.' });
    }

    let faceVerification;
    if (verification.verified) {
      if (typeof selfieImageUrl !== 'string' || !selfieImageUrl.trim()) {
        faceVerification = {
          verified: false,
          reason: 'A selfie image is required for face verification.'
        };
      } else {
        try {
          faceVerification = await verifyWithDeepFace({
            idImageData: dlImageUrl,
            selfieImageData: selfieImageUrl,
          });
        } catch {
          faceVerification = {
            verified: false,
            reason: 'Face verification could not be completed.'
          };
        }
      }
    } else {
      faceVerification = {
        verified: false,
        reason: 'Face verification was not attempted because the Driving Licence was not verified.'
      };
    }

    const documentVerified = verification.verified === true;
    const faceVerified = faceVerification.verified === true;
    const overallVerified = documentVerified && faceVerified;
    const reason = overallVerified
      ? faceVerification.reason || verification.reason
      : (!documentVerified ? verification.reason : faceVerification.reason);

    const reservation = await prisma.reservation.update({
      where: { id: Number(reservationId) },
      data: {
        dlImageUrl: dlImageUrl.slice(0, 5000),
        selfieImageUrl: typeof selfieImageUrl === 'string' ? selfieImageUrl.slice(0, 5000) : null,
        verificationStatus: overallVerified ? 'VERIFIED' : 'REJECTED',
      },
      include: { guest: true }
    });

    const verificationResult = {
      verified: overallVerified,
      documentVerified,
      faceVerified,
      ...(typeof faceVerification.distance === 'number' ? { faceDistance: faceVerification.distance } : {}),
      ...(typeof faceVerification.threshold === 'number' ? { faceThreshold: faceVerification.threshold } : {}),
      ...(typeof faceVerification.model === 'string' ? { model: faceVerification.model } : {}),
      reason: reason || 'Identity verification failed.',
    };

    if (!overallVerified) {
      return res.status(400).json({
        success: false,
        message: verificationResult.reason,
        verificationStatus: 'REJECTED',
        verification: verificationResult,
        reservation
      });
    }

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
    return {
      digitalPin: reservation.digitalPin,
      lockId: reservation.lockId,
      keyPayload: JSON.parse(reservation.digitalKey),
    };
  }

  const roomNumber = reservation.roomId ? `ROOM-${reservation.roomId}` : 'ROOM-101';
  const lockId = `LOCK-${roomNumber}-${crypto.randomBytes(8).toString('hex')}`;
  const digitalPin = crypto.randomInt(100000, 1000000).toString();
  const validFrom = new Date();
  const validUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const keyPayload = lockService.generateDigitalKeyPayload(String(reservation.id), lockId, validFrom, validUntil);

  return { digitalPin, lockId, keyPayload };
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
      return res.status(409).json({ error: 'This reservation is already checked in.' });
    }

    const paymentWhere = {
      reservationId: reservation.id,
      paymentStatus: 'Paid',
      OR: [
        { gatewayStatus: 'captured', razorpayPaymentId: { not: null } },
        ...(req.user ? [{ gatewayStatus: 'manual' }] : []),
      ],
    };
    const paidPayments = await prisma.payment.aggregate({
      _sum: { amount: true },
      where: paymentWhere,
    });
    const paidAmount = Number(paidPayments._sum.amount || 0);
    const totalCharges = Number(reservation.totalCharges);
    if (!Number.isFinite(totalCharges) || totalCharges <= 0 || paidAmount < totalCharges) {
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
        paidAmount,
        digitalPin: key.digitalPin,
        digitalKey: JSON.stringify(key.keyPayload),
        digitalKeyStatus: 'ACTIVE',
        lockId: key.lockId,
      },
      include: { guest: true }
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
      ...key,
      reservation: updated
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Backward-compatible endpoint: key issuance is now part of completeGuestCheckIn.
export async function generateDigitalLockKey(req, res) {
  return completeGuestCheckIn(req, res);
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
