import { prisma } from '../utils/db.js';
import { createNotification, NotificationType, NotificationPriority } from '../utils/notificationService.js';

function paginate(data, page, limit) {
  const total = data.length;
  const pages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  return { items: data.slice(start, start + limit), total, page, limit, pages };
}

export async function listGuests(req, res) {
  try {
    const { page = 1, limit = 50, q = '' } = req.query;
    const guests = await prisma.guest.findMany({
      where: {
        reservations: {
          some: {}
        }
      },
      include: { reservations: true },
      orderBy: { createdAt: 'desc' }
    });
    const filtered = q
      ? guests.filter(g => `${g.firstName} ${g.lastName} ${g.email || ''} ${g.phone || ''}`.toLowerCase().includes(q.toLowerCase()))
      : guests;
    res.json(paginate(filtered, Number(page), Number(limit)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

function validateServerGuest(data) {
  if (data.firstName !== undefined) {
    const fn = String(data.firstName || '').trim();
    if (!fn || fn.length < 2 || !/^[A-Za-z\s'\-]+$/.test(fn)) {
      return 'First Name must contain at least 2 alphabetic characters.';
    }
  }
  if (data.lastName !== undefined) {
    const ln = String(data.lastName || '').trim();
    if (!ln || !/^[A-Za-z\s'\-]+$/.test(ln)) {
      return 'Last Name must contain only alphabetic characters.';
    }
  }
  if (data.email) {
    const em = String(data.email).trim();
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+\.[a-zA-Z]{2,}$/;
    const parts = em.split('@');
    if (!emailRegex.test(em) || parts.length !== 2 || parts[1].startsWith('.') || parts[1].endsWith('.') || parts[1].includes('..')) {
      return 'Please provide a valid email address (e.g. guest@example.com).';
    }
  }
  if (data.phone) {
  const phone = String(data.phone).trim();
  const cleanPhone = phone.replace(/\D/g, '');

  // International phone numbers:
  // - Optional leading +
  // - 10 to 15 digits total
  // - Reject repeated digits and known invalid test number
  const internationalPhoneRegex = /^\+?[1-9]\d{9,14}$/;

  if (
    !internationalPhoneRegex.test(phone) ||
    /^(\d)\1+$/.test(cleanPhone) ||
    cleanPhone === '1234567890'
  ) {
    return 'Please provide a valid international phone number.';
  }
}
  return null;
}

const ALLOWED_GUEST_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'idDocument', 'loyaltyPoints', 'notes'];

function filterGuestFields(input) {
  const data = {};
  for (const key of ALLOWED_GUEST_FIELDS) {
    if (key in input) data[key] = input[key];
  }
  return data;
}

export async function createGuest(req, res) {
  try {
    const err = validateServerGuest(req.body);
    if (err) return res.status(400).json({ error: err });

    const safeData = filterGuestFields(req.body);
    const guest = await prisma.guest.create({ data: safeData });
    res.status(201).json(guest);
    try {
      await createNotification({
        type: NotificationType.USER_CREATED,
        title: 'Guest Created',
        message: `Guest profile created for ${guest.firstName} ${guest.lastName || ''}`.trim(),
        priority: NotificationPriority.NORMAL,
        guestId: guest.id,
        metadata: { guestId: guest.id },
      });
    } catch (notifErr) {
      console.error('[guestController] GUEST_CREATED notification failed:', notifErr.message);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function updateGuest(req, res) {
  try {
    const err = validateServerGuest(req.body);
    if (err) return res.status(400).json({ error: err });

    const safeData = filterGuestFields(req.body);
    const guest = await prisma.guest.update({ where: { id: Number(req.params.id) }, data: safeData });
    res.json(guest);
    try {
      await createNotification({
        type: NotificationType.USER_UPDATED,
        title: 'Guest Updated',
        message: `Guest profile updated for ${guest.firstName} ${guest.lastName || ''}`.trim(),
        priority: NotificationPriority.NORMAL,
        guestId: guest.id,
        metadata: { guestId: guest.id },
      });
    } catch (notifErr) {
      console.error('[guestController] GUEST_UPDATED notification failed:', notifErr.message);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deleteGuest(req, res) {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.guest.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: 'Guest not found' });
    }

    await prisma.guest.delete({ where: { id } });
    res.json({ success: true });

    try {
      const guestName = `${existing.firstName} ${existing.lastName || ''}`.trim();
      await createNotification({
        type: NotificationType.GUEST_DELETED,
        title: 'Guest Profile Deleted',
        message: `Guest profile for ${guestName} has been deleted`,
        priority: NotificationPriority.NORMAL,
        guestId: existing.id,
        metadata: { guestId: existing.id, guestName },
      });
    } catch (notifErr) {
      console.error('[guestController] GUEST_DELETED notification failed:', notifErr.message);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
