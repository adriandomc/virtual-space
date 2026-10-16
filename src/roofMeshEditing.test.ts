import assert from 'node:assert/strict';
import test from 'node:test';
import { Matrix4 } from 'three';
import { transformRoofVertices } from './roofMeshEditing';

test('moving a selected roof face preserves stable IDs and the other vertices without changing the source', () => {
  const source = [{ id: 'a', x: 0, y: 3, z: 0 }, { id: 'b', x: 1, y: 3, z: 0 }, { id: 'c', x: 1, y: 3, z: 1 }, { id: 'd', x: 0, y: 3, z: 1 }];
  const moved = transformRoofVertices(source, ['a', 'b', 'c'], new Matrix4().makeTranslation(.25, .5, -.25));
  assert.deepEqual(moved.map(vertex => vertex.id), source.map(vertex => vertex.id));
  assert.equal(moved[0].x, .25); assert.equal(moved[0].y, 3.5); assert.equal(moved[2].z, .75); assert.equal(moved[3], source[3]); assert.equal(source[0].y, 3);
});

test('rotation and scale use the same selection transform while invalid coordinates cannot corrupt a draft', () => {
  const source = [{ id: 'a', x: 1, y: 3, z: 0 }];
  const rotated = transformRoofVertices(source, ['a'], new Matrix4().makeRotationY(Math.PI / 2)); assert.ok(Math.abs(rotated[0].z + 1) < 1e-7);
  const scaled = transformRoofVertices(source, ['a'], new Matrix4().makeScale(2, 1, 2)); assert.equal(scaled[0].x, 2);
  const bounded = transformRoofVertices(source, ['a'], new Matrix4().makeTranslation(100, -100, 100)); assert.deepEqual(bounded[0], { id: 'a', x: 50, y: .1, z: 50 });
  const invalid = new Matrix4(); invalid.elements[0] = Infinity; assert.equal(transformRoofVertices(source, ['a'], invalid)[0], source[0]);
  assert.equal(transformRoofVertices(source, ['a'], new Matrix4().makeTranslation(0, 30, 0), 22.8)[0].y, 22.8);
});
