import { initializeTestDatabase, insertTestUser, insertTestSession, insertTestRoom } from './serverTestFixtures';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { deleteInactiveAccounts, inactivityDeadline, touchAccount } from './retention';

const date = (value: string) => Date.parse(value);
function fixture() {
  const database = new DatabaseSync(':memory:');
  initializeTestDatabase(database);
  return database;
}
function row(database: DatabaseSync, id: string) {
  return database.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

test('inactivity uses three UTC calendar months, clamping month ends and preserving time', () => {
  for (const [start, end] of [
    ['2026-01-31T11:22:33.123Z', '2026-04-30T11:22:33.123Z'],
    ['2023-11-30T23:59:59.999Z', '2024-02-29T23:59:59.999Z'],
    ['2024-11-30T05:12:03.001Z', '2025-02-28T05:12:03.001Z'],
    ['2026-08-31T00:00:00.000Z', '2026-11-30T00:00:00.000Z'],
    ['2026-10-31T00:00:00.000Z', '2027-01-31T00:00:00.000Z'],
    ['2026-05-15T14:00:00.000Z', '2026-08-15T14:00:00.000Z'],
  ]) assert.equal(inactivityDeadline(date(start)), date(end), start);
  for (const invalid of [NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, 1.5]) {
    assert.throws(() => inactivityDeadline(invalid), /Invalid activity timestamp/);
  }
});

test('activity extends the deadline but a same-millisecond visit, clock rollback or expiry cannot revive an account', () => {
  const database = fixture(), started = date('2026-01-31T11:22:33.123Z');
  try {
    insertTestUser(database, 'owner', 'active_owner', started);
    const initial = row(database, 'owner')!;
    assert.equal(Number(touchAccount(database, 'owner', started)), 0);
    assert.equal(Number(touchAccount(database, 'owner', started - 1)), 0);
    assert.deepEqual(row(database, 'owner'), initial);
    const later = started + 3_600_000;
    assert.equal(Number(touchAccount(database, 'owner', later)), 1);
    assert.equal(row(database, 'owner')!.last_active_at, later);
    assert.equal(row(database, 'owner')!.inactive_after, inactivityDeadline(later));
    const expiry = inactivityDeadline(later);
    assert.equal(Number(touchAccount(database, 'owner', expiry)), 0);
    assert.equal(Number(touchAccount(database, 'owner', expiry + 1)), 0);
    assert.equal(Number(touchAccount(database, 'missing', later)), 0);
    assert.equal(row(database, 'owner')!.last_active_at, later);
  } finally { database.close(); }
});

test('expiry cascades through designs, binary sketches and sessions while retaining active accounts and current security blocks', () => {
  const database = fixture(), started = date('2026-01-31T11:22:33.123Z');
  const expiry = inactivityDeadline(started);
  try {
    for (const id of ['expired', 'active']) insertTestUser(database, id, id + '_owner', started);
    touchAccount(database, 'active', expiry - 1);
    for (const id of ['expired', 'active']) {
      insertTestRoom(database, 'room_' + id, id, { sketch: Buffer.from([0, 255, 137, 80]), sketch_mime: 'image/png' });
      insertTestSession(database, 'session_' + id, id, expiry + 24 * 60 * 60_000);
      const limitKey = 'create-user:' + createHash('sha256').update(id).digest('hex');
      database.prepare('INSERT INTO request_limits (key, updated_at, blocked_until, count, window_start) VALUES (?, ?, ?, 1, 0)').run(limitKey, expiry, 0);
    }
    database.prepare('INSERT INTO request_limits (key, updated_at, blocked_until, count, window_start) VALUES (?, ?, ?, 1, 0)').run('failed-ip:old_block', started, expiry + 1);
    database.prepare('INSERT INTO request_limits (key, updated_at, blocked_until, count, window_start) VALUES (?, ?, ?, 1, 0)').run('failed-ip:old_inactive', started, 0);
    assert.equal(deleteInactiveAccounts(database, expiry - 1), 0);
    assert.equal(deleteInactiveAccounts(database, expiry), 1);
    assert.equal(row(database, 'expired'), undefined);
    assert.ok(row(database, 'active'));
    const survivingRooms = database.prepare('SELECT owner_id, sketch FROM rooms').all();
    assert.equal(survivingRooms.length, 1);
    assert.equal(survivingRooms[0].owner_id, 'active');
    assert.deepEqual(survivingRooms[0].sketch, new Uint8Array([0, 255, 137, 80]));
    assert.equal(database.prepare('SELECT user_id FROM sessions').get()!.user_id, 'active');
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM request_limits').get()!.count, 2);
    assert.ok(database.prepare('SELECT key FROM request_limits WHERE key = ?').get('failed-ip:old_block'));
    assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { database.close(); }
});
