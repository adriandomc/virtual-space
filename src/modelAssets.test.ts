import { initializeTestDatabase, insertTestUser, insertTestSession, insertTestRoom } from './serverTestFixtures';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createModelAssets, MODEL_ACCOUNT_BYTES, MODEL_MAX_BYTES, validateGlb } from './modelAssets';
import { createDefaultRoom } from './model';
import * as THREE from 'three/webgpu';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

export function glbFixture(change: (document: Record<string, any>, binary: Buffer) => void = () => {}) {
  const binary = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 1].forEach((value, index) => binary.writeFloatLE(value, index * 4));
  const document = { asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ name: 'Frente', mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
  change(document, binary);
  return makeGlb(document, binary);
}
function makeGlb(document: unknown, binary: Buffer) {
  const raw = Buffer.from(JSON.stringify(document)), json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(json);
  const bin = Buffer.alloc(Math.ceil(binary.length / 4) * 4); binary.copy(bin);
  const result = Buffer.alloc(28 + json.length + bin.length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(json.length, 12); result.writeUInt32LE(0x4e4f534a, 16); json.copy(result, 20);
  result.writeUInt32LE(bin.length, 20 + json.length); result.writeUInt32LE(0x004e4942, 24 + json.length); bin.copy(result, 28 + json.length);
  return result;
}

test('self-contained GLB validation returns physical bounds and stable node keys', () => {
  assert.deepEqual(validateGlb(glbFixture()), { width: 1, height: 1, depth: 1, triangles: 1, texturePixels: 0, nodes: [{ key: '0', name: 'Frente', mesh: true }] });
  const result = validateGlb(glbFixture(document => { document.nodes[0].translation = [2, 3, 4]; document.nodes[0].scale = [2, 3, 4]; }));
  assert.deepEqual([result.width, result.height, result.depth], [2, 3, 4]);
});

test('server metadata marks generated node names without interpreting authored names', () => {
  for (const name of [undefined, '', '   ']) {
    const result = validateGlb(glbFixture(document => { document.nodes[0].name = name; }));
    assert.deepEqual(result.nodes, [{ key: '0', name: 'Parte 1', mesh: true, generatedName: true }]);
  }
  for (const name of ['Parte 1', 'Tabla', 'My shelf [1]: left']) {
    const result = validateGlb(glbFixture(document => { document.nodes[0].name = name; document.nodes[0].generatedName = true; document.nodes[0].extras = { generatedName: true }; }));
    assert.deepEqual(result.nodes, [{ key: '0', name, mesh: true }]);
  }
  const hierarchy = validateGlb(glbFixture(document => { document.nodes = [{ mesh: 0 }, { children: [0] }]; document.scenes[0].nodes = [1]; }));
  assert.deepEqual(hierarchy.nodes, [{ key: '1', name: 'Parte 2', mesh: false, generatedName: true }, { key: '0', name: 'Parte 1', mesh: true, generatedName: true }]);
});

test('models cannot fetch external resources, data URLs, compressed decoders, or animations', () => {
  for (const uri of ['https://example.com/private.png', 'data:image/png;base64,aGVsbG8=', 'file:///etc/passwd', 'javascript:alert(1)', '/api/auth/logout', 'blob:unknown']) assert.throws(() => validateGlb(glbFixture(document => { document.buffers[0].uri = uri; })), /sin enlaces externos/);
  assert.throws(() => validateGlb(glbFixture(document => { document.meshes[0].primitives[0].extensions = { KHR_draco_mesh_compression: { bufferView: 0 } }; })), /sin compresión/);
  assert.throws(() => validateGlb(glbFixture(document => { document.animations = [{ channels: [] }]; })), /sin compresión ni animaciones/);
  assert.throws(() => validateGlb(glbFixture(document => { document.extensionsUsed = ['KHR_materials_clearcoat']; })), /sin compresión/);
});

test('GLB rejects truncated chunks, non-finite geometry, invalid ranges and recursive transforms', () => {
  const valid = glbFixture();
  for (const bytes of [valid.subarray(0, 15), valid.subarray(0, valid.length - 1), Buffer.concat([valid, Buffer.alloc(4)])]) assert.throws(() => validateGlb(bytes));
  const corrupt = Buffer.from(valid); corrupt.writeUInt32LE(0xffffffff, 12); assert.throws(() => validateGlb(corrupt));
  assert.throws(() => validateGlb(glbFixture((_, binary) => binary.writeFloatLE(NaN, 4))));
  assert.throws(() => validateGlb(glbFixture(document => { document.accessors[0].count = 4; })));
  assert.throws(() => validateGlb(glbFixture(document => { document.accessors[0].byteOffset = 1; })));
  assert.throws(() => validateGlb(glbFixture(document => { document.nodes[0].children = [0]; })), /jerarquía/);
  assert.throws(() => validateGlb(glbFixture(document => { document.nodes[0].rotation = [0, 0, 0, 2]; })));
  assert.throws(() => validateGlb(glbFixture(document => { document.nodes.push({ mesh: 0, children: [0] }); document.nodes[0].children = [1]; })), /jerarquía/);
  assert.throws(() => validateGlb(Buffer.alloc(MODEL_MAX_BYTES + 1)), /20 MB/);
});

test('embedded texture dimensions and total rendered triangle instances are bounded', () => {
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X9S8AAAAASUVORK5CYII=', 'base64');
  const base = glbFixture();
  const jsonLength = base.readUInt32LE(12), document = JSON.parse(base.toString('utf8', 20, 20 + jsonLength));
  const binary = Buffer.concat([base.subarray(28 + jsonLength), image]);
  document.buffers[0].byteLength = binary.length;
  document.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: image.length });
  document.images = [{ mimeType: 'image/png', bufferView: 1 }]; document.textures = [{ source: 0 }];
  assert.equal(validateGlb(makeGlb(document, binary)).triangles, 1);
  const oversized = Buffer.from(binary); oversized.writeUInt32BE(32768, 36 + 16);
  assert.throws(() => validateGlb(makeGlb(document, oversized)), /4096/);
  const pixels = Buffer.from(binary); pixels.writeUInt32BE(4096, 36 + 16); pixels.writeUInt32BE(4096, 36 + 20);
  document.textures.push({ source: 0 }); assert.throws(() => validateGlb(makeGlb(document, pixels)), /memoria/);
  const geometry = Buffer.alloc(600000 * 12);
  const big = { asset: { version: '2.0' }, buffers: [{ byteLength: geometry.length }], bufferViews: [{ buffer: 0, byteLength: geometry.length }], accessors: [{ bufferView: 0, componentType: 5126, count: 600000, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }, { mesh: 0 }], scenes: [{ nodes: [0, 1] }] };
  assert.throws(() => validateGlb(makeGlb(big, geometry)), /200 000/);
});

function storageFixture() {
  const database = new DatabaseSync(':memory:');
  initializeTestDatabase(database);
  const owner = randomUUID(), editor = randomUUID(), outsider = randomUUID(), roomId = randomUUID(), anotherRoom = randomUUID();
  for (const id of [owner, editor, outsider]) insertTestUser(database, id);
  const room = createDefaultRoom();
  insertTestRoom(database, roomId, owner, { room: JSON.stringify(room) });
  insertTestRoom(database, anotherRoom, owner, { room: JSON.stringify(room) });
  const service = createModelAssets(database, {
    now: () => 1800000000000,
    canViewRoom: (id, user) => id === roomId && (user === owner || user === editor || database.prepare('SELECT shared FROM rooms WHERE id=?').get(id)?.shared === 1),
    canEditRoom: (id, user) => id === roomId && (user === owner || user === editor),
  });
  return { database, owner, editor, outsider, roomId, anotherRoom, room, service };
}

test('offline model upload retries preserve the stable id and reject collisions', () => {
  const { database, owner, roomId, anotherRoom, service } = storageFixture();
  try {
    const id = randomUUID(), data = glbFixture();
    const first = service.upload(owner, data, 'Mesa.glb', roomId, id);
    assert.equal(first.id, id);
    assert.deepEqual(service.upload(owner, data, 'Mesa.glb', roomId, id), first);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM model_assets').get()!.count, 1);
    assert.throws(() => service.upload(owner, data, 'Otra.glb', roomId, id), /ya está en uso/);
    assert.throws(() => service.upload(owner, glbFixture((_, binary) => binary.writeFloatLE(2, 12)), 'Mesa.glb', roomId, id), /ya está en uso/);
    assert.throws(() => service.upload(owner, data, 'Mesa.glb', anotherRoom, id), /ya está en uso/);
    assert.throws(() => service.upload(owner, data, 'Mesa.glb', roomId, 'invalid-id'), /identidad/);
  } finally { database.close(); }
});

test('room-owned model assets allow editors, hide unused models from public links and forbid other-room references', () => {
  const { database, owner, editor, outsider, roomId, anotherRoom, room, service } = storageFixture();
  try {
    const data = glbFixture(), asset = service.upload(owner, data, 'Mueble.glb', roomId);
    assert.equal(asset.name, 'Mueble'); assert.equal(asset.size, data.length);
    assert.deepEqual(service.read(asset.id, editor, roomId), data);
    assert.throws(() => service.read(asset.id, outsider, roomId), /no existe/);
    database.prepare('UPDATE rooms SET shared=1 WHERE id=?').run(roomId);
    assert.throws(() => service.read(asset.id, null, roomId), /no existe/);
    assert.throws(() => service.read(asset.id, outsider, roomId), /no existe/);
    const custom = { id: 'custom-1', type: 'custom' as const, material: null, color: null, name: 'Modelo', assetId: asset.id, width: 1, depth: 1, height: 1, x: 0, z: 0, rotation: 0 };
    const changed = { ...room, furniture: [custom] };
    service.validateRoomReferences(changed, editor, roomId);
    assert.throws(() => service.validateRoomReferences(changed, owner, anotherRoom), /no está disponible/);
    database.prepare('UPDATE rooms SET room=? WHERE id=?').run(JSON.stringify(changed), roomId);
    assert.deepEqual(service.read(asset.id, null, roomId), data);
    assert.throws(() => service.remove(asset.id, owner), /Retíralo/);
    assert.throws(() => service.validateRoomReferences({ ...changed, furniture: [{ ...custom, parts: { '999': { color: '#ffffff' } } }] }, editor, roomId), /parte no válida/);
    database.prepare('DELETE FROM users WHERE id=?').run(editor);
    assert.deepEqual(service.read(asset.id, owner), data, 'deleting the uploader does not delete the room owner’s model');
    database.prepare('DELETE FROM rooms WHERE id=?').run(roomId);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM model_assets').get()!.count, 0);
  } finally { database.close(); }
});

test('model quota and owner-only deletion are enforced in the same persistent database', () => {
  const { database, owner, editor, roomId, service } = storageFixture();
  try {
    const asset = service.upload(owner, glbFixture(), 'Modelo', roomId);
    assert.throws(() => service.remove(asset.id, editor), /no existe/);
    database.prepare('UPDATE model_assets SET size=? WHERE id=?').run(MODEL_ACCOUNT_BYTES, asset.id);
    assert.throws(() => service.upload(owner, glbFixture(), 'Otro', roomId), /100 MB/);
    assert.equal(service.list(owner, roomId).length, 1);
    service.remove(asset.id, owner);
    assert.equal(service.list(owner, roomId).length, 0);
  } finally { database.close(); }
});

test('personal library is account-scoped and copied models survive source-design deletion', () => {
  const { database, owner, editor, outsider, roomId, anotherRoom, service } = storageFixture();
  try {
    const original = service.upload(owner, glbFixture(), 'Reutilizable', anotherRoom);
    assert.equal(original.roomId, anotherRoom);
    assert.equal(service.list(owner, roomId).length, 0);
    assert.deepEqual(service.list(owner, roomId, true).map(asset => asset.id), [original.id]);
    assert.deepEqual(service.list(editor, roomId, true), [], 'an editor does not get the owner’s global model library');
    assert.throws(() => service.list(outsider, roomId, true), /no existe/);
    const copied = service.upload(owner, service.read(original.id, owner), original.name, roomId);
    assert.notEqual(copied.id, original.id); assert.equal(copied.roomId, roomId);
    database.prepare('DELETE FROM rooms WHERE id=?').run(anotherRoom);
    assert.throws(() => service.read(original.id, owner), /no existe/);
    assert.deepEqual(service.read(copied.id, owner), glbFixture());
    assert.deepEqual(service.list(owner, roomId, true).map(asset => asset.id), [copied.id]);
  } finally { database.close(); }
});

test('room GPU texture budget counts shared instances once and bounds different uploaded textures', () => {
  const { database, owner, roomId, room, service } = storageFixture();
  try {
    const first = service.upload(owner, glbFixture(), 'Primero', roomId), second = service.upload(owner, glbFixture(), 'Segundo', roomId);
    for (const asset of [first, second]) {
      const metadata = JSON.parse(String(database.prepare('SELECT metadata FROM model_assets WHERE id=?').get(asset.id)!.metadata)); metadata.texturePixels = 12 * 1024 * 1024;
      database.prepare('UPDATE model_assets SET metadata=? WHERE id=?').run(JSON.stringify(metadata), asset.id);
    }
    const custom = { id: 'custom-a', type: 'custom' as const, material: null, color: null, name: 'Modelo', assetId: first.id, width: 1, depth: 1, height: 1, x: 0, z: 0, rotation: 0 };
    assert.doesNotThrow(() => service.validateRoomReferences({ ...room, furniture: [custom, { ...custom, id: 'custom-b' }] }, owner, roomId));
    assert.throws(() => service.validateRoomReferences({ ...room, furniture: [custom, { ...custom, id: 'custom-b', assetId: second.id }] }, owner, roomId), /demasiadas texturas/);
  } finally { database.close(); }
});

test('SQLite backup restores every custom model byte and its room ownership and metadata', async () => {
  const { database, owner, roomId, service } = storageFixture();
  const directory = mkdtempSync(join(tmpdir(), '3d-space-model-backup-'));
  try {
    const data = glbFixture(), asset = service.upload(owner, data, 'Restaurable', roomId), file = join(directory, 'backup.sqlite');
    await backup(database, file);
    const restored = new DatabaseSync(file, { readOnly: true });
    try {
      const row = restored.prepare('SELECT * FROM model_assets WHERE id=?').get(asset.id)!;
      assert.deepEqual(Buffer.from(row.data as Uint8Array), data); assert.equal(row.owner_id, owner); assert.equal(row.room_id, roomId);
      assert.deepEqual(JSON.parse(String(row.metadata)).nodes, asset.nodes);
      assert.equal(restored.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
      assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length, 0);
    } finally { restored.close(); }
  } finally { database.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('GLB exported by the built-in editor passes the same upload boundary without special exceptions', async () => {
  const previous = globalThis.FileReader;
  class NodeReader {
    result: ArrayBuffer | null = null;
    onloadend: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.(); }); }
  }
  globalThis.FileReader = NodeReader as unknown as typeof FileReader;
  try {
    const group = new THREE.Group();
    const piece = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.5, 0.6), new THREE.MeshStandardMaterial({ color: '#884422', roughness: 0.7 }));
    piece.position.set(0.5, 0.75, 0); piece.name = 'Cuerpo'; group.add(piece);
    const data = await new GLTFExporter().parseAsync(group, { binary: true });
    assert.ok(data instanceof ArrayBuffer);
    const metadata = validateGlb(Buffer.from(data));
    assert.equal(metadata.triangles, 12); assert.ok(metadata.nodes.some(node => node.name === 'Cuerpo'));
    assert.ok(Math.abs(metadata.height - 1.5) < 0.001);
  } finally { globalThis.FileReader = previous; }
});
