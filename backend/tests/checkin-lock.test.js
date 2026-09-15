import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/utils/db.js';
import { completeGuestCheckIn, generateDigitalLockKey, unlockDoor } from '../src/controllers/checkinController.js';

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    }
  };
  return res;
}

test('Check-in and digital lock key generation workflow', async (t) => {
  // 1. Create a guest and reservation
  const guest = await prisma.guest.create({
    data: {
      firstName: 'TestLock',
      lastName: 'Guest',
      email: `testlock-${Date.now()}@example.com`,
      phone: `98${Math.floor(10000000 + Math.random() * 90000000)}`
    }
  });

  const reservation = await prisma.reservation.create({
    data: {
      guestId: guest.id,
      checkIn: new Date(),
      checkOut: new Date(Date.now() + 86400000),
      status: 'confirmed',
      totalCharges: 500,
      paidAmount: 500,
      verificationStatus: 'VERIFIED',
    }
  });

  await prisma.payment.create({
    data: {
      reservationId: reservation.id,
      amount: 500,
      method: 'Cash',
      paymentStatus: 'Paid',
      gatewayStatus: 'manual'
    }
  });

  t.after(async () => {
    try {
      await prisma.payment.deleteMany({ where: { reservationId: reservation.id } });
      await prisma.reservation.delete({ where: { id: reservation.id } });
      await prisma.guest.delete({ where: { id: guest.id } });
    } catch (e) {
      // ignore cleanup errors
    }
  });

  await t.test('completeGuestCheckIn generates digitalPin, lockId, and keyPayload', async () => {
    const req = { body: { reservationId: reservation.id } };
    const res = mockRes();

    await completeGuestCheckIn(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.digitalPin, 'digitalPin should be generated');
    assert.ok(res.body.lockId, 'lockId should be generated');
    assert.ok(res.body.keyPayload, 'keyPayload should be generated');
    assert.equal(res.body.reservation.status, 'checked_in');
    assert.equal(res.body.reservation.digitalKeyStatus, 'ACTIVE');
  });

  await t.test('completeGuestCheckIn is idempotent and does not throw 409', async () => {
    const req = { body: { reservationId: reservation.id } };
    const res = mockRes();

    await completeGuestCheckIn(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.digitalPin);
    assert.ok(res.body.lockId);
  });

  await t.test('generateDigitalLockKey retrieves key for checked-in reservation', async () => {
    const req = { body: { reservationId: reservation.id } };
    const res = mockRes();

    await generateDigitalLockKey(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.ok(res.body.digitalPin);
    assert.ok(res.body.lockId);
  });

  await t.test('unlockDoor succeeds with valid digitalPin', async () => {
    const updated = await prisma.reservation.findUnique({ where: { id: reservation.id } });
    const req = { body: { reservationId: reservation.id, digitalPin: updated.digitalPin } };
    const res = mockRes();

    await unlockDoor(req, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
  });
});
