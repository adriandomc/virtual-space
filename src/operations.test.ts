import { initializeTestDatabase, insertTestUser, insertTestSession, insertTestRoom } from './serverTestFixtures';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { BACKUP_INTERVAL, restoreBackup, runBackup } from './backups';
import { assertCurrentDatabase, initializeDatabase } from './databaseSchema';
import { initializeErasures } from './erasures';
import { cancelAccount, closeService, resetPrelaunch } from './operations';

const time = 1_800_000_000_000;
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const room = '33333333-3333-4333-8333-333333333333';
const otherRoom = '44444444-4444-4444-8444-444444444444';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), '3d-space-operations-test-'));
  const directory = join(root, 'data'); mkdirSync(directory);
  const path = join(directory, 'accounts.sqlite');
  const database = new DatabaseSync(path);
  initializeTestDatabase(database);
  for (const [id, username] of [[owner, 'owner'], [other, 'other']]) insertTestUser(database, id, username, time);
  insertTestSession(database, 'e'.repeat(64), owner, time + 30 * BACKUP_INTERVAL);
  insertTestSession(database, 'f'.repeat(64), other, time + 30 * BACKUP_INTERVAL);
  database.prepare('INSERT INTO request_limits VALUES (?, ?, ?, ?, ?, ?)').run('ip:masked', 3, time, 0, 0, time);
  database.prepare('INSERT INTO request_limits VALUES (?, 1, ?, 0, 0, ?)').run('create-user:' + createHash('sha256').update(owner).digest('hex'), time, time);
  for (const [id, user, name] of [[room, owner, 'Owner design'], [otherRoom, other, 'Other design']]) insertTestRoom(database, id, user, { updated_at: time, shared: 1, sketch: Buffer.from([137, 80, 78, 71, 0, 255]), sketch_mime: 'image/png', sketch_version: 1 });
  database.close();
  const ledger = initializeErasures(directory);
  const neighbor = join(root, 'neighbor.sqlite'); writeFileSync(neighbor, 'outside service data');
  return { root, directory, path, ledger, neighbor, dispose() { assert.equal(resolve(root), root); rmSync(root, { recursive: true, force: true }); } };
}

function inspect(path: string) {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      users: database.prepare('SELECT id, username FROM users ORDER BY id').all(),
      sessions: database.prepare('SELECT user_id FROM sessions ORDER BY user_id').all(),
      rooms: database.prepare('SELECT id, owner_id, sketch FROM rooms ORDER BY id').all(),
      limits: database.prepare('SELECT key FROM request_limits ORDER BY key').all(),
    };
  } finally { database.close(); }
}

test('account cancellation requires an explicit normalized confirmation and a valid current ledger before mutation', () => {
  const sample = fixture();
  try {
    const before = inspect(sample.path), original = readFileSync(sample.path);
    for (const confirmation of ['', '--confirm=other', '--confirm=OWNER']) {
      assert.throws(() => cancelAccount(sample.directory, ' Owner ', confirmation, time), /confirmation/);
      assert.deepEqual(readFileSync(sample.path), original);
    }
    assert.throws(() => cancelAccount(sample.directory, 'missing', '--confirm=missing', time), /Account not found/);
    assert.deepEqual(inspect(sample.path), before);
    unlinkSync(sample.ledger);
    assert.throws(() => cancelAccount(sample.directory, 'owner', '--confirm=owner', time));
    assert.deepEqual(inspect(sample.path), before);
    writeFileSync(sample.ledger, '{"version":1,"entries":[{"kind":"user","id":"bad","at":0}]}');
    assert.throws(() => cancelAccount(sample.directory, 'owner', '--confirm=owner', time), /ledger entry/);
    assert.deepEqual(inspect(sample.path), before);
    assert.equal(readFileSync(sample.neighbor, 'utf8'), 'outside service data');
  } finally { sample.dispose(); }
});

test('destructive commands refuse live SQLite recovery files, relative paths and filesystem roots', () => {
  const sample = fixture();
  try {
    const before = readFileSync(sample.path);
    for (const suffix of ['-wal', '-shm', '-journal']) {
      writeFileSync(sample.path + suffix, 'active recovery');
      assert.throws(() => cancelAccount(sample.directory, 'owner', '--confirm=owner', time), /Stop the service/);
      assert.throws(() => closeService(sample.directory, '--confirm=erase-all'), /Stop the service/);
      assert.deepEqual(readFileSync(sample.path), before);
      assert.equal(readFileSync(sample.path + suffix, 'utf8'), 'active recovery');
      unlinkSync(sample.path + suffix);
    }
    assert.throws(() => closeService('relative-data', '--confirm=erase-all'), /absolute/);
    assert.throws(() => cancelAccount('relative-data', 'owner', '--confirm=owner', time), /absolute/);
    const root = resolve(sample.directory).slice(0, process.platform === 'win32' ? 3 : 1);
    assert.throws(() => closeService(root, '--confirm=erase-all'), /filesystem root/);
    assert.deepEqual(inspect(sample.path).users.map(row => row.username), ['owner', 'other']);
  } finally { sample.dispose(); }
});

test('account cancellation records recovery restrictions and restoring an older snapshot cannot revive the account or shared designs', async () => {
  const sample = fixture();
  try {
    const database = new DatabaseSync(sample.path);
    let snapshot;
    try { snapshot = await runBackup(database, sample.directory, { now: time }); }
    finally { database.close(); }
    assert.deepEqual(cancelAccount(sample.directory, ' OwNeR ', '--confirm=owner', time + 1), { cancelled: true });
    const current = inspect(sample.path);
    assert.deepEqual(current.users.map(row => row.username), ['other']);
    assert.deepEqual(current.sessions.map(row => row.user_id), [other]);
    assert.deepEqual(current.rooms.map(row => row.owner_id), [other]);
    assert.deepEqual(current.limits.map(row => row.key), ['ip:masked']);
    const ledger = JSON.parse(readFileSync(sample.ledger, 'utf8'));
    assert.deepEqual(ledger, { version: 1, entries: [{ kind: 'user', id: owner, at: time + 1 }] });
    const restored = restoreBackup(snapshot.path, join(sample.root, 'restored'), { now: time + 2, erasureFile: sample.ledger });
    assert.equal(restored.recovered.digest, snapshot.verified.digest);
    assert.equal(restored.removed.erasures, 1);
    const recovered = inspect(restored.path);
    assert.deepEqual(recovered.users.map(row => row.username), ['other']);
    assert.deepEqual(recovered.sessions, []);
    assert.deepEqual(recovered.rooms.map(row => row.owner_id), [other]);
    assert.deepEqual(recovered.limits.map(row => row.key), ['ip:masked']);
    assert.equal(readFileSync(sample.neighbor, 'utf8'), 'outside service data');
  } finally { sample.dispose(); }
});

test('permanent closure refuses wrong confirmation and foreign backup files before deleting any account data', () => {
  const sample = fixture();
  try {
    const before = inspect(sample.path);
    for (const confirmation of ['', '--confirm=other', '--confirm=ERASE-ALL']) assert.throws(() => closeService(sample.directory, confirmation), /confirmation/);
    const backups = join(sample.directory, 'backups'); mkdirSync(backups);
    const foreign = join(backups, 'not-owned.sqlite'); writeFileSync(foreign, 'keep foreign information');
    assert.throws(() => closeService(sample.directory, '--confirm=erase-all'), /Unrecognized backup/);
    assert.equal(readFileSync(foreign, 'utf8'), 'keep foreign information');
    assert.deepEqual(inspect(sample.path), before);
    assert.ok(existsSync(sample.ledger)); assert.ok(existsSync(sample.path));
    assert.equal(readFileSync(sample.neighbor, 'utf8'), 'outside service data');
  } finally { sample.dispose(); }
});

test('explicit permanent closure removes synthetic database, all owned backups and service metadata while preserving outside neighbors', async () => {
  const sample = fixture();
  try {
    const database = new DatabaseSync(sample.path);
    let snapshot;
    try { snapshot = await runBackup(database, sample.directory, { now: time }); }
    finally { database.close(); }
    const backups = join(sample.directory, 'backups');
    const abandoned = '.accounts-' + time + '-' + 'a'.repeat(32) + '.partial.sqlite';
    writeFileSync(join(backups, abandoned), 'unfinished backup'); writeFileSync(join(backups, abandoned + '-journal'), 'backup recovery');
    writeFileSync(join(sample.directory, 'maintenance-status.json'), '{"backup":{"ok":true}}');
    writeFileSync(join(sample.directory, '.maintenance-status.tmp'), 'unfinished status');
    assert.deepEqual(closeService(sample.directory, '--confirm=erase-all'), { closed: true, removedBackups: 3 });
    assert.ok(!existsSync(sample.path)); assert.ok(!existsSync(sample.ledger)); assert.ok(!existsSync(snapshot.path));
    for (const name of ['accounts.sqlite-wal', 'accounts.sqlite-shm', 'accounts.sqlite-journal', 'maintenance-status.json', '.maintenance-status.tmp']) assert.ok(!existsSync(join(sample.directory, name)));
    assert.deepEqual(readdirSync(backups), []);
    assert.equal(readFileSync(sample.neighbor, 'utf8'), 'outside service data');
  } finally { sample.dispose(); }
});

test('destructive commands reject symlinked service directories, source databases, backups and metadata', { skip: process.platform === 'win32' }, () => {
  const sample = fixture();
  try {
    const linked = join(sample.root, 'linked-data'); symlinkSync(sample.directory, linked, 'dir');
    assert.throws(() => closeService(linked, '--confirm=erase-all'), /symbolic links/);
    assert.throws(() => cancelAccount(linked, 'owner', '--confirm=owner', time), /symbolic links/);
    const actual = join(sample.root, 'actual.sqlite');
    const contents = readFileSync(sample.path); unlinkSync(sample.path); writeFileSync(actual, contents); symlinkSync(actual, sample.path);
    assert.throws(() => closeService(sample.directory, '--confirm=erase-all'), /existing service data/);
    assert.throws(() => cancelAccount(sample.directory, 'owner', '--confirm=owner', time), /existing service data/);
    unlinkSync(sample.path); writeFileSync(sample.path, contents);
    const backups = join(sample.directory, 'backups'); symlinkSync(sample.root, backups, 'dir');
    assert.throws(() => closeService(sample.directory, '--confirm=erase-all'), /Invalid backup directory/);
    unlinkSync(backups);
    const status = join(sample.directory, 'maintenance-status.json'); symlinkSync(sample.neighbor, status);
    assert.throws(() => closeService(sample.directory, '--confirm=erase-all'), /Invalid service metadata/);
    assert.equal(readFileSync(sample.neighbor, 'utf8'), 'outside service data');
    assert.deepEqual(inspect(sample.path).users.map(row => row.username), ['owner', 'other']);
  } finally { sample.dispose(); }
});


test('one-time prelaunch reset replaces recognized test data and backups with the complete empty current schema', async () => {
  const sample = fixture();
  try {
    const source = new DatabaseSync(sample.path);
    try { await runBackup(source, sample.directory, { now: time }); source.exec('PRAGMA user_version=0'); }
    finally { source.close(); }
    assert.throws(() => resetPrelaunch(sample.directory, '--confirm=erase-all', time), /confirmation/);
    assert.deepEqual(resetPrelaunch(sample.directory, '--confirm=reset-3d-space-test-data', time), { reset: true, version: 2, removedBackups: 1 });
    const database = new DatabaseSync(sample.path);
    try {
      assertCurrentDatabase(database); initializeDatabase(database);
      for (const table of ['users', 'sessions', 'rooms', 'model_assets', 'room_members', 'request_limits']) assert.equal(database.prepare('SELECT COUNT(*) AS n FROM ' + table).get()!.n, 0);
      assert.equal(database.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { database.close(); }
    assert.deepEqual(JSON.parse(readFileSync(sample.ledger, 'utf8')), { version: 1, entries: [] });
    assert.deepEqual(JSON.parse(readFileSync(join(sample.directory, 'prelaunch-reset.json'), 'utf8')), { version: 2, resetAt: time });
    assert.deepEqual(readdirSync(join(sample.directory, 'backups')), []);
    assert.equal(readFileSync(sample.neighbor, 'utf8'), 'outside service data');
    assert.throws(() => resetPrelaunch(sample.directory, '--confirm=reset-3d-space-test-data', time + 1), /already completed/);
  } finally { sample.dispose(); }
});

test('prelaunch reset rejects active databases, unknown files and foreign tables before erasing anything', () => {
  const sample = fixture();
  try {
    const before = readFileSync(sample.path);
    writeFileSync(sample.path + '-wal', 'active');
    assert.throws(() => resetPrelaunch(sample.directory, '--confirm=reset-3d-space-test-data'), /Stop the service/);
    unlinkSync(sample.path + '-wal');
    const unknown = join(sample.directory, 'operator-note.txt'); writeFileSync(unknown, 'preserve');
    assert.throws(() => resetPrelaunch(sample.directory, '--confirm=reset-3d-space-test-data'), /Unrecognized service files/);
    assert.deepEqual(readFileSync(sample.path), before); unlinkSync(unknown);
    const database = new DatabaseSync(sample.path); database.exec('CREATE TABLE foreign_data (id TEXT)'); database.close();
    const foreignBefore = readFileSync(sample.path);
    assert.throws(() => resetPrelaunch(sample.directory, '--confirm=reset-3d-space-test-data'), /recognized 3D Space/);
    assert.deepEqual(readFileSync(sample.path), foreignBefore);
    assert.deepEqual(inspect(sample.path).users.map(row => row.username), ['owner', 'other']);
    assert.equal(readFileSync(sample.neighbor, 'utf8'), 'outside service data');
  } finally { sample.dispose(); }
});
