import { PrismaClient } from '@prisma/client';
import { createNotification, NotificationType, NotificationPriority } from '../utils/notificationService.js';
const prisma = new PrismaClient();

function paginate(data, page, limit) {
  const total = data.length;
  const pages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  return { items: data.slice(start, start + limit), total, page, limit, pages };
}

export async function listCashLedger(req, res) {
  try {
    const { limit = 50, q = '' } = req.query;
    const entries = await prisma.cashLedger.findMany({ orderBy: { createdAt: 'desc' } });
    const filtered = q
      ? entries.filter(e => `${e.employeeName} ${e.status} ${e.notes || ''}`.toLowerCase().includes(q.toLowerCase()))
      : entries;
    res.json(paginate(filtered, 1, Number(limit)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createCashLedger(req, res) {
  try {
    const { employeeName, openingCash, closingCash, status, notes } = req.body;
    if (!employeeName || !String(employeeName).trim()) {
      return res.status(400).json({ error: 'Employee Name is required.' });
    }
    const entry = await prisma.cashLedger.create({
      data: {
        employeeName: String(employeeName).trim(),
        openingCash: Number(openingCash ?? 0),
        closingCash: Number(closingCash ?? 0),
        status: status || 'open',
        notes: notes || null
      }
    });
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateCashLedger(req, res) {
  try {
    const entry = await prisma.cashLedger.update({
      where: { id: Number(req.params.id) },
      data: {
        ...(req.body.employeeName && { employeeName: req.body.employeeName }),
        ...(req.body.openingCash !== undefined && { openingCash: Number(req.body.openingCash) }),
        ...(req.body.closingCash !== undefined && { closingCash: Number(req.body.closingCash) }),
        ...(req.body.status && { status: req.body.status }),
        ...(req.body.notes !== undefined && { notes: req.body.notes })
      }
    });
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteCashLedger(req, res) {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.cashLedger.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Cash ledger record not found' });
    }

    await prisma.cashLedger.delete({ where: { id } });
    res.json({ success: true });

    try {
      await createNotification({
        type: NotificationType.CASH_LEDGER_DELETED,
        title: 'Cash Ledger Entry Deleted',
        message: `Cash ledger shift #${existing.id} for ${existing.employeeName} was deleted`,
        priority: NotificationPriority.HIGH,
        metadata: { ledgerId: existing.id, employeeName: existing.employeeName },
      });
    } catch (notifErr) {
      console.error('[cashLedgerController] CASH_LEDGER_DELETED notification failed:', notifErr.message);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
