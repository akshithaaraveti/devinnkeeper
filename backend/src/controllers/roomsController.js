import { prisma } from '../utils/db.js';
import { createNotification, NotificationType, NotificationPriority } from '../utils/notificationService.js';


function paginate(data, page, limit) {
  const total = data.length;
  const pages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  return { items: data.slice(start, start + limit), total, page, limit, pages };
}

export async function listRoomsNew(req, res) {
  try {
    const { page = 1, limit = 200, q = '' } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const whereClause = q ? {
      OR: [
        { room_number: { contains: q, mode: 'insensitive' } },
        { room_type: { name: { contains: q, mode: 'insensitive' } } }
      ]
    } : {};

    const [total, rooms] = await Promise.all([
      prisma.room.count({ where: whereClause }),
      prisma.room.findMany({
        where: whereClause,
        include: { room_type: true, channelInventory: true },
        orderBy: [{ floor: 'asc' }, { id: 'asc' }],
        skip,
        take
      })
    ]);

    const pages = Math.ceil(total / take);

    const normalized = rooms.map(r => ({
      id: r.id,
      number: r.room_number,
      name: `Room ${r.room_number}`,
      type: r.room_type?.name?.toLowerCase() || 'standard',
      floor: r.floor,
      status: r.status?.toLowerCase() || 'vacant',
      rate: r.current_price,
      capacity: r.room_type?.capacity || 2,
      amenities: r.room_type?.description || null,
      isAvailable: r.availability ? 1 : 0,
      createdAt: r.last_updated,
      updatedAt: r.last_updated,
    }));
    
    res.json({ items: normalized, total, page: Number(page), limit: take, pages });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
}

export async function getRoomNew(req, res) {
  try {
    const room = await prisma.room.findUnique({
      where: { id: Number(req.params.id) },
      include: { room_type: true }
    });
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ ...room, number: room.room_number, type: room.room_type?.name?.toLowerCase() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createRoomNew(req, res) {
  try {
    const { number, type, floor, status, rate, capacity } = req.body;
    if (!number || !String(number).trim()) {
      return res.status(400).json({ error: 'Room number is required.' });
    }

    const existing = await prisma.room.findUnique({ where: { room_number: String(number).trim() } });
    if (existing) {
      return res.status(409).json({ error: `Room ${number} already exists.` });
    }

    // Find or create room_type
    let roomType = await prisma.roomType.findFirst({ where: { name: { contains: type, mode: 'insensitive' } } });
    if (!roomType) {
      roomType = await prisma.roomType.create({ data: { name: type || 'Standard', base_price: rate || 100, capacity: capacity || 2, description: '' } });
    }
    const room = await prisma.room.create({
      data: { room_number: String(number).trim(), room_type_id: roomType.id, floor: floor || 1, status: status || 'Vacant', current_price: rate || roomType.base_price, availability: true }
    });
    res.status(201).json(room);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: `Room ${req.body?.number} already exists.` });
    }
    res.status(500).json({ error: err.message });
  }
}

export async function updateRoomNew(req, res) {
  try {
    const { status, rate, isAvailable, floor } = req.body;
    const roomId = Number(req.params.id);
    const room = await prisma.room.update({
      where: { id: roomId },
      data: {
        ...(status && { status }),
        ...(rate !== undefined && { current_price: rate }),
        ...(isAvailable !== undefined && { availability: Boolean(isAvailable) }),
        ...(floor !== undefined && { floor }),
        last_updated: new Date()
      }
    });

    if (status) {
      const st = String(status).toLowerCase();
      if (st === 'dirty' || st === 'vacant' || st === 'clean' || st === 'maintenance' || st === 'under_maintenance' || st === 'out_of_service') {
        const activeRes = await prisma.reservation.findMany({
          where: {
            roomId: roomId,
            status: { in: ['checked_in', 'CHECKED_IN'] }
          }
        });
        for (const r of activeRes) {
          await prisma.reservation.update({
            where: { id: r.id },
            data: { status: 'checked_out', digitalKeyStatus: 'EXPIRED' }
          });
        }
      } else if (st === 'occupied') {
        const confirmedRes = await prisma.reservation.findMany({
          where: {
            roomId: roomId,
            status: { in: ['confirmed', 'CONFIRMED'] }
          }
        });
        for (const r of confirmedRes) {
          if (r.verificationStatus === 'VERIFIED') {
            await prisma.reservation.update({
              where: { id: r.id },
              data: { status: 'checked_in' }
            });
          }
        }
      }
    }

    res.json(room);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteRoomNew(req, res) {
  try {
    const roomId = Number(req.params.id);
    const activeBookings = await prisma.reservation.findMany({
      where: {
        roomId,
        status: { in: ['confirmed', 'checked_in'] }
      }
    });

    if (activeBookings.length > 0) {
      return res.status(400).json({ error: `Cannot delete room #${roomId}: ${activeBookings.length} active reservation(s) exist. Please relocate or check out guests first.` });
    }

    const room = await prisma.room.findUnique({ where: { id: roomId } });

    await prisma.room.delete({ where: { id: roomId } });
    res.json({ success: true });

    try {
      await createNotification({
        type: NotificationType.ROOM_DELETED,
        title: 'Room Deleted',
        message: `Room ${room?.room_number || roomId} has been removed from inventory`,
        priority: NotificationPriority.HIGH,
        roomId,
        metadata: { roomId, roomNumber: room?.room_number },
      });
    } catch (notifErr) {
      console.error('[roomsController] ROOM_DELETED notification failed:', notifErr.message);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
// ─── Housekeeping Room Status Actions ─────────────────────

export async function startCleaning(req, res) {
  try {
    const roomId = Number(req.params.id);

    const room = await prisma.room.update({
      where: { id: roomId },
      data: {
        status: 'CLEANING_IN_PROGRESS',
        last_updated: new Date(),
      },
    });

    res.json({
      success: true,
      data: {
        ...room,
        roomNumber: room.room_number,
      },
    });
  } catch (err) {
    console.error('Failed to start cleaning:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

export async function markRoomClean(req, res) {
  try {
    const roomId = Number(req.params.id);
    const { notes } = req.body;

    const room = await prisma.room.update({
      where: { id: roomId },
      data: {
        status: 'CLEAN',
        availability: true,
        last_updated: new Date(),
      },
    });

    res.json({
      success: true,
      data: {
        ...room,
        roomNumber: room.room_number,
        cleaningNotes: notes || null,
      },
    });

    try {
      await createNotification({
        type: NotificationType.ROOM_CLEAN,
        title: `Room ${room.room_number} Clean`,
        message: `Room ${room.room_number} has been marked clean.`,
        targetRoles: ['receptionist', 'manager', 'admin'],
        priority: NotificationPriority.NORMAL,
        roomId: room.id,
        metadata: { roomNumber: room.room_number }
      });
    } catch (e) {
      console.error('Room clean notification error:', e);
    }

  } catch (err) {
    console.error('Failed to mark room clean:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

export async function markRoomDirty(req, res) {
  try {
    const roomId = Number(req.params.id);

    const room = await prisma.room.update({
      where: { id: roomId },
      data: {
        status: 'DIRTY',
        availability: false,
        last_updated: new Date(),
      },
    });

    res.json({
      success: true,
      data: {
        ...room,
        roomNumber: room.room_number,
      },
    });

    try {
      await createNotification({
        type: NotificationType.ROOM_DIRTY,
        title: `Room ${room.room_number} Marked Dirty`,
        message: `Room ${room.room_number} needs cleaning.`,
        targetRoles: ['housekeeping', 'manager', 'admin'],
        priority: NotificationPriority.HIGH,
        roomId: room.id,
        metadata: { roomNumber: room.room_number }
      });
    } catch (e) {
      console.error('Room dirty notification error:', e);
    }

  } catch (err) {
    console.error('Failed to mark room dirty:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}

export async function markRoomInspected(req, res) {
  try {
    const roomId = Number(req.params.id);

    const room = await prisma.room.update({
      where: { id: roomId },
      data: {
        status: 'CLEAN',
        availability: true,
        last_updated: new Date(),
      },
    });

    res.json({
      success: true,
      data: {
        ...room,
        roomNumber: room.room_number,
      },
    });
  } catch (err) {
    console.error('Failed to mark room inspected:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
}