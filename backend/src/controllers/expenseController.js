import { prisma } from '../utils/db.js';
import { recordAuditLog } from '../services/rbacService.js';
import { createNotification, NotificationType, NotificationPriority } from '../utils/notificationService.js';

export async function getExpenses(req, res) {
  try {
    const expenses = await prisma.expense.findMany({
      orderBy: { date: 'desc' },
    });
    res.json({ success: true, data: expenses });
  } catch (error) {
    console.error('Error fetching expenses:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve expenses' });
  }
}

export async function createExpense(req, res) {
  try {
    const { title, amount, category, notes, date } = req.body;
    if (!title || amount === undefined) {
      return res.status(400).json({ success: false, message: 'Title and amount are required' });
    }

    const expense = await prisma.expense.create({
      data: {
        title,
        amount: parseFloat(amount),
        category: category || 'General',
        notes: notes || null,
        date: date ? new Date(date) : new Date(),
        status: 'pending',
      },
    });

    await recordAuditLog({
      userId: req.user?.id,
      userEmail: req.user?.email,
      userName: req.user?.name,
      action: 'CREATE',
      module: 'expenses',
      details: `Created expense "${title}" for amount ${amount}`,
      ipAddress: req.ip,
    });

    res.status(201).json({ success: true, data: expense });
  } catch (error) {
    console.error('Error creating expense:', error);
    res.status(500).json({ success: false, message: 'Failed to create expense' });
  }
}

export async function updateExpense(req, res) {
  try {
    const { id } = req.params;
    const { title, amount, category, notes, status } = req.body;

    const data = {};
    if (title !== undefined) data.title = title;
    if (amount !== undefined) data.amount = parseFloat(amount);
    if (category !== undefined) data.category = category;
    if (notes !== undefined) data.notes = notes;
    if (status !== undefined) data.status = status;

    const updated = await prisma.expense.update({
      where: { id: parseInt(id) },
      data,
    });

    await recordAuditLog({
      userId: req.user?.id,
      userEmail: req.user?.email,
      userName: req.user?.name,
      action: 'EDIT',
      module: 'expenses',
      details: `Updated expense #${id} (${updated.title})`,
      ipAddress: req.ip,
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error updating expense:', error);
    res.status(500).json({ success: false, message: 'Failed to update expense' });
  }
}

export async function deleteExpense(req, res) {
  try {
    const { id } = req.params;
    const expense = await prisma.expense.delete({
      where: { id: parseInt(id) },
    });

    await recordAuditLog({
      userId: req.user?.id,
      userEmail: req.user?.email,
      userName: req.user?.name,
      action: 'DELETE',
      module: 'expenses',
      details: `Deleted expense #${id} (${expense.title})`,
      ipAddress: req.ip,
    });

    res.json({ success: true, message: 'Expense deleted successfully' });

    try {
      await createNotification({
        type: NotificationType.EXPENSE_DELETED,
        title: 'Expense Deleted',
        message: `Expense #${id} (${expense.title} - ₹${expense.amount}) was deleted`,
        priority: NotificationPriority.NORMAL,
        metadata: { expenseId: expense.id, title: expense.title, amount: expense.amount },
      });
    } catch (notifErr) {
      console.error('[expenseController] EXPENSE_DELETED notification failed:', notifErr.message);
    }
  } catch (error) {
    console.error('Error deleting expense:', error);
    res.status(500).json({ success: false, message: 'Failed to delete expense' });
  }
}

export async function approveExpense(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'approved' or 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be approved or rejected' });
    }

    const updated = await prisma.expense.update({
      where: { id: parseInt(id) },
      data: {
        status,
        approvedBy: req.user?.name || req.user?.email || 'Authorized Staff',
      },
    });

    await recordAuditLog({
      userId: req.user?.id,
      userEmail: req.user?.email,
      userName: req.user?.name,
      action: 'APPROVE',
      module: 'expenses',
      details: `${status.toUpperCase()} expense #${id} (${updated.title})`,
      ipAddress: req.ip,
    });

    res.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error approving expense:', error);
    res.status(500).json({ success: false, message: 'Failed to process expense approval' });
  }
}
