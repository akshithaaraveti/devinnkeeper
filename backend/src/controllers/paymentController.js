import { PrismaClient } from '@prisma/client';
import { createNotification, NotificationType, NotificationPriority } from '../utils/notificationService.js';
const prisma = new PrismaClient();


function paginate(data, page, limit) {
  const total = data.length;
  const pages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  return { items: data.slice(start, start + limit), total, page, limit, pages };
}

export async function listPayments(req, res) {
  try {
    const { page = 1, limit = 20, q = '' } = req.query;
    // Only return payments that have been completed by guests (paymentStatus !== 'Pending')
    const [payments, rooms] = await Promise.all([
      prisma.payment.findMany({
        where: {
          paymentStatus: {
            not: 'Pending'
          }
        },
        include: { reservation: { include: { guest: true } } },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.room.findMany()
    ]);

    const mapped = payments.map(p => {
      const guestObj = p.reservation?.guest;
      const guestName = guestObj
        ? `${guestObj.firstName} ${guestObj.lastName}`.trim()
        : (p.notes?.includes("Holder:") ? p.notes.split("Holder:")[1]?.split("|")[0]?.trim() : "—");

      const isRefundedOrFailed = p.paymentStatus === 'Refunded' || p.paymentStatus === 'Failed';
      const status = isRefundedOrFailed ? p.paymentStatus : 'Paid';

      const rawRoomId = p.roomId || p.reservation?.roomId;
      const roomObj = rooms.find(rm => String(rm.id) === String(rawRoomId) || String(rm.room_number) === String(rawRoomId));
      const roomNumberDisplay = roomObj ? roomObj.room_number : (rawRoomId ? String(rawRoomId) : "—");

      return {
        ...p,
        status,
        paymentStatus: status,
        guest: guestName,
        roomId: roomNumberDisplay,
        roomNumber: roomNumberDisplay,
      };
    });

    const filtered = q
      ? mapped.filter(p => `${p.guest} ${p.method} ${p.status} ${p.roomId} ${p.notes || ''}`.toLowerCase().includes(q.toLowerCase()))
      : mapped;
    res.json(paginate(filtered, Number(page), Number(limit)));
  } catch (err) {
    res.status(500).json({ error: 'An internal error occurred while processing your request.' });
  }
}

export async function getPayment(req, res) {
  try {
    const payment = await prisma.payment.findUnique({
      where: { id: Number(req.params.id) },
      include: { reservation: { include: { guest: true } } }
    });
    if (!payment) return res.status(404).json({ error: 'Payment not found' });
    res.json(payment);
  } catch (err) {
    res.status(500).json({ error: 'An internal error occurred while processing your request.' });
  }
}

export async function createPayment(req, res) {
  try {
    const { reservationId, amount, method, paymentStatus, notes } = req.body;
    const payment = await prisma.payment.create({
      data: {
        amount: Number(amount),
        method: method || 'Cash',
        paymentStatus: paymentStatus || 'Pending',
        notes: notes || null,
        ...(reservationId && { reservationId: Number(reservationId) })
      }
    });
    res.status(201).json(payment);

    try {
      const isFailed = payment.paymentStatus?.toLowerCase() === 'failed';
      await createNotification({
        type: isFailed ? NotificationType.PAYMENT_FAILED : NotificationType.PAYMENT_SUCCESS,
        title: isFailed ? `Payment Failed: $${payment.amount}` : `Payment Received: $${payment.amount}`,
        message: `Payment of $${payment.amount} (${payment.method}) status: ${payment.paymentStatus}`,
        targetRoles: ['receptionist', 'manager', 'admin', 'staff'],
        priority: isFailed ? NotificationPriority.HIGH : NotificationPriority.NORMAL,
        reservationId: payment.reservationId || null,
        metadata: { amount: payment.amount, method: payment.method, status: payment.paymentStatus }
      });
    } catch (e) {
      console.error('Payment notification error:', e);
    }

  } catch (err) {
    res.status(500).json({ error: 'An internal error occurred while processing your request.' });
  }
}

export async function updatePayment(req, res) {
  try {
    const { amount, method, paymentStatus, notes, reservationId } = req.body;
    const payment = await prisma.payment.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(amount !== undefined && { amount: Number(amount) }),
        ...(method && { method }),
        ...(paymentStatus && { paymentStatus }),
        ...(notes !== undefined && { notes }),
        ...(reservationId !== undefined && { reservationId: reservationId ? Number(reservationId) : null })
      }
    });
    res.json(payment);
    try {
      const status = String(payment.paymentStatus || '').toLowerCase();
      await createNotification({
        type: status === 'failed' ? NotificationType.PAYMENT_FAILED : NotificationType.PAYMENT_RECEIVED,
        title: status === 'failed' ? 'Payment Failed' : 'Payment Updated',
        message: `Payment of $${payment.amount} (${payment.method}) status: ${payment.paymentStatus}`,
        priority: status === 'failed' ? NotificationPriority.HIGH : NotificationPriority.NORMAL,
        reservationId: payment.reservationId || null,
        metadata: { paymentId: payment.id, amount: payment.amount, method: payment.method, status: payment.paymentStatus },
      });
    } catch (notifErr) {
      console.error('Payment update notification error:', notifErr.message);
    }
  } catch (err) {
    res.status(500).json({ error: 'An internal error occurred while processing your request.' });
  }
}

export async function deletePayment(req, res) {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.payment.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    await prisma.payment.delete({ where: { id } });
    res.json({ success: true });

    try {
      await createNotification({
        type: NotificationType.PAYMENT_DELETED,
        title: 'Payment Record Deleted',
        message: `Payment record #${existing.id} of ₹${existing.amount || 0} (${existing.method || 'Payment'}) was deleted`,
        priority: NotificationPriority.HIGH,
        metadata: { paymentId: existing.id, amount: existing.amount, method: existing.method },
      });
    } catch (notifErr) {
      console.error('[paymentController] PAYMENT_DELETED notification failed:', notifErr.message);
    }
  } catch (err) {
    res.status(500).json({ error: 'An internal error occurred while processing your request.' });
  }
}
