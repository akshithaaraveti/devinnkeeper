import { PrismaClient } from '@prisma/client';
import {
  createRazorpayOrder,
  fetchRazorpayOrder,
  fetchRazorpayPayment,
  verifyRazorpayPaymentSignature,
} from '../services/razorpayService.js';
import { createNotification, NotificationType, NotificationPriority } from '../utils/notificationService.js';

const prisma = new PrismaClient();

function parseReservationId(value) {
  const reservationId = Number(value);
  if (!Number.isInteger(reservationId) || reservationId <= 0) {
    return null;
  }
  return reservationId;
}

export function getAmountDue(reservation) {
  const totalCharges = Number(reservation.totalCharges);
  const paidAmount = reservation.paidAmount == null ? 0 : Number(reservation.paidAmount);

  if (!Number.isFinite(totalCharges) || totalCharges <= 0) {
    throw new Error('Reservation has no valid payment amount');
  }
  if (!Number.isFinite(paidAmount) || paidAmount < 0) {
    throw new Error('Reservation has an invalid paid amount');
  }

  const amountDue = Math.round((totalCharges - paidAmount) * 100) / 100;
  if (!Number.isFinite(amountDue) || amountDue <= 0) {
    throw new Error('Reservation has no amount due');
  }

  return amountDue;
}

export async function createPaymentOrderForReservation(reservation) {
  const amount = getAmountDue(reservation);
  const order = await createRazorpayOrder({
    amount,
    currency: 'INR',
    receipt: `reservation_${reservation.id}_${Date.now()}`,
    notes: { reservationId: String(reservation.id) },
  });

  const payment = await prisma.payment.create({
    data: {
      reservationId: reservation.id,
      amount,
      method: 'Razorpay',
      paymentStatus: 'Pending',
      razorpayOrderId: order.id,
      currency: 'INR',
      gatewayStatus: order.status || 'created',
    },
  });

  return { order, payment };
}

export async function createPaymentOrder(req, res) {
  try {
    const reservationId = parseReservationId(req.body?.reservationId);
    if (!reservationId) {
      return res.status(400).json({ error: 'A valid reservationId is required' });
    }

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
    });
    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    if (req.checkInAccess && Number(req.checkInAccess.reservationId) !== reservationId) {
      return res.status(403).json({ error: 'This check-in link is not valid for the selected reservation.' });
    }

    const { order, payment } = await createPaymentOrderForReservation(reservation);

    return res.status(201).json({
      keyId: process.env.RAZORPAY_KEY_ID,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      paymentId: payment.id,
    });
  } catch (err) {
    const message = err?.message || 'Unable to create Razorpay order';
    const status = message.includes('Razorpay credentials') ? 503 : 400;
    return res.status(status).json({ error: message });
  }
}

export async function verifyPayment(req, res) {
  try {
    const requestedReservationId = parseReservationId(req.body?.reservationId);
    const razorpayOrderId = req.body?.razorpayOrderId || req.body?.razorpay_order_id;
    const razorpayPaymentId = req.body?.razorpayPaymentId || req.body?.razorpay_payment_id;
    const razorpaySignature = req.body?.razorpaySignature || req.body?.razorpay_signature;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({
        error: 'razorpayOrderId, razorpayPaymentId, and razorpaySignature are required',
      });
    }

    const payment = await prisma.payment.findUnique({
      where: { razorpayOrderId: String(razorpayOrderId) },
    });
    if (!payment) {
      return res.status(404).json({ error: 'Razorpay order not found' });
    }

    if (requestedReservationId && Number(payment.reservationId) !== requestedReservationId) {
      return res.status(403).json({ error: 'This payment does not belong to the selected reservation.' });
    }
    if (req.checkInAccess && Number(req.checkInAccess.reservationId) !== Number(payment.reservationId)) {
      return res.status(403).json({ error: 'This check-in link is not valid for the payment reservation.' });
    }

    const isValid = verifyRazorpayPaymentSignature({
      orderId: String(razorpayOrderId),
      paymentId: String(razorpayPaymentId),
      signature: String(razorpaySignature),
    });
    if (!isValid) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          gatewayStatus: 'signature_verification_failed',
          failureMessage: 'Invalid Razorpay payment signature',
        },
      });
      return res.status(400).json({ error: 'Invalid Razorpay payment signature' });
    }

    let razorpayPayment;
    let razorpayOrder;
    try {
      [razorpayPayment, razorpayOrder] = await Promise.all([
        fetchRazorpayPayment(String(razorpayPaymentId)),
        fetchRazorpayOrder(String(razorpayOrderId)),
      ]);
    } catch (error) {
      return res.status(400).json({ error: 'Unable to validate the Razorpay payment with the gateway' });
    }

    const expectedAmountPaise = Math.round(Number(payment.amount) * 100);
    const paymentMatchesOrder = String(razorpayPayment.order_id) === String(razorpayOrderId);
    const paymentMatchesStoredOrder = String(payment.razorpayOrderId) === String(razorpayOrderId);
    const amountMatches = Number(razorpayPayment.amount) === expectedAmountPaise &&
      Number(razorpayOrder.amount) === expectedAmountPaise;
    const currencyMatches = razorpayPayment.currency === 'INR' && razorpayOrder.currency === 'INR' && payment.currency === 'INR';
    const isCaptured = razorpayPayment.status === 'captured' || razorpayPayment.status === 'authorized';
    const orderIsPaid = razorpayOrder.status === 'paid' || razorpayOrder.amount_paid >= expectedAmountPaise;

    if (!paymentMatchesOrder || !paymentMatchesStoredOrder || !amountMatches || !currencyMatches || !isCaptured || !orderIsPaid) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          gatewayStatus: 'gateway_validation_failed',
          failureMessage: 'Razorpay payment details did not match the stored order',
        },
      });
      return res.status(400).json({ error: 'Razorpay payment validation failed' });
    }

    if (payment.paymentStatus === 'Paid' && payment.razorpayPaymentId === String(razorpayPaymentId)) {
      return res.json({ success: true, paymentId: payment.id, status: 'Paid' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const reservation = await tx.reservation.findUnique({ where: { id: payment.reservationId } });
      if (!reservation) throw new Error('Reservation not found');

      const amountDue = getAmountDue(reservation);
      if (payment.amount < amountDue) {
        throw new Error('Razorpay payment does not satisfy the reservation amount due');
      }

      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, paymentStatus: 'Pending' },
        data: {
          razorpayPaymentId: String(razorpayPaymentId),
          razorpaySignature: String(razorpaySignature),
          paymentStatus: 'Paid',
          gatewayStatus: 'captured',
        },
      });

      if (claimed.count === 0) {
        const currentPayment = await tx.payment.findUnique({ where: { id: payment.id } });
        if (currentPayment?.paymentStatus === 'Paid' && currentPayment.razorpayPaymentId === String(razorpayPaymentId)) {
          return { updatedPayment: currentPayment, updatedReservation: reservation };
        }
        throw new Error('Payment has already been processed');
      }

      const updatedPayment = await tx.payment.findUnique({ where: { id: payment.id } });
      const updatedReservation = await tx.reservation.update({
        where: { id: payment.reservationId },
        data: {
          paidAmount: { increment: payment.amount },
        },
      });

      return { updatedPayment, updatedReservation };
    });

    try {
      await createNotification({
        type: NotificationType.PAYMENT_RECEIVED,
        title: 'Payment Received',
        message: `Razorpay payment received for Reservation #${result.updatedReservation.id}.`,
        priority: NotificationPriority.NORMAL,
        reservationId: result.updatedReservation.id,
        metadata: { paymentId: result.updatedPayment.id, status: result.updatedPayment.paymentStatus },
      });
    } catch (notificationError) {
      console.error('[razorpayController] PAYMENT_RECEIVED notification failed:', notificationError.message);
    }

    return res.json({
      success: true,
      paymentId: result.updatedPayment.id,
      reservationId: result.updatedReservation.id,
      status: result.updatedPayment.paymentStatus,
    });
  } catch (err) {
    const message = err?.message || 'Unable to verify Razorpay payment';
    const status = message.includes('Razorpay credentials') ? 503 : 400;
    return res.status(status).json({ error: message });
  }
}
