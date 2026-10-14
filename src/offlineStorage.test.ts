import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import assert from 'node:assert/strict';
import test from 'node:test';
import { clearOffline, getOfflineAccess, listOffline, onOfflinePurge, readOffline, removeOffline, setOfflineAccess, writeOffline } from './offlineStorage';

test('offline records commit before resolving, remain separated by keys, and delete completely', async () => {
  await clearOffline();
  await writeOffline('meta', 'identity', { id: 'a' });
  await writeOffline('projects', 'a:room', { accountId: 'a', title: 'Uno' });
  await writeOffline('meta', 'identity', { id: 'b' });
  await writeOffline('projects', 'b:room', { accountId: 'b', title: 'Dos' });
  assert.deepEqual(await readOffline('projects', 'a:room'), { accountId: 'a', title: 'Uno' });
  assert.equal((await listOffline('projects')).length, 2);
  await removeOffline('projects', 'a:room');
  assert.equal(await readOffline('projects', 'a:room'), undefined);
  await clearOffline();
  assert.deepEqual(await listOffline('projects'), []);
});

test('a successful request followed by transaction abort never reports a durable save', async () => {
  await clearOffline();
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    const request = put.apply(this, args);
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  };
  try { await assert.rejects(writeOffline('projects', 'aborted', { pending: true }), /No se pudo guardar/); }
  finally { IDBObjectStore.prototype.put = put; }
  assert.equal(await readOffline('projects', 'aborted'), undefined);
});

test('quota failures are visible and leave existing pending records intact', async () => {
  await writeOffline('projects', 'pending', { title: 'No perder' });
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function () { throw new DOMException('Full', 'QuotaExceededError'); };
  try { await assert.rejects(writeOffline('projects', 'pending', { title: 'Cambio' }), /No hay espacio/); }
  finally { IDBObjectStore.prototype.put = put; }
  assert.deepEqual(await readOffline('projects', 'pending'), { title: 'No perder' });
});

test('identity changes invalidate in-memory access without deleting another account’s pending work', async () => {
  await clearOffline();
  let invalidations = 0;
  const unsubscribe = onOfflinePurge(() => invalidations++);
  await writeOffline('meta', 'identity', { id: 'a', username: 'uno' });
  setOfflineAccess('room', { accountId: 'a', allowed: true });
  assert.equal(getOfflineAccess('room')?.allowed, true);
  await writeOffline('projects', 'a:room', { pending: true });
  await writeOffline('meta', 'identity', { id: 'b', username: 'dos' });
  assert.equal(getOfflineAccess('room'), undefined);
  setOfflineAccess('room', { accountId: 'a', allowed: true });
  assert.equal(getOfflineAccess('room'), undefined);
  assert.deepEqual(await readOffline('projects', 'a:room'), { pending: true });
  assert.ok(invalidations >= 2);
  await clearOffline();
  assert.equal(getOfflineAccess('room'), undefined);
  unsubscribe();
});

test('a queued old-account write cannot recreate drafts after logout or an account switch', async () => {
  await clearOffline();
  await writeOffline('meta', 'identity', { id: 'a' });
  await clearOffline();
  await assert.rejects(writeOffline('projects', 'a:late', { accountId: 'a', pending: true }));
  await writeOffline('meta', 'identity', { id: 'b' });
  await assert.rejects(writeOffline('assets', 'a:late', { accountId: 'a', blob: new Blob(['private']) }));
  assert.deepEqual(await listOffline('projects'), []);
  assert.deepEqual(await listOffline('assets'), []);
});

test('authoritative session expiry removes access immediately but preserves unsynchronized work', async () => {
  await clearOffline(); await writeOffline('meta', 'identity', { id: 'a' });
  setOfflineAccess('room', { accountId: 'a', allowed: true });
  await writeOffline('projects', 'a:room', { accountId: 'a', pending: true });
  const removing = removeOffline('meta', 'identity');
  assert.equal(getOfflineAccess('room'), undefined);
  await removing;
  assert.equal(await readOffline('meta', 'identity'), undefined);
  assert.deepEqual(await readOffline('projects', 'a:room'), { accountId: 'a', pending: true });
});
