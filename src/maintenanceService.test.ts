import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createAuth } from './auth';
import { initializeErasures } from './erasures';
import { createMaintenance } from './maintenanceService';
import { createServer } from './server';
import type { BackupResult } from './backups';

function sample() {
  const directory = mkdtempSync(join(tmpdir(), '3d-space-scheduler-'));
  const database = new DatabaseSync(join(directory, 'accounts.sqlite'));
  database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
  createAuth(database);
  const ledger = initializeErasures(directory);
  return { directory, database, ledger, dispose() { database.close(); rmSync(directory, { recursive: true, force: true }); } };
}

test('maintenance creates daily verified copies, catches up, and persists operator status', async () => {
  const fixture = sample();
  let now = 1_800_000_000_000;
  const tasks = createMaintenance(fixture.database, fixture.directory, fixture.ledger, { now: () => now });
  try {
    await tasks.run(); await tasks.run();
    assert.equal(readdirSync(join(fixture.directory, 'backups')).length, 1);
    now += 24 * 60 * 60_000;
    await tasks.run();
    assert.equal(readdirSync(join(fixture.directory, 'backups')).length, 2);
    const status = JSON.parse(readFileSync(join(fixture.directory, 'maintenance-status.json'), 'utf8'));
    assert.equal(status.error, null); assert.equal(status.backup.createdAt, now); assert.equal(status.backup.verifiedAt, now);
    assert.match(status.backup.digest, /^[0-9a-f]{64}$/);
  } finally { await tasks.stop(); fixture.dispose(); }
});

test('maintenance serializes overlapping ticks and awaits its in-flight work during shutdown', async () => {
  const fixture = sample();
  let release!: (value: BackupResult) => void, entered!: () => void, calls = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<BackupResult>(resolve => { release = resolve; });
  const tasks = createMaintenance(fixture.database, fixture.directory, fixture.ledger, {
    now: () => 1_800_000_000_000, intervalMs: 10,
    backup: async () => { calls++; entered(); return gate; },
  });
  try {
    tasks.start(); await started;
    const first = tasks.run(), second = tasks.run(); assert.equal(first, second);
    let stopped = false;
    const stopping = tasks.stop().then(() => { stopped = true; });
    await Promise.resolve(); assert.equal(stopped, false); assert.equal(calls, 1);
    release({ created: true, path: join(fixture.directory, 'accounts-1800000000000-' + 'a'.repeat(32) + '.sqlite'), verified: { digest: 'a'.repeat(64), rows: 0, tables: 4, blobBytes: 0 } });
    await stopping;
    assert.equal(stopped, true); assert.equal(calls, 1); await tasks.run(); assert.equal(calls, 1);
    assert.ok(fixture.database.prepare('SELECT COUNT(*) AS total FROM users').get());
  } finally { await tasks.stop(); fixture.dispose(); }
});

test('a failed backup records failure and retries on the next tick', async context => {
  const fixture = sample(); let calls = 0;
  context.mock.method(console, 'error', () => {});
  const tasks = createMaintenance(fixture.database, fixture.directory, fixture.ledger, { backup: async () => { calls++; throw new Error('Synthetic disk failure'); } });
  try {
    await tasks.run(); await tasks.run();
    const status = JSON.parse(readFileSync(join(fixture.directory, 'maintenance-status.json'), 'utf8'));
    assert.equal(calls, 2); assert.ok(status.error); assert.equal(status.backup, null);
  } finally { await tasks.stop(); fixture.dispose(); }
});

test('closing the HTTP server waits for the initial online backup before closing SQLite', async () => {
  const directory = mkdtempSync(join(tmpdir(), '3d-space-close-backup-'));
  const server = createServer({ dataDir: directory });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    await new Promise<void>(resolve => server.close(() => resolve()));
    const status = JSON.parse(readFileSync(join(directory, 'maintenance-status.json'), 'utf8'));
    assert.equal(status.error, null); assert.ok(status.backup.file);
    assert.equal(readdirSync(join(directory, 'backups')).length, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
