import assert from 'node:assert/strict';
import test from 'node:test';
import { preflightGlb } from './glbPreflight';
import { validateGlb } from './modelAssets';
import { inspectOfflineGlb } from './offlineModelValidation';

function file(patch: Record<string, unknown> = {}): Buffer {
  const document = { asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0, ...patch };
  const json = JSON.stringify(document), length = Math.ceil(json.length / 4) * 4, bytes = Buffer.alloc(28 + length + 36, 32);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); bytes.write(json, 20);
  bytes.writeUInt32LE(36, 20 + length); bytes.writeUInt32LE(0x004e4942, 24 + length);
  [0, 0, 0, 1, 0, 0, 0, 1, 1].forEach((value, index) => bytes.writeFloatLE(value, 28 + length + index * 4));
  return bytes;
}
const buffer = (bytes: Buffer) => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

test('shared GLB preflight counts instances across all declared scenes before allocation', () => {
  const bytes = file({ nodes: Array.from({ length: 256 }, () => ({ mesh: 0 })), scenes: [{ nodes: Array.from({ length: 256 }, (_, index) => index) }, { nodes: Array.from({ length: 256 }, (_, index) => index) }] });
  assert.equal(preflightGlb(bytes).primitiveInstances, 512);
  const expanded = file({ nodes: Array.from({ length: 256 }, () => ({ mesh: 0 })), scenes: Array.from({ length: 3 }, () => ({ nodes: Array.from({ length: 256 }, (_, index) => index) })) });
  for (const validate of [preflightGlb, validateGlb]) assert.throws(() => validate(expanded));
  assert.throws(() => inspectOfflineGlb(buffer(expanded)));
});

test('graph cycles, duplicate parents, invalid materials and expanded triangle budgets are rejected', () => {
  for (const patch of [
    { nodes: [{ children: [1] }, { children: [0], mesh: 0 }] },
    { nodes: [{ children: [2] }, { children: [2] }, { mesh: 0 }], scenes: [{ nodes: [0, 1] }] },
    { meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }] },
    { materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 3 } } }] },
    { accessors: [{ bufferView: 0, componentType: 5126, count: 600000, type: 'VEC3' }], nodes: [{ mesh: 0 }, { mesh: 0 }], scenes: [{ nodes: [0, 1] }] },
  ]) assert.throws(() => preflightGlb(file(patch)));
  assert.equal(validateGlb(file()).triangles, 1);
  assert.equal(inspectOfflineGlb(buffer(file())).texturePixels, 0);
});
