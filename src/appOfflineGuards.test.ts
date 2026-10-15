import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmAllLocalSaved, getAppOfflineState, registerBeforeAppUpdate, releaseLocalSaveFreeze } from './appOffline';
import { bootstrapOfflineMode, offlineForced, refreshOfflineMode } from './offlineMode';
import { clearOffline, writeOffline } from './offlineStorage';

test('a mode preflight waits for local durable guards and freezes editing until mode publication completes', async () => {
  let finish!: () => void;
  const guard = registerBeforeAppUpdate(() => new Promise<void>(resolve => { finish = resolve; }));
  try {
    const checking = confirmAllLocalSaved(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(getAppOfflineState().updating, true);
    finish(); await checking; assert.equal(getAppOfflineState().updating, true);
    await releaseLocalSaveFreeze(); assert.equal(getAppOfflineState().updating, false);
  } finally { guard(); await releaseLocalSaveFreeze(); }
});

test('unsaved model guards refuse a mode change, release the freeze and keep the current mode', async () => {
  const unregister = registerBeforeAppUpdate(async () => { throw new Error('Guarda el modelo antes de continuar.'); });
  let forced = false;
  try {
    await assert.rejects(async () => {
      await confirmAllLocalSaved();
      try { forced = true; }
      finally { await releaseLocalSaveFreeze(); }
    }, /Guarda el modelo/);
    assert.equal(forced, false); assert.equal(getAppOfflineState().updating, false);
  } finally { unregister(); await releaseLocalSaveFreeze(); }
});

test('release refreshes the persisted mode before unlocking when its broadcast has not arrived', async () => {
  await clearOffline();
  const accountId = '11111111-1111-4111-8111-111111111111';
  await writeOffline('meta', 'identity', { id: accountId, username: 'test_owner', verifiedAt: Date.now() });
  await refreshOfflineMode(); assert.equal(offlineForced(), false);
  await confirmAllLocalSaved();
  await writeOffline('meta', 'mode:' + accountId, { accountId, forced: true });
  assert.equal(offlineForced(), false, 'another tab wrote its choice but this tab has not received the broadcast');
  await releaseLocalSaveFreeze();
  assert.equal(getAppOfflineState().updating, false); assert.equal(offlineForced(), true);
  await writeOffline('meta', 'mode:' + accountId, { accountId, forced: false });
  await refreshOfflineMode(); assert.equal((await bootstrapOfflineMode()).forced, false);
});
