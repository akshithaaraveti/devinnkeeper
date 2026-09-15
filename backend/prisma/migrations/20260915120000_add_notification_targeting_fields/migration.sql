-- Align AppNotification with the Prisma model used by the role-aware notification service.
ALTER TABLE "AppNotification"
  ADD COLUMN IF NOT EXISTS "priority" TEXT NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS "targetRoles" TEXT,
  ADD COLUMN IF NOT EXISTS "recipientId" INTEGER,
  ADD COLUMN IF NOT EXISTS "roomId" INTEGER,
  ADD COLUMN IF NOT EXISTS "guestId" INTEGER,
  ADD COLUMN IF NOT EXISTS "reservationId" INTEGER,
  ADD COLUMN IF NOT EXISTS "metadata" TEXT,
  ADD COLUMN IF NOT EXISTS "readAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "AppNotification"
SET "readAt" = CURRENT_TIMESTAMP
WHERE "isRead" = true AND "readAt" IS NULL;

CREATE INDEX IF NOT EXISTS "AppNotification_roomId_idx" ON "AppNotification"("roomId");
CREATE INDEX IF NOT EXISTS "AppNotification_reservationId_idx" ON "AppNotification"("reservationId");
CREATE INDEX IF NOT EXISTS "AppNotification_recipientId_idx" ON "AppNotification"("recipientId");
