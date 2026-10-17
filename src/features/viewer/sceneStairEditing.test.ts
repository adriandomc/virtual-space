import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createDefaultProject } from '../../domain/project/projectDocument';
import { addLevel, addStair, deleteStair, setLevelHeight, updateStair } from '../../domain/project/projectOperations';
import { stairPose, StairTransformPreview } from './sceneStairEditing';

function fixture(levelCount = 2) {
  let project = createDefaultProject();
  project.levels[0].points.forEach(point => { point.x *= 2; point.z *= 2; });
  while (project.levels.length < levelCount) project = addLevel(project, { copy: true });
  project = addStair(project, { fromLevelId: project.levels[0].id, toLevelId: project.levels[1].id, run: 3, stepCount: 12, rotation: 0 });
  const group = new THREE.Group(); group.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
  const draft = new StairTransformPreview(project, project.stairs[0].id, group);
  return { project, group, draft };
}

test('stair preview transforms resident buffers without changing its source and applies one complete operation', () => {
  const { project, group, draft } = fixture(), before = structuredClone(project), geometry = (group.children[0] as THREE.Mesh).geometry;
  const stair = project.stairs[0]; draft.preview({ x: stair.x + .4, z: stair.z + .2, rotation: 15 });
  assert.equal(draft.error, ''); assert.deepEqual(project, before); assert.equal((group.children[0] as THREE.Mesh).geometry, geometry);
  const outline = group.children.find(child => child instanceof THREE.Line) as THREE.Line, positions = outline.geometry.getAttribute('position');
  assert.equal(outline.type, 'Line');
  assert.deepEqual(new THREE.Vector3().fromBufferAttribute(positions, 0), new THREE.Vector3().fromBufferAttribute(positions, positions.count - 1));
  const next = draft.apply(project); assert.equal(next.stairs[0].rotation, 15);
  assert.notDeepEqual(next.levels[1].surfaces[0].holes, project.levels[1].surfaces[0].holes);
  draft.dispose(); assert.equal(group.children.length, 1); assert.equal(group.matrixAutoUpdate, true); assert.deepEqual(group.matrix.elements, new THREE.Matrix4().elements);
  geometry.dispose(); ((group.children[0] as THREE.Mesh).material as THREE.Material).dispose();
});

test('invalid previews and remotely changed connected levels cannot overwrite the saved construction', () => {
  const { project, draft } = fixture(), stair = project.stairs[0];
  draft.preview({ ...stair, x: 49 }); assert.ok(draft.error); assert.throws(() => draft.apply(project));
  draft.preview({ ...stair, x: stair.x + .2 }); assert.equal(draft.error, '');
  const changed = setLevelHeight(project, project.levels[1].id, 3.1);
  assert.equal(draft.compatible(changed), false); assert.throws(() => draft.apply(changed), /canceló/);
  const painted = updateStair(project, stair.id, { finish: { color: '#445566', material: 'wood' } });
  assert.equal(draft.compatible(painted), true); assert.equal(draft.apply(painted).stairs[0].finish.color, '#445566'); draft.dispose();
});

test('stair grid and rotation snap can be disabled without changing the project preferences', () => {
  const project = createDefaultProject(); project.editing.step = .1;
  assert.deepEqual(stairPose(project, { x: .14, z: -.26, rotation: -17 }), { x: .1, z: -.3, rotation: 345 });
  const original = { x: .135, z: -.263, rotation: 17 };
  assert.deepEqual(stairPose(project, original, original), original);
  assert.deepEqual(stairPose(project, { ...original, x: .235 }, original), { ...original, x: .2 });
  assert.deepEqual(stairPose(project, { ...original, rotation: 31 }, original), { ...original, rotation: 30 });
  project.editing.snap = false;
  assert.deepEqual(stairPose(project, { x: .14, z: -.26, rotation: -17 }), { x: .14, z: -.26, rotation: 343 });
});

test('repeated stair previews cancel without disposing resident buffers or changing the saved construction', () => {
  const { project, group, draft } = fixture(), before = structuredClone(project), stair = project.stairs[0];
  const mesh = group.children[0] as THREE.Mesh, geometry = mesh.geometry, material = mesh.material as THREE.Material;
  let geometryDisposals = 0, materialDisposals = 0;
  geometry.addEventListener('dispose', () => geometryDisposals++); material.addEventListener('dispose', () => materialDisposals++);
  for (let index = 0; index < 30; index++) {
    draft.preview({ x: stair.x + (index % 5) * .1, z: stair.z + (index % 3) * .1, rotation: (index % 3) * 15 });
    assert.equal(draft.error, ''); assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material);
    assert.equal(group.children.length, 3); assert.deepEqual(project, before);
  }
  draft.dispose();
  assert.deepEqual(group.children, [mesh]); assert.deepEqual(group.matrix.elements, new THREE.Matrix4().elements);
  assert.equal(group.matrixAutoUpdate, true); assert.equal(geometryDisposals, 0); assert.equal(materialDisposals, 0);
  assert.deepEqual(project, before); geometry.dispose(); material.dispose();
});

test('stair previews preserve unrelated level edits but reject deletion of the selected staircase', () => {
  const { project, draft } = fixture(3), stair = project.stairs[0], thirdLevel = project.levels[2];
  draft.preview({ x: stair.x + .2, z: stair.z, rotation: stair.rotation });
  const remote = setLevelHeight(project, thirdLevel.id, thirdLevel.height + .2);
  assert.equal(draft.compatible(remote), true);
  const accepted = draft.apply(remote);
  assert.deepEqual(accepted.levels[2], remote.levels[2]); assert.deepEqual(accepted.roofs, remote.roofs);
  assert.equal(accepted.stairs[0].x, stair.x + .2);
  const removed = deleteStair(remote, stair.id), saved = structuredClone(removed);
  assert.equal(draft.compatible(removed), false); assert.throws(() => draft.apply(removed), /canceló/);
  assert.deepEqual(removed, saved); draft.dispose();
});

test('a fast preview moves immediately while deferred validation still rejects an invalid final position', () => {
  const { project, group, draft } = fixture(), stair = project.stairs[0];
  draft.preview({ ...stair, x: 49 }, false);
  assert.equal(draft.error, ''); assert.notDeepEqual(group.matrix.elements, new THREE.Matrix4().elements);
  draft.preview({ ...stair, x: 49 }); assert.ok(draft.error); assert.throws(() => draft.apply(project));
  draft.preview({ ...stair, x: stair.x + .2 }, false);
  assert.equal(draft.apply(project).stairs[0].x, stair.x + .2); draft.dispose();
});
