import { PrismaClient } from '@prisma/client';
import { createNotification, NotificationType, NotificationPriority } from '../utils/notificationService.js';
const prisma = new PrismaClient();

function paginate(data, page, limit) {
  const total = data.length;
  const pages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  return { items: data.slice(start, start + limit), total, page, limit, pages };
}

export async function listHousekeeping(req, res) {
  try {
    const { page = 1, limit = 50, q = '' } = req.query;
    const items = await prisma.housekeeping.findMany({ orderBy: { createdAt: 'desc' } });
    
    // Resolve assigned housekeeper names if stored as user IDs
    const users = await prisma.user.findMany({ select: { id: true, name: true, role: true } });
    const userMap = new Map(users.map(u => [String(u.id), u.name]));

    const enriched = items.map(item => {
      let displayName = item.assignedTo;
      if (item.assignedTo && userMap.has(String(item.assignedTo))) {
        displayName = userMap.get(String(item.assignedTo));
      }
      return {
        ...item,
        assignedTo: displayName || item.assignedTo || null
      };
    });

    const filtered = q
      ? enriched.filter(i => `${i.status} ${i.assignedTo || ''} ${i.notes || ''}`.toLowerCase().includes(q.toLowerCase()))
      : enriched;
    res.json(paginate(filtered, Number(page), Number(limit)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createHousekeeping(req, res) {
  try {
    const item = await prisma.housekeeping.create({ data: {
      roomId: req.body.roomId ? Number(req.body.roomId) : null,
      status: req.body.status || 'pending',
      assignedTo: req.body.assignedTo || null,
      notes: req.body.notes || null
    }});
    res.status(201).json(item);

    // Fire HOUSEKEEPING_TASK_CREATED notification
    try {
      const room = item.roomId ? await prisma.room.findUnique({ where: { id: item.roomId } }) : null;
      const roomLabel = room ? `Room ${room.room_number}` : (item.roomId ? `Room ${item.roomId}` : '');
      await createNotification({
        type: NotificationType.HOUSEKEEPING_TASK_CREATED,
        title: 'Housekeeping Task Created',
        message: `New housekeeping task created${roomLabel ? ` for ${roomLabel}` : ''}${item.assignedTo ? ` – Assigned to ${item.assignedTo}` : ''}`,
        priority: NotificationPriority.NORMAL,
        roomId: item.roomId,
        metadata: { roomId: item.roomId, roomNumber: room?.room_number, taskId: item.id },
      });
    } catch (notifErr) {
      console.error('[housekeepingController] TASK_CREATED notification failed:', notifErr.message);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateHousekeeping(req, res) {
  try {
    const rawId = req.params.id;
    let numericId = Number(rawId);

    if (isNaN(numericId) && typeof rawId === 'string' && rawId.startsWith('dirty-')) {
      const roomId = Number(rawId.replace('dirty-', ''));
      let existing = await prisma.housekeeping.findFirst({ where: { roomId } });
      if (!existing) {
        existing = await prisma.housekeeping.create({
          data: {
            roomId,
            status: req.body.status || 'in-progress',
            assignedTo: req.body.assignedTo || 'Maria Rodriguez',
            notes: req.body.notes || 'Room marked dirty - Turnaround cleaning required'
          }
        });
        // Fire notification for newly created task
        try {
          const room = await prisma.room.findUnique({ where: { id: roomId } });
          const roomLabel = room ? `Room ${room.room_number}` : `Room ${roomId}`;
          await createNotification({
            type: NotificationType.HOUSEKEEPING_TASK_UPDATED,
            title: 'Housekeeping Cleaning In Progress',
            message: `Housekeeping started turnaround cleaning for ${roomLabel}`,
            priority: NotificationPriority.NORMAL,
            roomId,
            metadata: { roomId, roomNumber: room?.room_number, taskId: existing.id }
          });
        } catch (notifErr) {
          console.error('[housekeepingController] fallback notification error:', notifErr.message);
        }
        return res.json(existing);
      }
      numericId = existing.id;
    }

    if (isNaN(numericId)) {
      return res.status(400).json({ error: 'Invalid housekeeping ID' });
    }

    const item = await prisma.housekeeping.update({
      where: { id: numericId },
      data: {
        ...(req.body.status && { status: req.body.status }),
        ...(req.body.assignedTo !== undefined && { assignedTo: req.body.assignedTo }),
        ...(req.body.notes !== undefined && { notes: req.body.notes })
      }
    });
    res.json(item);

    // Fire notification based on status
    try {
      const room = item.roomId ? await prisma.room.findUnique({ where: { id: item.roomId } }) : null;
      const roomLabel = room ? `Room ${room.room_number}` : (item.roomId ? `Room ${item.roomId}` : 'Room');
      const newStatus = (req.body.status || '').toLowerCase();

      if (newStatus === 'clean' || newStatus === 'completed' || newStatus === 'done') {
        await createNotification({
          type: NotificationType.HOUSEKEEPING_TASK_COMPLETED,
          title: 'Housekeeping Clean Completed',
          message: `${roomLabel} marked clean & vacant by Housekeeping`,
          priority: NotificationPriority.NORMAL,
          roomId: item.roomId,
          metadata: { roomId: item.roomId, roomNumber: room?.room_number, taskId: item.id },
        });
        if (item.roomId) {
          await createNotification({
            type: NotificationType.ROOM_CLEAN,
            title: 'Room Clean & Ready',
            message: `${roomLabel} has been cleaned and is ready for guest arrival`,
            priority: NotificationPriority.NORMAL,
            roomId: item.roomId,
            metadata: { roomId: item.roomId, roomNumber: room?.room_number },
          });
        }
      } else if (newStatus === 'inspected') {
        await createNotification({
          type: NotificationType.ROOM_READY,
          title: 'Room Inspection Approved',
          message: `${roomLabel} inspection approved. Ready for check-in.`,
          priority: NotificationPriority.NORMAL,
          roomId: item.roomId,
          metadata: { roomId: item.roomId, roomNumber: room?.room_number, taskId: item.id },
        });
      } else if (newStatus === 'in-progress' || newStatus === 'in_progress') {
        await createNotification({
          type: NotificationType.HOUSEKEEPING_TASK_UPDATED,
          title: 'Housekeeping Cleaning In Progress',
          message: `Housekeeping started turnaround cleaning for ${roomLabel}${item.assignedTo ? ` (${item.assignedTo})` : ''}`,
          priority: NotificationPriority.NORMAL,
          roomId: item.roomId,
          metadata: { roomId: item.roomId, roomNumber: room?.room_number, taskId: item.id },
        });
      } else if (newStatus === 'pending' || newStatus === 'dirty') {
        await createNotification({
          type: NotificationType.ROOM_DIRTY,
          title: 'Room Marked Dirty',
          message: `${roomLabel} marked dirty – turnaround cleaning required`,
          priority: NotificationPriority.NORMAL,
          roomId: item.roomId,
          metadata: { roomId: item.roomId, roomNumber: room?.room_number, taskId: item.id },
        });
      }
    } catch (notifErr) {
      console.error('[housekeepingController] update notification failed:', notifErr.message);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteHousekeeping(req, res) {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.housekeeping.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Housekeeping task not found' });
    }

    await prisma.housekeeping.delete({ where: { id } });
    res.json({ success: true });

    try {
      const room = existing.roomId ? await prisma.room.findUnique({ where: { id: existing.roomId } }) : null;
      const roomLabel = room ? `Room ${room.room_number}` : (existing.roomId ? `Room ${existing.roomId}` : 'Room');
      await createNotification({
        type: NotificationType.HOUSEKEEPING_TASK_DELETED,
        title: 'Housekeeping Task Deleted',
        message: `Housekeeping turnaround task for ${roomLabel} was deleted`,
        priority: NotificationPriority.NORMAL,
        roomId: existing.roomId,
        metadata: { taskId: existing.id, roomNumber: room?.room_number },
      });
    } catch (notifErr) {
      console.error('[housekeepingController] HOUSEKEEPING_TASK_DELETED notification failed:', notifErr.message);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
