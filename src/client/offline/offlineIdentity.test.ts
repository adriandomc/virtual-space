import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOfflineIdentity } from './offlineIdentity';

test('offline identity contains no credentials and keeps local access independently of session age', () => {
  const now = 1800000000000, value = { id: 'a10e1c3d-3421-4234-9432-01aaddebff21', username: 'usuario', verifiedAt: now, password: 'never-copy' };
  assert.deepEqual(parseOfflineIdentity(value, now), { id: value.id, username: value.username, verifiedAt: now });
  assert.equal(parseOfflineIdentity({ ...value, verifiedAt: now - 365 * 86400000 }, now)?.id, value.id);
  assert.equal(parseOfflineIdentity({ ...value, verifiedAt: now + 300001 }, now), null);
  for (const invalid of [null, {}, { ...value, id: '../another' }, { ...value, username: 'MixedCase' }, { ...value, verifiedAt: NaN }]) assert.equal(parseOfflineIdentity(invalid, now), null);
});
