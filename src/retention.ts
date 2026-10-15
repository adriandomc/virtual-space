import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { INACTIVITY_MONTHS } from './legalPolicy.js';

export function inactivityDeadline(time: number) {
  const date = new Date(time);
  if (!Number.isSafeInteger(time) || !Number.isFinite(date.getTime())) throw new Error('Invalid activity timestamp.');
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + INACTIVITY_MONTHS);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.getTime();
}

export function touchAccount(database: DatabaseSync, id: string, time: number) {
  return database.prepare('UPDATE users SET last_active_at = ?, inactive_after = ? WHERE id = ? AND inactive_after > ? AND last_active_at < ?').run(time, inactivityDeadline(time), id, time, time).changes;
}

export function deleteInactiveAccounts(database: DatabaseSync, time: number) {
  const expired = database.prepare('SELECT id FROM users WHERE inactive_after <= ?').all(time);
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const user of expired) database.prepare('DELETE FROM request_limits WHERE key = ?').run('create-user:' + createHash('sha256').update(String(user.id)).digest('hex'));
    const deleted = database.prepare('DELETE FROM users WHERE inactive_after <= ?').run(time).changes;
    database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(time);
    database.prepare('DELETE FROM request_limits WHERE updated_at < ? AND blocked_until <= ?').run(time - 48 * 60 * 60_000, time);
    database.exec('COMMIT');
    return Number(deleted);
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
