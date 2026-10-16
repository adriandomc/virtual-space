/** Only the explicit v3 test-data reset authorizes retirement of these known stores. */
export const PRELAUNCH_STORAGE_EPOCH = '3d-space-prelaunch-v3';
export function hasTestStorageRetirement(value: unknown, now = Date.now()): boolean {
  if (!value || typeof value !== 'object') return false;
  const release = value as { version?: unknown; retireTestStorage?: unknown };
  if (release.version !== 3 || !release.retireTestStorage || typeof release.retireTestStorage !== 'object') return false;
  const marker = release.retireTestStorage as { epoch?: unknown; resetAt?: unknown };
  return marker.epoch === PRELAUNCH_STORAGE_EPOCH && Number.isSafeInteger(marker.resetAt) && Number(marker.resetAt) >= 1577836800000 && Number(marker.resetAt) <= now + 300000;
}
