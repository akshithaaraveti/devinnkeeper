import { prisma } from '../utils/db.js';
import { createNotification, NotificationType, NotificationPriority } from '../utils/notificationService.js';

function paginate(data, page, limit) {
  const total = data.length;
  const pages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  return { items: data.slice(start, start + limit), total, page, limit, pages };
}

export async function listVehicles(req, res) {
  try {
    const { page = 1, limit = 20, q = '' } = req.query;
    const vehicles = await prisma.vehicle.findMany({ orderBy: { createdAt: 'desc' } });
    const filtered = q
      ? vehicles.filter(v => `${v.make} ${v.model} ${v.licensePlate} ${v.state} ${v.parkingSlot || ''}`.toLowerCase().includes(q.toLowerCase()))
      : vehicles;
    res.json(paginate(filtered, Number(page), Number(limit)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getVehicle(req, res) {
  try {
    const vehicle = await prisma.vehicle.findUnique({ where: { id: Number(req.params.id) } });
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function createVehicle(req, res) {
  try {
    const { make, model, licensePlate, state, parkingSlot } = req.body;
    if (!licensePlate || !String(licensePlate).trim()) {
      return res.status(400).json({ error: 'License plate is required.' });
    }
    const cleanPlate = String(licensePlate).trim().toUpperCase();
    const norm = (s) => String(s || '').replace(/\s+/g, '').toUpperCase();

    const allVehicles = await prisma.vehicle.findMany();
    const existing = allVehicles.find(v => norm(v.licensePlate) === norm(cleanPlate));
    if (existing) {
      return res.status(400).json({ error: `Vehicle with license plate ${cleanPlate} is already registered.` });
    }

    const vehicle = await prisma.vehicle.create({
      data: {
        make: make ? String(make).trim() : 'Unknown',
        model: model ? String(model).trim() : '',
        licensePlate: cleanPlate,
        state: state ? String(state).trim() : 'NA',
        parkingSlot: parkingSlot ? String(parkingSlot).trim() : null
      }
    });
    res.status(201).json(vehicle);

    try {
      await createNotification({
        type: NotificationType.VEHICLE_REGISTERED,
        title: 'Vehicle Registered',
        message: `New vehicle registered: ${vehicle.make} ${vehicle.model || ''} (${vehicle.licensePlate})${vehicle.parkingSlot ? ` in slot ${vehicle.parkingSlot}` : ''}`,
        priority: NotificationPriority.NORMAL,
        metadata: { vehicleId: vehicle.id, licensePlate: vehicle.licensePlate, parkingSlot: vehicle.parkingSlot },
      });
    } catch (notifErr) {
      console.error('[vehicleController] VEHICLE_REGISTERED notification failed:', notifErr.message);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateVehicle(req, res) {
  try {
    const ALLOWED_VEHICLE_FIELDS = ['make', 'model', 'licensePlate', 'state', 'parkingSlot', 'guestId'];
    const safeData = {};
    for (const key of ALLOWED_VEHICLE_FIELDS) {
      if (key in req.body) safeData[key] = req.body[key];
    }
    const vehicle = await prisma.vehicle.update({ where: { id: Number(req.params.id) }, data: safeData });
    res.json(vehicle);

    try {
      await createNotification({
        type: NotificationType.VEHICLE_UPDATED,
        title: 'Vehicle Updated',
        message: `Vehicle details updated for ${vehicle.make} ${vehicle.model || ''} (${vehicle.licensePlate})`,
        priority: NotificationPriority.NORMAL,
        metadata: { vehicleId: vehicle.id, licensePlate: vehicle.licensePlate },
      });
    } catch (notifErr) {
      console.error('[vehicleController] VEHICLE_UPDATED notification failed:', notifErr.message);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteVehicle(req, res) {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.vehicle.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    await prisma.vehicle.delete({ where: { id } });
    res.json({ success: true });

    try {
      await createNotification({
        type: NotificationType.VEHICLE_DELETED,
        title: 'Vehicle Removed',
        message: `Vehicle removed: ${existing.make} ${existing.model || ''} (${existing.licensePlate})`,
        priority: NotificationPriority.NORMAL,
        metadata: { vehicleId: existing.id, licensePlate: existing.licensePlate },
      });
    } catch (notifErr) {
      console.error('[vehicleController] VEHICLE_DELETED notification failed:', notifErr.message);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
