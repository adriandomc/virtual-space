import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import assert from 'node:assert/strict';
import test from 'node:test';
import { atomicOffline, cacheOfflineAsset, clearOffline, getOfflineAccess, listOffline, onOfflinePurge, readOffline, removeOffline, setOfflineAccess, updateOffline, writeOffline } from './offlineStorage';

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
test('binary storage uses portable buffers, keeps asset metadata small, and does not rewrite files for flags', async () => {
  await clearOffline(); await writeOffline('meta', 'identity', { id: 'owner' });
  const put = IDBObjectStore.prototype.put; let binaryWrites = 0;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    const value = args[0] as { blob?: Blob; bytes?: ArrayBuffer };
    assert.equal(value.blob instanceof Blob, false, 'Some WebKit implementations reject native Blobs in IndexedDB');
    if (this.name === 'blobs') { assert.ok(value.bytes instanceof ArrayBuffer); binaryWrites++; }
    return put.apply(this, args);
  };
  try {
    await writeOffline('assets', 'owner:room:model', { accountId: 'owner', roomId: 'room', blob: new Blob(['GLB'], { type: 'model/gltf-binary' }), pending: true });
    await updateOffline<{ accountId: string; pending: boolean }>('assets', 'owner:room:model', 'owner', value => value ? { ...value, pending: false } : undefined);
    assert.equal(binaryWrites, 1);
    const record = await readOffline<{ blob: Blob; pending: boolean }>('assets', 'owner:room:model');
    assert.equal(await record?.blob.text(), 'GLB'); assert.equal(record?.blob.type, 'model/gltf-binary'); assert.equal(record?.pending, false);
    await writeOffline('blobs', 'sketch', { accountId: 'owner', blob: new Blob(['PNG'], { type: 'image/png' }) });
    assert.equal(await (await readOffline<{ blob: Blob }>('blobs', 'sketch'))?.blob.text(), 'PNG');
  } finally { IDBObjectStore.prototype.put = put; }
});
test('late asset caching cannot erase a pending deletion or replace its recovery file', async () => {
  await clearOffline(); await writeOffline('meta', 'identity', { id: 'owner' });
  const key = 'owner:room:model';
  await writeOffline('assets', key, { accountId: 'owner', roomId: 'room', blob: new Blob(['original']), pending: false, deleted: true });
  await cacheOfflineAsset(key, { accountId: 'owner', roomId: 'room', blob: new Blob(['stale response']), pending: false });
  const record = await readOffline<{ blob: Blob; deleted?: boolean }>('assets', key);
  assert.equal(record?.deleted, true); assert.equal(await record?.blob.text(), 'original');
});

test('normalized project reads cannot mix metadata and levels from different committed saves', async () => {
  for (const list of [false, true]) {
    await clearOffline(); await writeOffline('meta', 'identity', { id: 'owner' });
    const metadata = (name: string) => ({ accountId: 'owner', snapshot: { project: { name, levels: [] } }, levelRefs: { snapshot: ['owner:room:level'] } });
    await atomicOffline('owner', [
      { store: 'projects', key: 'owner:room', value: metadata('old metadata') },
      { store: 'levels', key: 'owner:room:level', value: { accountId: 'owner', level: { name: 'old level' } } },
    ]);
    const method = list ? 'getAll' : 'get', original = IDBObjectStore.prototype[method];
    let written: Promise<void> | undefined;
    IDBObjectStore.prototype[method] = function (this: IDBObjectStore, ...args: any[]) {
      const request = original.apply(this, args as never);
      if (this.name === 'projects') request.addEventListener('success', () => {
        const tx = this.transaction.db.transaction(['projects', 'levels'], 'readwrite');
        tx.objectStore('projects').put(metadata('new metadata'), 'owner:room');
        tx.objectStore('levels').put({ accountId: 'owner', level: { name: 'new level' } }, 'owner:room:level');
        written = new Promise<void>((accept, reject) => { tx.oncomplete = () => accept(); tx.onabort = () => reject(tx.error); });
      }, { once: true });
      return request;
    } as typeof original;
    try {
      const result: any = list ? (await listOffline('projects'))[0] : await readOffline('projects', 'owner:room');
      assert.equal(result.snapshot.project.name, 'old metadata');
      assert.equal(result.snapshot.project.levels[0].name, 'old level');
      await written;
    } finally { IDBObjectStore.prototype[method] = original; }
    const latest: any = await readOffline('projects', 'owner:room');
    assert.equal(latest.snapshot.project.name, 'new metadata'); assert.equal(latest.snapshot.project.levels[0].name, 'new level');
  }
});
