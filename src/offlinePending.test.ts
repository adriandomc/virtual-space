import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { hasStoredOfflineChanges } from './offlinePending';
import { clearOffline, writeOffline } from './offlineStorage';

test('startup checks closed designs, uninserted models, sketch removals and recoveries across accounts without reading binaries', async () => {
  await clearOffline(); assert.equal(await hasStoredOfflineChanges(), false);
  for (const [store, value] of [
    ['projects', { accountId: 'other', localOnly: true }], ['projects', { sketchDrafts: { level: { blob: null } } }],
    ['assets', { pending: true }], ['assets', { deleted: true }], ['meta', { roomId: 'closed', project: { version: 3 } }],
  ] as const) {
    if ('accountId' in value) await writeOffline('meta', 'identity', { id: value.accountId, username: 'sample' });
    await writeOffline(store, 'sample', value);
    await writeOffline('meta', 'identity', { id: 'current', username: 'current' });
    assert.equal(await hasStoredOfflineChanges(), true); await clearOffline();
  }
  await writeOffline('meta', 'identity', { id: 'owner', username: 'owner' }); assert.equal(await hasStoredOfflineChanges(), false);
});
