import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBObjectStore } from 'fake-indexeddb';
import { createBlankRoom } from './onboardingModel';
import { offlineForced, setOfflineMode } from './offlineMode';
import { accountRequest } from './accountApi';
import { clearOffline, listOffline, readOffline, setOfflineAccess, writeOffline } from './offlineStorage';
import { readOfflineProject, type OfflineProjectRecord } from './offlineProject';
import { assertRoomReadyToShare, createDesignLocal, clearOfflineAccount, deleteDesign, exportOfflineProject, importOfflineProject, listDesigns, pendingOfflineCount, persistOfflineProject, roomHasOfflineChanges, syncOfflineAccount } from './offlineService';
import { listOfflineModels, uploadOfflineModel, type OfflineAssetRecord } from './offlineAssets';
import type { ProjectSnapshot } from './liveProject';

const user = { id: '031f3902-316e-4233-931b-6e3776ba8ae6', username: 'pruebas', verifiedAt: 1700000000000 };
function glb() {
  const json = { asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }] };
  const text = new TextEncoder().encode(JSON.stringify(json)), size = Math.ceil(text.length / 4) * 4;
  const bytes = new Uint8Array(28 + size + 36), view = new DataView(bytes.buffer);
  [0x46546c67, 2, bytes.length, size, 0x4e4f534a].forEach((value, i) => view.setUint32(i * 4, value, true));
  bytes.fill(32, 20, 20 + size); bytes.set(text, 20); view.setUint32(20 + size, 36, true); view.setUint32(24 + size, 0x004e4942, true);
  [0, 0, 0, 1, 0, 0, 0, 1, 1].forEach((value, i) => view.setFloat32(28 + size + i * 4, value, true));
  return new Blob([bytes], { type: 'model/gltf-binary' });
}
async function reset() {
  if (offlineForced()) await setOfflineMode(false);
  await clearOffline(); await writeOffline('meta', 'identity', user);
}
async function force() { await writeOffline('meta', 'prepared:' + user.id, { accountId: user.id, complete: true }); await setOfflineMode(true); }
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('forced mode creates, reloads, lists, imports and exports without any API request', async () => {
  await reset(); await force();
  const fetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('No request allowed'); };
  try {
    const { id } = await createDesignLocal();
    const room = { ...createBlankRoom(), name: 'Mi diseño local' };
    await importOfflineProject(id, { room, assets: [], sketch: null });
    assert.equal((await readOfflineProject(id))?.draft?.name, room.name);
    assert.equal((await exportOfflineProject(id)).room.name, room.name);
    assert.equal((await listDesigns())[0].id, id);
    await assert.rejects(accountRequest('/api/auth/session'));
    await syncOfflineAccount();
    assert.equal(requests, 0); assert.equal(await pendingOfflineCount(), 1);
  } finally { globalThis.fetch = fetch; await setOfflineMode(false); }
});

test('atomic import rolls back assets, room and sketch when its final write fails', async () => {
  await reset(); await force(); const { id } = await createDesignLocal();
  const assetId = crypto.randomUUID(), blob = glb();
  const room = { ...createBlankRoom(), name: 'Imported', furniture: [{ id: 'piece', type: 'custom' as const, assetId, name: 'Tabla', material: null, color: null, width: 1, height: 1, depth: 1, x: 0, z: 0, rotation: 0 }] };
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    if (this.name === 'projects') throw new DOMException('Full', 'QuotaExceededError');
    return put.apply(this, args);
  };
  try { await assert.rejects(importOfflineProject(id, { room, assets: [{ id: assetId, name: 'Tabla', blob }], sketch: null }), /espacio/); }
  finally { IDBObjectStore.prototype.put = put; }
  assert.equal((await listOffline('assets')).length, 0);
  assert.notEqual((await readOfflineProject(id))?.draft?.name, 'Imported');
  assert.equal((await listOffline('blobs')).length, 0);
  await setOfflineMode(false);
});

test('invalid GLB or sketch never partially changes an existing design', async () => {
  await reset(); const { id } = await createDesignLocal();
  const room = { ...createBlankRoom(), name: 'Broken' };
  await assert.rejects(importOfflineProject(id, { room, assets: [], sketch: new Blob(['not PNG'], { type: 'image/png' }) }));
  assert.notEqual((await readOfflineProject(id))?.draft?.name, room.name);
});

test('sketch blobs are versioned separately, replaced and removed without reviving stale bytes', async () => {
  await reset(); const { id } = await createDesignLocal();
  const record = (await readOfflineProject(id))!;
  record.localOnly = false; record.snapshot.revision = 1; record.snapshot.hasSketch = true; record.snapshot.sketchVersion = 1;
  record.sketchBlob = new Blob(['old']); record.sketchBlobVersion = 1;
  await persistOfflineProject(record);
  assert.equal((await readOffline<OfflineProjectRecord>('projects', user.id + ':' + id))?.sketchBlob, undefined);
  assert.equal(await (await readOfflineProject(id))!.sketchBlob?.text(), 'old');
  record.snapshot.sketchVersion = 2; record.sketchBlob = undefined; record.sketchBlobVersion = undefined;
  await persistOfflineProject(record);
  assert.equal((await readOfflineProject(id))?.sketchBlob, undefined);
  record.snapshot.hasSketch = false; await persistOfflineProject(record);
  assert.deepEqual(await listOffline('blobs'), []);
});

test('logout guard preserves pending work and account-specific cleanup preserves another account', async () => {
  await reset(); await createDesignLocal();
  await assert.rejects(clearOfflineAccount(user.id), /pendientes/);
  assert.equal((await listOffline('projects')).length, 1);
  await writeOffline('meta', 'other-setting', { accountId: 'other', keep: true });
  await clearOfflineAccount(user.id, { discard: true });
  assert.equal((await listOffline('projects')).length, 0);
  assert.deepEqual(await readOffline('meta', 'other-setting'), { accountId: 'other', keep: true });
});

test('all closed new projects synchronize, including a GLB not inserted in any room', async () => {
  await reset(); await force();
  const first = await createDesignLocal(), second = await createDesignLocal();
  const asset = await uploadOfflineModel(new File([glb()], 'Tabla.glb'), first.id);
  assert.equal((await listOfflineModels(first.id, 'room')).length, 1);
  const remote = new Map<string, ProjectSnapshot>(), requests: string[] = [], fetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const path = String(input), method = options?.method ?? 'GET'; requests.push(method + ' ' + path);
    if (path === '/api/auth/session') return json({ user });
    if (path === '/api/rooms' && method === 'POST') {
      const { id, room } = JSON.parse(String(options?.body));
      assert.equal(new Headers(options?.headers).get('X-Account-Id'), user.id);
      assert.equal(new Headers(options?.headers).get('X-Offline-Write'), '1');
      const snapshot: ProjectSnapshot = { id, room, accountId: user.id, offlineAllowed: true, revision: 1, shared: false, role: 'owner', canEdit: true, canManage: true, hasSketch: false, sketchVersion: 0 };
      remote.set(id, snapshot); return json(snapshot, 201);
    }
    if (path.startsWith('/api/models?room=') && method === 'POST') {
      const id = new Headers(options?.headers).get('X-Model-Id'); assert.equal(id, asset.id);
      return json({ model: asset }, 201);
    }
    const id = path.split('/')[3], snapshot = remote.get(id)!;
    if (method === 'PUT') { const body = JSON.parse(String(options?.body)); assert.equal(body.revision, snapshot.revision); snapshot.room = body.room; snapshot.revision++; return json({ room: snapshot.room, revision: snapshot.revision }); }
    return json(snapshot);
  };
  try {
    await setOfflineMode(false); await syncOfflineAccount();
    assert.equal(remote.size, 2); assert.ok(remote.has(second.id));
    assert.equal(await pendingOfflineCount(), 0);
    const assets = await listOffline<OfflineAssetRecord>('assets'); assert.equal(assets[0].pending, false);
    assert.ok(requests.findIndex(request => request === 'POST /api/rooms') < requests.findIndex(request => request.startsWith('POST /api/models')));
  } finally { globalThis.fetch = fetch; }
});

test('deferred deletes include both revisions and stay hidden until their confirmation', async () => {
  await reset(); const { id } = await createDesignLocal();
  const record = (await readOfflineProject(id))!; record.localOnly = false; record.draft = null; record.snapshot.revision = 4; record.snapshot.sketchVersion = 2; await persistOfflineProject(record);
  await force(); await deleteDesign(id); assert.deepEqual(await listDesigns(), []);
  const fetch = globalThis.fetch; let deleted = false;
  globalThis.fetch = async (input, options) => {
    if (String(input) === '/api/auth/session') return json({ user });
    assert.equal(options?.method, 'DELETE'); assert.deepEqual(JSON.parse(String(options.body)), { revision: 4, sketchVersion: 2 }); deleted = true; return json({ deleted: true });
  };
  try { await setOfflineMode(false); await syncOfflineAccount(); assert.ok(deleted); assert.equal(await readOfflineProject(id), null); }
  finally { globalThis.fetch = fetch; }
});

test('clean local exports remain available after expired sessions and transport failures', async () => {
  await reset(); const { id } = await createDesignLocal(); const record = (await readOfflineProject(id))!;
  record.localOnly = false; record.snapshot.revision = 1; record.draft = null; await persistOfflineProject(record);
  const fetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => json({ error: 'Expired' }, 401);
    assert.equal((await exportOfflineProject(id)).room.version, 2);
    globalThis.fetch = async () => { throw new TypeError('Offline'); };
    assert.equal((await exportOfflineProject(id)).room.version, 2);
    globalThis.fetch = async () => json({ error: 'No access' }, 403);
    await assert.rejects(exportOfflineProject(id), /No access/);
  } finally { globalThis.fetch = fetch; }
});

test('late responses and new requests are rejected after choosing forced mode', async () => {
  await reset(); await writeOffline('meta', 'prepared:' + user.id, { accountId: user.id, complete: true });
  const fetch = globalThis.fetch; let release!: (response: Response) => void, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; }); let requests = 0;
  globalThis.fetch = async () => { requests++; started(); return new Promise(resolve => { release = resolve; }); };
  try {
    const request = accountRequest('/api/rooms'); await entered; await setOfflineMode(true); release(json({ rooms: [] }));
    await assert.rejects(request); await assert.rejects(accountRequest('/api/rooms')); assert.equal(requests, 1);
  } finally { globalThis.fetch = fetch; await setOfflineMode(false); }
});
test('a remotely deleted source never purges a pending standalone GLB', async () => {
  await reset(); await force(); const { id } = await createDesignLocal();
  const record = (await readOfflineProject(id))!; record.localOnly = false; record.draft = null; record.snapshot.revision = 1; await persistOfflineProject(record);
  const model = await uploadOfflineModel(new File([glb()], 'Recuperar.glb'), id);
  const fetch = globalThis.fetch;
  globalThis.fetch = async input => {
    const path = String(input);
    if (path === '/api/auth/session') return json({ user });
    if (path === '/api/rooms') return json({ rooms: [] });
    return json({ error: 'Eliminado' }, 404);
  };
  try {
    await setOfflineMode(false); await syncOfflineAccount(); await listDesigns();
    assert.equal((await readOfflineProject(id))?.authorized, false);
    const saved = (await listOffline<OfflineAssetRecord>('assets')).find(asset => asset.asset.id === model.id);
    assert.ok(saved?.pending); assert.equal(saved?.blob.size, model.size); assert.equal(await pendingOfflineCount(), 1);
  } finally { globalThis.fetch = fetch; }
});
test('library cleanup skips a room locked by another editor', async () => {
  await reset(); const { id } = await createDesignLocal();
  const record = (await readOfflineProject(id))!; record.localOnly = false; record.draft = null; record.snapshot.revision = 1; await persistOfflineProject(record);
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_name: string, _options: unknown, callback: (lock: null) => unknown) => callback(null) } });
  const fetch = globalThis.fetch; globalThis.fetch = async () => json({ rooms: [] });
  try { await listDesigns(); assert.ok(await readOfflineProject(id)); }
  finally { globalThis.fetch = fetch; if (descriptor) Object.defineProperty(navigator, 'locks', descriptor); else Reflect.deleteProperty(navigator, 'locks'); }
});
test('an uninserted pending GLB blocks collaboration until it is synchronized', async () => {
  await reset(); await force(); const { id } = await createDesignLocal();
  const record = (await readOfflineProject(id))!; record.localOnly = false; record.draft = null; record.snapshot.revision = 1; await persistOfflineProject(record);
  const model = await uploadOfflineModel(new File([glb()], 'Sin insertar.glb'), id);
  assert.equal(record.snapshot.room.furniture.length, 0);
  await setOfflineMode(false);
  assert.equal(await roomHasOfflineChanges(id), true); await assert.rejects(assertRoomReadyToShare(id), /modelos/);
  const fetch = globalThis.fetch; globalThis.fetch = async (input, options) => {
    if (String(input) === '/api/auth/session') return json({ user });
    if (String(input).startsWith('/api/models?room=') && options?.method === 'POST') return json({ model }, 201);
    return json(record.snapshot);
  };
  try { await syncOfflineAccount(); assert.equal(await roomHasOfflineChanges(id), false); await assert.doesNotReject(assertRoomReadyToShare(id)); }
  finally { globalThis.fetch = fetch; }
});
