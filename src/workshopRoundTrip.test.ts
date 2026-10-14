import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { prepareCustomModelTemplate } from './customModel';
import { combineWorkshopMeshes } from './workshopBoolean';
import { cloneWorkshopModel, disposeWorkshopModel, exportWorkshopGLB } from './modelWorkshopGeometry';
import { validateGlb } from './modelAssets';

async function withReader<T>(action: () => Promise<T>) {
  const previous = globalThis.FileReader;
  class Reader { result: ArrayBuffer | null = null; onloadend?: () => void; readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then(bytes => { this.result = bytes; this.onloadend?.(); }); } }
  globalThis.FileReader = Reader as unknown as typeof FileReader;
  try { return await action(); } finally { globalThis.FileReader = previous; }
}
const box = (size: number, color: string): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshStandardMaterial({ color }));

test('a saved multi-material boolean reloads as one closed editable piece and can be cut again', () => withReader(async () => {
  const a = box(2, '#8f6243'), b = new THREE.Mesh(new THREE.CylinderGeometry(.45, .45, 3, 24), new THREE.MeshStandardMaterial({ color: '#445566' })), tool = box(.6, '#eeeeee');
  tool.position.set(.65, .65, .65); a.name = 'Recorte';
  const result = combineWorkshopMeshes(a, b, 'subtract'), source = new THREE.Group().add(result);
  let loaded: THREE.Group | undefined, editable: THREE.Group | undefined, recut: THREE.Mesh | undefined;
  try {
    const bytes = await exportWorkshopGLB(source); validateGlb(Buffer.from(bytes));
    const gltf = await new GLTFLoader().parseAsync(bytes, ''); loaded = gltf.scene;
    prepareCustomModelTemplate(gltf);
    const marked: THREE.Object3D[] = []; loaded.traverse(object => { if (object.userData.logicalModelMesh) marked.push(object); });
    assert.equal(marked.length, 1); assert.ok(marked[0].children.length > 1); assert.ok(marked[0].userData.modelNodeKey !== undefined);
    const sourceMaterials: THREE.Material[] = [], originalPositions: number[][] = [];
    loaded.traverse(object => { if (object instanceof THREE.Mesh) { sourceMaterials.push(...(Array.isArray(object.material) ? object.material : [object.material])); originalPositions.push(Array.from(object.geometry.getAttribute('position').array)); } });
    editable = cloneWorkshopModel(loaded); assert.equal(editable.children.length, 1);
    const piece = editable.children[0] as THREE.Mesh; assert.equal(piece.name, 'Recorte');
    assert.equal(piece.geometry.index!.count, result.geometry.index!.count);
    assert.ok(Array.isArray(piece.material)); assert.equal(piece.geometry.groups.length, sourceMaterials.length);
    (piece.material as THREE.Material[]).forEach((material, i) => { assert.notEqual(material, sourceMaterials[i]); assert.equal((material as THREE.MeshStandardMaterial).color.getHexString(), (sourceMaterials[i] as THREE.MeshStandardMaterial).color.getHexString()); });
    const expected = new THREE.Box3().setFromObject(loaded), actual = new THREE.Box3().setFromObject(editable);
    assert.ok(expected.min.distanceTo(actual.min) < 1e-6 && expected.max.distanceTo(actual.max) < 1e-6);
    recut = combineWorkshopMeshes(piece, tool, 'subtract'); assert.ok(recut.geometry.index!.count > 0);
    const secondBytes = await exportWorkshopGLB(new THREE.Group().add(recut)); assert.ok(validateGlb(Buffer.from(secondBytes)).triangles > 12);
    const unchanged: number[][] = []; loaded.traverse(object => { if (object instanceof THREE.Mesh) unchanged.push(Array.from(object.geometry.getAttribute('position').array)); });
    assert.deepEqual(unchanged, originalPositions);
  } finally { disposeWorkshopModel(source); disposeWorkshopModel(new THREE.Group().add(a, b, tool, ...(recut ? [recut] : []))); if (loaded) disposeWorkshopModel(loaded); if (editable) disposeWorkshopModel(editable); }
}));

test('logical meshes preserve their world transforms and remain separate from child furniture nodes', () => withReader(async () => {
  const source = new THREE.Group(), parent = new THREE.Group(); source.add(parent); parent.scale.set(1.4, .8, 1.1); parent.rotation.y = .4;
  const multi = new THREE.Mesh(new THREE.BoxGeometry(), Array.from({ length: 6 }, (_, i) => new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(i / 6, .5, .5) })));
  multi.name = 'Ropero'; multi.position.set(1, .5, -.4); multi.rotation.z = .3; parent.add(multi);
  const child = box(.25, '#abcdef'); child.name = 'Buró'; child.position.set(0, 2, 0); multi.add(child);
  let loaded: THREE.Group | undefined, editable: THREE.Group | undefined;
  try {
    const gltf = await new GLTFLoader().parseAsync(await exportWorkshopGLB(source), ''); loaded = gltf.scene; prepareCustomModelTemplate(gltf);
    editable = cloneWorkshopModel(loaded); assert.equal(editable.children.length, 2);
    assert.deepEqual(editable.children.map(object => object.name).sort(), ['Buró', 'Ropero']);
    const expected = new THREE.Box3().setFromObject(source), actual = new THREE.Box3().setFromObject(editable);
    assert.ok(expected.min.distanceTo(actual.min) < .00001 && expected.max.distanceTo(actual.max) < .00001);
    assert.equal((editable.getObjectByName('Ropero') as THREE.Mesh).geometry.index!.count, 36);
  } finally { disposeWorkshopModel(source); if (loaded) disposeWorkshopModel(loaded); if (editable) disposeWorkshopModel(editable); }
}));

test('unmarked furniture groups are flattened into independent meshes and merged primitives align optional attributes', () => {
  const source = new THREE.Group(), furniture = new THREE.Group(), logical = new THREE.Group(); source.add(furniture, logical);
  const first = box(1, '#112233'), second = box(1, '#445566'); second.position.x = 2; furniture.add(first, second);
  logical.userData.logicalModelMesh = true; logical.position.set(-2, 1, 3); logical.rotation.y = .6; logical.scale.x = -1;
  const left = box(1, '#778899'), right = box(1, '#aabbcc'); right.position.x = 1; left.userData.logicalModelPrimitive = right.userData.logicalModelPrimitive = true;
  left.geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(24 * 3).fill(.5), 3));
  left.geometry.setAttribute('uv1', left.geometry.getAttribute('uv').clone()); right.geometry.deleteAttribute('uv'); logical.add(left, right);
  const textures = new THREE.Texture(); (left.material as THREE.MeshStandardMaterial).map = textures;
  let editable: THREE.Group | undefined;
  try {
    editable = cloneWorkshopModel(source); assert.equal(editable.children.length, 3);
    const merged = editable.children[2] as THREE.Mesh; assert.equal(merged.geometry.index!.count, 72);
    for (const name of ['normal', 'uv', 'uv1', 'color']) assert.equal(merged.geometry.getAttribute(name).count, merged.geometry.getAttribute('position').count);
    assert.equal(merged.geometry.getAttribute('color').itemSize, 4);
    assert.equal(((merged.material as THREE.Material[])[0] as THREE.MeshStandardMaterial).map, textures);
    const expected = new THREE.Box3().setFromObject(source), actual = new THREE.Box3().setFromObject(editable); assert.ok(expected.min.distanceTo(actual.min) < .00001 && expected.max.distanceTo(actual.max) < .00001);
  } finally { disposeWorkshopModel(source); if (editable) disposeWorkshopModel(editable); textures.dispose(); }
});
