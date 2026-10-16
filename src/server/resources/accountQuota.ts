import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from '../auth/auth.js';

export type AccountQuota = { designs: number; bytes: number; receipts?: number };
const setting = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(name + ' must be a positive integer.');
  return value;
};
export function accountQuotaConfig(): AccountQuota { return { designs: setting('ACCOUNT_MAX_DESIGNS', 50), bytes: setting('ACCOUNT_MAX_BYTES', 500 * 1024 * 1024), receipts: setting('ACCOUNT_MAX_RECEIPTS', 100000) }; }

/** Each canonical document and binary is charged once, independently of references. */
export function accountUsage(database: DatabaseSync, ownerId: string) {
  return database.prepare(`SELECT
    (SELECT COUNT(*) FROM rooms WHERE owner_id=?) AS designs,
    COALESCE((SELECT SUM(length(CAST(room AS BLOB))) FROM rooms WHERE owner_id=?),0)
    +COALESCE((SELECT SUM(length(CAST(document AS BLOB))) FROM project_levels JOIN rooms ON rooms.id=project_levels.room_id WHERE owner_id=?),0)
    +COALESCE((SELECT SUM(length(data)) FROM project_sketches JOIN rooms ON rooms.id=project_sketches.room_id WHERE owner_id=?),0)
    +COALESCE((SELECT SUM(size) FROM model_assets WHERE owner_id=?),0) AS bytes`).get(ownerId, ownerId, ownerId, ownerId, ownerId) as { designs: number; bytes: number };
}

export function checkAccountQuota(previous: { designs: number; bytes: number }, next: { designs: number; bytes: number }, limits: AccountQuota) {
  if (next.designs > limits.designs && next.designs > previous.designs) throw new HttpError(413, 'Alcanzaste el límite de diseños de tu cuenta.');
  if (next.bytes > limits.bytes && next.bytes > previous.bytes) throw new HttpError(413, 'Alcanzaste el espacio disponible de tu cuenta.');
}

export function quotaMutation<T>(database: DatabaseSync, ownerId: string, limits: AccountQuota, apply: () => T): T {
  if (!database.isTransaction) throw new Error('Account quota changes require a transaction.');
  const previous = accountUsage(database, ownerId), result = apply();
  checkAccountQuota(previous, accountUsage(database, ownerId), limits);
  return result;
}
