import { prisma } from '../utils/db.js';
import { recordAuditLog, getUserPermissions, hasPermission } from '../services/rbacService.js';
import { broadcastRoomUpdate, broadcastApprovalUpdate } from '../utils/realtime.js';
import { createNotification, NotificationType, NotificationPriority } from '../utils/notificationService.js';

export async function listApprovalRequests(req, res) {
  try {
    const { status, type } = req.query;
    const where = {};
    if (status && status !== 'all') where.status = status;
    if (type && type !== 'all') where.type = type;

    const requests = await prisma.approvalRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    // Enrich cancellation requests with full reservation and guest details
    const cancellationResIds = requests
      .filter(r => r.type === 'cancellation' && r.referenceId)
      .map(r => parseInt(r.referenceId))
      .filter(id => !isNaN(id));

    let resMap = new Map();
    if (cancellationResIds.length > 0) {
      const reservations = await prisma.reservation.findMany({
        where: { id: { in: cancellationResIds } },
        include: { guest: true, room: true },
      });
      reservations.forEach(r => resMap.set(String(r.id), r));
    }

    const enriched = requests.map(r => {
      if (r.type === 'cancellation' && r.referenceId && resMap.has(String(r.referenceId))) {
        return { ...r, reservation: resMap.get(String(r.referenceId)) };
      }
      return r;
    });

    res.json({ success: true, data: enriched });
  } catch (error) {
    console.error('Error fetching approval requests:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve approval requests' });
  }
}

export async function createApprovalRequest(req, res) {
  try {
    const { type, referenceId, reason } = req.body;
    if (!type || !referenceId) {
      return res.status(400).json({ success: false, message: 'Type and referenceId are required' });
    }

    const request = await prisma.approvalRequest.create({
      data: {
        type,
        referenceId: String(referenceId),
        requestedBy: req.user?.name || req.user?.email || 'Receptionist',
        requestedById: req.user?.id || null,
        reason: reason || 'Cancellation requested',
        status: 'pending',
      },
    });

    // If reservation cancellation request, mark reservation as cancellation_requested
    if (type === 'cancellation') {
      const resId = parseInt(referenceId);
      if (!isNaN(resId)) {
        await prisma.reservation.update({
          where: { id: resId },
          data: { status: 'cancellation_requested' },
        }).catch(() => {});

        // Create Admin notification
        await prisma.appNotification.create({
          data: {
            type: 'cancellation',
            title: 'Reservation Cancellation Request',
            message: `${req.user?.name || 'Staff'} submitted a cancellation request for Reservation #${resId}. Reason: ${reason || 'Not specified'}`,
            isRead: false,
          },
        }).catch(() => {});

        // Broadcast real-time approval update
        broadcastApprovalUpdate({
          type: 'cancellation',
          referenceId: String(resId),
          status: 'pending',
          requestedBy: req.user?.name || req.user?.email || 'Staff',
          reason: reason || 'Not specified',
        });
      }
    }

    await recordAuditLog({
      userId: req.user?.id,
      userEmail: req.user?.email,
      userName: req.user?.name,
      action: 'CANCEL',
      module: 'approvals',
      details: `Submitted cancellation request for Reservation #${referenceId} to Admin. Reason: ${reason || 'Not specified'}`,
      ipAddress: req.ip,
    });

    res.status(201).json({
      success: true,
      message: 'Cancellation request submitted to Admin for approval.',
      data: request,
    });
  } catch (error) {
    console.error('Error creating approval request:', error);
    res.status(500).json({ success: false, message: 'Failed to create approval request' });
  }
}

export async function reviewApprovalRequest(req, res) {
  try {
    const { id } = req.params;
    const { status, reviewNotes } = req.body; // 'approved' or 'rejected'

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be approved or rejected' });
    }

    const existing = await prisma.approvalRequest.findUnique({
      where: { id: parseInt(id) },
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Approval request not found' });
    }

    // Role check: Only Admin can approve or reject cancellation requests
    if (existing.type === 'cancellation') {
      const userPermissions = req.userPermissions || await getUserPermissions(req.user);
      if (!hasPermission(userPermissions, 'reservations.approve')) {
        return res.status(403).json({
          success: false,
          message: 'Only Administrators can approve or reject reservation cancellation requests.',
        });
      }
    }

    const reviewerName = req.user?.name || req.user?.email || 'Admin';

    const updated = await prisma.approvalRequest.update({
      where: { id: parseInt(id) },
      data: {
        status,
        reviewedBy: reviewerName,
        reviewedAt: new Date(),
      },
    });

    // Handle cascading status updates based on request type
    if (existing.type === 'cancellation') {
      const resId = parseInt(existing.referenceId);
      if (!isNaN(resId)) {
        if (status === 'approved') {
          const resv = await prisma.reservation.update({
            where: { id: resId },
            data: { status: 'cancelled' },
            include: { room: true },
          });

          // Free up room if assigned
          if (resv.roomId) {
            await prisma.room.update({
              where: { id: resv.roomId },
              data: { status: 'clean', availability: true, last_updated: new Date() },
            });
            broadcastRoomUpdate({ roomId: resv.roomId, status: 'clean', availability: true, action: 'cancelled' });
          }

          // Create notification for staff/admin
          await createNotification({
            type: NotificationType.RESERVATION_CANCELLED,
            title: 'Cancellation Approved',
            message: `${reviewerName} approved cancellation for Reservation #${resId}. Room has been released.`,
            priority: NotificationPriority.HIGH,
            reservationId: resId,
            roomId: resv.roomId || null,
            metadata: { reservationId: resId, roomId: resv.roomId, reviewer: reviewerName },
          });
        } else {
          // If rejected, revert status back to confirmed
          await prisma.reservation.update({
            where: { id: resId },
            data: { status: 'confirmed' },
          });

          // Create notification for staff/admin
          await createNotification({
            type: NotificationType.RESERVATION_UPDATED,
            title: 'Cancellation Rejected',
            message: `${reviewerName} rejected cancellation for Reservation #${resId}. Reservation remains confirmed.`,
            priority: NotificationPriority.NORMAL,
            reservationId: resId,
            metadata: { reservationId: resId, reviewer: reviewerName },
          });
        }

        // Broadcast real-time approval review update
        broadcastApprovalUpdate({
          type: 'cancellation',
          referenceId: String(resId),
          status,
          reviewedBy: reviewerName,
        });
      }
    } else if (existing.type === 'expense') {
      const expId = parseInt(existing.referenceId);
      if (!isNaN(expId)) {
        await prisma.expense.update({
          where: { id: expId },
          data: {
            status,
            approvedBy: reviewerName,
          },
        }).catch(() => {});
      }
    }

    await recordAuditLog({
      userId: req.user?.id,
      userEmail: req.user?.email,
      userName: req.user?.name,
      action: 'APPROVE',
      module: 'approvals',
      details: `${status.toUpperCase()} approval request #${id} (${existing.type} Ref: ${existing.referenceId}) by ${reviewerName}`,
      ipAddress: req.ip,
    });

    res.json({
      success: true,
      message: `Cancellation request ${status === 'approved' ? 'accepted and reservation cancelled' : 'rejected and reservation restored'}.`,
      data: updated,
    });
  } catch (error) {
    console.error('Error reviewing approval request:', error);
    res.status(500).json({ success: false, message: 'Failed to process approval request' });
  }
}

