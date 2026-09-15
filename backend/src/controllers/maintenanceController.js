import { PrismaClient } from '@prisma/client';
import { createNotification, NotificationType, NotificationPriority } from '../utils/notificationService.js';
const prisma = new PrismaClient();

function paginate(data, page, limit) {
  const total = data.length;
  const pages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  return { items: data.slice(start, start + limit), total, page, limit, pages };
}

function parseTimerFromNotes(notes) {
  let repairStartedAt = null;
  let accumulatedSeconds = 0;
  let cleanNotes = notes || '';

  if (notes && typeof notes === 'string') {
    const match = notes.match(/<!--\s*TIMER:(\{.*?\})\s*-->/);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        repairStartedAt = parsed.repairStartedAt || null;
        accumulatedSeconds = Number(parsed.accumulatedSeconds) || 0;
        cleanNotes = notes.replace(/<!--\s*TIMER:\{.*?\}\s*-->/, '').trim();
      } catch (e) {
        // ignore JSON parse error
      }
    }
  }
  return { repairStartedAt, accumulatedSeconds, cleanNotes };
}

function buildNotesWithTimer(notes, repairStartedAt, accumulatedSeconds) {
  let baseNotes = notes || '';
  // remove any existing timer comment from baseNotes first
  baseNotes = baseNotes.replace(/<!--\s*TIMER:\{.*?\}\s*-->/g, '').trim();

  if (repairStartedAt !== undefined || accumulatedSeconds !== undefined) {
    const timerPayload = {};
    if (repairStartedAt !== undefined) {
      timerPayload.repairStartedAt = repairStartedAt;
    }
    if (accumulatedSeconds !== undefined) {
      timerPayload.accumulatedSeconds = Number(accumulatedSeconds) || 0;
    }
    const timerComment = `<!-- TIMER:${JSON.stringify(timerPayload)} -->`;
    return baseNotes ? `${baseNotes} ${timerComment}` : timerComment;
  }
  return baseNotes || null;
}

function serializeMaintenanceItem(item) {
  if (!item) return item;
  const { repairStartedAt, accumulatedSeconds, cleanNotes } = parseTimerFromNotes(item.notes);
  return {
    ...item,
    notes: cleanNotes || null,
    repairStartedAt,
    accumulatedSeconds
  };
}

export async function listMaintenance(req, res) {
  try {
    const { page = 1, limit = 50, q = '' } = req.query;
    const items = await prisma.maintenance.findMany({ orderBy: { createdAt: 'desc' } });
    const serialized = items.map(serializeMaintenanceItem);
    const filtered = q
      ? serialized.filter(i => `${i.issue} ${i.status} ${i.priority} ${i.notes || ''}`.toLowerCase().includes(q.toLowerCase()))
      : serialized;
    res.json(paginate(filtered, Number(page), Number(limit)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createMaintenance(req, res) {
  try {
    if (!req.body.issue || !String(req.body.issue).trim()) {
      return res.status(400).json({ error: 'Issue description is required' });
    }
    const finalNotes = buildNotesWithTimer(
      req.body.notes,
      req.body.repairStartedAt,
      req.body.accumulatedSeconds
    );
    const item = await prisma.maintenance.create({ data: {
      roomId: req.body.roomId ? Number(req.body.roomId) : null,
      issue: String(req.body.issue).trim(),
      priority: req.body.priority || 'normal',
      status: req.body.status || 'open',
      notes: finalNotes
    }});
    res.status(201).json(serializeMaintenanceItem(item));

    // Fire MAINTENANCE_CREATED notification
    try {
      const room = item.roomId ? await prisma.room.findUnique({ where: { id: item.roomId } }) : null;
      const roomLabel = room ? `Room ${room.room_number}` : (item.roomId ? `Room ${item.roomId}` : '');
      const priority = item.priority === 'urgent' || item.priority === 'high'
        ? NotificationPriority.HIGH
        : NotificationPriority.NORMAL;
      await createNotification({
        type: NotificationType.MAINTENANCE_CREATED,
        title: 'Maintenance Request Created',
        message: `Maintenance required${roomLabel ? ` for ${roomLabel}` : ''}: ${item.issue}${item.priority !== 'normal' ? ` (${item.priority} priority)` : ''}`,
        priority,
        roomId: item.roomId,
        metadata: { roomId: item.roomId, roomNumber: room?.room_number, issue: item.issue, maintenanceId: item.id },
      });
    } catch (notifErr) {
      console.error('[maintenanceController] MAINTENANCE_CREATED notification failed:', notifErr.message);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateMaintenance(req, res) {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.maintenance.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Maintenance record not found' });
    }

    const { repairStartedAt: existingStartedAt, accumulatedSeconds: existingAccumulated, cleanNotes: existingCleanNotes } = parseTimerFromNotes(existing.notes);

    const notesToUse = req.body.notes !== undefined ? req.body.notes : existingCleanNotes;
    const repairStartedAtToUse = req.body.repairStartedAt !== undefined ? req.body.repairStartedAt : existingStartedAt;
    const accumulatedSecondsToUse = req.body.accumulatedSeconds !== undefined ? req.body.accumulatedSeconds : existingAccumulated;

    const newStatus = (req.body.status || existing.status || '').toLowerCase();
    let finalNotes;
    if (newStatus === 'resolved' || newStatus === 'completed') {
      finalNotes = (notesToUse || '').replace(/<!--\s*TIMER:\{.*?\}\s*-->/g, '').trim() || null;
    } else {
      finalNotes = buildNotesWithTimer(notesToUse, repairStartedAtToUse, accumulatedSecondsToUse);
    }

    const item = await prisma.maintenance.update({
      where: { id },
      data: {
        ...(req.body.issue && { issue: req.body.issue }),
        ...(req.body.priority && { priority: req.body.priority }),
        ...(req.body.status && { status: req.body.status }),
        notes: finalNotes
      }
    });
    res.json(serializeMaintenanceItem(item));

    // Fire notification based on status change
    try {
      const room = item.roomId ? await prisma.room.findUnique({ where: { id: item.roomId } }) : null;
      const roomLabel = room ? `Room ${room.room_number}` : (item.roomId ? `Room ${item.roomId}` : '');
      const newStatus = (req.body.status || '').toLowerCase();

      if (newStatus === 'completed' || newStatus === 'done' || newStatus === 'resolved') {
        await createNotification({
          type: NotificationType.MAINTENANCE_COMPLETED,
          title: 'Maintenance Resolved',
          message: `Maintenance issue resolved${roomLabel ? ` for ${roomLabel}` : ''}: ${item.issue}`,
          priority: NotificationPriority.NORMAL,
          roomId: item.roomId,
          metadata: { roomId: item.roomId, roomNumber: room?.room_number, issue: item.issue, maintenanceId: item.id },
        });
      } else if (newStatus === 'in_progress' || newStatus === 'in-progress' || newStatus === 'assigned') {
        await createNotification({
          type: NotificationType.MAINTENANCE_UPDATED,
          title: 'Maintenance Repair Started',
          message: `Maintenance repair in progress${roomLabel ? ` for ${roomLabel}` : ''}: ${item.issue}`,
          priority: NotificationPriority.NORMAL,
          roomId: item.roomId,
          metadata: { roomId: item.roomId, roomNumber: room?.room_number, issue: item.issue, maintenanceId: item.id },
        });
      } else if (newStatus === 'paused') {
        await createNotification({
          type: NotificationType.MAINTENANCE_UPDATED,
          title: 'Maintenance Repair Paused',
          message: `Maintenance repair paused${roomLabel ? ` for ${roomLabel}` : ''}: ${item.issue}`,
          priority: NotificationPriority.NORMAL,
          roomId: item.roomId,
          metadata: { roomId: item.roomId, roomNumber: room?.room_number, issue: item.issue, maintenanceId: item.id },
        });
      }
    } catch (notifErr) {
      console.error('[maintenanceController] update notification failed:', notifErr.message);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteMaintenance(req, res) {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.maintenance.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Maintenance record not found' });
    }

    await prisma.maintenance.delete({ where: { id } });
    res.json({ success: true });

    try {
      const room = existing.roomId ? await prisma.room.findUnique({ where: { id: existing.roomId } }) : null;
      const roomLabel = room ? `Room ${room.room_number}` : (existing.roomId ? `Room ${existing.roomId}` : '');
      await createNotification({
        type: NotificationType.MAINTENANCE_DELETED,
        title: 'Maintenance Ticket Deleted',
        message: `Maintenance ticket #${existing.id}${roomLabel ? ` for ${roomLabel}` : ''} (${existing.issue}) was deleted`,
        priority: NotificationPriority.NORMAL,
        roomId: existing.roomId,
        metadata: { maintenanceId: existing.id, issue: existing.issue, roomNumber: room?.room_number },
      });
    } catch (notifErr) {
      console.error('[maintenanceController] MAINTENANCE_DELETED notification failed:', notifErr.message);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
