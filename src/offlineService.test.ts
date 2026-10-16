import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBObjectStore } from 'fake-indexeddb';
import { createBlankProject } from './onboardingModel';
import { offlineForced, setOfflineMode } from './offlineMode';
import { accountRequest } from './accountApi';
import { atomicOffline, clearOffline, listOffline, listOfflineKeys, readOffline, setOfflineAccess, writeOffline } from './offlineStorage';
import { readOfflineProject, type OfflineProjectRecord } from './offlineProject';
import { assertRoomReadyToShare, copyDesign, createDesignLocal, clearOfflineAccount, deleteDesign, exportOfflineProject, importOfflineProject, listDesigns, pendingOfflineCount, persistOfflineProject, roomHasOfflineChanges, syncOfflineAccount } from './offlineService';
import { appActivityReason } from './appActivity';
import { listOfflineModels, uploadOfflineModel, type OfflineAssetRecord } from './offlineAssets';
import { addLevel } from './projectOperations';
import { patchProject, snapshotFixture } from './projectTestFixture';
import type { ProjectSnapshot } from './liveProject';
import { syncOfflineAccount as syncQueue } from './offline/sync';

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
    const room = { ...createBlankProject(), name: 'Mi diseño local' };
    await importOfflineProject(id, { project: room, assets: [], sketches: [] });
    assert.equal((await readOfflineProject(id))?.draft?.name, room.name);
    assert.equal((await exportOfflineProject(id)).project.name, room.name);
    assert.equal((await listDesigns())[0].id, id);
    await assert.rejects(accountRequest('/api/auth/session'));
    await syncOfflineAccount();
    assert.equal(requests, 0); assert.equal(await pendingOfflineCount(), 1);
  } finally { globalThis.fetch = fetch; await setOfflineMode(false); }
});

test('atomic import rolls back assets, room and sketch when its final write fails', async () => {
  await reset(); await force(); const { id } = await createDesignLocal();
  const levels = await listOfflineKeys('levels');
  const assetId = crypto.randomUUID(), blob = glb();
  const room = patchProject(createBlankProject(), { name: 'Imported', furniture: [{ id: 'piece', type: 'custom' as const, assetId, name: 'Tabla', material: null, color: null, width: 1, height: 1, depth: 1, x: 0, z: 0, rotation: 0 }] });
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    if (this.name === 'projects') throw new DOMException('Full', 'QuotaExceededError');
    return put.apply(this, args);
  };
  try { await assert.rejects(importOfflineProject(id, { project: room, assets: [{ id: assetId, name: 'Tabla', blob }], sketches: [] }), /espacio/); }
  finally { IDBObjectStore.prototype.put = put; }
  assert.equal((await listOffline('assets')).length, 0);
  assert.notEqual((await readOfflineProject(id))?.draft?.name, 'Imported');
  assert.equal((await listOffline('blobs')).length, 0);
  assert.deepEqual(await listOfflineKeys('levels'), levels, 'failed import cannot leave new levels or remove the original ones');
  await setOfflineMode(false);
});

test('package export, failed import and nested copy block updates only for their lifetime', async () => {
  await reset(); await force();
  try {
    const { id } = await createDesignLocal();
    const exporting = exportOfflineProject(id, true);
    assert.ok(appActivityReason()); await exporting; assert.equal(appActivityReason(), '');
    const bad = importOfflineProject(id, { project: createBlankProject(), assets: [], sketches: [{ levelId: 'missing', blob: new Blob(['bad'], { type: 'image/png' }) }] });
    assert.ok(appActivityReason()); await assert.rejects(bad); assert.equal(appActivityReason(), '');
    const copying = copyDesign(id); assert.ok(appActivityReason()); await copying; assert.equal(appActivityReason(), '');
  } finally { await setOfflineMode(false); }
});

test('a failed independent copy removes only its own normalized levels and binary records', async () => {
  await reset(); await force(); const { id } = await createDesignLocal(), model = await uploadOfflineModel(new File([glb()], 'Table.glb'), id);
  const original = (await readOfflineProject(id))!;
  original.draft = patchProject(original.draft!, { furniture: [{ id: 'piece', type: 'custom', assetId: model.id, name: 'Table', material: null, color: null, width: 1, height: 1, depth: 1, x: 0, z: 0, rotation: 0 }] }); await persistOfflineProject(original);
  await writeOffline('meta', 'another-account-setting', { accountId: 'another-account', untouched: true });
  const stores = ['projects', 'levels', 'assets', 'blobs'] as const, keys = await Promise.all(stores.map(store => listOfflineKeys(store)));
  const put = IDBObjectStore.prototype.put; let projectWrites = 0;
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof put>) {
    if (this.name === 'projects' && ++projectWrites === 2) throw new DOMException('Full', 'QuotaExceededError');
    return put.apply(this, args);
  };
  try { await assert.rejects(copyDesign(id), /espacio/); }
  finally { IDBObjectStore.prototype.put = put; }
  for (let index = 0; index < stores.length; index++) assert.deepEqual(await listOfflineKeys(stores[index]), keys[index], stores[index]);
  assert.deepEqual((await readOfflineProject(id))?.draft, original.draft); assert.equal((await listOffline<OfflineAssetRecord>('assets'))[0].blob.size, model.size);
  assert.deepEqual(await readOffline('meta', 'another-account-setting'), { accountId: 'another-account', untouched: true });
  await setOfflineMode(false);
});

test('uploaded GLB files without a browser MIME type export and copy with canonical binary metadata', async () => {
  await reset(); await force(); const { id } = await createDesignLocal(), model = await uploadOfflineModel(new File([glb()], 'Table.glb'), id), source = (await readOfflineProject(id))!;
  source.draft = patchProject(source.draft!, { furniture: [{ id: 'piece', type: 'custom', assetId: model.id, name: 'Table', material: null, color: null, width: 1, height: 1, depth: 1, x: 0, z: 0, rotation: 0 }] }); await persistOfflineProject(source);
  const backup = await exportOfflineProject(id); assert.equal(backup.assets[0].blob.type, 'model/gltf-binary');
  const copy = await copyDesign(id), result = (await readOfflineProject(copy.id))!, models = await listOffline<OfflineAssetRecord>('assets');
  assert.equal(result.draft!.levels[0].furniture.length, 1); assert.notEqual(result.draft!.levels[0].furniture[0].assetId, model.id); assert.equal(models.length, 2);
  assert.deepEqual(await models.find(value => value.roomId === id)!.blob.arrayBuffer(), await models.find(value => value.roomId === copy.id)!.blob.arrayBuffer());
  assert.deepEqual((await readOfflineProject(id))!.draft, source.draft); await setOfflineMode(false);
});

test('an account switch during copy export cannot create or import private content into the other account', async () => {
  await reset(); const { id } = await createDesignLocal(), source = (await readOfflineProject(id))!;
  source.localOnly = false; source.draft = null; source.snapshot.revision = 1; await persistOfflineProject(source);
  const fetch = globalThis.fetch, other = { ...user, id: '42f01306-b06a-49b3-9301-7b5576da3a41', username: 'another_user' }; let switched = false;
  globalThis.fetch = async () => { if (!switched) { switched = true; await writeOffline('meta', 'identity', other); } return json(source.snapshot); };
  try {
    await assert.rejects(copyDesign(id), /cuenta activa cambió/);
    const projects = await listOffline<OfflineProjectRecord>('projects'); assert.equal(projects.length, 1); assert.equal(projects[0].accountId, user.id);
    assert.deepEqual((await readOffline('meta', 'identity') as typeof user).id, other.id);
  } finally { globalThis.fetch = fetch; await writeOffline('meta', 'identity', user); }
});

test('invalid GLB or sketch never partially changes an existing design', async () => {
  await reset(); const { id } = await createDesignLocal();
  const room = { ...createBlankProject(), name: 'Broken' };
  await assert.rejects(importOfflineProject(id, { project: room, assets: [], sketches: [{ levelId: room.activeLevelId, blob: new Blob(['not PNG'], { type: 'image/png' }) }] }));
  assert.notEqual((await readOfflineProject(id))?.draft?.name, room.name);
});

test('sketch blobs are versioned separately, replaced and removed without reviving stale bytes', async () => {
  await reset(); const { id } = await createDesignLocal();
  const record = (await readOfflineProject(id))!;
  const levelId = record.snapshot.project.activeLevelId;
  record.localOnly = false; record.snapshot.revision = 1; record.snapshot.sketches[levelId] = { hasSketch: true, version: 1, mutationId: null };
  record.sketchBlobs = { [levelId]: { blob: new Blob(['old']), version: 1 } };
  await persistOfflineProject(record);
  assert.equal((await readOffline<OfflineProjectRecord>('projects', user.id + ':' + id))?.sketchBlobs, undefined);
  assert.equal(await (await readOfflineProject(id))!.sketchBlobs?.[levelId].blob.text(), 'old');
  record.snapshot.sketches[levelId].version = 2; record.sketchBlobs = {};
  await persistOfflineProject(record); assert.equal((await readOfflineProject(id))?.sketchBlobs?.[levelId], undefined);
  record.snapshot.sketches[levelId].hasSketch = false; await persistOfflineProject(record); assert.deepEqual(await listOffline('blobs'), []);
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
      const { id, project } = JSON.parse(String(options?.body));
      assert.equal(new Headers(options?.headers).get('X-Account-Id'), user.id);
      assert.equal(new Headers(options?.headers).get('X-Offline-Write'), '1');
      const snapshot: ProjectSnapshot = snapshotFixture(id, user.id, project);
      remote.set(id, snapshot); return json(snapshot, 201);
    }
    if (path.startsWith('/api/models?room=') && method === 'POST') {
      const id = new Headers(options?.headers).get('X-Model-Id'); assert.equal(id, asset.id);
      return json({ model: asset }, 201);
    }
    const id = path.split('/')[3], snapshot = remote.get(id)!;
    if (method === 'PUT') { const body = JSON.parse(String(options?.body)); assert.equal(body.revision, snapshot.revision); snapshot.project = body.project; snapshot.revision++; return json(snapshot); }
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

test('the facade and synchronization module share one durable synchronization queue', async () => {
  await reset(); const { id } = await createDesignLocal(), record = (await readOfflineProject(id))!;
  const fetch = globalThis.fetch; let sessions = 0, creations = 0, remote: ProjectSnapshot | null = null, release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async (input, options) => {
    if (String(input) === '/api/auth/session') { sessions++; await ready; return json({ user }); }
    if (String(input) === '/api/rooms' && options?.method === 'POST') { creations++; remote = snapshotFixture(id, user.id, record.snapshot.project); return json(remote, 201); }
    if (options?.method === 'PUT') { remote = { ...remote!, project: JSON.parse(String(options.body)).project, revision: remote!.revision + 1 }; return json(remote); }
    return json(remote);
  };
  try {
    const first = syncOfflineAccount(), second = syncQueue(); release(); await Promise.all([first, second]);
    assert.equal(sessions, 2, 'one queue verifies the account, then creation independently verifies it again'); assert.equal(creations, 1); assert.equal(await pendingOfflineCount(), 0, JSON.stringify(await readOfflineProject(id)));
  } finally { release(); globalThis.fetch = fetch; }
});

test('synchronization preserves a rejected draft and its actionable error after module separation', async () => {
  await reset(); const { id } = await createDesignLocal(), record = (await readOfflineProject(id))!;
  record.localOnly = false; record.snapshot.revision = 1; record.draft = { ...record.snapshot.project, name: 'Unsent draft' }; await persistOfflineProject(record);
  const fetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => String(input) === '/api/auth/session' ? json({ user }) : options?.method === 'PUT' ? json({ error: 'Conflicto de prueba' }, 409) : json(record.snapshot);
  try {
    await syncOfflineAccount(); const saved = (await readOfflineProject(id))!;
    assert.equal(saved.draft?.name, 'Unsent draft'); assert.match(saved.error!, /Conflicto de prueba/); assert.equal(await pendingOfflineCount(), 1);
  } finally { globalThis.fetch = fetch; }
});

test('deferred deletes include both revisions and stay hidden until their confirmation', async () => {
  await reset(); const { id } = await createDesignLocal();
  const record = (await readOfflineProject(id))!; record.localOnly = false; record.draft = null; record.snapshot.revision = 4; record.snapshot.sketches[record.snapshot.project.activeLevelId].version = 2; await persistOfflineProject(record);
  await force(); await deleteDesign(id); assert.deepEqual(await listDesigns(), []);
  const fetch = globalThis.fetch; let deleted = false;
  globalThis.fetch = async (input, options) => {
    if (String(input) === '/api/auth/session') return json({ user });
    assert.equal(options?.method, 'DELETE'); assert.deepEqual(JSON.parse(String(options.body)), { revision: 4, sketches: record.snapshot.sketches }); deleted = true; return json({ deleted: true });
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
    assert.equal((await exportOfflineProject(id)).project.version, 3);
    globalThis.fetch = async () => { throw new TypeError('Offline'); };
    assert.equal((await exportOfflineProject(id)).project.version, 3);
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
  assert.equal(record.snapshot.project.levels[0].furniture.length, 0);
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


test('twelve-level edits write only their changed level and never fetch sketch/model bytes while saving metadata', async () => {
  await reset(); await force(); let project = createBlankProject();
  while (project.levels.length < 12) project = addLevel(project, { copy: true });
  const { id } = await createDesignLocal(project), record = (await readOfflineProject(id))!;
  record.localOnly = false; record.snapshot.revision = 1;
  record.sketchBlobs = Object.fromEntries(project.levels.map(level => [level.id, { blob: new Blob(['image']), version: 1 }]));
  for (const level of project.levels) record.snapshot.sketches[level.id] = { hasSketch: true, version: 1, mutationId: null };
  await persistOfflineProject(record);
  const originalGet = IDBObjectStore.prototype.get, originalAll = IDBObjectStore.prototype.getAll, originalPut = IDBObjectStore.prototype.put;
  let levelWrites = 0;
  IDBObjectStore.prototype.get = function (...args: Parameters<typeof originalGet>) { if (this.name === 'blobs') throw new Error('Binary read during metadata save'); return originalGet.apply(this, args); };
  IDBObjectStore.prototype.getAll = function (...args: Parameters<typeof originalAll>) { if (this.name === 'blobs') throw new Error('Binary scan during metadata save'); return originalAll.apply(this, args); };
  IDBObjectStore.prototype.put = function (...args: Parameters<typeof originalPut>) { if (this.name === 'levels') levelWrites++; return originalPut.apply(this, args); };
  try {
    record.draft = { ...record.draft!, name: 'Updated title' }; await persistOfflineProject(record); assert.equal(levelWrites, 0);
    record.draft = { ...record.draft, levels: record.draft.levels.map((level, index) => index === 5 ? { ...level, name: 'Changed one level' } : level) };
    await persistOfflineProject(record); assert.equal(levelWrites, 1);
  } finally { IDBObjectStore.prototype.get = originalGet; IDBObjectStore.prototype.getAll = originalAll; IDBObjectStore.prototype.put = originalPut; await setOfflineMode(false); }
  const restored = (await readOfflineProject(id))!;
  assert.equal(restored.draft!.levels.length, 12); assert.equal(Object.keys(restored.sketchBlobs ?? {}).length, 12); assert.equal(restored.draft!.levels[5].name, 'Changed one level');
});

test('collaboration recoveries count as pending and cannot be lost through logout or sharing', async () => {
  await reset(); const id = crypto.randomUUID(), project = { ...createBlankProject(), id };
  await atomicOffline(user.id, [{ store: 'meta', key: 'recovery:' + user.id + ':' + id, value: { accountId: user.id, roomId: id, project } }]);
  assert.equal(await pendingOfflineCount(), 1); assert.equal(await roomHasOfflineChanges(id), true);
  await assert.rejects(clearOfflineAccount(user.id), /pendientes/);
  await assert.rejects(assertRoomReadyToShare(id), /sincronicen/);
  await writeOffline('meta', 'another-account-recovery', { accountId: 'other-account', roomId: 'other-room', project });
  await clearOfflineAccount(user.id, { discard: true });
  assert.equal(await readOffline('meta', 'recovery:' + user.id + ':' + id), undefined);
  assert.ok(await readOffline('meta', 'another-account-recovery'));
});

test('a stale deferred deletion is cancelled visibly rather than hiding the design forever', async () => {
  await reset(); await force(); const { id } = await createDesignLocal(), record = (await readOfflineProject(id))!;
  record.localOnly = false; record.draft = null; record.snapshot.revision = 1; await persistOfflineProject(record); await deleteDesign(id);
  const fetch = globalThis.fetch; globalThis.fetch = async input => {
    if (String(input) === '/api/auth/session') return json({ user });
    if (String(input) === '/api/rooms') return json({ rooms: [{ id, name: record.snapshot.project.name, updatedAt: new Date().toISOString(), role: 'owner', offlineAllowed: true }] });
    return json({ error: 'Changed revision' }, 409);
  };
  try { await setOfflineMode(false); await assert.rejects(syncOfflineAccount(), /canceló/); const restored = (await readOfflineProject(id))!; assert.equal(restored.deleted, false); assert.match(restored.error!, /canceló/); assert.equal((await listDesigns())[0].id, id); }
  finally { globalThis.fetch = fetch; }
});

test('logout refuses while another live editor holds this account, without blocking other accounts', async () => {
  await reset();
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'locks'); let name = '3d-space-live:' + user.id + ':live-project', pending = false;
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { query: async () => ({ held: pending ? [] : [{ name, mode: 'shared' }], pending: pending ? [{ name, mode: 'shared' }] : [] }) } });
  try {
    assert.equal(await pendingOfflineCount(), 0);
    await assert.rejects(clearOfflineAccount(user.id), /otras pestañas/);
    pending = true; await assert.rejects(clearOfflineAccount(user.id), /otras pestañas/);
    assert.equal((await readOffline<{ id: string }>('meta', 'identity'))?.id, user.id);
    name = '3d-space-live:other-account:live-project';
    await clearOfflineAccount(user.id);
    assert.equal(await readOffline('meta', 'identity'), undefined);
  } finally { if (descriptor) Object.defineProperty(navigator, 'locks', descriptor); else Reflect.deleteProperty(navigator, 'locks'); }
});
