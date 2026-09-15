import express from 'express';

// Middleware
import { authenticateToken } from '../middleware/authMiddleware.js';
import { authenticateTokenOrCheckInAccess } from '../utils/checkinAccess.js';
import { requirePermission, requireAnyPermission, requireRole } from '../middleware/rbac.js';

// Auth & Staff
import {
  signup,
  login,
  me,
  logout,
  forgotPassword,
  resetPassword,
  listStaff,
  createStaff,
  updateStaff,
  deleteStaff
} from '../controllers/authController.js';

// Hotel & Room Types (Admin)
import {
  getHotelProfile,
  updateHotelProfile,
  listRoomTypes,
  createRoomType,
  updateRoomType,
  deleteRoomType
} from '../controllers/hotelController.js';

// Module2 distribution
import {
  healthCheck,
  listRooms,
  createRoom,
  updateRoom,
  deleteRoom,
  updateAvailability,
  listBookings,
  createBooking,
  updateBooking,
  cancelBooking,
  deleteBooking,
  listChannels,
  syncChannel,
  connectChannel,
  disconnectChannel,
  reconnectChannel,
  listPricingRules,
  createPricingRule,
  updatePricingRule,
  deletePricingRule,
  togglePricingRule,
  recalculatePricing,
  listPricingHistory,
  listSyncLogs,
  listStatistics,
  listOccupancyHistory
} from '../controllers/distributionController.js';

// Rooms, Guests, Reservations, Payments
import {
  listRoomsNew,
  getRoomNew,
  createRoomNew,
  updateRoomNew,
  deleteRoomNew,
  startCleaning,
  markRoomClean,
  markRoomDirty,
  markRoomInspected
} from '../controllers/roomsController.js';
import { listGuests, createGuest, updateGuest, deleteGuest } from '../controllers/guestController.js';
import {
  listReservations,
  createReservation,
  updateReservation,
  cancelReservation,
  requestReservationCancellation,
  deleteReservation
} from '../controllers/reservationController.js';
import { listPayments, getPayment, createPayment, updatePayment, deletePayment } from '../controllers/paymentController.js';
import { listVehicles, getVehicle, createVehicle, updateVehicle, deleteVehicle } from '../controllers/vehicleController.js';
import { listCashLedger, createCashLedger, updateCashLedger, deleteCashLedger } from '../controllers/cashLedgerController.js';
import { listShiftAudits, createShiftAudit, updateShiftAudit, deleteShiftAudit } from '../controllers/shiftAuditController.js';
import { listHousekeeping, createHousekeeping, updateHousekeeping, deleteHousekeeping } from '../controllers/housekeepingController.js';
import { listMaintenance, createMaintenance, updateMaintenance, deleteMaintenance } from '../controllers/maintenanceController.js';
import {
  listNotifications,
  getUnreadNotificationCount,
  createNotification,
  markOneRead,
  markAllRead,
  deleteOneNotification,
  markRead,
  clearNotifications
} from '../controllers/notificationController.js';
import { getAnalytics } from '../controllers/analyticsController.js';
import { getDashboard } from '../controllers/dashboardController.js';
import { getWeather } from '../controllers/weatherController.js';
import { getRoomAvailability } from '../controllers/roomAvailabilityController.js';
import {
  createBookingWithPayment,
  getGuestCheckInAccess,
  verifyGuestId,
  processCheckInPayment,
  processManualCheckInPayment,
  generateDigitalLockKey,
  unlockDoor,
  completeGuestCheckIn
} from '../controllers/checkinController.js';
import { createPaymentOrder, verifyPayment } from '../controllers/razorpayController.js';

// RBAC Audit Logs, Expenses, Approvals, Roles
import { getAuditLogs } from '../controllers/auditLogController.js';
import {
  getExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
  approveExpense
} from '../controllers/expenseController.js';
import {
  listApprovalRequests,
  createApprovalRequest,
  reviewApprovalRequest
} from '../controllers/approvalController.js';
import {
  getRoles,
  getPermissions,
  updateRolePermissions,
  assignUserRole
} from '../controllers/roleController.js';

const router = express.Router();

// ─── Health & Public ───────────────────────────────────────
router.get('/health', (req, res) => res.json({ status: 'ok' }));
router.get('/weather', getWeather);

// ─── Auth ──────────────────────────────────────────────────
router.post('/auth/signup', signup);
router.post('/auth/login', login);
router.get('/auth/me', me);
router.post('/auth/logout', logout);
router.post('/auth/forgot-password', forgotPassword);
router.post('/auth/reset-password', resetPassword);

// ─── Audit Logs (Admin & Manager) ──────────────────────────
router.get('/audit-logs', authenticateToken, requirePermission('audit_logs.view'), getAuditLogs);

// ─── Roles & Permissions (Admin Only) ──────────────────────
router.get('/roles', authenticateToken, requirePermission('roles.view'), getRoles);
router.get('/permissions', authenticateToken, requirePermission('permissions.view'), getPermissions);
router.put('/roles/:id/permissions', authenticateToken, requirePermission('roles.manage'), updateRolePermissions);
router.post('/users/:userId/role', authenticateToken, requirePermission('users.manage'), assignUserRole);

// ─── Expenses (Admin & Manager) ────────────────────────────
router.get('/expenses', authenticateToken, requirePermission('expenses.view'), getExpenses);
router.post('/expenses', authenticateToken, requirePermission('expenses.create'), createExpense);
router.put('/expenses/:id', authenticateToken, requirePermission('expenses.edit'), updateExpense);
router.delete('/expenses/:id', authenticateToken, requirePermission('expenses.delete'), deleteExpense);
router.put('/expenses/:id/approve', authenticateToken, requirePermission('expenses.approve'), approveExpense);

// ─── Approval Requests Workflow ────────────────────────────
router.get('/approvals', authenticateToken, requireAnyPermission('reservations.approve', 'reservations.cancel_request', 'expenses.approve'), listApprovalRequests);
router.post('/approvals', authenticateToken, requireAnyPermission('reservations.cancel_request', 'payments.create'), createApprovalRequest);
router.put('/approvals/:id/review', authenticateToken, requireAnyPermission('reservations.approve', 'expenses.approve'), reviewApprovalRequest);

// ─── Check-In & Digital Lock Key Generation (Protected / Verified) ─
router.post('/checkin/book-with-payment', authenticateToken, requirePermission('checkin.perform'), createBookingWithPayment);
router.get('/checkin/access', getGuestCheckInAccess);
router.post('/checkin/verify-id', authenticateTokenOrCheckInAccess, verifyGuestId);
router.post('/checkin/process-payment', authenticateTokenOrCheckInAccess, processCheckInPayment);
router.post('/checkin/manual-payment', authenticateToken, requirePermission('checkin.perform'), processManualCheckInPayment);
router.post('/checkin/payment/order', authenticateTokenOrCheckInAccess, createPaymentOrder);
router.post('/checkin/payment/verify', authenticateTokenOrCheckInAccess, verifyPayment);
router.post('/checkin/generate-lock-key', authenticateTokenOrCheckInAccess, generateDigitalLockKey);
router.post('/checkin/unlock-door', authenticateTokenOrCheckInAccess, unlockDoor);
router.post('/checkin/complete', authenticateTokenOrCheckInAccess, completeGuestCheckIn);

// ─── Hotel Configuration (Admin only) ──────────────────────
router.get('/hotel', authenticateToken, requirePermission('settings.view'), getHotelProfile);
router.put('/hotel', authenticateToken, requirePermission('settings.manage'), updateHotelProfile);

// ─── Room Types (Admin only for manage) ────────────────────
router.get('/room-types', authenticateToken, requirePermission('room_types.view'), listRoomTypes);
router.post('/room-types', authenticateToken, requirePermission('room_types.manage'), createRoomType);
router.put('/room-types/:id', authenticateToken, requirePermission('room_types.manage'), updateRoomType);
router.delete('/room-types/:id', authenticateToken, requirePermission('room_types.manage'), deleteRoomType);

// ─── Staff / Users Management ──────────────────────────────
router.get('/staff', authenticateToken, requirePermission('staff.view'), listStaff);
router.post('/staff', authenticateToken, requirePermission('users.create'), createStaff);
router.put('/staff/:id', authenticateToken, requirePermission('users.edit'), updateStaff);
router.delete('/staff/:id', authenticateToken, requirePermission('users.delete'), deleteStaff);

// ─── Rooms ─────────────────────────────────────────────────
router.get('/rooms', authenticateToken, requirePermission('rooms.view'), listRoomsNew);
router.get('/rooms/:id', authenticateToken, requirePermission('rooms.view'), getRoomNew);
router.post('/rooms', authenticateToken, requirePermission('rooms.create'), createRoomNew);
router.put('/rooms/:id', authenticateToken, requirePermission('rooms.manage'), updateRoomNew);
router.delete('/rooms/:id', authenticateToken, requirePermission('rooms.delete'), deleteRoomNew);

// Housekeeping status actions on rooms
router.put('/rooms/:id/start', authenticateToken, requirePermission('housekeeping.manage'), startCleaning);
router.put('/rooms/:id/clean', authenticateToken, requirePermission('housekeeping.manage'), markRoomClean);
router.put('/rooms/:id/dirty', authenticateToken, requirePermission('housekeeping.manage'), markRoomDirty);
router.put('/rooms/:id/inspect', authenticateToken, requirePermission('housekeeping.manage'), markRoomInspected);

// ─── Guests ────────────────────────────────────────────────
router.get('/guests', authenticateToken, requirePermission('guests.view'), listGuests);
router.post('/guests', authenticateToken, requirePermission('guests.create'), createGuest);
router.put('/guests/:id', authenticateToken, requirePermission('guests.edit'), updateGuest);
router.delete('/guests/:id', authenticateToken, requirePermission('guests.delete'), deleteGuest);

// ─── Reservations ──────────────────────────────────────────
router.get('/reservations', authenticateToken, requirePermission('reservations.view'), listReservations);
router.post('/reservations', authenticateToken, requirePermission('reservations.create'), createReservation);
router.put('/reservations/:id', authenticateToken, requirePermission('reservations.edit'), updateReservation);
router.post('/reservations/:id/cancel', authenticateToken, requireAnyPermission('reservations.cancel', 'reservations.cancel_request'), cancelReservation);
router.post('/reservations/:id/cancel-request', authenticateToken, requireAnyPermission('reservations.cancel', 'reservations.cancel_request'), requestReservationCancellation);
router.delete('/reservations/:id', authenticateToken, requirePermission('reservations.delete'), deleteReservation);

// ─── Payments ──────────────────────────────────────────────
router.get('/payments', authenticateToken, requirePermission('payments.view'), listPayments);
router.get('/payments/:id', authenticateToken, requirePermission('payments.view'), getPayment);
router.post('/payments', authenticateToken, requirePermission('payments.create'), createPayment);
router.put('/payments/:id', authenticateToken, requirePermission('payments.create'), updatePayment);
router.delete('/payments/:id', authenticateToken, requirePermission('payments.delete'), deletePayment);

// ─── Vehicles ──────────────────────────────────────────────
router.get('/vehicles', authenticateToken, listVehicles);
router.get('/vehicles/:id', authenticateToken, getVehicle);
router.post('/vehicles', authenticateToken, createVehicle);
router.put('/vehicles/:id', authenticateToken, updateVehicle);
router.delete('/vehicles/:id', authenticateToken, requirePermission('guests.delete'), deleteVehicle);

// ─── Cash Ledger ───────────────────────────────────────────
router.get('/cash-ledger', authenticateToken, requirePermission('payments.view'), listCashLedger);
router.post('/cash-ledger', authenticateToken, requirePermission('payments.create'), createCashLedger);
router.put('/cash-ledger/:id', authenticateToken, requirePermission('payments.create'), updateCashLedger);
router.delete('/cash-ledger/:id', authenticateToken, requirePermission('payments.delete'), deleteCashLedger);

// ─── Shift Audits ──────────────────────────────────────────
router.get('/shift-audits', authenticateToken, requirePermission('reports.view'), listShiftAudits);
router.post('/shift-audits', authenticateToken, requirePermission('reports.view'), createShiftAudit);
router.put('/shift-audits/:id', authenticateToken, requirePermission('reports.view'), updateShiftAudit);
router.delete('/shift-audits/:id', authenticateToken, requirePermission('reports.financial'), deleteShiftAudit);

// ─── Housekeeping ──────────────────────────────────────────
router.get('/housekeeping', authenticateToken, requirePermission('housekeeping.view'), listHousekeeping);
router.post('/housekeeping', authenticateToken, requirePermission('housekeeping.manage'), createHousekeeping);
router.put('/housekeeping/:id', authenticateToken, requirePermission('housekeeping.manage'), updateHousekeeping);
router.delete('/housekeeping/:id', authenticateToken, requirePermission('housekeeping.manage'), deleteHousekeeping);

// ─── Maintenance ───────────────────────────────────────────
router.get('/maintenance', authenticateToken, requirePermission('maintenance.view'), listMaintenance);
router.post('/maintenance', authenticateToken, requirePermission('maintenance.manage'), createMaintenance);
router.put('/maintenance/:id', authenticateToken, requirePermission('maintenance.manage'), updateMaintenance);
router.delete('/maintenance/:id', authenticateToken, requirePermission('maintenance.manage'), deleteMaintenance);

// ─── Notifications ─────────────────────────────────────────
router.get('/notifications', authenticateToken, listNotifications);
router.get('/notifications/unread-count', authenticateToken, getUnreadNotificationCount);
router.post('/notifications', authenticateToken, createNotification);
router.patch('/notifications/:id/read', authenticateToken, markOneRead);
router.post('/notifications/mark-all-read', authenticateToken, markAllRead);
router.patch('/notifications/read-all', authenticateToken, markAllRead);
router.post('/notifications/mark-read', authenticateToken, markRead);
router.put('/notifications', authenticateToken, markRead);
router.delete('/notifications/:id', authenticateToken, deleteOneNotification);
router.delete('/notifications', authenticateToken, clearNotifications);

// ─── Analytics / Dashboard ────────────────────────────────
router.get('/analytics', authenticateToken, requirePermission('reports.view'), getAnalytics);
router.get('/dashboard', authenticateToken, requirePermission('dashboard.view'), getDashboard);
router.get('/room-availability', authenticateToken, requirePermission('rooms.view'), getRoomAvailability);

// ─── Module2 distribution ─────────────────────────────────
router.get('/module2/health', healthCheck);
router.get('/module2/rooms', authenticateToken, requirePermission('rooms.view'), listRooms);
router.post('/module2/rooms', authenticateToken, requirePermission('rooms.create'), createRoom);
router.put('/module2/rooms/:id', authenticateToken, requirePermission('rooms.manage'), updateRoom);
router.delete('/module2/rooms/:id', authenticateToken, requirePermission('rooms.delete'), deleteRoom);
router.patch('/module2/rooms/:id/availability', authenticateToken, requirePermission('rooms.manage'), updateAvailability);
router.get('/module2/bookings', authenticateToken, requirePermission('reservations.view'), listBookings);
router.post('/module2/bookings', authenticateToken, requirePermission('reservations.create'), createBooking);
router.put('/module2/bookings/:id', authenticateToken, requirePermission('reservations.edit'), updateBooking);
router.post('/module2/bookings/:id/cancel', authenticateToken, requirePermission('reservations.cancel'), cancelBooking);
router.delete('/module2/bookings/:id', authenticateToken, requirePermission('reservations.delete'), deleteBooking);
router.get('/module2/channels', authenticateToken, requirePermission('settings.view'), listChannels);
router.post('/module2/channels/:id/sync', authenticateToken, requirePermission('settings.manage'), syncChannel);
router.post('/module2/channels/:id/connect', authenticateToken, requirePermission('settings.manage'), connectChannel);
router.post('/module2/channels/:id/disconnect', authenticateToken, requirePermission('settings.manage'), disconnectChannel);
router.post('/module2/channels/:id/reconnect', authenticateToken, requirePermission('settings.manage'), reconnectChannel);
router.get('/module2/pricing-rules', authenticateToken, requirePermission('pricing.view'), listPricingRules);
router.post('/module2/pricing-rules', authenticateToken, requirePermission('pricing.manage'), createPricingRule);
router.put('/module2/pricing-rules/:id', authenticateToken, requirePermission('pricing.manage'), updatePricingRule);
router.delete('/module2/pricing-rules/:id', authenticateToken, requirePermission('pricing.manage'), deletePricingRule);
router.patch('/module2/pricing-rules/:id/toggle', authenticateToken, requirePermission('pricing.manage'), togglePricingRule);
router.post('/module2/pricing/recalculate', authenticateToken, requirePermission('pricing.manage'), recalculatePricing);
router.post('/module2/pricing-engine/recalculate', authenticateToken, requirePermission('pricing.manage'), recalculatePricing);
router.get('/module2/pricing-history', authenticateToken, requirePermission('pricing.view'), listPricingHistory);
router.get('/module2/sync-logs', authenticateToken, requirePermission('audit_logs.view'), listSyncLogs);
router.get('/module2/statistics', authenticateToken, requirePermission('reports.view'), listStatistics);
router.get('/module2/occupancy-history', authenticateToken, requirePermission('reports.view'), listOccupancyHistory);

export default router;