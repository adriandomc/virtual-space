import { TERMS_VERSION } from './legalPolicy';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as THREE from 'three';
import { addCustomFurniture, addFurniture, createDefaultRoom, fitFurniture, fitRoom, resizeRoom, validateRoom } from './model';
import { createDefaultProject, updateProjectRoom } from './projectDocument';
import { createServer } from './server';
import { clearCustomModelCache, loadEditableModel } from './customModel';
import { WORKSHOP_PIECES } from './workshopPieces';

function thinModelData(width = 1.2, height = .024, depth = .6): Buffer {
  const document = { asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [width, height, depth] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ name: 'Tabla', mesh: 0 }], scenes: [{ nodes: [0] }] };
  const raw = Buffer.from(JSON.stringify(document)), json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(json);
  const bytes = Buffer.alloc(28 + json.length + 36);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8); bytes.writeUInt32LE(json.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20); bytes.writeUInt32LE(36, 20 + json.length); bytes.writeUInt32LE(0x004e4942, 24 + json.length);
  [0, 0, 0, width, 0, 0, 0, height, depth].forEach((value, index) => bytes.writeFloatLE(value, 28 + json.length + index * 4));
  return bytes;
}

test('los prefabs delgados mantienen sus dimensiones al colocarse, ajustar y redimensionar el cuarto', () => {
  for (const preset of WORKSHOP_PIECES.filter(piece => piece.category === 'prefabs')) {
    const asset = { ...preset, id: randomUUID(), name: preset.label };
    const room = addCustomFurniture(createDefaultRoom(), asset), item = room.furniture[0];
    const expected = [preset.width, preset.height, preset.depth];
    assert.deepEqual([item.width, item.height, item.depth], expected, preset.label);
    assert.deepEqual(fitFurniture(room, item), item);
    assert.deepEqual(validateRoom(room).furniture[0], item);
    assert.deepEqual(fitRoom({ ...room, height: 1.8 }).furniture[0], item);
    assert.deepEqual(resizeRoom(room, 3, 3).furniture[0], item);
    assert.deepEqual(JSON.parse(JSON.stringify(room)).furniture[0], item);
  }
});

test('sólo los modelos propios admiten tamaños desde 0.01 m y conservan sus máximos', () => {
  const asset = { id: randomUUID(), name: 'Pieza', width: .01, height: .01, depth: .01 };
  const room = addCustomFurniture(createDefaultRoom(), asset), item = room.furniture[0];
  assert.deepEqual([item.width, item.height, item.depth], [.01, .01, .01]);
  for (const field of ['width', 'height', 'depth'] as const) {
    for (const value of [0, .009, NaN, Infinity]) {
      assert.throws(() => addCustomFurniture(createDefaultRoom(), { ...asset, [field]: value }));
      assert.throws(() => validateRoom({ ...room, furniture: [{ ...item, [field]: value }] }));
    }
    const conventional = addFurniture(createDefaultRoom(), 'nightstand');
    assert.throws(() => validateRoom({ ...conventional, furniture: [{ ...conventional.furniture[0], [field]: .01 }] }));
  }
  assert.throws(() => validateRoom({ ...room, furniture: [{ ...item, width: 10.01 }] }));
  assert.throws(() => validateRoom({ ...room, furniture: [{ ...item, depth: 10.01 }] }));
  assert.throws(() => validateRoom({ ...room, furniture: [{ ...item, height: room.height + .01 }] }));
});

test('el modelo renderizado respeta el grosor del archivo sin inflarlo durante la instanciación', async () => {
  const asset = { id: randomUUID(), name: 'Tabla', width: 1.2, height: .024, depth: .6 };
  const item = addCustomFurniture(createDefaultRoom(), asset).furniture[0], originalFetch = globalThis.fetch;
  let instance: THREE.Group | undefined;
  globalThis.fetch = async () => new Response(new Uint8Array(thinModelData()));
  try {
    instance = await loadEditableModel(item);
    const actual = new THREE.Box3().setFromObject(instance).getSize(new THREE.Vector3());
    for (const [size, expected] of [[actual.x, item.width], [actual.y, item.height], [actual.z, item.depth]]) assert.ok(Math.abs(size - expected) < 1e-7);
  } finally {
    instance?.userData.disposeEditorModel(); globalThis.fetch = originalFetch; clearCustomModelCache();
  }
});

test('la API persiste dimensiones delgadas y rechaza cambios inválidos sin alterar lo guardado', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), '3d-space-prefab-dimensions-'));
  const server = createServer({ dataDir, maintenance: false });
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  let cookie = '';
  const request = (path: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers: { Origin: base, 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    const registered = await request('/api/auth/register', 'POST', { username: 'prefab_owner', password: 'Testing-pass-123', confirmPassword: 'Testing-pass-123', termsVersion: TERMS_VERSION });
    assert.equal(registered.status, 201); cookie = registered.headers.get('set-cookie')!.split(';')[0];
    const id = randomUUID(), baseProject = createDefaultProject(undefined, undefined, id), initial = createDefaultRoom(), path = '/api/rooms/' + id;
    assert.equal((await request('/api/rooms', 'POST', { id, project: updateProjectRoom(baseProject, baseProject.activeLevelId, initial) })).status, 201);
    const uploaded = await fetch(base + '/api/models?room=' + id, { method: 'POST', headers: { Origin: base, Cookie: cookie, 'Content-Type': 'model/gltf-binary', 'X-Model-Name': 'Tabla.glb' }, body: new Uint8Array(thinModelData()) });
    assert.equal(uploaded.status, 201);
    const asset = (await uploaded.json()).model;
    let room = addCustomFurniture(initial, asset), revision = 1;
    const saved = await request(path, 'PUT', { project: updateProjectRoom(baseProject, baseProject.activeLevelId, room), revision, operationId: randomUUID() }); assert.equal(saved.status, 200);
    revision = (await saved.json()).revision;
    const exact = { ...room.furniture[0], levelId: baseProject.activeLevelId };
    assert.equal(exact.height, asset.height); assert.ok(exact.height < .025);
    assert.deepEqual((await (await request(path)).json()).project.levels[0].furniture[0], exact);
    room = resizeRoom(room, 3, 3);
    const resized = await request(path, 'PUT', { project: updateProjectRoom(baseProject, baseProject.activeLevelId, room), revision, operationId: randomUUID() }); assert.equal(resized.status, 200); revision = (await resized.json()).revision;
    for (const field of ['width', 'height', 'depth'] as const) for (const value of [0, .009]) {
      const valid = updateProjectRoom(baseProject, baseProject.activeLevelId, room);
      const invalid = { ...valid, levels: valid.levels.map(level => ({ ...level, furniture: level.furniture.map(item => ({ ...item, [field]: value })) })) };
      assert.equal((await request(path, 'PUT', { project: invalid, revision, operationId: randomUUID() })).status, 400);
    }
    assert.equal((await request(path, 'PUT', { project: updateProjectRoom(baseProject, baseProject.activeLevelId, { ...room, furniture: [{ ...exact, assetId: randomUUID() }] }), revision, operationId: randomUUID() })).status, 400, 'la validación de referencias privadas sigue activa');
    const remaining = await (await request(path)).json();
    assert.equal(remaining.revision, revision); assert.deepEqual(remaining.project.levels[0].furniture[0], exact);
  } finally {
    await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
    rmSync(dataDir, { recursive: true, force: true });
  }
});
