import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { updateRoofPreviewGeometry, updateRoofPreviewSelection, type RoofPreviewGeometry } from './roofPreviewGeometry';

test('roof selection and coordinate changes preserve surface/point buffers while face identifiers remain stable', () => {
  const scene = new THREE.Scene(), model = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3)), new THREE.MeshStandardMaterial()); scene.add(model);
  const active: RoofPreviewGeometry = { scene, model, points: null, edges: null, faceIds: [] };
  const vertices = [{ id: 'a', x: 0, y: 0, z: 0 }, { id: 'b', x: 2, y: 0, z: 0 }, { id: 'c', x: 2, y: 0, z: 2 }, { id: 'd', x: 0, y: 0, z: 2 }], faces = [{ id: 'roof', vertexIds: ['a', 'b', 'c', 'd'] }];
  updateRoofPreviewGeometry(active, vertices, faces);
  const geometry = model.geometry, position = geometry.getAttribute('position'), points = active.points, edges = active.edges!.geometry;
  updateRoofPreviewSelection(active, vertices, ['c'], 'roof', 'vertices');
  assert.equal(model.geometry, geometry); assert.equal(active.edges!.geometry, edges); assert.equal(active.points, points); assert.deepEqual(active.faceIds, ['roof', 'roof']);
  const selectedColor = new THREE.Color('#e0b66a'), colors = geometry.getAttribute('color'); assert(Math.abs(colors.getX(0) - selectedColor.r) < 1e-6);
  const moved = vertices.map(vertex => vertex.id === 'c' ? { ...vertex, y: 1 } : vertex); updateRoofPreviewGeometry(active, moved, faces);
  assert.equal(model.geometry, geometry); assert.equal(geometry.getAttribute('position'), position); assert.equal(active.points, points); assert.equal(position.getY(2), 1); assert.equal(geometry.boundingBox!.max.y, 1);
  updateRoofPreviewSelection(active, moved, [], null, 'faces'); assert.equal(active.points!.visible, false); assert.equal(model.geometry, geometry);
  model.geometry.dispose(); model.material.dispose(); active.points!.geometry.dispose(); (active.points!.material as THREE.Material).dispose(); active.edges!.geometry.dispose(); (active.edges!.material as THREE.Material).dispose();
});
