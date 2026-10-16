import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountRequestError } from './accountApi';
import { createDefaultProject } from './projectDocument';
import { snapshotFixture, patchProject } from './projectTestFixture';
import { loadModelBlob, type OfflineAssetRecord } from './offlineAssets';
import { offlineModelMetadata } from './offlineModelValidation';
import { clearOffline, getOfflineAccess, readOffline, setOfflineAccess, writeOffline } from './offlineStorage';
import { exportOfflineProject, persistOfflineProject } from './offlineService';
import { SoloProject, type OfflineProjectRecord, type SoloStatus } from './offlineProject';
import type { ProjectSnapshot } from './liveProject';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const roomId = '33333333-3333-4333-8333-333333333333';
const modelId = '44444444-4444-4444-8444-444444444444';
function modelBlob() {
  const document = { asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }] };
  const text = new TextEncoder().encode(JSON.stringify(document)), size = Math.ceil(text.length / 4) * 4;
  const bytes = new Uint8Array(28 + size + 36), view = new DataView(bytes.buffer);
  [0x46546c67, 2, bytes.length, size, 0x4e4f534a].forEach((value, i) => view.setUint32(i * 4, value, true));
  bytes.fill(32, 20, 20 + size); bytes.set(text, 20);
  view.setUint32(20 + size, 36, true); view.setUint32(24 + size, 0x004e4942, true);
  [0, 0, 0, 1, 0, 0, 0, 1, 1].forEach((value, i) => view.setFloat32(28 + size + i * 4, value, true));
  return new Blob([bytes], { type: 'model/gltf-binary' });
}
async function cachedModel() {
  await clearOffline(); await writeOffline('meta', 'identity', { id: owner, username: 'test_owner', verifiedAt: Date.now() });
  setOfflineAccess(roomId, { accountId: owner, allowed: true });
  const blob = modelBlob(), asset = await offlineModelMetadata(blob, modelId, roomId, 'Tabla');
  const record: OfflineAssetRecord = { accountId: owner, roomId, blob, asset, pending: false };
  await writeOffline('assets', `${owner}:${roomId}:${modelId}`, record); return record;
}
const storedModel = () => readOffline<OfflineAssetRecord>('assets', `${owner}:${roomId}:${modelId}`);

test('session expiry retains the owner model for local use without granting a different account access', async () => {
  const model = await cachedModel(), fetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('Session expired', { status: 401 });
    assert.deepEqual(await (await loadModelBlob(modelId, roomId)).arrayBuffer(), await model.blob.arrayBuffer());
    assert.deepEqual(await (await storedModel())!.blob.arrayBuffer(), await model.blob.arrayBuffer());
    await writeOffline('meta', 'identity', { id: other, username: 'other_owner', verifiedAt: Date.now() });
    setOfflineAccess(roomId, { accountId: other, allowed: true });
    await assert.rejects(loadModelBlob(modelId, roomId));
    assert.deepEqual(await (await storedModel())!.blob.arrayBuffer(), await model.blob.arrayBuffer());
  } finally { globalThis.fetch = fetch; }
});

test('authoritative model denials revoke automatic access while retaining complete recovery bytes', async () => {
  const fetch = globalThis.fetch;
  try {
    for (const status of [403, 404]) {
      const model = await cachedModel();
      globalThis.fetch = async () => new Response('Denied', { status });
      await assert.rejects(loadModelBlob(modelId, roomId));
      assert.notEqual(getOfflineAccess(roomId)?.allowed, true);
      assert.deepEqual(await (await storedModel())!.blob.arrayBuffer(), await model.blob.arrayBuffer());
      globalThis.fetch = async () => { throw new TypeError('Offline'); };
      await assert.rejects(loadModelBlob(modelId, roomId), /disponible/);
    }
  } finally { globalThis.fetch = fetch; }
});

test('a denied design can still export its pending design and retained GLB as a complete recovery copy', async () => {
  const model = await cachedModel(), fetch = globalThis.fetch;
  const snapshot: ProjectSnapshot = snapshotFixture(roomId, owner);
  const draft = patchProject(snapshot.project, { name: 'Conservar borrador', furniture: [{ id: 'custom', type: 'custom' as const, name: 'Tabla', material: null, color: null, assetId: modelId, width: 1, depth: 1, height: 1, x: 0, z: 0, rotation: 0 }] });
  await persistOfflineProject({ id: roomId, accountId: owner, snapshot, draft, authorized: false, updatedAt: Date.now() });
  setOfflineAccess(roomId, null);
  try {
    globalThis.fetch = async () => { throw new Error('Recovery of complete local drafts must not need network access.'); };
    const backup = await exportOfflineProject(roomId);
    assert.equal(backup.project.name, draft.name); assert.equal(backup.assets.length, 1); assert.equal(backup.assets[0].id, modelId);
    assert.deepEqual(await backup.assets[0].blob.arrayBuffer(), await model.blob.arrayBuffer());
  } finally { globalThis.fetch = fetch; }
});

function projectHarness(localOnly = false) {
  let server: ProjectSnapshot = { ...snapshotFixture(roomId, owner), revision: localOnly ? 0 : 1 };
  const state = { status: 'saved' as SoloStatus, writes: [] as OfflineProjectRecord[], puts: 0, creates: 0, loseCreation: false };
  const record: OfflineProjectRecord = { id: roomId, accountId: owner, snapshot: structuredClone(server), draft: localOnly ? { ...server.project, name: 'Mi borrador' } : null, localOnly: localOnly || undefined, authorized: true, updatedAt: Date.now() };
  const project = new SoloProject(record, {
    persist: async value => { state.writes.push(structuredClone(value)); },
    get: async () => structuredClone(server),
    create: async () => {
      state.creates++;
      if (state.creates === 1) { const { levels, ...metadata } = server.project; server = { ...server, revision: 1, project: { ...metadata, levels } }; }
      if (state.loseCreation) { state.loseCreation = false; throw new AccountRequestError('Acknowledgement lost'); }
      return structuredClone(server);
    },
    assets: async room => room,
    put: async room => { state.puts++; server = { ...server, project: room, revision: server.revision + 1 }; return structuredClone(server); },
    sketch: async () => { throw new Error('Unexpected sketch upload'); },
    changed: (_record, status) => { state.status = status; },
    collaborative: () => { throw new Error('Unexpected collaboration'); },
  });
  return { project, state, get server() { return server; }, set server(value) { server = value; } };
}

test('lost creation acknowledgements never adopt remote advances as permission to overwrite them', async () => {
  for (const remoteChange of ['room', 'sketch']) {
    const f = projectHarness(true);
    try {
      await f.project.initialize(true); f.state.loseCreation = true; await f.project.retry();
      assert.equal(f.state.status, 'offline'); assert.equal(f.project.record.localOnly, true);
      if (remoteChange === 'room') f.server = { ...f.server, revision: 2, project: { ...f.server.project, name: 'Otra persona' } };
      else f.server = { ...f.server, sketches: { [f.server.project.activeLevelId]: { version: 1, hasSketch: true, mutationId: crypto.randomUUID() } } };
      await f.project.retry();
      assert.equal(f.state.status, 'conflict', remoteChange); assert.equal(f.state.puts, 0, remoteChange);
      assert.equal(f.project.record.draft!.name, 'Mi borrador');
      assert.equal(f.project.record.localOnly, true);
    } finally { f.project.destroy(); }
  }
});

test('idle reconnect checks do not repeatedly rewrite an unchanged local design', async () => {
  const f = projectHarness();
  try {
    await f.project.initialize(true); const writes = f.state.writes.length;
    for (let i = 0; i < 4; i++) await f.project.retry();
    assert.equal(f.state.status, 'saved'); assert.equal(f.state.writes.length, writes); assert.equal(f.state.puts, 0);
  } finally { f.project.destroy(); }
});

test('new remote sketch versions invalidate old bytes and late image responses cannot restore them', async () => {
  const f = projectHarness();
  const levelId = f.server.project.activeLevelId; f.project.record.snapshot.sketches[levelId] = { hasSketch: true, version: 1, mutationId: null };
  f.project.record.sketchBlobs = { [levelId]: { blob: new Blob(['old']), version: 1 } };
  f.server = structuredClone(f.project.record.snapshot);
  try {
    await f.project.initialize(true);
    f.server = { ...f.server, sketches: { [levelId]: { hasSketch: true, version: 2, mutationId: crypto.randomUUID() } } }; await f.project.retry();
    assert.equal(f.project.record.sketchBlobs?.[levelId], undefined);
    const writes = f.state.writes.length;
    await f.project.cacheSketch(new Blob(['late old response']), 1, levelId);
    assert.equal(f.project.record.sketchBlobs?.[levelId], undefined); assert.equal(f.state.writes.length, writes);
    await f.project.cacheSketch(new Blob(['current']), 2, levelId);
    assert.equal(await (f.project.record as OfflineProjectRecord).sketchBlobs?.[levelId]?.blob.text(), 'current');
    f.server = { ...f.server, sketches: { [levelId]: { hasSketch: false, version: 3, mutationId: null } } }; await f.project.retry();
    assert.equal(f.project.record.sketchBlobs?.[levelId], undefined);
  } finally { f.project.destroy(); }
});
