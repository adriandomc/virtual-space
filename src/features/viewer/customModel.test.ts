import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { applyCustomPart, attachCustomModel, clearCustomModelCache, cloneCustomModel } from './customModel';
import { modelAssetUrl } from '../../client/models/modelUrl';
import type { FurnitureItem } from '../../domain/project/types';

const item: FurnitureItem = { id: 'custom-a', type: 'custom', material: null, color: null, width: 1, height: 1, depth: 1, x: 0, z: 0, rotation: 0 };
test('custom models clone materials and geometry without mutating another instance', () => {
  const source = new THREE.Group(), material = new THREE.MeshStandardMaterial({ color: '#112233' });
  source.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  const first = cloneCustomModel(source), second = cloneCustomModel(source);
  applyCustomPart(first, { color: '#ff0000', position: { x: 2, y: 0, z: 0 }, scale: { x: 2, y: 1, z: 1 }, visible: false }, item, 'realistic');
  const mesh = first.children[0] as THREE.Mesh, other = second.children[0] as THREE.Mesh;
  assert.equal((mesh.material as THREE.MeshStandardMaterial).color.getHexString(), 'ff0000');
  assert.equal((other.material as THREE.MeshStandardMaterial).color.getHexString(), '112233');
  assert.equal(material.color.getHexString(), '112233');
  assert.notEqual(mesh.geometry, other.geometry); assert.notEqual(mesh.material, other.material);
  assert.equal(first.position.x, 2); assert.equal(first.scale.x, 2); assert.equal(first.visible, false); assert.equal(second.visible, true);
});
test('custom surface materials follow all three quality modes and keep authored PBR textures', () => {
  for (const quality of ['standard', 'realistic', 'hyperrealistic'] as const) {
    const source = new THREE.Group(), material = new THREE.MeshStandardMaterial({ color: '#aaaaaa', roughness: 0.75 });
    const texture = new THREE.Texture(); material.map = texture;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material); source.add(mesh);
    applyCustomPart(source, {}, item, quality);
    assert.equal((mesh.material as THREE.MeshStandardMaterial).map, texture);
    if (quality === 'hyperrealistic') assert.ok(mesh.material instanceof THREE.MeshPhysicalNodeMaterial);
    applyCustomPart(source, { material: 'metal', color: '#abcdef' }, item, quality);
    assert.equal((mesh.material as THREE.MeshStandardMaterial).metalness, 1);
    assert.equal((mesh.material as THREE.MeshStandardMaterial).color.getHexString(), 'abcdef');
  }
});
test('model URLs keep the project permission context separate from arbitrary names', () => {
  assert.equal(modelAssetUrl('id', 'room'), '/api/models/id?room=room');
  assert.equal(modelAssetUrl('id/secret', 'x&metadata=1'), '/api/models/id%2Fsecret?room=x%26metadata%3D1');
  assert.equal(modelAssetUrl('id', 'room', true), '/api/models/id?room=room&public=1');
  assert.equal(modelAssetUrl('id', undefined, true), '/api/models/id?public=1');
});

test('editor-created material markers retain the chosen finish in each quality mode', () => {
  for (const quality of ['standard', 'realistic', 'hyperrealistic'] as const) {
    const source = new THREE.Group(), original = new THREE.MeshStandardMaterial({ color: '#aabbcc' });
    original.name = '3D Space:wood';
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), original); source.add(mesh);
    applyCustomPart(source, {}, item, quality);
    const wood = mesh.material as unknown as THREE.MeshStandardNodeMaterial;
    assert.equal(wood.name, '3D Space:wood'); assert.equal(wood.color.getHexString(), 'aabbcc');
    if (quality !== 'standard') assert.ok(wood.colorNode, 'wood grain is rendered rather than lost on export');
    applyCustomPart(source, { material: 'metal' }, item, quality);
    assert.equal((mesh.material as THREE.MeshStandardMaterial).metalness, 1);
    assert.equal((mesh.material as THREE.Material).name, '3D Space:metal');
  }
});

function modelBytes(name = 'Tabla') {
  const document = { asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }], extras: { selection: { kind: 'wall', index: 999 }, modelNodeKey: '999', disposeCustomModel: true } }], nodes: [{ mesh: 0, name, extras: { selection: { kind: 'wall', index: 999 }, modelNodeKey: '999' } }], scenes: [{ nodes: [0] }] };
  const raw = new TextEncoder().encode(JSON.stringify(document)), length = Math.ceil(raw.length / 4) * 4, bytes = new Uint8Array(28 + length + 36), view = new DataView(bytes.buffer);
  bytes.fill(32, 20, 20 + length); bytes.set(raw, 20); view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true); view.setUint32(12, length, true); view.setUint32(16, 0x4e4f534a, true); view.setUint32(20 + length, 36, true); view.setUint32(24 + length, 0x004e4942, true);
  [0, 0, 0, 1, 0, 0, 0, 1, 1].forEach((value, index) => view.setFloat32(28 + length + index * 4, value, true));
  return bytes;
}

test('public custom model templates cannot reuse an authenticated private template', async () => {
  clearCustomModelCache();
  const original = globalThis.fetch, cleanup: (() => void)[] = [], requests: { url: string; credentials: RequestCredentials | undefined }[] = [];
  const privateParent = new THREE.Group(), publicParent = new THREE.Group();
  const attach = (parent: THREE.Group, publicOnly = false) => new Promise<void>((accept, reject) => {
    cleanup.push(attachCustomModel(parent, { ...item, assetId: 'same-model' }, 'realistic', { roomId: 'same-room', publicOnly, onLoaded: accept, onError: message => reject(new Error(message)) }));
  });
  try {
    globalThis.fetch = async (input, options) => {
      requests.push({ url: String(input), credentials: options?.credentials });
      return new Response(modelBytes('Private'));
    };
    await attach(privateParent);
    globalThis.fetch = async (input, options) => {
      requests.push({ url: String(input), credentials: options?.credentials });
      return new Response('', { status: 403 });
    };
    await assert.rejects(attach(publicParent, true), /no está disponible/);
    assert.equal(publicParent.children.length, 0);
    assert.deepEqual(requests, [
      { url: '/api/models/same-model?room=same-room', credentials: 'same-origin' },
      { url: '/api/models/same-model?room=same-room&public=1', credentials: 'omit' },
    ]);
    globalThis.fetch = async (input, options) => {
      requests.push({ url: String(input), credentials: options?.credentials });
      return new Response(modelBytes('Public'));
    };
    await attach(publicParent, true);
    assert.ok(publicParent.getObjectByName('Public'));
    assert.ok(privateParent.getObjectByName('Private'));
    assert.equal(requests.length, 3);
  } finally { cleanup.forEach(dispose => dispose()); globalThis.fetch = original; clearCustomModelCache(); }
});

test('cancelled model loads cannot attach to disposed scenes, while other instances remain independent', async () => {
  const bytes = modelBytes();
  const original = globalThis.fetch;
  let release!: () => void;
  const ready = new Promise<void>(accept => { release = accept; });
  globalThis.fetch = async () => { await ready; return new Response(bytes); };
  const parent = new THREE.Group();
  try {
    const cleanup = attachCustomModel(parent, { ...item, assetId: 'cancel-test' }, 'realistic');
    cleanup(); release(); await new Promise<void>(accept => setImmediate(accept));
    assert.equal(parent.children.length, 0);
    const first = new THREE.Group(), second = new THREE.Group();
    let disposeFirst!: () => void, disposeSecond!: () => void;
    await Promise.all([
      new Promise<void>((accept, reject) => { disposeFirst = attachCustomModel(first, { ...item, assetId: 'cancel-test', color: '#ff0000' }, 'realistic', { onLoaded: accept, onError: message => reject(new Error(message)) }); }),
      new Promise<void>((accept, reject) => { disposeSecond = attachCustomModel(second, { ...item, assetId: 'cancel-test', color: '#0000ff' }, 'realistic', { onLoaded: accept, onError: message => reject(new Error(message)) }); }),
    ]);
    const meshes: THREE.Mesh[] = [];
    first.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); }); second.traverse(object => { if (object instanceof THREE.Mesh) meshes.push(object); });
    for (const mesh of meshes) { assert.equal(mesh.userData.selection, undefined); assert.equal(mesh.userData.disposeCustomModel, undefined); assert.equal(mesh.userData.modelNodeKey, '0'); }
    assert.equal((meshes[0].material as THREE.MeshStandardMaterial).color.getHexString(), 'ff0000');
    assert.equal((meshes[1].material as THREE.MeshStandardMaterial).color.getHexString(), '0000ff');
    disposeFirst(); assert.equal(first.children.length, 0); assert.equal(second.children.length, 1); disposeSecond();
  } finally { globalThis.fetch = original; clearCustomModelCache(); }
});
