import { initializeTestDatabase, insertTestUser, insertTestSession, insertTestRoom } from './serverTestFixtures';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { applyErasures, initializeErasures, pruneErasures, recordErasure, validateErasureFile, wasErased } from './erasures';
import { BACKUP_RETENTION_DAYS } from './legalPolicy';

const time = Date.parse('2026-10-13T17:00:00Z');
const retention = BACKUP_RETENTION_DAYS * 24 * 60 * 60_000;

test('a second SQLite connection cannot leave the main process with a stale erasure ledger', () => {
  const directory = mkdtempSync(join(tmpdir(), '3d-space-erasures-live-')), path = join(directory, 'accounts.sqlite');
  const main = new DatabaseSync(path);
  initializeTestDatabase(main);
  main.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const qa = randomUUID(), control = randomUUID(), room = randomUUID();
  insertTestUser(main, qa, 'qa_live_fixture', time);
  insertTestUser(main, control, 'unrelated_control', time);
  insertTestRoom(main, room, control, { shared: 1 });
  insertTestSession(main, 'session', qa, time + retention);
  const ledger = initializeErasures(directory, main), cachedStatement = main.prepare('SELECT username FROM users WHERE id = ?');
  assert.equal(cachedStatement.get(qa)?.username, 'qa_live_fixture');
  const helper = new DatabaseSync(path);
  helper.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  try {
    recordErasure(helper, ledger, { kind: 'user', id: qa, at: time }, () => { helper.prepare('DELETE FROM users WHERE id = ? AND username = ?').run(qa, 'qa_live_fixture'); });
    assert.equal(cachedStatement.get(qa), undefined);
    recordErasure(main, ledger, { kind: 'share', id: room, at: time + 1 }, () => { main.prepare('UPDATE rooms SET shared = 0 WHERE id = ?').run(room); });
    pruneErasures(ledger, time + 2, main);
    assert.deepEqual(JSON.parse(readFileSync(ledger, 'utf8')).entries, [{ kind: 'user', id: qa, at: time }, { kind: 'share', id: room, at: time + 1 }]);
    assert.equal(cachedStatement.get(control)?.username, 'unrelated_control');
    assert.equal(main.prepare('SELECT COUNT(*) AS count FROM sessions').get()!.count, 0);
    assert.equal(main.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally {
    helper.close(); main.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('3d-space-erasures-live-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), '3d-space-erasures-test-'));
  const database = new DatabaseSync(':memory:');
  initializeTestDatabase(database);
  const ledger = initializeErasures(directory), user = randomUUID(), room = randomUUID();
  insertTestUser(database, user, undefined, time);
  const addRoom = (id = room, version = 1, updated = time) => insertTestRoom(database, id, user, { sketch: Buffer.from([0, 255, 137, 80]), sketch_mime: 'image/png', sketch_version: version, shared: 1, updated_at: updated });
  addRoom();
  insertTestSession(database, 'protected_session', user, time + retention);
  database.prepare('INSERT INTO request_limits (key, count, window_start, updated_at) VALUES (?, 1, 0, 0)').run('create-user:' + createHash('sha256').update(user).digest('hex'));
  return { database, directory, ledger, user, room, addRoom, dispose() {
    database.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('3d-space-erasures-test-'));
    rmSync(directory, { recursive: true, force: true });
  } };
}

test('an erasure persists before commit and stops restored accounts, designs and sessions from returning', () => {
  const sample = fixture();
  try {
    recordErasure(sample.database, sample.ledger, { kind: 'user', id: sample.user, at: time }, () => {
      sample.database.prepare('DELETE FROM users WHERE id = ?').run(sample.user);
    });
    const persisted = JSON.parse(readFileSync(sample.ledger, 'utf8'));
    assert.deepEqual(persisted.entries, [{ kind: 'user', id: sample.user, at: time }]);
    assert.equal(sample.database.prepare('SELECT COUNT(*) AS count FROM rooms').get()!.count, 0);
    insertTestUser(sample.database, sample.user, undefined, time);
    sample.addRoom();
    insertTestSession(sample.database, 'restored_session', sample.user, time + retention);
    assert.equal(applyErasures(sample.database, sample.ledger, { now: time + 1 }), 1);
    for (const table of ['users', 'rooms', 'sessions', 'request_limits']) assert.equal(sample.database.prepare('SELECT COUNT(*) AS count FROM ' + table).get()!.count, 0);
    assert.equal(sample.database.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { sample.dispose(); }
});

test('deleted room identities remain blocked for the backup window and are not mistaken for other accounts', () => {
  const sample = fixture();
  try {
    recordErasure(sample.database, sample.ledger, { kind: 'room', id: sample.room, at: time }, () => {
      sample.database.prepare('DELETE FROM rooms WHERE id = ?').run(sample.room);
    });
    assert.equal(wasErased(sample.ledger, 'room', sample.room), true);
    assert.equal(wasErased(sample.ledger, 'room', randomUUID()), false);
    assert.equal(wasErased(sample.ledger, 'user', sample.user), false);
    assert.equal(wasErased(sample.ledger, 'room', sample.room), true);
    sample.addRoom();
    assert.equal(applyErasures(sample.database, sample.ledger, { now: time + 1 }), 1);
    assert.equal(sample.database.prepare('SELECT COUNT(*) AS count FROM users').get()!.count, 1);
    pruneErasures(sample.ledger, time + retention + 1);
    assert.equal(wasErased(sample.ledger, 'room', sample.room), false);
    assert.deepEqual(JSON.parse(readFileSync(sample.ledger, 'utf8')).entries, []);
  } finally { sample.dispose(); }
});

test('sketch deletion clears restored old versions but preserves a newer deliberate upload', () => {
  const sample = fixture();
  try {
    recordErasure(sample.database, sample.ledger, { kind: 'sketch', id: sample.room, levelId: String(sample.database.prepare('SELECT level_id FROM project_sketches WHERE room_id=?').get(sample.room)!.level_id), at: time, version: 2 }, () => {
      sample.database.prepare('UPDATE project_sketches SET data = NULL, mime = NULL, version = 2 WHERE room_id = ?').run(sample.room);
    });
    sample.database.prepare('UPDATE project_sketches SET data = ?, mime = ?, version = 1 WHERE room_id = ?').run(Buffer.from([1, 2, 3]), 'image/png', sample.room);
    assert.equal(applyErasures(sample.database, sample.ledger, { now: time + 1 }), 1);
    const erased = sample.database.prepare('SELECT data AS sketch, mime AS sketch_mime, version AS sketch_version FROM project_sketches WHERE room_id = ?').get(sample.room)!;
    assert.equal(erased.sketch, null); assert.equal(erased.sketch_mime, null); assert.equal(erased.sketch_version, 2);
    sample.database.prepare('UPDATE project_sketches SET data = ?, mime = ?, version = 3 WHERE room_id = ?').run(Buffer.from([4, 5]), 'image/png', sample.room);
    assert.equal(applyErasures(sample.database, sample.ledger, { now: time + 2 }), 0);
    assert.deepEqual(sample.database.prepare('SELECT data AS sketch FROM project_sketches WHERE room_id = ?').get(sample.room)!.sketch, new Uint8Array([4, 5]));
  } finally { sample.dispose(); }
});

test('sharing revocation makes older restored copies private but allows a later explicit re-enable', () => {
  const sample = fixture();
  try {
    recordErasure(sample.database, sample.ledger, { kind: 'share', id: sample.room, at: time }, () => {
      sample.database.prepare('UPDATE rooms SET shared = 0, updated_at = ? WHERE id = ?').run(time, sample.room);
    });
    sample.database.prepare('UPDATE rooms SET shared = 1, updated_at = ? WHERE id = ?').run(time - 1, sample.room);
    applyErasures(sample.database, sample.ledger, { now: time + 1 });
    assert.equal(sample.database.prepare('SELECT shared FROM rooms WHERE id = ?').get(sample.room)!.shared, 0);
    sample.database.prepare('UPDATE rooms SET shared = 1, updated_at = ? WHERE id = ?').run(time + 10, sample.room);
    applyErasures(sample.database, sample.ledger, { now: time + 11 });
    assert.equal(sample.database.prepare('SELECT shared FROM rooms WHERE id = ?').get(sample.room)!.shared, 1);
  } finally { sample.dispose(); }
});

test('corrupt or malformed ledgers fail closed before an erasure mutates the database', () => {
  const sample = fixture();
  try {
    const invalid = [
      'not JSON', JSON.stringify({ version: 2, entries: [] }), JSON.stringify({ version: 1, entries: null }),
      JSON.stringify({ version: 1, entries: [{ kind: 'user', id: '../outside', at: time }] }),
      JSON.stringify({ version: 1, entries: [{ kind: 'sketch', id: sample.room, at: time, version: 0 }] }),
      JSON.stringify({ version: 1, entries: [{ kind: 'user', id: sample.user, at: -1 }] }),
    ];
    for (const value of invalid) {
      writeFileSync(sample.ledger, value);
      assert.throws(() => validateErasureFile(sample.ledger));
      assert.throws(() => applyErasures(sample.database, sample.ledger, { now: time }));
      let called = false;
      assert.throws(() => recordErasure(sample.database, sample.ledger, { kind: 'user', id: sample.user, at: time }, () => { called = true; }));
      assert.equal(called, false);
      assert.equal(sample.database.prepare('SELECT COUNT(*) AS count FROM users').get()!.count, 1);
    }
  } finally { sample.dispose(); }
});

test('an unsuccessful database erasure rolls back without writing a recovery restriction', () => {
  const sample = fixture();
  try {
    assert.throws(() => recordErasure(sample.database, sample.ledger, { kind: 'room', id: sample.room, at: time }, () => {
      sample.database.prepare('DELETE FROM rooms WHERE id = ?').run(sample.room);
      throw new Error('storage failure');
    }), /storage failure/);
    assert.equal(sample.database.prepare('SELECT COUNT(*) AS count FROM rooms').get()!.count, 1);
    assert.deepEqual(JSON.parse(readFileSync(sample.ledger, 'utf8')).entries, []);
  } finally { sample.dispose(); }
});
