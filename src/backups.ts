import { createHash, randomBytes } from 'node:crypto';
import { backup, DatabaseSync } from 'node:sqlite';
import { chmodSync, closeSync, constants, copyFileSync, existsSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readdirSync, renameSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, parse, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { applyErasures, validateErasureFile } from './erasures.js';
import { deleteInactiveAccounts } from './retention.js';
import { assertCurrentDatabase } from './databaseSchema.js';
import { BACKUP_RETENTION_DAYS } from './legalPolicy.js';

export const BACKUP_INTERVAL = 24 * 60 * 60_000;
export const BACKUP_RETENTION = BACKUP_RETENTION_DAYS * BACKUP_INTERVAL;
const NAME = /^accounts-(\d{13})-([a-f0-9]{32})\.sqlite$/;
const RECOVERY_NAME = /^accounts-(\d{13})-([a-f0-9]{32})\.sqlite(?:-wal|-shm|-journal)$/;
const PARTIAL_NAME = /^\.accounts-(\d{13})-([a-f0-9]{32})\.partial\.sqlite(?:-wal|-shm|-journal)?$/;
const queues = new Map<string, Promise<unknown>>();
export type BackupVerification = { digest: string; tables: number; rows: number; blobBytes: number };
export type BackupResult = { created: boolean; path: string; verified: BackupVerification };

function checkedPath(value: string) {
  if (!value.trim() || value.includes('\0')) throw new Error('Invalid maintenance path.');
  const full = resolve(value), root = parse(full).root;
  if (full === root) throw new Error('A filesystem root is not a maintenance directory.');
  let current = root;
  for (const part of full.slice(root.length).split(sep)) {
    current = join(current, part);
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error('Maintenance paths must not contain symbolic links.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return full;
}

function privateDirectory(value: string) {
  const path = checkedPath(value);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  if (!lstatSync(path).isDirectory()) throw new Error('The backup path is not a directory.');
  chmodSync(path, 0o700);
  return path;
}

function standaloneFile(value: string) {
  const path = checkedPath(value), info = lstatSync(path);
  if (!info.isFile() || info.size === 0) throw new Error('A standalone SQLite backup is required.');
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (existsSync(path + suffix)) throw new Error('The backup has active SQLite recovery files.');
  }
  return path;
}

function quote(value: string) { return '"' + value.replaceAll('"', '""') + '"'; }

function inspectDatabase(path: string): BackupVerification {
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    assertCurrentDatabase(database);
    const integrity = database.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('Backup integrity verification failed.');
    if (database.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Backup foreign-key verification failed.');
    const digest = createHash('sha256');
    const schema = database.prepare('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name').all();
    digest.update(JSON.stringify(schema));
    digest.update(JSON.stringify(database.prepare('PRAGMA user_version').get()));
    digest.update(JSON.stringify(database.prepare('PRAGMA application_id').get()));
    let tables = 0, rows = 0, blobBytes = 0;
    for (const item of schema) {
      if (item.type !== 'table') continue;
      const name = String(item.name), statement = database.prepare('SELECT * FROM ' + quote(name));
      statement.setReadBigInts(true);
      const rowDigests: string[] = [];
      for (const row of statement.iterate()) {
        const rowHash = createHash('sha256');
        for (const [key, value] of Object.entries(row)) {
          rowHash.update(JSON.stringify(key));
          if (value instanceof Uint8Array) {
            rowHash.update('blob:' + value.byteLength + ':'); rowHash.update(value); blobBytes += value.byteLength;
          } else rowHash.update(JSON.stringify([typeof value, typeof value === 'bigint' ? String(value) : value]));
        }
        rowDigests.push(rowHash.digest('hex')); rows++;
      }
      // Row order has no meaning in SQLite; only fixed-size row digests are retained in memory.
      digest.update(JSON.stringify([name, rowDigests.sort()])); tables++;
    }
    return { digest: digest.digest('hex'), tables, rows, blobBytes };
  } finally { database.close(); }
}

function removeOwnedFile(path: string) {
  try {
    if (lstatSync(path).isFile()) unlinkSync(path);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

/** Check the complete schema and data, then restore into an isolated copy and compare it. */
export function verifyBackup(value: string): BackupVerification {
  const path = standaloneFile(value), expected = inspectDatabase(path);
  const scratch = mkdtempSync(join(tmpdir(), '3d-space-restore-check-'));
  chmodSync(scratch, 0o700);
  const restoredPath = join(scratch, 'accounts.sqlite');
  try {
    copyFileSync(path, restoredPath, constants.COPYFILE_EXCL); chmodSync(restoredPath, 0o600);
    const actual = inspectDatabase(restoredPath);
    if (actual.digest !== expected.digest) throw new Error('The restored database does not match the backup.');
    return actual;
  } finally {
    removeOwnedFile(restoredPath);
    rmdirSync(scratch);
  }
}

/** Expired snapshots are removed even if the next backup cannot be made. */
export function pruneBackups(dataDir: string, { now = Date.now(), backupDir = join(dataDir, 'backups') }: { now?: number; backupDir?: string } = {}) {
  if (!Number.isSafeInteger(now) || now < 1_000_000_000_000 || now > 9_999_999_999_999) throw new Error('Invalid backup time.');
  const directory = checkedPath(backupDir);
  if (!existsSync(directory)) return 0;
  if (!lstatSync(directory).isDirectory()) throw new Error('The backup path is not a directory.');
  let removed = 0;
  for (const name of readdirSync(directory)) {
    const match = NAME.exec(name) ?? RECOVERY_NAME.exec(name) ?? PARTIAL_NAME.exec(name);
    const path = join(directory, name);
    if (match && Number(match[1]) <= now - BACKUP_RETENTION && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink()) {
      removeOwnedFile(path); removed++;
    }
  }
  return removed;
}

function candidates(directory: string) {
  return readdirSync(directory).flatMap(name => {
    const match = NAME.exec(name), path = join(directory, name);
    if (!match || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) return [];
    return [{ path, timestamp: Number(match[1]) }];
  }).sort((a, b) => b.timestamp - a.timestamp || b.path.localeCompare(a.path));
}

/** Daily online snapshots, published only after a complete isolated restoration passes. */
export async function runBackup(database: DatabaseSync, dataDir: string, { now = Date.now(), backupDir = join(dataDir, 'backups'), force = false }: { now?: number; backupDir?: string; force?: boolean } = {}): Promise<BackupResult> {
  if (!Number.isSafeInteger(now) || now < 1_000_000_000_000 || now > 9_999_999_999_999) throw new Error('Invalid backup time.');
  const directory = checkedPath(backupDir), prior = queues.get(directory) ?? Promise.resolve();
  const pending = prior.catch(() => {}).then(async () => {
    privateDirectory(directory);
    pruneBackups(dataDir, { now, backupDir: directory });
    for (const candidate of candidates(directory)) {
      if (force || now - candidate.timestamp >= BACKUP_INTERVAL || candidate.timestamp > now) break;
      try { return { created: false, path: candidate.path, verified: verifyBackup(candidate.path) }; }
      catch { /* A damaged recent snapshot must not prevent a fresh backup. */ }
    }
    const token = randomBytes(16).toString('hex');
    const partial = join(directory, '.accounts-' + now + '-' + token + '.partial.sqlite');
    const destination = join(directory, 'accounts-' + now + '-' + token + '.sqlite');
    const descriptor = openSync(partial, 'wx', 0o600); closeSync(descriptor);
    try {
      await backup(database, partial);
      const snapshot = new DatabaseSync(partial);
      try { snapshot.exec('PRAGMA journal_mode=DELETE;'); } finally { snapshot.close(); }
      chmodSync(partial, 0o600);
      const verified = verifyBackup(partial);
      const descriptor = openSync(partial, 'r+');
      try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
      renameSync(partial, destination);
      return { created: true, path: destination, verified };
    } finally {
      for (const suffix of ['', '-wal', '-shm', '-journal']) removeOwnedFile(partial + suffix);
    }
  });
  queues.set(directory, pending);
  try { return await pending; }
  finally { if (queues.get(directory) === pending) queues.delete(directory); }
}

/** Operator-triggered online backup; a missing source is never silently created. */
export async function backupFromDirectory(dataDir: string) {
  const path = checkedPath(join(dataDir, 'accounts.sqlite'));
  if (!lstatSync(path).isFile()) throw new Error('An existing service database is required.');
  const database = new DatabaseSync(path, { readOnly: true });
  try { return await runBackup(database, dataDir, { force: true }); }
  finally { database.close(); }
}

/** Restore only to a newly-created directory, never over an existing/live data directory. */
export function restoreBackup(value: string, targetDir: string, { now = Date.now(), erasureFile }: { now?: number; erasureFile: string }) {
  const path = standaloneFile(value), destination = checkedPath(targetDir);
  if (existsSync(destination)) throw new Error('Restore requires a new, non-existing data directory.');
  const timestamp = NAME.exec(parse(path).base)?.[1];
  if (!Number.isSafeInteger(now) || !timestamp || Number(timestamp) > now || now - Number(timestamp) >= BACKUP_RETENTION) throw new Error('Restore requires an unexpired service backup.');
  const ledger = checkedPath(erasureFile);
  validateErasureFile(ledger);
  const parent = dirname(destination);
  if (!statSync(parent).isDirectory()) throw new Error('The restore parent must already exist.');
  const expected = verifyBackup(path);
  mkdirSync(destination, { mode: 0o700 });
  const target = join(destination, 'accounts.sqlite'), restoredLedger = join(destination, 'erasures.json');
  try {
    copyFileSync(path, target, constants.COPYFILE_EXCL); chmodSync(target, 0o600);
    const recovered = inspectDatabase(target);
    if (expected.digest !== recovered.digest) throw new Error('The restored database does not match the backup.');
    copyFileSync(ledger, restoredLedger, constants.COPYFILE_EXCL); chmodSync(restoredLedger, 0o600);
    const database = new DatabaseSync(target);
    let erasures = 0, inactiveAccounts = 0, revokedSessions = 0;
    try {
      database.exec('PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;');
      erasures = applyErasures(database, restoredLedger, { now });
      inactiveAccounts = deleteInactiveAccounts(database, now);
      // An older snapshot must not reactivate sessions revoked after it was created.
      revokedSessions = Number(database.prepare('DELETE FROM sessions').run().changes);
      database.exec('VACUUM;');
    } finally { database.close(); }
    return { path: target, recovered, verified: inspectDatabase(target), removed: { erasures, inactiveAccounts, revokedSessions } };
  } catch (error) {
    for (const owned of [restoredLedger, target, target + '-wal', target + '-shm', target + '-journal']) removeOwnedFile(owned);
    rmdirSync(destination); throw error;
  }
}
