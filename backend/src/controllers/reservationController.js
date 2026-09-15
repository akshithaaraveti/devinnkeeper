import crypto from 'crypto';
import { prisma } from '../utils/db.js';
import { sendCheckInEmail } from '../utils/emailNotifier.js';
import { broadcastRoomUpdate, broadcastApprovalUpdate } from '../utils/realtime.js';
import { recordAuditLog, getUserPermissions, hasPermission } from '../services/rbacService.js';
import { createNotification, NotificationType, NotificationPriority } from '../utils/notificationService.js';
import { LockService } from '../lock/lock.service.js';

const lockService = new LockService();

function paginate(data, page, limit) {
  const total = data.length;
  const pages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  return { items: data.slice(start, start + limit), total, page, limit, pages };
}

export async function listReservations(req, res) {
  try {
    const { page = 1, limit = 50, q = '' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const whereClause = q ? {
      OR: [
        { guest: { firstName: { contains: q, mode: 'insensitive' } } },
        { guest: { lastName: { contains: q, mode: 'insensitive' } } },
        { status: { contains: q, mode: 'insensitive' } }
      ]
    } : {};

    const [total, reservations] = await Promise.all([
      prisma.reservation.count({ where: whereClause }),
      prisma.reservation.findMany({
        where: whereClause,
        include: { guest: true, room: true, payments: true },
        orderBy: { id: 'desc' },
        skip,
        take
      })
    ]);

    const pages = Math.ceil(total / take);

    const mapped = reservations.map(r => ({
      ...r,
      roomNumber: r.room ? String(r.room.room_number) : (r.roomId ? String(r.roomId) : "—"),
      room: r.room ? { id: r.room.id, room_number: r.room.room_number, number: r.room.room_number, floor: r.room.floor } : null
    }));

    res.json({ items: mapped, total, page: Number(page), limit: take, pages });
  } catch (err) {
    res.status(500).json({ error: 'An internal error occurred while processing your request.' });
  }
}

export async function createReservation(req, res) {
  try {
    const { 
      checkIn, 
      checkOut, 
      guestId, 
      roomId, 
      firstName, 
      lastName, 
      email, 
      phone, 
      status, 
      totalCharges, 
      paidAmount, 
      source, 
      notes 
    } = req.body;

    if (!checkIn || !checkOut) {
      return res.status(400).json({ error: 'Check-in and Check-out dates are required.' });
    }
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);
    if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
      return res.status(400).json({ error: 'Provided check-in or check-out date is invalid.' });
    }

    let targetRoomId = null;
    if (roomId) {
      let room = await prisma.room.findUnique({ where: { id: Number(roomId) } });
      if (!room) {
        room = await prisma.room.findFirst({ where: { room_number: String(roomId) } });
      }
      if (room) {
        targetRoomId = room.id;
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
      } else {
        targetRoomId = Number(roomId);
      }
    }

    if (targetRoomId) {
      const conflicting = await prisma.reservation.findFirst({
        where: {
          roomId: targetRoomId,
          status: { not: 'checked_out' },
          checkIn: { lt: checkOutDate },
          checkOut: { gt: checkInDate },
        },
        include: { guest: true, room: true }
      });
      if (conflicting) {
        const guestName = conflicting.guest ? `${conflicting.guest.firstName} ${conflicting.guest.lastName}`.trim() : 'another guest';
        const roomLabel = conflicting.room?.room_number || targetRoomId;
        return res.status(409).json({
          error: `Room ${roomLabel} is already booked for ${guestName} from ${conflicting.checkIn.toISOString().slice(0, 10)} to ${conflicting.checkOut.toISOString().slice(0, 10)}. Please choose different dates or another room.`
        });
      }
    }

    const isCheckedInStatus = (status || '').toLowerCase().includes('check');

    if (firstName || lastName) {
      const fn = String(firstName || '').trim();
      const ln = String(lastName || '').trim();
      if (!fn || fn.length < 2 || !/^[A-Za-z\s'\-]+$/.test(fn)) {
        return res.status(400).json({ error: 'First Name must contain at least 2 alphabetic characters.' });
      }
      if (!ln || !/^[A-Za-z\s'\-]+$/.test(ln)) {
        return res.status(400).json({ error: 'Last Name must contain only alphabetic characters.' });
      }
    }

    if (email) {
      const em = String(email).trim();
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+\.[a-zA-Z]{2,}$/;
      const parts = em.split('@');
      if (!emailRegex.test(em) || parts.length !== 2 || parts[1].startsWith('.') || parts[1].endsWith('.') || parts[1].includes('..')) {
        return res.status(400).json({ error: 'Please provide a valid email address (e.g. guest@example.com).' });
      }
    }

    if (phone) {
  const phoneNumber = String(phone).trim();
  const cleanPhone = phoneNumber.replace(/\D/g, '');

  const internationalPhoneRegex = /^\+?[1-9]\d{9,14}$/;

  if (
    !internationalPhoneRegex.test(phoneNumber) ||
    /^(\d)\1+$/.test(cleanPhone) ||
    cleanPhone === '1234567890'
  ) {
    return res.status(400).json({
      error: 'Please provide a valid international phone number.'
    });
  }
}

    let finalGuestId = guestId ? Number(guestId) : null;

    // If guest details (firstName/lastName) are provided for a new reservation, always create a fresh guest record
    if (firstName && lastName) {
      const newGuest = await prisma.guest.create({
        data: {
          firstName: String(firstName).trim(),
          lastName: String(lastName).trim(),
          email: email ? String(email).trim() : null,
          phone: phone ? String(phone).trim() : null,
        }
      });
      finalGuestId = newGuest.id;
    } else if (guestId) {
      finalGuestId = Number(guestId);
    }

    let calculatedTotal = totalCharges !== undefined && Number(totalCharges) > 0 ? Number(totalCharges) : 0;
    if ((!calculatedTotal || calculatedTotal === 0) && targetRoomId) {
      const targetRoomObj = await prisma.room.findUnique({ where: { id: targetRoomId } });
      if (targetRoomObj && targetRoomObj.current_price) {
        const diffMs = Math.abs(checkOutDate.getTime() - checkInDate.getTime());
        const nights = Math.max(1, Math.ceil(diffMs / (1000 * 3600 * 24)) || 1);
        calculatedTotal = nights * targetRoomObj.current_price;
      }
    }

    const reservation = await prisma.reservation.create({
      data: {
        guestId: finalGuestId,
        roomId: targetRoomId,
        checkIn: checkInDate,
        checkOut: checkOutDate,
        status: status || 'confirmed',
        totalCharges: calculatedTotal,
        paidAmount: paidAmount !== undefined ? Number(paidAmount) : calculatedTotal,
        source: source || 'Direct',
        notes: notes || '',
      },
      include: { guest: true }
    });

    if (targetRoomId) {
      try {
        const roomStatus = isCheckedInStatus ? 'occupied' : 'reserved';
        await prisma.room.update({
          where: { id: targetRoomId },
          data: { status: roomStatus, availability: false, last_updated: new Date() }
        });
        broadcastRoomUpdate({ roomId: targetRoomId, status: roomStatus, availability: false, action: 'reserved' });
      } catch (err) {
        console.warn('Could not update room on reservation create:', err.message);
      }
    }

    if (isCheckedInStatus) {
      const roomNumber = targetRoomId ? `ROOM-${targetRoomId}` : 'ROOM-101';
      const lockId = `LOCK-${roomNumber}-${crypto.randomBytes(8).toString('hex')}`;
      const digitalPin = crypto.randomInt(100000, 1000000).toString();
      const validFrom = new Date();
      const validUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
      const keyPayload = lockService.generateDigitalKeyPayload(String(reservation.id), lockId, validFrom, validUntil);
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: {
          digitalPin,
          digitalKey: JSON.stringify(keyPayload),
          digitalKeyStatus: 'ACTIVE',
          lockId,
          verificationStatus: 'VERIFIED',
        }
      });
    }

    if (isCheckedInStatus && Number(paidAmount) > 0) {
      const gName = reservation.guest ? `${reservation.guest.firstName} ${reservation.guest.lastName}`.trim() : 'Guest';
      await prisma.payment.create({
        data: {
          reservationId: reservation.id,
          amount: Number(paidAmount),
          method: req.body.paymentMethod || 'Credit Card',
          paymentStatus: 'Paid',
          gatewayStatus: 'manual',
          notes: `Payment collected at check-in for ${gName} (Reservation #${reservation.id})`,
        }
      });
    }

    const { vehiclePlate, vehicleMake, vehicleModel } = req.body;
    if (vehiclePlate && String(vehiclePlate).trim()) {
      const cleanPlate = String(vehiclePlate).trim().toUpperCase();
      const norm = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();
      const allVehicles = await prisma.vehicle.findMany();
      const existingVeh = allVehicles.find(v => norm(v.licensePlate) === norm(cleanPlate));
      if (!existingVeh) {
        try {
          await prisma.vehicle.create({
            data: {
              licensePlate: cleanPlate,
              make: vehicleMake ? String(vehicleMake).trim() : 'Guest Vehicle',
              model: vehicleModel ? String(vehicleModel).trim() : '',
              state: 'NA',
              parkingSlot: roomId ? `Slot #${(Number(roomId) % 20) + 1}` : 'Slot A-1'
            }
          });
        } catch (vehErr) {
          console.log('Vehicle record auto-creation note:', vehErr.message);
        }
      }
    }

    let emailDelivery;
    if (reservation.guest?.email) {
      try {
        const result = await sendCheckInEmail({
          guestEmail: reservation.guest.email,
          guestName: `${reservation.guest.firstName} ${reservation.guest.lastName}`,
          guestId: reservation.guestId,
          reservationId: reservation.id,
          roomId: reservation.roomId,
          checkInDate: reservation.checkIn
        });
        emailDelivery = {
          success: result.success,
          emailSent: result.emailSent === true,
          category: result.category,
          error: result.success ? undefined : result.error,
          messageId: result.messageId,
        };
      } catch (e) {
        emailDelivery = { success: false, emailSent: false, category: 'unknown', error: 'Unable to deliver the check-in email.' };
        console.error('[CHECK-IN EMAIL] controller delivery failure:', e.message);
      }
    } else {
      emailDelivery = { success: false, emailSent: false, category: 'invalid-recipient', error: 'Guest email address is missing or invalid.' };
    }

    // Fire NEW_RESERVATION notification
    try {
      const room = targetRoomId ? await prisma.room.findUnique({ where: { id: targetRoomId } }) : null;
      const guestName = reservation.guest ? `${reservation.guest.firstName} ${reservation.guest.lastName}`.trim() : (firstName ? `${firstName} ${lastName}`.trim() : 'Guest');
      const roomLabel = room ? `Room ${room.room_number}` : (targetRoomId ? `Room ${targetRoomId}` : '');
      await createNotification({
        type: NotificationType.NEW_RESERVATION,
        title: 'New Reservation Booked',
        message: `Reservation #${reservation.id} booked for ${guestName}${roomLabel ? ` in ${roomLabel}` : ''}`,
        priority: NotificationPriority.NORMAL,
        roomId: targetRoomId,
        guestId: reservation.guestId,
        reservationId: reservation.id,
        metadata: { reservationId: reservation.id, roomId: targetRoomId, guestName, roomNumber: room?.room_number },
      });
    } catch (notifErr) {
      console.error('[reservationController] NEW_RESERVATION notification failed:', notifErr.message);
    }

    res.status(201).json({ ...reservation, emailDelivery });
  } catch (err) {
    console.error('createReservation error:', err);
    res.status(500).json({ error: 'An internal error occurred while processing your request.' });
  }
}

export async function updateReservation(req, res) {
  try {
    const { checkIn, checkOut, firstName, lastName, email, phone, guestId, roomId } = req.body;
    const ALLOWED_RESERVATION_FIELDS = ['status', 'totalCharges', 'paidAmount', 'source', 'notes'];
    const updateData = {};

    for (const field of ALLOWED_RESERVATION_FIELDS) {
      if (field in req.body) {
        updateData[field] = req.body[field];
      }
    }

    if (updateData.status === 'cancelled') {
      const userPermissions = req.userPermissions || await getUserPermissions(req.user);
      if (!hasPermission(userPermissions, 'reservations.cancel')) {
        return res.status(403).json({
          error: 'Managers and Receptionists cannot cancel rooms directly. Please submit a cancellation request to the Admin.'
        });
      }
    }

    if (checkIn !== undefined) {
      const parsed = new Date(checkIn);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Invalid check-in date' });
      }
      updateData.checkIn = parsed;
    }
    if (checkOut !== undefined) {
      const parsed = new Date(checkOut);
      if (isNaN(parsed.getTime())) {
        return res.status(400).json({ error: 'Invalid check-out date' });
      }
      updateData.checkOut = parsed;
    }

    if (roomId !== undefined) {
      updateData.roomId = roomId ? Number(roomId) : null;
    }

    if (guestId !== undefined) {
      updateData.guestId = guestId ? Number(guestId) : null;
    }

    const currentRes = await prisma.reservation.findUnique({ where: { id: Number(req.params.id) } });

    const effectiveRoomId = updateData.roomId !== undefined ? updateData.roomId : currentRes?.roomId;
    const effectiveCheckIn = updateData.checkIn || currentRes?.checkIn;
    const effectiveCheckOut = updateData.checkOut || currentRes?.checkOut;
    const datesOrRoomChanging = updateData.roomId !== undefined || updateData.checkIn !== undefined || updateData.checkOut !== undefined;

    if (datesOrRoomChanging && effectiveRoomId && effectiveCheckIn && effectiveCheckOut) {
      const conflicting = await prisma.reservation.findFirst({
        where: {
          id: { not: Number(req.params.id) },
          roomId: effectiveRoomId,
          status: { not: 'checked_out' },
          checkIn: { lt: effectiveCheckOut },
          checkOut: { gt: effectiveCheckIn },
        },
        include: { guest: true, room: true }
      });
      if (conflicting) {
        const guestName = conflicting.guest ? `${conflicting.guest.firstName} ${conflicting.guest.lastName}`.trim() : 'another guest';
        const roomLabel = conflicting.room?.room_number || effectiveRoomId;
        return res.status(409).json({
          error: `Room ${roomLabel} is already booked for ${guestName} from ${conflicting.checkIn.toISOString().slice(0, 10)} to ${conflicting.checkOut.toISOString().slice(0, 10)}. Please choose different dates or another room.`
        });
      }
    }

    // Handle guest updates if guest names/email are passed
    if (currentRes?.guestId && (firstName || lastName || email || phone)) {
      await prisma.guest.update({
        where: { id: currentRes.guestId },
        data: {
          ...(firstName && { firstName }),
          ...(lastName && { lastName }),
          ...(email !== undefined && { email }),
          ...(phone !== undefined && { phone }),
        }
      });
    }

    if (updateData.status === 'checked_out') {
      updateData.digitalKeyStatus = 'EXPIRED';
    } else if (updateData.status === 'checked_in') {
      if (!currentRes?.digitalPin || !currentRes?.digitalKey || currentRes?.digitalKeyStatus !== 'ACTIVE') {
        const roomNumber = (updateData.roomId || currentRes?.roomId) ? `ROOM-${updateData.roomId || currentRes.roomId}` : 'ROOM-101';
        const lockId = `LOCK-${roomNumber}-${crypto.randomBytes(8).toString('hex')}`;
        const digitalPin = crypto.randomInt(100000, 1000000).toString();
        const validFrom = new Date();
        const validUntil = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
        const keyPayload = lockService.generateDigitalKeyPayload(String(currentRes?.id || req.params.id), lockId, validFrom, validUntil);
        updateData.digitalPin = digitalPin;
        updateData.digitalKey = JSON.stringify(keyPayload);
        updateData.digitalKeyStatus = 'ACTIVE';
        updateData.lockId = lockId;
      }
    }

    const reservation = await prisma.reservation.update({
      where: { id: Number(req.params.id) },
      data: updateData,
      include: { guest: true, payments: true }
    });

    if (updateData.status === 'checked_out' && reservation.roomId) {
      try {
        await prisma.room.update({
          where: { id: reservation.roomId },
          data: { status: 'dirty', availability: true, last_updated: new Date() }
        });
        broadcastRoomUpdate({ roomId: reservation.roomId, status: 'dirty', availability: true, action: 'checkout' });
      } catch (rErr) {
        console.log('Room checkout status update note:', rErr.message);
      }
    } else if (updateData.status === 'checked_in' && reservation.roomId) {
      try {
        await prisma.room.update({
          where: { id: reservation.roomId },
          data: { status: 'occupied', availability: false, last_updated: new Date() }
        });
        broadcastRoomUpdate({ roomId: reservation.roomId, status: 'occupied', availability: false, action: 'checkin' });
      } catch (rErr) {
        console.log('Room checkin status update note:', rErr.message);
      }
    } else if (updateData.status === 'cancelled' && reservation.roomId) {
      try {
        await prisma.room.update({
          where: { id: reservation.roomId },
          data: { status: 'vacant', availability: true, last_updated: new Date() }
        });
        broadcastRoomUpdate({ roomId: reservation.roomId, status: 'vacant', availability: true, action: 'cancelled' });
      } catch (rErr) {
        console.log('Room cancel status update note:', rErr.message);
      }
    }

    const isCheckedIn = (reservation.status || '').toLowerCase().includes('check');
    if (isCheckedIn && updateData.paidAmount !== undefined && Number(updateData.paidAmount) > 0) {
      const existingPay = await prisma.payment.findFirst({ where: { reservationId: reservation.id } });
      const gName = reservation.guest ? `${reservation.guest.firstName} ${reservation.guest.lastName}`.trim() : 'Guest';
      if (existingPay) {
        await prisma.payment.update({
          where: { id: existingPay.id },
          data: {
            amount: Number(updateData.paidAmount),
            paymentStatus: 'Paid',
          }
        });
      } else {
        await prisma.payment.create({
          data: {
            reservationId: reservation.id,
            amount: Number(updateData.paidAmount),
            method: 'Credit Card',
            paymentStatus: 'Paid',
            notes: `Payment collected at check-in for ${gName} (Reservation #${reservation.id})`,
          }
        });
      }
    }

    // Fire notification on status or reservation updates
    try {
      const room = reservation.roomId ? await prisma.room.findUnique({ where: { id: reservation.roomId } }) : null;
      const guestName = reservation.guest ? `${reservation.guest.firstName} ${reservation.guest.lastName}`.trim() : 'Guest';
      const roomLabel = room ? `Room ${room.room_number}` : (reservation.roomId ? `Room ${reservation.roomId}` : '');
      const st = (updateData.status || '').toLowerCase();

      if (st === 'checked_in') {
        await createNotification({
          type: NotificationType.GUEST_CHECKED_IN,
          title: 'Guest Checked In',
          message: `${guestName} checked in to ${roomLabel} (Reservation #${reservation.id})`,
          priority: NotificationPriority.NORMAL,
          roomId: reservation.roomId,
          guestId: reservation.guestId,
          reservationId: reservation.id,
          metadata: { reservationId: reservation.id, roomId: reservation.roomId, guestName, roomNumber: room?.room_number },
        });
      } else if (st === 'checked_out') {
        await createNotification({
          type: NotificationType.GUEST_CHECKED_OUT,
          title: 'Guest Checked Out',
          message: `${guestName} checked out of ${roomLabel} (Reservation #${reservation.id})`,
          priority: NotificationPriority.NORMAL,
          roomId: reservation.roomId,
          guestId: reservation.guestId,
          reservationId: reservation.id,
          metadata: { reservationId: reservation.id, roomId: reservation.roomId, guestName, roomNumber: room?.room_number },
        });
      } else if (st === 'cancelled') {
        await createNotification({
          type: NotificationType.RESERVATION_CANCELLED,
          title: 'Reservation Cancelled',
          message: `Reservation #${reservation.id} for ${guestName} was cancelled`,
          priority: NotificationPriority.HIGH,
          roomId: reservation.roomId,
          guestId: reservation.guestId,
          reservationId: reservation.id,
          metadata: { reservationId: reservation.id, roomId: reservation.roomId, guestName, roomNumber: room?.room_number },
        });
      } else if (updateData.status) {
        await createNotification({
          type: NotificationType.RESERVATION_UPDATED,
          title: 'Reservation Status Updated',
          message: `Reservation #${reservation.id} for ${guestName} status set to ${updateData.status}`,
          priority: NotificationPriority.NORMAL,
          roomId: reservation.roomId,
          guestId: reservation.guestId,
          reservationId: reservation.id,
          metadata: { reservationId: reservation.id, roomId: reservation.roomId, guestName, roomNumber: room?.room_number },
        });
      }
    } catch (notifErr) {
      console.error('[reservationController] update notification failed:', notifErr.message);
    }

    res.json(reservation);
  } catch (err) {
    console.error('updateReservation error:', err);
    res.status(500).json({ error: 'An internal error occurred while processing your request.' });
  }
}

export async function cancelReservation(req, res) {
  try {
    const reservationId = Number(req.params.id);
    const { reason } = req.body || {};

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { guest: true, room: true },
    });

    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }

    const userPermissions = req.userPermissions || await getUserPermissions(req.user);

    // If user does NOT have direct cancel permission, check for request permission (Manager or Receptionist)
    if (!hasPermission(userPermissions, 'reservations.cancel')) {
      if (hasPermission(userPermissions, 'reservations.cancel_request')) {
        const requesterRole = (req.user?.role || '').toUpperCase() === 'MANAGER' ? 'Manager' : 'Receptionist';
        const requesterTitle = req.user?.name ? `${req.user.name} (${requesterRole})` : (req.user?.email || requesterRole);

        const approval = await prisma.approvalRequest.create({
          data: {
            type: 'cancellation',
            referenceId: String(reservationId),
            requestedBy: requesterTitle,
            requestedById: req.user?.id || null,
            reason: reason || `Cancellation requested by ${requesterRole}`,
            status: 'pending',
          },
        });

        await prisma.reservation.update({
          where: { id: reservationId },
          data: { status: 'cancellation_requested' },
        });

        await prisma.appNotification.create({
          data: {
            type: 'cancellation',
            title: 'Reservation Cancellation Request',
            message: `${requesterTitle} submitted a cancellation request for Reservation #${reservationId}. Reason: ${reason || 'Not specified'}`,
            isRead: false,
          },
        }).catch(() => {});

        broadcastApprovalUpdate({
          type: 'cancellation',
          referenceId: String(reservationId),
          status: 'pending',
          requestedBy: requesterTitle,
          reason: reason || 'Not specified',
        });

        await recordAuditLog({
          userId: req.user?.id,
          userEmail: req.user?.email,
          userName: req.user?.name,
          action: 'CANCEL',
          module: 'reservations',
          details: `Requested cancellation for reservation #${reservationId} by ${requesterRole} - Sent to Admin for Approval. Reason: ${reason || 'Not specified'}`,
          ipAddress: req.ip,
        });

        return res.status(200).json({
          success: true,
          requiresApproval: true,
          message: 'Cancellation request submitted to Admin for approval.',
          data: approval,
        });
      } else {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to perform this action',
        });
      }
    }

    // Direct cancellation by authorized user (Admin or Manager)
    const updated = await prisma.reservation.update({
      where: { id: reservationId },
      data: { status: 'cancelled' },
      include: { guest: true, room: true },
    });

    if (updated.roomId) {
      try {
        await prisma.room.update({
          where: { id: updated.roomId },
          data: { status: 'clean', availability: true, last_updated: new Date() },
        });
        broadcastRoomUpdate({ roomId: updated.roomId, status: 'clean', availability: true, action: 'cancelled' });
      } catch (err) {
        console.error('Error freeing room upon cancellation:', err);
      }
    }

    await recordAuditLog({
      userId: req.user?.id,
      userEmail: req.user?.email,
      userName: req.user?.name,
      action: 'CANCEL',
      module: 'reservations',
      details: `Directly cancelled reservation #${reservationId}. Reason: ${reason || 'Not specified'}`,
      ipAddress: req.ip,
    });

    // Fire notification for direct cancellation
    try {
      const guestName = updated.guest ? `${updated.guest.firstName} ${updated.guest.lastName}`.trim() : 'Guest';
      const room = updated.roomId ? await prisma.room.findUnique({ where: { id: updated.roomId } }) : null;
      const roomLabel = room ? `Room ${room.room_number}` : (updated.roomId ? `Room ${updated.roomId}` : '');
      await createNotification({
        type: NotificationType.RESERVATION_CANCELLED,
        title: 'Reservation Cancelled',
        message: `Reservation #${reservationId} for ${guestName}${roomLabel ? ` (${roomLabel})` : ''} was cancelled. Reason: ${reason || 'Direct cancellation'}`,
        priority: NotificationPriority.HIGH,
        roomId: updated.roomId,
        guestId: updated.guestId,
        reservationId: updated.id,
        metadata: { reservationId, roomId: updated.roomId, guestName, reason },
      });
    } catch (notifErr) {
      console.error('[reservationController] cancel notification failed:', notifErr.message);
    }

    return res.json({
      success: true,
      message: 'Reservation cancelled successfully',
      data: updated,
    });
  } catch (err) {
    console.error('cancelReservation error:', err);
    return res.status(500).json({ success: false, message: 'Failed to cancel reservation' });
  }
}

export async function deleteReservation(req, res) {
  try {
    const reservationId = Number(req.params.id);
    const existing = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { guest: true, room: true },
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }

    await prisma.reservation.delete({ where: { id: reservationId } });

    await recordAuditLog({
      userId: req.user?.id,
      userEmail: req.user?.email,
      userName: req.user?.name,
      action: 'DELETE',
      module: 'reservations',
      details: `Deleted reservation #${reservationId} for guest ${existing.guest?.firstName || ''} ${existing.guest?.lastName || ''}`,
      ipAddress: req.ip,
    });

    // Fire RESERVATION_DELETED notification
    try {
      const guestName = existing.guest ? `${existing.guest.firstName} ${existing.guest.lastName || ''}`.trim() : 'Guest';
      const roomLabel = existing.room ? `Room ${existing.room.room_number}` : (existing.roomId ? `Room ${existing.roomId}` : '');
      await createNotification({
        type: NotificationType.RESERVATION_DELETED,
        title: 'Reservation Deleted',
        message: `Reservation #${existing.bookingNumber || reservationId} for ${guestName}${roomLabel ? ` (${roomLabel})` : ''} was deleted`,
        priority: NotificationPriority.HIGH,
        roomId: existing.roomId,
        guestId: existing.guestId,
        reservationId: existing.id,
        metadata: { reservationId: existing.id, guestName, roomNumber: existing.room?.room_number },
      });
    } catch (notifErr) {
      console.error('[reservationController] RESERVATION_DELETED notification failed:', notifErr.message);
    }

    res.json({ success: true, message: 'Reservation deleted successfully' });
  } catch (err) {
    console.error('deleteReservation error:', err);
    res.status(500).json({ error: 'An internal error occurred while processing your request.' });
  }
}

export async function requestReservationCancellation(req, res) {
  try {
    const reservationId = Number(req.params.id);
    const { reason } = req.body || {};

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: { guest: true, room: true },
    });

    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reservation not found' });
    }

    const requesterRole = (req.user?.role || '').toUpperCase() === 'MANAGER' ? 'Manager' : 'Receptionist';
    const requesterName = req.user?.name ? `${req.user.name} (${requesterRole})` : (req.user?.email || requesterRole);

    const approval = await prisma.approvalRequest.create({
      data: {
        type: 'cancellation',
        referenceId: String(reservationId),
        requestedBy: requesterName,
        requestedById: req.user?.id || null,
        reason: reason || `Cancellation requested by ${requesterRole}`,
        status: 'pending',
      },
    });

    await prisma.reservation.update({
      where: { id: reservationId },
      data: { status: 'cancellation_requested' },
    });

    await prisma.appNotification.create({
      data: {
        type: 'cancellation',
        title: 'Reservation Cancellation Request',
        message: `${requesterName} submitted a cancellation request for Reservation #${reservationId}. Reason: ${reason || 'Not specified'}`,
        isRead: false,
      },
    }).catch(() => {});

    broadcastApprovalUpdate({
      type: 'cancellation',
      referenceId: String(reservationId),
      status: 'pending',
      requestedBy: requesterName,
      reason: reason || 'Not specified',
    });

    await recordAuditLog({
      userId: req.user?.id,
      userEmail: req.user?.email,
      userName: req.user?.name,
      action: 'CANCEL',
      module: 'reservations',
      details: `Submitted cancellation request for Reservation #${reservationId} to Admin. Reason: ${reason || 'Not specified'}`,
      ipAddress: req.ip,
    });

    return res.status(200).json({
      success: true,
      requiresApproval: true,
      message: 'Cancellation request submitted to Admin for approval.',
      data: approval,
    });
  } catch (err) {
    console.error('requestReservationCancellation error:', err);
    return res.status(500).json({ success: false, message: 'Failed to submit cancellation request' });
  }
}

