import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { BACKUP_RETENTION_DAYS } from './legalPolicy.js';
import { clearProjectCache, invalidateProjectCache } from './projectRepository.js';

type Erasure = { kind: 'user' | 'room' | 'sketch' | 'share' | 'member' | 'asset'; id: string; at: number; version?: number; levelId?: string };
type Ledger = { version: 1; entries: Erasure[] };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const windowMs = BACKUP_RETENTION_DAYS * 24 * 60 * 60_000;

function validateEntry(entry: Erasure) {
  if (!entry || !['user', 'room', 'sketch', 'share', 'member', 'asset'].includes(entry.kind) || typeof entry.id !== 'string' || !idPattern.test(entry.id) || !Number.isSafeInteger(entry.at) || entry.at < 0 || (entry.kind === 'sketch' && (!entry.levelId || !/^[a-zA-Z0-9_-]{1,80}$/.test(entry.levelId) || !Number.isSafeInteger(entry.version) || entry.version! < 1))) throw new Error('Invalid erasure ledger entry.');
}

function readLedger(path: string): Ledger {
  const file = lstatSync(path);
  if (!file.isFile() || file.isSymbolicLink() || file.size > 32 * 1024 * 1024) throw new Error('Invalid erasure ledger.');
  const ledger: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!ledger || typeof ledger !== 'object' || !('version' in ledger) || ledger.version !== 1 || !('entries' in ledger) || !Array.isArray(ledger.entries)) throw new Error('Invalid erasure ledger.');
  for (const entry of ledger.entries) {
    validateEntry(entry);
  }
  return ledger as Ledger;
}

function writeLedger(path: string, ledger: Ledger) {
  const temporary = join(dirname(path), '.erasures-' + randomUUID() + '.tmp');
  try {
    writeFileSync(temporary, JSON.stringify(ledger), { mode: 0o600, flag: 'wx', flush: true });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } finally { rmSync(temporary, { force: true }); }
}

export function initializeErasures(dataDir: string, database?: DatabaseSync) {
  const path = join(dataDir, 'erasures.json');
  database?.exec('BEGIN IMMEDIATE');
  try {
    if (existsSync(path)) { readLedger(path); chmodSync(path, 0o600); }
    else writeLedger(path, { version: 1, entries: [] });
    database?.exec('COMMIT');
    return path;
  } catch (error) { database?.exec('ROLLBACK'); throw error; }
}

export function validateErasureFile(path: string) { readLedger(path); }

export function wasErased(path: string, kind: Erasure['kind'], id: string) {
  return readLedger(path).entries.some(entry => entry.kind === kind && entry.id === id);
}

export function recordErasure(database: DatabaseSync, ledgerPath: string, entry: Erasure, erase: () => void) {
  return recordErasures(database, ledgerPath, [entry], erase);
}
export function recordErasures(database: DatabaseSync, ledgerPath: string, entries: Erasure[], erase: () => void) {
  for (const entry of entries) validateEntry(entry);
  // Commit the recovery restriction first, so a crash cannot restore a requested deletion.
  database.exec('BEGIN IMMEDIATE');
  try {
    const ledger = readLedger(ledgerPath);
    const retained = ledger.entries.filter(previous => !entries.some(entry => previous.kind === entry.kind && previous.id === entry.id && previous.levelId === entry.levelId));
    retained.push(...entries);
    erase();
    writeLedger(ledgerPath, { version: 1, entries: retained });
    database.exec('COMMIT');
    if (entries.some(entry => entry.kind === 'user')) clearProjectCache(database);
    else for (const entry of entries) if (entry.kind === 'room') invalidateProjectCache(database, entry.id);
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}

export function pruneErasures(path: string, time: number, database?: DatabaseSync) {
  database?.exec('BEGIN IMMEDIATE');
  try {
    const ledger = readLedger(path);
    const entries = ledger.entries.filter(entry => entry.at >= time - windowMs);
    if (entries.length !== ledger.entries.length) writeLedger(path, { version: 1, entries });
    database?.exec('COMMIT');
  } catch (error) { database?.exec('ROLLBACK'); throw error; }
}

export function applyErasures(database: DatabaseSync, ledgerPath: string, { now = Date.now(), includeExpired = false }: { now?: number; includeExpired?: boolean } = {}) {
  let changed = 0;
  database.exec('BEGIN IMMEDIATE');
  try {
    const ledger = readLedger(ledgerPath);
    for (const entry of ledger.entries) {
      if (!includeExpired && entry.at < now - windowMs) continue;
      if (entry.kind === 'user') {
        changed += Number(database.prepare('DELETE FROM users WHERE id = ?').run(entry.id).changes);
        database.prepare('DELETE FROM request_limits WHERE key = ?').run('create-user:' + createHash('sha256').update(entry.id).digest('hex'));
      }
      else if (entry.kind === 'room') changed += Number(database.prepare('DELETE FROM rooms WHERE id = ?').run(entry.id).changes);
      else if (entry.kind === 'member') changed += Number(database.prepare('DELETE FROM room_members WHERE id = ?').run(entry.id).changes);
      else if (entry.kind === 'asset') {
        changed += Number(database.prepare('DELETE FROM model_assets WHERE id = ?').run(entry.id).changes);
        for (const row of database.prepare('SELECT room_id,id,document FROM project_levels').all()) {
          const room = JSON.parse(String(row.document));
          if (!Array.isArray(room.furniture) || !room.furniture.some((item: { assetId?: string }) => item.assetId === entry.id)) continue;
          room.furniture = room.furniture.filter((item: { assetId?: string }) => item.assetId !== entry.id);
          database.prepare('UPDATE project_levels SET document = ?, y_state = NULL WHERE room_id=? AND id = ?').run(JSON.stringify(room), row.room_id, row.id);
        }
      }
      else if (entry.kind === 'share') changed += Number(database.prepare('UPDATE rooms SET shared = 0 WHERE id = ? AND updated_at <= ?').run(entry.id, entry.at).changes);
      else changed += Number(database.prepare('UPDATE project_sketches SET data = NULL, mime = NULL, version = MAX(version, ?) WHERE room_id = ? AND level_id=? AND version <= ?').run(entry.version!, entry.id, entry.levelId!, entry.version!).changes);
    }
    database.exec('COMMIT');
    clearProjectCache(database);
    return changed;
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
