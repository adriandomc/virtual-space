import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ADDITION, Brush, Evaluator } from 'three-bvh-csg';
import { createWorkshopPiece, WORKSHOP_PIECES } from './workshopPieces';

function closedGeometry(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position'), index = geometry.index, vertices: THREE.Vector3[] = [], vertexIds: number[] = [], lookup = new Map<string, number>(), edges = new Map<string, { count: number; winding: number }>();
  for (let i = 0; i < position.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(position, i), key = point.toArray().map(value => Math.round(value * 1e6)).join(':');
    if (!lookup.has(key)) { lookup.set(key, vertices.length); vertices.push(point); }
    vertexIds.push(lookup.get(key)!);
  }
  let volume = 0;
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    const ids = [0, 1, 2].map(offset => vertexIds[index?.getX(i + offset) ?? i + offset]);
    const [a, b, c] = ids.map(id => vertices[id]);
    if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-18) continue;
    volume += a.dot(b.clone().cross(c)) / 6;
    for (let side = 0; side < 3; side++) {
      const first = ids[side], second = ids[(side + 1) % 3], key = [Math.min(first, second), Math.max(first, second)].join(':');
      const edge = edges.get(key) ?? { count: 0, winding: 0 }; edge.count++; edge.winding += first < second ? 1 : -1; edges.set(key, edge);
    }
  }
  assert.ok(volume > 0, 'closed solids have outward-facing triangles and positive volume');
  for (const [key, edge] of edges) { assert.equal(edge.count, 2, `edge ${key} must connect two faces`); assert.equal(edge.winding, 0, `edge ${key} must have opposite directions`); }
}

test('piece catalog has six primitives and at least ten distinct usable prefab sizes', () => {
  assert.equal(WORKSHOP_PIECES.filter(piece => piece.category === 'primitives').length, 6);
  assert.ok(WORKSHOP_PIECES.filter(piece => piece.category === 'prefabs').length >= 10);
  assert.equal(new Set(WORKSHOP_PIECES.map(piece => piece.id)).size, WORKSHOP_PIECES.length);
  assert.throws(() => createWorkshopPiece('constructor'));
  assert.throws(() => createWorkshopPiece('missing'));
});

test('all pieces are closed solids with finite attributes, actual meter dimensions and floor-aligned transforms', () => {
  for (const preset of WORKSHOP_PIECES) {
    const mesh = createWorkshopPiece(preset.id); mesh.updateWorldMatrix(true, false);
    try {
      const bounds = new THREE.Box3().setFromObject(mesh), size = bounds.getSize(new THREE.Vector3()), expected = [preset.width, preset.height, preset.depth];
      size.toArray().forEach((value, axis) => assert.ok(Math.abs(value - expected[axis]) < .000001, `${preset.id}: dimension ${axis} is ${value}`));
      assert.ok(Math.abs(bounds.min.y) < .000001); assert.ok(Math.abs((bounds.max.x + bounds.min.x) / 2) < .000001); assert.ok(Math.abs((bounds.max.z + bounds.min.z) / 2) < .000001);
      for (const name of ['position', 'normal', 'uv']) for (const value of mesh.geometry.getAttribute(name).array) assert.ok(Number.isFinite(value), `${preset.id}: ${name}`);
      closedGeometry(mesh.geometry);
      assert.equal(mesh.name, preset.label); assert.equal((mesh.material as THREE.MeshStandardMaterial).name, '3D Space:' + (preset.material ?? 'wood'));
      assert.ok(mesh.castShadow && mesh.receiveShadow);
    } finally { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
  }
});

test('prefabs and primitives can participate in CSG without changing their originals', () => {
  const evaluator = new Evaluator(); evaluator.useGroups = false;
  for (const preset of WORKSHOP_PIECES) {
    const source = createWorkshopPiece(preset.id), original = Array.from(source.geometry.getAttribute('position').array);
    const brush = new Brush(source.geometry.clone(), source.material); brush.position.copy(source.position); brush.updateMatrixWorld(true);
    const other = new Brush(new THREE.BoxGeometry(.08, .08, .08), new THREE.MeshStandardMaterial()); other.position.set(.012, Math.min(.06, preset.height / 2), .013); other.updateMatrixWorld(true);
    let result: Brush | undefined;
    try {
      result = evaluator.evaluate(brush, other, ADDITION);
      assert.ok(result.geometry.getAttribute('position').count > 0, preset.id);
      for (const name of ['position', 'normal', 'uv']) for (const value of result.geometry.getAttribute(name).array) assert.ok(Number.isFinite(value), `${preset.id}: CSG ${name}`);
      assert.deepEqual(Array.from(source.geometry.getAttribute('position').array), original);
    } finally { result?.geometry.dispose(); brush.geometry.dispose(); other.geometry.dispose(); (other.material as THREE.Material).dispose(); source.geometry.dispose(); (source.material as THREE.Material).dispose(); }
  }
});
