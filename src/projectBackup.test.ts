import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultRoom } from './model';
import { parseProjectBackup, serializeProjectBackup, validateProjectBackupResources } from './projectBackup';
import { validateGlb } from './modelAssets';

const FIRST = '00000000-0000-4000-8000-000000000001', SECOND = '00000000-0000-4000-8000-000000000002';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X9S8AAAAASUVORK5CYII=';
function glb() {
  const document = { asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
  const json = JSON.stringify(document), jsonLength = Math.ceil(json.length / 4) * 4, result = Buffer.alloc(28 + jsonLength + 36, 32);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonLength, 12); result.writeUInt32LE(0x4e4f534a, 16); result.write(json, 20);
  result.writeUInt32LE(36, 20 + jsonLength); result.writeUInt32LE(0x004e4942, 24 + jsonLength);
  [0, 0, 0, 1, 0, 0, 0, 1, 1].forEach((value, index) => result.writeFloatLE(value, 28 + jsonLength + index * 4));
  assert.equal(validateGlb(result).triangles, 1);
  return result;
}
function fixture() {
  const room = createDefaultRoom();
  room.furniture = [{ id: 'furniture-1', type: 'custom', assetId: FIRST, name: 'Tabla', parts: {}, color: null, material: null, width: 1, height: 1, depth: 1, x: 0, z: 0, rotation: 0 }];
  return { format: '3d-space-project', version: 2, room, sketch: { type: 'image/png', base64: png } as { type: string; base64: string } | null, assets: [{ asset: { id: FIRST, name: 'Tabla' }, data: { type: 'model/gltf-binary', base64: glb().toString('base64') } }] };
}

test('complete backup decodes its referenced models and sketch without mutating the source', async () => {
  const input = fixture(), original = JSON.stringify(input), result = parseProjectBackup(input)!;
  assert.equal(result.room.furniture[0].assetId, FIRST); assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].name, 'Tabla'); assert.equal(result.assets[0].blob.type, 'model/gltf-binary');
  assert.equal(validateGlb(Buffer.from(await result.assets[0].blob.arrayBuffer())).triangles, 1);
  assert.deepEqual(Buffer.from(await result.sketch!.arrayBuffer()), Buffer.from(png, 'base64'));
  assert.equal(JSON.stringify(input), original);
});

test('old room documents and backup versions are rejected', () => {
  assert.throws(() => parseProjectBackup(createDefaultRoom())); assert.throws(() => parseProjectBackup(null));
  for (const change of [ { version: 1 }, { format: 'other' }, { room: {} }, { assets: {} }, { sketch: undefined } ]) assert.throws(() => parseProjectBackup({ ...fixture(), ...change }), /respaldo no es válido/);
  const input = fixture(); input.assets = Array.from({ length: 101 }, () => input.assets[0]); assert.throws(() => parseProjectBackup(input), /100 modelos/);
});

test('models require distinct UUIDs, safe names, and all identifiers referenced by the room', () => {
  const input = fixture(); input.assets.push(structuredClone(input.assets[0])); assert.throws(() => parseProjectBackup(input), /repetidos/);
  for (const id of ['../../x', 'not-a-uuid', SECOND]) { const input = fixture(); input.assets[0].asset.id = id; assert.throws(() => parseProjectBackup(input), /identificadores|falta un modelo/); }
  for (const name of ['', ' ', 'x'.repeat(81), 'Mesa\u0000', 'Mesa\nPrivada']) { const input = fixture(); input.assets[0].asset.name = name; assert.throws(() => parseProjectBackup(input), /nombre/); }
  const incomplete = fixture(); incomplete.assets = []; assert.throws(() => parseProjectBackup(incomplete), /falta un modelo/);
});

test('all resources are retained for validation and repeated references share one blob', () => {
  const input = fixture(); input.assets.push({ asset: { id: SECOND, name: 'Sobrante' }, data: input.assets[0].data });
  input.room.furniture.push({ ...input.room.furniture[0], id: 'furniture-2', x: 1 });
  const result = parseProjectBackup(input)!;
  assert.equal(result.room.furniture.length, 2); assert.deepEqual(result.assets.map(asset => asset.id), [FIRST, SECOND]);
  input.room.furniture = []; input.assets = []; input.sketch = null; assert.deepEqual(parseProjectBackup(input)!.assets, []);
});

test('one writer produces a complete package recoverable without external resources', async () => {
  const input = parseProjectBackup(fixture());
  const serialized = await serializeProjectBackup(input);
  const recovered = parseProjectBackup(JSON.parse(serialized));
  await validateProjectBackupResources(recovered);
  assert.deepEqual(recovered.room, input.room);
  assert.deepEqual(Buffer.from(await recovered.assets[0].blob.arrayBuffer()), glb());
  assert.deepEqual(Buffer.from(await recovered.sketch!.arrayBuffer()), Buffer.from(png, 'base64'));
  assert.throws(() => parseProjectBackup({ ...fixture(), format: '3d-space-offline', version: 1 }), /copia actual/);
});

test('invalid binary resources fail validation before an importer can alter the design', async () => {
  const badModel = parseProjectBackup(fixture()); badModel.assets[0].blob = new Blob(['invalid'], { type: 'model/gltf-binary' });
  await assert.rejects(validateProjectBackupResources(badModel));
  const badSketch = parseProjectBackup(fixture()); badSketch.sketch = new Blob(['invalid'], { type: 'image/png' });
  await assert.rejects(serializeProjectBackup(badSketch), /contenido del croquis/);
  const extra = parseProjectBackup(fixture()); extra.assets.push({ id: SECOND, name: 'Sin usar', blob: new Blob(['invalid'], { type: 'model/gltf-binary' }) });
  await assert.rejects(validateProjectBackupResources(extra));
});

test('base64 must be canonical, without whitespace, URL encoding, garbage, or nonzero padding bits', () => {
  for (const base64 of ['', 'A', 'AAA', 'AA===', 'a A==', 'AA==\n', '-A==', '_A==', 'AB==', 'AAB=', 'data:model/gltf-binary;base64,AA==']) {
    const input = fixture(); input.assets[0].data.base64 = base64; assert.throws(() => parseProjectBackup(input), /formato|dañados/);
  }
  const input = fixture(); input.assets[0].data.type = ''; assert.throws(() => parseProjectBackup(input));
});

test('encoded model, sketch, and combined limits are rejected before decoding large blobs', () => {
  const model = fixture(); model.assets[0].data.base64 = 'A'.repeat(Math.ceil(20 * 1024 * 1024 / 3) * 4 + 4); assert.throws(() => parseProjectBackup(model), /20 MB/);
  const sketch = fixture(); sketch.sketch!.base64 = 'A'.repeat(Math.ceil(10 * 1024 * 1024 / 3) * 4 + 4); assert.throws(() => parseProjectBackup(sketch), /10 MB/);
  const total = fixture(), large = 'A'.repeat(Math.ceil(20 * 1024 * 1024 / 3) * 4 - 1) + '=';
  total.assets = Array.from({ length: 6 }, (_, index) => ({ asset: { id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, name: 'Tabla' }, data: { type: 'model/gltf-binary', base64: large } }));
  assert.throws(() => parseProjectBackup(total), /100 MB/);
  const mime = fixture(); mime.sketch!.type = 'text/html'; assert.throws(() => parseProjectBackup(mime), /formato/);
});
