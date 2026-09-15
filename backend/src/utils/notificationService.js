/**
 * notificationService.js
 * Centralized InnKeeper Notification Service
 *
 * All notification creation must flow through this service.
 * It:
 *   1. Validates the notification data
 *   2. Saves the notification to PostgreSQL
 *   3. Emits to Socket.IO rooms (role:* and user:*)
 *   4. Returns the created notification
 */

import { prisma } from './db.js';
import { getSocketIo } from './realtime.js';

// ─── Notification Type Constants ───────────────────────────────────────────────
export const NotificationType = {
  // Guest / Reservation
  NEW_RESERVATION:        'NEW_RESERVATION',
  RESERVATION_UPDATED:    'RESERVATION_UPDATED',
  RESERVATION_CANCELLED:  'RESERVATION_CANCELLED',
  NEW_ARRIVAL:            'NEW_ARRIVAL',
  GUEST_CHECKED_IN:       'GUEST_CHECKED_IN',
  GUEST_CHECKED_OUT:      'GUEST_CHECKED_OUT',

  // Rooms
  ROOM_STATUS_CHANGED:    'ROOM_STATUS_CHANGED',
  ROOM_DIRTY:             'ROOM_DIRTY',
  ROOM_CLEAN:             'ROOM_CLEAN',
  ROOM_READY:             'ROOM_READY',
  ROOM_OUT_OF_ORDER:      'ROOM_OUT_OF_ORDER',
  ROOM_OCCUPIED:          'ROOM_OCCUPIED',
  ROOM_VACANT:            'ROOM_VACANT',

  // Housekeeping
  HOUSEKEEPING_TASK_CREATED:    'HOUSEKEEPING_TASK_CREATED',
  HOUSEKEEPING_TASK_ASSIGNED:   'HOUSEKEEPING_TASK_ASSIGNED',
  HOUSEKEEPING_TASK_UPDATED:    'HOUSEKEEPING_TASK_UPDATED',
  HOUSEKEEPING_TASK_COMPLETED:  'HOUSEKEEPING_TASK_COMPLETED',
  ROOM_CLEANING_REQUIRED:       'ROOM_CLEANING_REQUIRED',
  ROOM_CLEANING_COMPLETED:      'ROOM_CLEANING_COMPLETED',

  // Maintenance
  MAINTENANCE_CREATED:    'MAINTENANCE_CREATED',
  MAINTENANCE_ASSIGNED:   'MAINTENANCE_ASSIGNED',
  MAINTENANCE_UPDATED:    'MAINTENANCE_UPDATED',
  MAINTENANCE_COMPLETED:  'MAINTENANCE_COMPLETED',

  // Payments
  PAYMENT_RECEIVED:   'PAYMENT_RECEIVED',
  PAYMENT_PENDING:    'PAYMENT_PENDING',
  PAYMENT_FAILED:     'PAYMENT_FAILED',
  PAYMENT_REFUNDED:   'PAYMENT_REFUNDED',

  // Vehicles
  VEHICLE_ARRIVED:    'VEHICLE_ARRIVED',
  VEHICLE_DEPARTED:   'VEHICLE_DEPARTED',
  VEHICLE_REGISTERED: 'VEHICLE_REGISTERED',
  VEHICLE_UPDATED:    'VEHICLE_UPDATED',

  // Shifts
  SHIFT_STARTED:  'SHIFT_STARTED',
  SHIFT_ENDED:    'SHIFT_ENDED',
  SHIFT_HANDOVER: 'SHIFT_HANDOVER',

  // Users/Admin
  USER_CREATED:       'USER_CREATED',
  USER_UPDATED:       'USER_UPDATED',
  USER_ROLE_CHANGED:  'USER_ROLE_CHANGED',
  USER_DEACTIVATED:   'USER_DEACTIVATED',

  // Deletions / Removals
  RESERVATION_DELETED:        'RESERVATION_DELETED',
  VEHICLE_DELETED:            'VEHICLE_DELETED',
  GUEST_DELETED:              'GUEST_DELETED',
  ROOM_DELETED:               'ROOM_DELETED',
  MAINTENANCE_DELETED:        'MAINTENANCE_DELETED',
  HOUSEKEEPING_TASK_DELETED:  'HOUSEKEEPING_TASK_DELETED',
  PAYMENT_DELETED:            'PAYMENT_DELETED',
  EXPENSE_DELETED:            'EXPENSE_DELETED',
  SHIFT_AUDIT_DELETED:        'SHIFT_AUDIT_DELETED',
  CASH_LEDGER_DELETED:        'CASH_LEDGER_DELETED',
};

// ─── Priority Constants ────────────────────────────────────────────────────────
export const NotificationPriority = {
  LOW:    'LOW',
  NORMAL: 'NORMAL',
  HIGH:   'HIGH',
  URGENT: 'URGENT',
};

// ─── Role-to-Notification Targeting Matrix ────────────────────────────────────
// Default roles for each notification type (can be overridden on createNotification)
const DEFAULT_TARGET_ROLES = {
  NEW_RESERVATION:         ['admin', 'manager', 'receptionist', 'staff'],
  RESERVATION_UPDATED:     ['admin', 'manager', 'receptionist', 'staff'],
  RESERVATION_CANCELLED:   ['admin', 'manager', 'receptionist', 'staff'],
  RESERVATION_DELETED:     ['admin', 'manager', 'receptionist', 'staff'],
  NEW_ARRIVAL:             ['admin', 'manager', 'receptionist', 'staff'],
  GUEST_CHECKED_IN:        ['admin', 'manager', 'receptionist', 'staff'],
  GUEST_CHECKED_OUT:       ['admin', 'manager', 'receptionist', 'housekeeping', 'staff'],
  GUEST_DELETED:           ['admin', 'manager', 'receptionist', 'staff'],
  ROOM_STATUS_CHANGED:     ['admin', 'manager', 'receptionist', 'housekeeping', 'staff'],
  ROOM_DIRTY:              ['admin', 'manager', 'receptionist', 'housekeeping', 'staff'],
  ROOM_CLEAN:              ['admin', 'manager', 'receptionist', 'housekeeping', 'staff'],
  ROOM_READY:              ['admin', 'manager', 'receptionist', 'staff'],
  ROOM_OUT_OF_ORDER:       ['admin', 'manager', 'receptionist', 'maintenance', 'staff'],
  ROOM_OCCUPIED:           ['admin', 'manager', 'receptionist', 'staff'],
  ROOM_VACANT:             ['admin', 'manager', 'receptionist', 'housekeeping', 'staff'],
  ROOM_DELETED:            ['admin', 'manager', 'receptionist', 'staff'],
  HOUSEKEEPING_TASK_CREATED:   ['admin', 'manager', 'housekeeping', 'staff'],
  HOUSEKEEPING_TASK_ASSIGNED:  ['admin', 'manager', 'housekeeping', 'staff'],
  HOUSEKEEPING_TASK_UPDATED:   ['admin', 'manager', 'housekeeping', 'staff'],
  HOUSEKEEPING_TASK_COMPLETED: ['admin', 'manager', 'receptionist', 'housekeeping', 'staff'],
  HOUSEKEEPING_TASK_DELETED:   ['admin', 'manager', 'housekeeping', 'staff'],
  ROOM_CLEANING_REQUIRED:      ['admin', 'manager', 'housekeeping', 'staff'],
  ROOM_CLEANING_COMPLETED:     ['admin', 'manager', 'receptionist', 'housekeeping', 'staff'],
  MAINTENANCE_CREATED:    ['admin', 'manager', 'receptionist', 'maintenance', 'staff'],
  MAINTENANCE_ASSIGNED:   ['admin', 'manager', 'maintenance', 'staff'],
  MAINTENANCE_UPDATED:    ['admin', 'manager', 'maintenance', 'staff'],
  MAINTENANCE_COMPLETED:  ['admin', 'manager', 'receptionist', 'maintenance', 'staff'],
  MAINTENANCE_DELETED:    ['admin', 'manager', 'receptionist', 'maintenance', 'staff'],
  PAYMENT_RECEIVED:   ['admin', 'manager', 'receptionist', 'staff'],
  PAYMENT_PENDING:    ['admin', 'manager', 'receptionist', 'staff'],
  PAYMENT_FAILED:     ['admin', 'manager', 'receptionist', 'staff'],
  PAYMENT_REFUNDED:   ['admin', 'manager', 'receptionist', 'staff'],
  PAYMENT_DELETED:    ['admin', 'manager', 'receptionist', 'staff'],
  VEHICLE_ARRIVED:    ['admin', 'manager', 'receptionist', 'staff'],
  VEHICLE_DEPARTED:   ['admin', 'manager', 'receptionist', 'staff'],
  VEHICLE_REGISTERED: ['admin', 'manager', 'receptionist', 'staff'],
  VEHICLE_UPDATED:    ['admin', 'manager', 'receptionist', 'staff'],
  VEHICLE_DELETED:    ['admin', 'manager', 'receptionist', 'staff'],
  EXPENSE_DELETED:    ['admin', 'manager', 'staff'],
  CASH_LEDGER_DELETED: ['admin', 'manager', 'staff'],
  SHIFT_AUDIT_DELETED: ['admin', 'manager', 'staff'],
  SHIFT_STARTED:  ['admin', 'manager', 'staff'],
  SHIFT_ENDED:    ['admin', 'manager', 'staff'],
  SHIFT_HANDOVER: ['admin', 'manager', 'staff'],
  USER_CREATED:       ['admin', 'manager'],
  USER_UPDATED:       ['admin', 'manager'],
  USER_ROLE_CHANGED:  ['admin', 'manager'],
  USER_DEACTIVATED:   ['admin', 'manager'],
};

/**
 * Create and deliver a notification.
 *
 * @param {Object} data
 * @param {string} data.type          - NotificationType constant
 * @param {string} data.title         - Short title
 * @param {string} data.message       - Full message
 * @param {string} [data.priority]    - NotificationPriority (default: NORMAL)
 * @param {string[]} [data.targetRoles] - Override default target roles
 * @param {number} [data.recipientId] - Specific user ID (in addition to roles)
 * @param {number} [data.roomId]
 * @param {number} [data.guestId]
 * @param {number} [data.reservationId]
 * @param {Object} [data.metadata]    - Extra context for frontend navigation
 */
export async function createNotification(data) {
  try {
    const {
      type = 'system',
      title,
      message,
      priority = NotificationPriority.NORMAL,
      targetRoles,
      recipientId,
      roomId,
      guestId,
      reservationId,
      metadata,
    } = data;

    if (!title || !message) {
      console.warn('[NotificationService] Missing title or message, skipping notification');
      return null;
    }

    // Determine target roles: use provided or fall back to defaults
    const roles = targetRoles || DEFAULT_TARGET_ROLES[type] || ['admin', 'manager', 'staff'];

    const notification = await prisma.appNotification.create({
      data: {
        type,
        title,
        message,
        priority,
        targetRoles: JSON.stringify(roles),
        recipientId: recipientId || null,
        roomId: roomId || null,
        guestId: guestId || null,
        reservationId: reservationId || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        readAt: null,
      },
    });

    // Emit via Socket.IO to all relevant role rooms and connected clients
    const io = getSocketIo();
    if (io) {
      const payload = formatNotification(notification);
      // Emit to each role room
      for (const role of roles) {
        io.to(`role:${String(role).toLowerCase()}`).emit('notification:new', payload);
      }
      // Emit to specific user if set
      if (recipientId) {
        io.to(`user:${recipientId}`).emit('notification:new', payload);
      }
      // Broadcast to all connected clients
      io.emit('notification:new', payload);
    }

    return notification;
  } catch (err) {
    // Notification failure must never break business operations
    console.error('[NotificationService] Failed to create notification:', err.message);
    return null;
  }
}

/**
 * Get notifications visible to a specific user+role.
 * A notification is visible if:
 *   - The user's role is in targetRoles, OR
 *   - recipientId matches the user's ID
 */
export async function getNotificationsForUser(userId, role, options = {}) {
  const {
    page = 1,
    limit = 20,
    unreadOnly = false,
    type = null,
  } = options;

  const skip = (Number(page) - 1) * Number(limit);
  const take = Number(limit);

  // Build where clause: user must be in targetRoles or be a direct recipient
  // We use raw filtering since targetRoles is stored as JSON string
  const allNotifications = await prisma.appNotification.findMany({
    orderBy: { createdAt: 'desc' },
    take: 500, // fetch a large batch then filter in JS (performance acceptable for typical hotel scale)
  });

  const userRole = (role || 'staff').toLowerCase();
  const isAdminOrManager = userRole === 'admin' || userRole === 'manager';

  const filtered = allNotifications.filter(n => {
    // Parse target roles
    let roles = [];
    try {
      roles = JSON.parse(n.targetRoles || '[]');
    } catch {
      roles = [];
    }
    const roleMatch = isAdminOrManager || roles.includes('*') || roles.includes('all') || roles.map(r => String(r).toLowerCase()).includes(userRole);
    const recipientMatch = n.recipientId && n.recipientId === Number(userId);
    if (!roleMatch && !recipientMatch) return false;
    if (unreadOnly && n.readAt !== null) return false;
    if (type && n.type !== type) return false;
    return true;
  });

  const total = filtered.length;
  const pages = Math.ceil(total / take);
  const items = filtered.slice(skip, skip + take).map(formatNotification);

  return { items, total, page: Number(page), limit: take, pages };
}

/**
 * Get unread count for a user/role.
 */
export async function getUnreadCount(userId, role) {
  const allUnread = await prisma.appNotification.findMany({
    where: { readAt: null },
    select: { targetRoles: true, recipientId: true },
  });

  const userRole = (role || 'staff').toLowerCase();
  const isAdminOrManager = userRole === 'admin' || userRole === 'manager';
  let count = 0;
  for (const n of allUnread) {
    let roles = [];
    try { roles = JSON.parse(n.targetRoles || '[]'); } catch { roles = []; }
    const roleMatch = isAdminOrManager || roles.includes('*') || roles.includes('all') || roles.map(r => String(r).toLowerCase()).includes(userRole);
    const recipientMatch = n.recipientId && n.recipientId === Number(userId);
    if (roleMatch || recipientMatch) count++;
  }
  return count;
}

/**
 * Mark a single notification as read (with authorization check).
 */
export async function markNotificationRead(notificationId, userId, role) {
  const notification = await prisma.appNotification.findUnique({
    where: { id: Number(notificationId) },
  });

  if (!notification) return null;

  // Authorization: user must be in targetRoles or be recipientId
  let roles = [];
  try { roles = JSON.parse(notification.targetRoles || '[]'); } catch { roles = []; }
  const userRole = (role || 'staff').toLowerCase();
  const authorized =
    roles.map(r => r.toLowerCase()).includes(userRole) ||
    (notification.recipientId && notification.recipientId === Number(userId));

  if (!authorized) return null;

  return await prisma.appNotification.update({
    where: { id: Number(notificationId) },
    data: { readAt: new Date() },
  });
}

/**
 * Mark all visible notifications as read for a user/role.
 */
export async function markAllNotificationsRead(userId, role) {
  const allUnread = await prisma.appNotification.findMany({
    where: { readAt: null },
  });

  const userRole = (role || 'staff').toLowerCase();
  const idsToMark = [];
  for (const n of allUnread) {
    let roles = [];
    try { roles = JSON.parse(n.targetRoles || '[]'); } catch { roles = []; }
    const roleMatch = roles.map(r => r.toLowerCase()).includes(userRole);
    const recipientMatch = n.recipientId && n.recipientId === Number(userId);
    if (roleMatch || recipientMatch) idsToMark.push(n.id);
  }

  if (idsToMark.length === 0) return { count: 0 };

  await prisma.appNotification.updateMany({
    where: { id: { in: idsToMark } },
    data: { readAt: new Date() },
  });

  return { count: idsToMark.length };
}

/**
 * Delete a notification (with authorization check).
 */
export async function deleteNotification(notificationId, userId, role) {
  const notification = await prisma.appNotification.findUnique({
    where: { id: Number(notificationId) },
  });

  if (!notification) return false;

  let roles = [];
  try { roles = JSON.parse(notification.targetRoles || '[]'); } catch { roles = []; }
  const userRole = (role || 'staff').toLowerCase();
  const authorized =
    userRole === 'admin' ||
    userRole === 'manager' ||
    roles.map(r => r.toLowerCase()).includes(userRole) ||
    (notification.recipientId && notification.recipientId === Number(userId));

  if (!authorized) return false;

  await prisma.appNotification.delete({ where: { id: Number(notificationId) } });
  return true;
}

/**
 * Format a raw DB notification for API/Socket.IO output.
 * Parses JSON fields and adds a safe subset of data.
 */
export function formatNotification(n) {
  let targetRoles = [];
  try { targetRoles = JSON.parse(n.targetRoles || '[]'); } catch { targetRoles = []; }

  let metadata = null;
  try { metadata = n.metadata ? JSON.parse(n.metadata) : null; } catch { metadata = null; }

  return {
    id: n.id,
    type: n.type,
    title: n.title,
    message: n.message,
    priority: n.priority,
    targetRoles,
    recipientId: n.recipientId,
    roomId: n.roomId,
    guestId: n.guestId,
    reservationId: n.reservationId,
    metadata,
    readAt: n.readAt,
    isRead: n.readAt !== null,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}
