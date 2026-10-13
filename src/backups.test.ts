import assert from 'node:assert/strict';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { BACKUP_INTERVAL, BACKUP_RETENTION, pruneBackups, restoreBackup, runBackup, verifyBackup } from './backups';
import { runMaintenance } from './maintenance';

const time = 1_800_000_000_000;
const ownerId = '11111111-1111-4111-8111-111111111111', designId = '22222222-2222-4222-8222-222222222222';
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
function contents(database: DatabaseSync) {
  const schema = database.prepare('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name').all();
  const tables = schema.filter(row => row.type === 'table').map(row => {
    const statement = database.prepare('SELECT * FROM ' + quote(String(row.name)));
    statement.setReadBigInts(true);
    return [row.name, statement.all()];
  });
  return { schema, tables, version: database.prepare('PRAGMA user_version').get() };
}
function withoutSessions(value: ReturnType<typeof contents>) {
  return { ...value, tables: value.tables.map(([name, rows]) => [name, name === 'sessions' ? [] : rows]) };
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), '3d-space-backup-test-'));
  const database = new DatabaseSync(join(directory, 'accounts.sqlite'));
  database.exec(`
    PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA foreign_keys=ON; PRAGMA user_version=3;
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE, salt TEXT, password_hash TEXT, created_at INTEGER, last_active_at INTEGER, inactive_after INTEGER);
    CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER);
    CREATE TABLE rooms (id TEXT PRIMARY KEY, owner_id TEXT REFERENCES users(id) ON DELETE CASCADE, room TEXT, revision INTEGER, shared INTEGER, sketch BLOB, sketch_mime TEXT, sketch_version INTEGER);
    CREATE TABLE request_limits (key TEXT PRIMARY KEY, count INTEGER, window_start INTEGER, blocked_until INTEGER, strikes INTEGER, updated_at INTEGER);
    CREATE TABLE "future table" (id INTEGER PRIMARY KEY AUTOINCREMENT, note TEXT, payload BLOB, huge INTEGER);
    CREATE VIEW room_names AS SELECT id, json_extract(room, '$.name') AS name FROM rooms;
    INSERT INTO users VALUES ('${ownerId}', 'sample_owner', '${'a'.repeat(32)}', '${'b'.repeat(128)}', ${time}, ${time}, ${time + 90 * BACKUP_INTERVAL});
    INSERT INTO sessions VALUES ('${'c'.repeat(64)}', '${ownerId}', ${time + 30 * BACKUP_INTERVAL});
    INSERT INTO request_limits VALUES ('failed-ip:masked', 11, ${time}, ${time + 60_000}, 1, ${time});
  `);
  database.prepare('INSERT INTO rooms VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(designId, ownerId, JSON.stringify({ name: 'Diseño íntegro', ceiling: '#ffffff', dimensions: [4, 5, 3] }), 12, 1, Buffer.from([137, 80, 78, 71, 0, 255, 12]), 'image/png', 4);
  database.prepare('INSERT INTO "future table" (note, payload, huge) VALUES (?, ?, ?)').run('テスト \u0000 texto', Buffer.from([0, 1, 2, 255]), 9_223_372_036_854_775_807n);
  const erasureFile = join(directory, 'erasures.json'); writeFileSync(erasureFile, '{"version":1,"entries":[]}');
  return { directory, database, erasureFile, dispose() { try { database.close(); } catch {} rmSync(directory, { recursive: true, force: true }); } };
}

test('online backup captures WAL, hashes, sessions, complete designs, sketch BLOBs and future tables, then restores exactly', async () => {
  const sample = fixture();
  try {
    assert.ok(existsSync(join(sample.directory, 'accounts.sqlite-wal')));
    const expected = contents(sample.database);
    const result = await runBackup(sample.database, sample.directory, { now: time });
    assert.equal(result.created, true); assert.match(result.path, /accounts-1800000000000-[a-f0-9]{32}\.sqlite$/);
    assert.equal(result.verified.tables, 6); assert.equal(result.verified.rows, 6); assert.equal(result.verified.blobBytes, 11);
    assert.deepEqual(verifyBackup(result.path), result.verified);
    assert.deepEqual(readdirSync(join(sample.directory, 'backups')), [result.path.split(/[\\/]/).at(-1)]);
    if (process.platform !== 'win32') {
      assert.equal(lstatSync(result.path).mode & 0o777, 0o600);
      assert.equal(lstatSync(join(sample.directory, 'backups')).mode & 0o777, 0o700);
    }
    sample.database.close();
    unlinkSync(join(sample.directory, 'accounts.sqlite'));
    const restored = restoreBackup(result.path, join(sample.directory, 'recovered'), { now: time, erasureFile: sample.erasureFile });
    const recovered = new DatabaseSync(restored.path, { readOnly: true });
    try { assert.deepEqual(contents(recovered), withoutSessions(expected)); } finally { recovered.close(); }
    assert.equal(restored.recovered.digest, result.verified.digest);
    assert.equal(restored.removed.revokedSessions, 1);
    assert.notEqual(restored.verified.digest, result.verified.digest);
    assert.ok(!existsSync(join(sample.directory, 'accounts.sqlite')));
  } finally { sample.dispose(); }
});

test('daily backup catches up after restart, avoids duplicate concurrent snapshots, and detects damaged latest copy', async () => {
  const sample = fixture();
  try {
    const results = await Promise.all([runBackup(sample.database, sample.directory, { now: time }), runBackup(sample.database, sample.directory, { now: time })]);
    assert.deepEqual(results.map(row => row.created), [true, false]);
    assert.equal(results[0].path, results[1].path);
    const existing = await runBackup(sample.database, sample.directory, { now: time + BACKUP_INTERVAL - 1 });
    assert.equal(existing.created, false);
    sample.database.prepare('UPDATE rooms SET room = ?, revision = 13 WHERE id = ?').run('{"name":"Cambio posterior"}', designId);
    const next = await runBackup(sample.database, sample.directory, { now: time + BACKUP_INTERVAL });
    assert.equal(next.created, true); assert.notEqual(next.verified.digest, existing.verified.digest);
    writeFileSync(next.path, 'corrupt snapshot');
    const repaired = await runBackup(sample.database, sample.directory, { now: time + BACKUP_INTERVAL + 1 });
    assert.equal(repaired.created, true); assert.equal(repaired.verified.digest, next.verified.digest);
    assert.equal(readdirSync(join(sample.directory, 'backups')).filter(name => name.startsWith('.')).length, 0);
  } finally { sample.dispose(); }
});

test('invalid or foreign-key damaged backups never publish and retain recent working snapshots', async () => {
  const sample = fixture();
  try {
    const good = await runBackup(sample.database, sample.directory, { now: time });
    const corrupt = join(sample.directory, 'bad.sqlite'); writeFileSync(corrupt, 'not SQLite');
    assert.throws(() => verifyBackup(corrupt));
    sample.database.exec('PRAGMA foreign_keys=OFF; INSERT INTO sessions VALUES (\'orphan\', \'missing\', 0);');
    await assert.rejects(runBackup(sample.database, sample.directory, { now: time + BACKUP_INTERVAL }), /foreign-key/);
    assert.deepEqual(readdirSync(join(sample.directory, 'backups')), [good.path.split(/[\\/]/).at(-1)]);
    assert.equal(verifyBackup(good.path).digest, good.verified.digest);
  } finally { sample.dispose(); }
});

test('strict seven-day pruning also runs when backup fails and only touches own regular filenames', async () => {
  const sample = fixture();
  try {
    const old = await runBackup(sample.database, sample.directory, { now: time });
    const directory = join(sample.directory, 'backups');
    writeFileSync(join(directory, 'operator-note.txt'), 'keep');
    writeFileSync(old.path + '-wal', 'old backup recovery');
    writeFileSync(join(directory, '.accounts-' + time + '-' + 'e'.repeat(32) + '.partial.sqlite'), 'abandoned');
    mkdirSync(join(directory, 'accounts-' + time + '-' + 'd'.repeat(32) + '.sqlite'));
    assert.equal(pruneBackups(sample.directory, { now: time + BACKUP_RETENTION - 1 }), 0);
    sample.database.close();
    await assert.rejects(runBackup(sample.database, sample.directory, { now: time + BACKUP_RETENTION }));
    assert.ok(!existsSync(old.path)); assert.equal(readFileSync(join(directory, 'operator-note.txt'), 'utf8'), 'keep');
    assert.ok(!existsSync(old.path + '-wal'));
    assert.ok(lstatSync(join(directory, 'accounts-' + time + '-' + 'd'.repeat(32) + '.sqlite')).isDirectory());
    assert.ok(!readdirSync(directory).some(name => name.includes('partial')));
  } finally { sample.dispose(); }
});

test('restore rejects any existing destination and SQLite recovery files without changing contents', async () => {
  const sample = fixture();
  try {
    const result = await runBackup(sample.database, sample.directory, { now: time });
    assert.throws(() => restoreBackup(result.path, sample.directory, { now: time, erasureFile: sample.erasureFile }), /new, non-existing/);
    const target = join(sample.directory, 'blocked'); mkdirSync(target); writeFileSync(join(target, 'accounts.sqlite-wal'), 'retain');
    assert.throws(() => restoreBackup(result.path, target, { now: time, erasureFile: sample.erasureFile }), /new, non-existing/);
    assert.equal(readFileSync(join(target, 'accounts.sqlite-wal'), 'utf8'), 'retain');
    assert.throws(() => restoreBackup(result.path, '', { now: time, erasureFile: sample.erasureFile }), /Invalid maintenance path/);
    writeFileSync(result.path + '-wal', 'recovery');
    assert.throws(() => verifyBackup(result.path), /recovery files/);
    assert.throws(() => restoreBackup(result.path, join(sample.directory, 'never-created'), { now: time, erasureFile: sample.erasureFile }), /recovery files/);
    assert.ok(!existsSync(join(sample.directory, 'never-created')));
  } finally { sample.dispose(); }
});

test('backup and restore reject symbolic-link paths and pruning leaves symlink targets intact', { skip: process.platform === 'win32' }, async () => {
  const sample = fixture();
  try {
    const other = join(sample.directory, 'outside'); mkdirSync(other);
    const link = join(sample.directory, 'linked'); symlinkSync(other, link, 'dir');
    await assert.rejects(runBackup(sample.database, sample.directory, { now: time, backupDir: link }), /symbolic links/);
    const result = await runBackup(sample.database, sample.directory, { now: time });
    assert.throws(() => restoreBackup(result.path, join(link, 'recovered'), { now: time, erasureFile: sample.erasureFile }), /symbolic links/);
    const victim = join(other, 'preserve.sqlite'); writeFileSync(victim, 'retain'); chmodSync(victim, 0o600);
    const alias = join(sample.directory, 'backups', 'accounts-' + time + '-' + 'a'.repeat(32) + '.sqlite'); symlinkSync(victim, alias);
    pruneBackups(sample.directory, { now: time + BACKUP_RETENTION });
    assert.equal(readFileSync(victim, 'utf8'), 'retain'); assert.ok(lstatSync(alias).isSymbolicLink());
  } finally { sample.dispose(); }
});

test('restore proves the entire snapshot then respects subsequent erasures and inactivity expiry', async () => {
  const sample = fixture();
  try {
    const snapshot = await runBackup(sample.database, sample.directory, { now: time });
    for (const kind of ['user', 'room', 'sketch'] as const) {
      writeFileSync(sample.erasureFile, JSON.stringify({ version: 1, entries: [{ kind, id: kind === 'user' ? ownerId : designId, at: time + 1, ...(kind === 'sketch' ? { version: 5 } : {}) }] }));
      const result = restoreBackup(snapshot.path, join(sample.directory, 'recover-' + kind), { now: time + 2, erasureFile: sample.erasureFile });
      assert.equal(result.recovered.digest, snapshot.verified.digest);
      assert.notEqual(result.verified.digest, snapshot.verified.digest);
      const database = new DatabaseSync(result.path, { readOnly: true });
      try {
        if (kind === 'user') {
          for (const table of ['users', 'sessions', 'rooms']) assert.equal(database.prepare('SELECT COUNT(*) AS count FROM ' + table).get()!.count, 0);
        } else if (kind === 'room') assert.equal(database.prepare('SELECT COUNT(*) AS count FROM rooms').get()!.count, 0);
        else { const room = database.prepare('SELECT sketch, sketch_mime, sketch_version FROM rooms').get()!; assert.equal(room.sketch, null); assert.equal(room.sketch_mime, null); assert.equal(room.sketch_version, 5); }
      } finally { database.close(); }
      assert.deepEqual(JSON.parse(readFileSync(join(sample.directory, 'recover-' + kind, 'erasures.json'), 'utf8')), JSON.parse(readFileSync(sample.erasureFile, 'utf8')));
    }
    writeFileSync(sample.erasureFile, '{"version":1,"entries":[]}');
    sample.database.prepare('UPDATE users SET inactive_after = ?').run(time + 10);
    const expired = await runBackup(sample.database, sample.directory, { now: time + 5, force: true });
    const result = restoreBackup(expired.path, join(sample.directory, 'recover-expired'), { now: time + 10, erasureFile: sample.erasureFile });
    assert.equal(result.recovered.digest, expired.verified.digest); assert.equal(result.removed.inactiveAccounts, 1);
    const database = new DatabaseSync(result.path, { readOnly: true });
    try { for (const table of ['users', 'sessions', 'rooms']) assert.equal(database.prepare('SELECT COUNT(*) AS count FROM ' + table).get()!.count, 0); }
    finally { database.close(); }
  } finally { sample.dispose(); }
});

test('restore refuses expired snapshots and missing or invalid deletion provenance before creating directories', async () => {
  const sample = fixture();
  try {
    const snapshot = await runBackup(sample.database, sample.directory, { now: time });
    const target = join(sample.directory, 'recovery-refused');
    assert.throws(() => restoreBackup(snapshot.path, target, { now: time + BACKUP_RETENTION, erasureFile: sample.erasureFile }), /unexpired/);
    assert.throws(() => restoreBackup(snapshot.path, target, { now: time - 1, erasureFile: sample.erasureFile }), /unexpired/);
    assert.throws(() => restoreBackup(snapshot.path, target, { now: time, erasureFile: join(sample.directory, 'missing.json') }));
    writeFileSync(sample.erasureFile, '{"version":1,"entries":[{"kind":"user","id":"invalid","at":0}]}');
    assert.throws(() => restoreBackup(snapshot.path, target, { now: time, erasureFile: sample.erasureFile }), /ledger entry/);
    assert.ok(!existsSync(target));
    assert.equal(verifyBackup(snapshot.path).digest, snapshot.verified.digest);
  } finally { sample.dispose(); }
});

test('restoring a snapshot never reactivates sessions later revoked or rotated in the live database', async () => {
  const sample = fixture();
  try {
    const snapshot = await runBackup(sample.database, sample.directory, { now: time });
    const oldSession = sample.database.prepare('SELECT token_hash FROM sessions').get()!.token_hash;
    sample.database.exec('DELETE FROM sessions');
    sample.database.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('d'.repeat(64), ownerId, time + 30 * BACKUP_INTERVAL);
    const restored = restoreBackup(snapshot.path, join(sample.directory, 'no-revived-session'), { now: time + 1, erasureFile: sample.erasureFile });
    assert.equal(restored.recovered.digest, snapshot.verified.digest);
    assert.equal(restored.removed.revokedSessions, 1);
    const database = new DatabaseSync(restored.path, { readOnly: true });
    try {
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions WHERE token_hash = ?').get(oldSession)!.count, 0);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions').get()!.count, 0);
      assert.equal(database.prepare('SELECT username, password_hash FROM users').get()!.password_hash, 'b'.repeat(128));
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM rooms').get()!.count, 1);
    } finally { database.close(); }
  } finally { sample.dispose(); }
});

test('operator commands make a verified online backup and restore to a new directory without creating missing sources', async () => {
  const sample = fixture();
  try {
    const expected = contents(sample.database);
    const snapshot = await runMaintenance(['backup', sample.directory]);
    assert.ok('created' in snapshot && snapshot.created);
    const verified = await runMaintenance(['verify', snapshot.path]);
    assert.ok('digest' in verified); assert.equal(verified.digest, snapshot.verified.digest);
    const result = await runMaintenance(['restore', snapshot.path, join(sample.directory, 'operator-recovered'), sample.erasureFile]);
    assert.ok('recovered' in result); assert.equal(result.recovered.digest, snapshot.verified.digest);
    const database = new DatabaseSync(result.path, { readOnly: true });
    try { assert.deepEqual(contents(database), withoutSessions(expected)); } finally { database.close(); }
    await assert.rejects(runMaintenance(['backup', join(sample.directory, 'missing-source')]));
    assert.ok(!existsSync(join(sample.directory, 'missing-source')));
    await assert.rejects(runMaintenance(['restore', snapshot.path, sample.directory]), /Usage/);
    await assert.rejects(runMaintenance(['unknown']), /Usage/);
  } finally { sample.dispose(); }
});
