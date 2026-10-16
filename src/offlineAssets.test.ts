import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBObjectStore } from 'fake-indexeddb';
import { createDefaultRoom } from './model';
import { flushOfflineAssets, forgetOfflineModel, listOfflineModels, loadLibraryModelBlob, loadModelBlob, reconcileOfflineModels, uploadOfflineModel, type OfflineAssetRecord } from './offlineAssets';
import { clearOffline, listOffline, setOfflineAccess, writeOffline } from './offlineStorage';
import { inspectOfflineGlb, offlineModelMetadata } from './offlineModelValidation';

function fixture(change: (document: any, view: DataView, offset: number) => void = () => {}) {
  const document = { asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0, name: 'Tabla' }], scenes: [{ nodes: [0] }] };
  const temp = new DataView(new ArrayBuffer(36));
  [0, 0, 0, 1, 0, 0, 0, 1, 1].forEach((value, i) => temp.setFloat32(i * 4, value, true));
  change(document, temp, 0);
  const text = new TextEncoder().encode(JSON.stringify(document)), size = Math.ceil(text.length / 4) * 4;
  const bytes = new Uint8Array(28 + size + 36), view = new DataView(bytes.buffer);
  [0x46546c67, 2, bytes.length, size, 0x4e4f534a].forEach((value, i) => view.setUint32(i * 4, value, true));
  bytes.fill(32, 20, 20 + size); bytes.set(text, 20);
  view.setUint32(20 + size, 36, true); view.setUint32(24 + size, 0x004e4942, true); bytes.set(new Uint8Array(temp.buffer), 28 + size);
  return bytes;
}
async function allow(accountId = 'owner', roomId = 'room') {
  await writeOffline('meta', 'identity', { id: accountId, username: accountId });
  setOfflineAccess(roomId, { accountId, allowed: true });
}

test('offline GLB validation rejects external dependencies, cycles, memory bombs and non-finite geometry', async () => {
  assert.throws(() => inspectOfflineGlb(fixture(document => { document.buffers[0].uri = 'https://example.com/x'; }).buffer), /sin enlaces/);
  assert.throws(() => inspectOfflineGlb(fixture(document => { document.nodes[0].children = [0]; }).buffer));
  assert.throws(() => inspectOfflineGlb(fixture(document => { document.accessors[0].count = 600001; }).buffer));
  await assert.rejects(offlineModelMetadata(new Blob([fixture((_, view) => view.setFloat32(4, NaN, true))]), 'id', 'room', 'Modelo.glb'));
  const metadata = await offlineModelMetadata(new Blob([fixture()]), 'id', 'room', 'Tabla.glb');
  assert.equal(metadata.name, 'Tabla'); assert.equal(metadata.triangles, 1); assert.equal(metadata.height, 1);
  assert.deepEqual(metadata.nodes, [{ key: '0', name: 'Tabla', mesh: true }]);
});

test('offline metadata uses original GLB names and marks only generated labels', async () => {
  const metadata = (change: (document: any) => void) => offlineModelMetadata(new Blob([fixture(change)]), 'id', 'room', 'Model.glb');
  for (const name of [undefined, '', '   ']) {
    const result = await metadata(document => { document.nodes[0].name = name; });
    assert.deepEqual(result.nodes, [{ key: '0', name: 'Parte 1', mesh: true, generatedName: true }]);
  }
  for (const name of ['Parte 1', 'Tabla', 'My shelf [1]: left']) {
    const result = await metadata(document => { document.nodes[0].name = name; document.nodes[0].generatedName = true; document.nodes[0].extras = { generatedName: true }; });
    assert.deepEqual(result.nodes, [{ key: '0', name, mesh: true }]);
  }
  const hierarchy = await metadata(document => { document.nodes = [{ mesh: 0 }, { children: [0] }]; document.scenes[0].nodes = [1]; });
  assert.deepEqual(hierarchy.nodes.map(({ key, name, generatedName }) => ({ key, name, generatedName })), [{ key: '1', name: 'Parte 2', generatedName: true }, { key: '0', name: 'Parte 1', generatedName: true }]);
});

test('cached model bytes recover on transport failure but not on permission denial or a different account', async () => {
  await clearOffline(); await allow();
  const original = globalThis.fetch, bytes = fixture();
  try {
    globalThis.fetch = async () => new Response(bytes);
    assert.equal((await loadModelBlob('model', 'room')).size, bytes.length);
    globalThis.fetch = async () => { throw new TypeError('Offline'); };
    assert.equal((await loadModelBlob('model', 'room')).size, bytes.length);
    await allow('other');
    await assert.rejects(loadModelBlob('model', 'room'), /aún no está disponible/);
    await allow();
    globalThis.fetch = async () => new Response('', { status: 403 });
    await assert.rejects(loadModelBlob('model', 'room'), /no está disponible/);
    globalThis.fetch = async () => { throw new TypeError('Offline'); };
    await assert.rejects(loadModelBlob('model', 'room'), /aún no está disponible/);
  } finally { globalThis.fetch = original; }
});

test('public model loads omit credentials and never read, write, fall back to, or erase private cache', async () => {
  await clearOffline(); await allow();
  const original = globalThis.fetch, get = IDBObjectStore.prototype.get, put = IDBObjectStore.prototype.put;
  const bytes = fixture();
  try {
    globalThis.fetch = async () => { throw new TypeError('Offline'); };
    const pending = await uploadOfflineModel(new File([bytes], 'Privado.glb'), 'room');
    const before = await listOffline<OfflineAssetRecord>('assets');
    IDBObjectStore.prototype.get = function () { throw new Error('Public reads must not use IndexedDB'); };
    IDBObjectStore.prototype.put = function () { throw new Error('Public writes must not use IndexedDB'); };
    let requests = 0;
    globalThis.fetch = async (input, options) => {
      requests++;
      assert.equal(input, `/api/models/${pending.id}?room=room&public=1`);
      assert.equal(options?.credentials, 'omit');
      assert.equal(options?.cache, 'no-store');
      return new Response(bytes);
    };
    assert.equal((await loadModelBlob(pending.id, 'room', true)).size, bytes.length);
    assert.equal(requests, 1, 'a pending private asset cannot satisfy a public load');
    globalThis.fetch = async () => { throw new TypeError('Public offline'); };
    await assert.rejects(loadModelBlob(pending.id, 'room', true), /Public offline/);
    globalThis.fetch = async () => new Response('', { status: 403 });
    await assert.rejects(loadModelBlob(pending.id, 'room', true), /no está disponible/);
    IDBObjectStore.prototype.get = get; IDBObjectStore.prototype.put = put;
    const after = await listOffline<OfflineAssetRecord>('assets');
    assert.equal(after.length, 1);
    assert.equal(after[0].asset.id, before[0].asset.id);
    assert.equal(after[0].pending, true);
    assert.deepEqual(await after[0].blob.arrayBuffer(), await before[0].blob.arrayBuffer());
  } finally { globalThis.fetch = original; IDBObjectStore.prototype.get = get; IDBObjectStore.prototype.put = put; }
});

test('cached GLB remains usable during temporary proxy outages without bypassing authorization errors', async () => {
  await clearOffline(); await allow();
  const original = globalThis.fetch, bytes = fixture();
  try {
    globalThis.fetch = async () => new Response(bytes);
    await loadModelBlob('model', 'room');
    for (const status of [401, 408, 502, 503, 504]) {
      globalThis.fetch = async () => new Response('Temporary outage', { status });
      assert.equal((await loadModelBlob('model', 'room')).size, bytes.length, String(status));
    }
    for (const status of [403, 404, 429]) {
      globalThis.fetch = async () => new Response('Denied', { status });
      await assert.rejects(loadModelBlob('model', 'room'), /no está disponible/, String(status));
    }
  } finally { globalThis.fetch = original; }
});

test('offline uploads persist their GLB and reuse the same id when synchronization retries', async () => {
  await clearOffline(); await allow();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError('Offline'); };
    const asset = await uploadOfflineModel(new File([fixture()], 'Tabla.glb'), 'room');
    const records = await listOffline<OfflineAssetRecord>('assets');
    assert.equal(records.length, 1); assert.equal(records[0].pending, true);
    assert.equal((await loadModelBlob(asset.id, 'room')).size, asset.size);
    assert.equal((await listOfflineModels('room', 'room'))[0].id, asset.id);
    const room = createDefaultRoom();
    room.furniture = [{ id: 'table', type: 'custom', color: null, material: null, assetId: asset.id, width: 1, height: 1, depth: 1, x: 0, z: 0, rotation: 0 }];
    const requestedIds: string[] = [];
    globalThis.fetch = async (_url, options) => {
      const headers = options?.headers as Record<string, string>;
      requestedIds.push(headers['X-Model-Id']);
      assert.equal(headers['X-Account-Id'], 'owner'); assert.equal(headers['X-Offline-Write'], '1');
      if (requestedIds.length === 1) throw new TypeError('Response lost');
      return Response.json({ model: asset });
    };
    await assert.rejects(flushOfflineAssets('room', room));
    assert.equal((await listOffline<OfflineAssetRecord>('assets'))[0].pending, true);
    assert.deepEqual(await flushOfflineAssets('room', room), room);
    assert.deepEqual(requestedIds, [asset.id, asset.id]);
    assert.equal((await listOffline<OfflineAssetRecord>('assets'))[0].pending, false);
    await flushOfflineAssets('room', room);
    assert.equal(requestedIds.length, 2);
  } finally { globalThis.fetch = original; }
});

test('upload permission denial never creates an offline queue and collaborative rooms cannot queue', async () => {
  await clearOffline(); await allow();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ error: 'Sin acceso' }, { status: 403 });
    await assert.rejects(uploadOfflineModel(new File([fixture()], 'Tabla.glb'), 'room'), /Sin acceso/);
    assert.equal((await listOffline('assets')).length, 0);
    setOfflineAccess('room', { accountId: 'owner', allowed: false });
    globalThis.fetch = async () => { throw new TypeError('Offline'); };
    await assert.rejects(uploadOfflineModel(new File([fixture()], 'Tabla.glb'), 'room'), /No se pudo conectar/);
    assert.equal((await listOffline('assets')).length, 0);
  } finally { globalThis.fetch = original; }
});

test('successful library reconciliation removes deleted server models and preserves pending models', async () => {
  await clearOffline(); await allow();
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(fixture());
    await loadModelBlob('deleted', 'room');
    globalThis.fetch = async () => { throw new TypeError('Offline'); };
    const pending = await uploadOfflineModel(new File([fixture()], 'Pendiente.glb'), 'room');
    await reconcileOfflineModels('room', [], 'room');
    assert.deepEqual((await listOfflineModels('room', 'room')).map(asset => asset.id), [pending.id]);
    await forgetOfflineModel(pending.id);
    assert.deepEqual(await listOfflineModels('room', 'room'), []);
  } finally { globalThis.fetch = original; }
});

test('online model loading and upload remain usable when local cache is full, while offline writes fail visibly', async () => {
  await clearOffline(); await allow();
  const original = globalThis.fetch, put = IDBObjectStore.prototype.put;
  const file = new File([fixture()], 'Tabla.glb'), asset = await offlineModelMetadata(file, 'new', 'room', file.name);
  try {
    IDBObjectStore.prototype.put = function () { throw new DOMException('Full', 'QuotaExceededError'); };
    globalThis.fetch = async () => new Response(fixture());
    assert.equal((await loadModelBlob('model', 'room')).size, file.size);
    globalThis.fetch = async () => Response.json({ model: asset });
    assert.equal((await uploadOfflineModel(file, 'room')).id, asset.id);
    globalThis.fetch = async () => { throw new TypeError('Offline'); };
    await assert.rejects(uploadOfflineModel(file, 'room'), /No hay espacio/);
  } finally { globalThis.fetch = original; IDBObjectStore.prototype.put = put; }
});

test('library downloads use only the active owner cache and never bypass a denial', async () => {
  await clearOffline(); await allow();
  const original = globalThis.fetch, file = new Blob([fixture()]);
  const asset = await offlineModelMetadata(file, 'library', 'source', 'Tabla.glb');
  await writeOffline('assets', 'owner:source:library', { accountId: 'owner', roomId: 'source', asset, blob: file, pending: false } satisfies OfflineAssetRecord);
  try {
    globalThis.fetch = async () => { throw new TypeError('Offline'); };
    assert.equal((await loadLibraryModelBlob(asset, 'room')).size, file.size);
    await allow('other');
    await assert.rejects(loadLibraryModelBlob(asset, 'room'), /no está disponible sin conexión/);
    await allow();
    globalThis.fetch = async () => new Response('', { status: 403 });
    await assert.rejects(loadLibraryModelBlob(asset, 'room'), /no está disponible/);
    globalThis.fetch = async () => { throw new TypeError('Offline'); };
    await assert.rejects(loadLibraryModelBlob(asset, 'room'), /no está disponible sin conexión/);
  } finally { globalThis.fetch = original; }
});
