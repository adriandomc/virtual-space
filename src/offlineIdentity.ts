import { readOffline, writeOffline } from './offlineStorage';

export type OfflineIdentity = { id: string; username: string; verifiedAt: number };
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;

export function parseOfflineIdentity(value: unknown, now = Date.now()): OfflineIdentity | null {
  if (!value || typeof value !== 'object') return null;
  const identity = value as OfflineIdentity;
  if (typeof identity.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identity.id)
    || typeof identity.username !== 'string' || !/^[a-z0-9_]{3,32}$/.test(identity.username)
    || !Number.isFinite(identity.verifiedAt) || identity.verifiedAt > now + 300000 || now - identity.verifiedAt > MAX_AGE) return null;
  return { id: identity.id, username: identity.username, verifiedAt: identity.verifiedAt };
}

export async function offlineIdentity() { return parseOfflineIdentity(await readOffline('meta', 'identity')); }
export async function rememberOfflineIdentity(user: { id: string; username: string }) {
  const identity = parseOfflineIdentity({ ...user, verifiedAt: Date.now() });
  if (identity) await writeOffline('meta', 'identity', identity);
}
