import assert from 'node:assert/strict';
import test from 'node:test';
import { ZipWriter, BlobWriter, TextReader, BlobReader } from '@zip.js/zip.js/index-native.js';
import { createDefaultProject } from '../../domain/project/projectDocument';
import { parseProjectBackup, serializeProjectBackup, validateProjectBackupResources, type ProjectBackup } from './projectBackup';

const ID = '00000000-0000-4000-8000-000000000001';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X9S8AAAAASUVORK5CYII=';
function glb() {
  const document = { asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
  const json = JSON.stringify(document), jsonLength = Math.ceil(json.length / 4) * 4, result = Buffer.alloc(28 + jsonLength + 36, 32);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonLength, 12); result.writeUInt32LE(0x4e4f534a, 16); result.write(json, 20);
  result.writeUInt32LE(36, 20 + jsonLength); result.writeUInt32LE(0x004e4942, 24 + jsonLength);
  [0, 0, 0, 1, 0, 0, 0, 1, 1].forEach((value, index) => result.writeFloatLE(value, 28 + jsonLength + index * 4));
  return new Blob([result], { type: 'model/gltf-binary' });
}
function fixture(): ProjectBackup {
  const project = createDefaultProject();
  project.levels[0].furniture.push({ levelId: project.levels[0].id, id: 'furniture-1', type: 'custom', assetId: ID, name: 'Tabla', parts: {}, color: null, material: null, width: 1, height: 1, depth: 1, x: 0, z: 0, rotation: 0 });
  return { project, assets: [{ id: ID, name: 'Tabla', blob: glb() }], sketches: [{ levelId: project.levels[0].id, blob: new Blob([Buffer.from(png, 'base64')], { type: 'image/png' }) }] };
}
async function archive(manifest: unknown, files: [string, Blob | string][] = []) {
  const writer = new ZipWriter(new BlobWriter(), { level: 0, useWebWorkers: false });
  await writer.add('manifest.json', new TextReader(JSON.stringify(manifest)));
  for (const [path, data] of files) await writer.add(path, typeof data === 'string' ? new TextReader(data) : new BlobReader(data));
  return writer.close();
}
const manifest = () => ({ format: '3d-space-project', version: 3, project: createDefaultProject(), assets: [] as unknown[], sketches: [] as unknown[] });

test('v3 binary archive round trips a full project, models and per-level sketch without base64', async () => {
  const input = fixture(), original = JSON.stringify(input.project);
  const file = await serializeProjectBackup(input), recovered = await parseProjectBackup(file);
  assert.equal(file.type, 'application/vnd.3dspace+zip');
  assert.deepEqual(recovered.project, input.project);
  assert.deepEqual(await recovered.assets[0].blob.arrayBuffer(), await input.assets[0].blob.arrayBuffer());
  assert.deepEqual(await recovered.sketches[0].blob.arrayBuffer(), await input.sketches[0].blob.arrayBuffer());
  assert.equal(JSON.stringify(input.project), original);
});

test('rejects all old JSON documents and ZIP manifests before any transaction', async () => {
  for (const value of [null, {}, { format: '3d-space-project', version: 2 }, new Blob([JSON.stringify({ version: 2 })])]) await assert.rejects(parseProjectBackup(value), /actual|anteriores/);
  for (const value of [1, 2]) await assert.rejects(parseProjectBackup(await archive({ ...manifest(), version: value })), /actual/);
  const old = manifest(); (old.project as unknown as { version: number }).version = 2;
  await assert.rejects(parseProjectBackup(await archive(old)), /versión/);
});

test('rejects traversal, directories, undeclared resources and missing declared files', async () => {
  for (const path of ['../private', '/absolute', 'models/../private.glb', 'nested.zip', 'models/x.glb']) await assert.rejects(parseProjectBackup(await archive(manifest(), [[path, 'x']])), /rutas|declarados/);
  const data = manifest(); data.assets.push({ id: ID, name: 'Tabla', path: `models/${ID}.glb`, size: 1 });
  await assert.rejects(parseProjectBackup(await archive(data)), /falta un archivo/);
});

test('validates every binary including unused models and exact sizes', async () => {
  const data = manifest(); data.assets.push({ id: ID, name: 'Tabla', path: `models/${ID}.glb`, size: 2 });
  await assert.rejects(parseProjectBackup(await archive(data, [[`models/${ID}.glb`, 'x']])), /tamaño declarado/);
  data.assets[0] = { id: ID, name: 'Tabla', path: `models/${ID}.glb`, size: 1 };
  await assert.rejects(parseProjectBackup(await archive(data, [[`models/${ID}.glb`, 'x']])));
});

test('rejects duplicate models, missing dependencies and unsafe names', async () => {
  const duplicate = fixture(); duplicate.assets.push(duplicate.assets[0]); await assert.rejects(validateProjectBackupResources(duplicate), /repetidos/);
  const missing = fixture(); missing.assets = []; await assert.rejects(validateProjectBackupResources(missing), /modelo|archivo/);
  for (const name of ['', ' ', 'x'.repeat(81), 'Mesa\u0000', 'Mesa\nPrivada']) {
    const input = fixture(); input.assets[0].name = name; await assert.rejects(validateProjectBackupResources(input), /incorrectos/);
  }
});

test('per-level sketches require current levels, uniqueness, matching signatures and bounded size', async () => {
  const missing = fixture(); missing.sketches[0].levelId = 'removed'; await assert.rejects(validateProjectBackupResources(missing), /niveles/);
  const duplicate = fixture(); duplicate.sketches.push(duplicate.sketches[0]); await assert.rejects(validateProjectBackupResources(duplicate), /repetidos/);
  const corrupt = fixture(); corrupt.sketches[0].blob = new Blob(['not-png'], { type: 'image/png' }); await assert.rejects(validateProjectBackupResources(corrupt), /contenido/);
  const huge = fixture(); huge.sketches[0].blob = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'image/png' }); await assert.rejects(validateProjectBackupResources(huge), /10 MB/);
});

test('empty binary project package is valid and complete', async () => {
  const source = { project: createDefaultProject(), assets: [], sketches: [] };
  const recovered = await parseProjectBackup(await serializeProjectBackup(source));
  assert.deepEqual(recovered, source);
});

test('central directory expansion and entry count budgets reject without allocating their claimed bytes', async () => {
  const original = new Uint8Array(await (await archive(manifest())).arrayBuffer());
  const view = new DataView(original.buffer);
  for (let i = 0; i < original.length - 46; i++) if (view.getUint32(i, true) === 0x02014b50) { view.setUint32(i + 24, 225 * 1024 * 1024, true); break; }
  await assert.rejects(parseProjectBackup(new Blob([original])), /expandido|tamaño/);
  const files: [string, string][] = Array.from({ length: 114 }, (_, index) => [`sketches/${index}.png`, 'x']);
  await assert.rejects(parseProjectBackup(await archive(manifest(), files)), /rutas/);
});
