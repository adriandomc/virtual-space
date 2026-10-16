import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { combineWorkshopMeshes } from './workshopBoolean';
import { disposeWorkshopModel, exportWorkshopGLB } from './modelWorkshopGeometry';
import { validateGlb } from '../../server/models/modelAssets';

const box = (size = 2): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshStandardMaterial());
function dispose(...meshes: THREE.Mesh[]) { const group = new THREE.Group(); group.add(...meshes); disposeWorkshopModel(group); }
function volume(mesh: THREE.Mesh) {
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry, position = geometry.getAttribute('position'), index = geometry.getIndex();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), cross = new THREE.Vector3();
  let result = 0;
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    a.fromBufferAttribute(position, index?.getX(i) ?? i).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(position, index?.getX(i + 1) ?? i + 1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(position, index?.getX(i + 2) ?? i + 2).applyMatrix4(mesh.matrixWorld);
    result += a.dot(cross.crossVectors(b, c)) / 6;
  }
  return result;
}
const near = (actual: number, expected: number, tolerance = 0.00005) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
function snapshot(mesh: THREE.Mesh) { return { position: Array.from(mesh.geometry.getAttribute('position').array), index: Array.from(mesh.geometry.index?.array ?? []), transform: mesh.matrix.toArray(), material: mesh.material }; }

test('union, subtraction and intersection change actual solid geometry without changing sources', () => {
  const a = box(), b = box(); b.position.x = 1; a.updateMatrix(); b.updateMatrix();
  const beforeA = snapshot(a), beforeB = snapshot(b), results: THREE.Mesh[] = [];
  try {
    for (const [operation, expected] of [['union', 12], ['subtract', 4], ['intersect', 4]] as const) {
      const result = combineWorkshopMeshes(a, b, operation); results.push(result); near(volume(result), expected);
      assert.notEqual(result.geometry, a.geometry); assert.notEqual(result.material, a.material);
      assert.deepEqual(result.scale.toArray(), [1, 1, 1]); assert.deepEqual(result.quaternion.toArray(), [0, 0, 0, 1]);
    }
    assert.deepEqual(snapshot(a), beforeA); assert.deepEqual(snapshot(b), beforeB);
  } finally { dispose(a, b, ...results); }
});

test('a cylinder can cut a box and its result supports another boolean operation', () => {
  const a = box(), cylinder = new THREE.Mesh(new THREE.CylinderGeometry(.45, .45, 3, 24), new THREE.MeshStandardMaterial()), cutter = box(.6), results: THREE.Mesh[] = [];
  cutter.position.set(.65, .65, .65);
  try {
    const result = combineWorkshopMeshes(a, cylinder, 'subtract'); results.push(result);
    near(volume(result), 8 - 24 * Math.sin(2 * Math.PI / 24) * .45 * .45, .001);
    const again = combineWorkshopMeshes(result, cutter, 'subtract'); results.push(again);
    assert.ok(volume(again) > 0 && volume(again) < volume(result));
  } finally { dispose(a, cylinder, cutter, ...results); }
});

test('empty operations preserve the original pieces and disconnected union remains reusable', () => {
  const a = box(), b = box(), covers = box(4); b.position.x = 5; a.updateMatrix(); b.updateMatrix();
  const beforeA = snapshot(a), beforeB = snapshot(b), results: THREE.Mesh[] = [];
  try {
    assert.throws(() => combineWorkshopMeshes(a, b, 'intersect'), /no comparten volumen/);
    assert.throws(() => combineWorkshopMeshes(a, covers, 'subtract'), /elimina toda la pieza/);
    const subtract = combineWorkshopMeshes(a, b, 'subtract'), union = combineWorkshopMeshes(a, b, 'union'); results.push(subtract, union);
    near(volume(subtract), 8); near(volume(union), 16);
    const again = combineWorkshopMeshes(union, covers, 'subtract'); results.push(again); near(volume(again), 8);
    assert.deepEqual(snapshot(a), beforeA); assert.deepEqual(snapshot(b), beforeB);
  } finally { dispose(a, b, covers, ...results); }
});

test('negative and nested transforms are baked into the first parent coordinates', () => {
  const parent = new THREE.Group(), a = box(), b = box(); parent.position.set(10, 3, -8); parent.rotation.y = .5; parent.scale.set(1.5, .8, .9);
  a.scale.x = -1; b.position.x = 1; parent.add(a, b);
  let result: THREE.Mesh | undefined;
  try {
    result = combineWorkshopMeshes(a, b, 'union'); near(volume(result), 12); parent.add(result);
    near(volume(result), 12 * 1.5 * .8 * .9);
    const world = new THREE.Box3().setFromObject(parent), actual = new THREE.Box3().setFromObject(result);
    assert.ok(world.min.distanceTo(actual.min) < .00005 && world.max.distanceTo(actual.max) < .00005);
  } finally { dispose(a, b, ...(result ? [result] : [])); }
});

test('pieces in separate transformed hierarchies preserve relative coordinates and shear', () => {
  const scene = new THREE.Group(), baseParent = new THREE.Group(), toolParent = new THREE.Group(), a = box(), b = box(.8);
  scene.add(baseParent, toolParent); baseParent.position.set(2, 1, -3); baseParent.rotation.y = .4; baseParent.scale.set(1.6, .7, 1.1); baseParent.add(a);
  a.rotation.z = .3;
  baseParent.updateWorldMatrix(true, true); const expected = new THREE.Box3().setFromObject(a), determinant = Math.abs(a.matrixWorld.determinant());
  toolParent.matrixAutoUpdate = false; toolParent.matrix.copy(a.matrixWorld); toolParent.add(b);
  let result: THREE.Mesh | undefined;
  try {
    result = combineWorkshopMeshes(a, b, 'subtract'); baseParent.add(result);
    near(volume(result), (8 - .8 ** 3) * determinant, .0005);
    const actual = new THREE.Box3().setFromObject(result); assert.ok(actual.min.distanceTo(expected.min) < .0001 && actual.max.distanceTo(expected.max) < .0001);
  } finally { dispose(a, b, ...(result ? [result] : [])); }
});

test('rounded primitives and angled tools produce reusable surfaces', () => {
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshStandardMaterial()), cube = box(.8), angled = new THREE.Mesh(new THREE.CylinderGeometry(.22, .22, 3, 16), new THREE.MeshStandardMaterial()), results: THREE.Mesh[] = [];
  cube.position.x = .85; angled.rotation.z = .25;
  try {
    const union = combineWorkshopMeshes(sphere, cube, 'union'); results.push(union); assert.ok(volume(union) > volume(sphere));
    const cut = combineWorkshopMeshes(union, angled, 'subtract'); results.push(cut); assert.ok(volume(cut) > 0 && volume(cut) < volume(union));
  } finally { dispose(sphere, cube, angled, ...results); }
});

test('failed validation never disposes source geometry, material or cached texture', () => {
  const a = box(), b = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial()), texture = new THREE.Texture();
  (a.material as THREE.MeshStandardMaterial).map = texture;
  let disposed = 0; for (const value of [a.geometry, a.material as THREE.Material, texture]) value.addEventListener('dispose', () => { disposed++; });
  try { assert.throws(() => combineWorkshopMeshes(a, b, 'union')); assert.equal(disposed, 0); }
  finally { dispose(a, b); texture.dispose(); }
});

test('closed solids retain UVs, colors and independent materials with texture references', () => {
  const a = box(), b = box(), texture = new THREE.Texture(), materials = Array.from({ length: 6 }, (_, i) => { const material = new THREE.MeshStandardMaterial({ map: texture, color: new THREE.Color().setHSL(i / 6, .5, .5) }); material.name = `face-${i}`; material.userData = { finish: i }; return material; });
  a.material = materials; b.position.x = .75;
  const colors = new Float32Array(a.geometry.getAttribute('position').count * 3).fill(.7); a.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  let result: THREE.Mesh | undefined;
  try {
    result = combineWorkshopMeshes(a, b, 'subtract');
    const outputMaterials = Array.isArray(result.material) ? result.material : [result.material];
    assert.ok(outputMaterials.some(material => material.name.startsWith('face-')));
    for (const material of outputMaterials.filter(material => material.name.startsWith('face-'))) {
      const source = materials.find(source => source.name === material.name)!; assert.notEqual(source, material);
      assert.equal((material as THREE.MeshStandardMaterial).map, texture); assert.deepEqual(material.userData, source.userData);
    }
    assert.equal(result.geometry.getAttribute('color').itemSize, 4);
    for (const name of ['normal', 'uv', 'color']) { const attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute = result.geometry.getAttribute(name); assert.equal(attr.count, result.geometry.getAttribute('position').count); assert.ok(Array.from(attr.array).every(Number.isFinite)); }
  } finally { dispose(a, b, ...(result ? [result] : [])); texture.dispose(); }
});

test('open, repeated and intersecting faces are rejected before CSG', () => {
  const closed = box(), open = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial()), repeated = box(), intersecting = box();
  repeated.geometry.setIndex([...repeated.geometry.index!.array, ...Array.from(repeated.geometry.index!.array).slice(0, 3)]);
  const left = new THREE.BoxGeometry(), right = new THREE.BoxGeometry().translate(.5, 0, 0); intersecting.geometry.dispose(); intersecting.geometry = mergeGeometries([left, right])!; left.dispose(); right.dispose();
  try {
    assert.throws(() => combineWorkshopMeshes(open, closed, 'union'), /sólido cerrado|bordes abiertos/);
    assert.throws(() => combineWorkshopMeshes(repeated, closed, 'union'), /repetidas/);
    assert.throws(() => combineWorkshopMeshes(intersecting, closed, 'union'), /superpuestas|cruzan/);
  } finally { dispose(closed, open, repeated, intersecting); }
});

test('invalid dimensions, coordinates and excessive triangle budgets are rejected', () => {
  const a = box(), b = box(), huge = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1, 50, 50, 50), new THREE.MeshStandardMaterial());
  try {
    b.scale.x = 0; assert.throws(() => combineWorkshopMeshes(a, b, 'union'), /tamaño/); b.scale.x = 1;
    b.geometry.getAttribute('position').setX(0, NaN); assert.throws(() => combineWorkshopMeshes(a, b, 'union'), /coordenadas/);
    assert.throws(() => combineWorkshopMeshes(a, huge, 'union'), /20 000/);
    assert.throws(() => combineWorkshopMeshes(a, a, 'union'), /distintas/);
  } finally { dispose(a, b, huge); }
});

test('the boolean result exports as a self-contained GLB accepted by server validation', async () => {
  const previous = globalThis.FileReader;
  class Reader { result: ArrayBuffer | null = null; onloadend?: () => void; readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then(bytes => { this.result = bytes; this.onloadend?.(); }); } }
  globalThis.FileReader = Reader as unknown as typeof FileReader;
  const a = box(), b = new THREE.Mesh(new THREE.CylinderGeometry(.45, .45, 3, 24), new THREE.MeshStandardMaterial());
  let result: THREE.Mesh | undefined;
  try {
    result = combineWorkshopMeshes(a, b, 'subtract');
    const group = new THREE.Group().add(result), bytes = await exportWorkshopGLB(group), metadata = validateGlb(Buffer.from(bytes));
    assert.ok(metadata.triangles > 12); assert.ok(metadata.nodes.length >= 1);
  } finally { globalThis.FileReader = previous; dispose(a, b, ...(result ? [result] : [])); }
});
