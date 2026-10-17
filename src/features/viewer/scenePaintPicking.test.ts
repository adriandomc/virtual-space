import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createDefaultProject, whiteFinish } from '../../domain/project/projectDocument';
import { addLevel, addStair } from '../../domain/project/projectOperations';
import { sampleSceneObjectColor, sampleScenePaintColor, scenePaintTarget, selectedScenePaintTarget, visiblePaintHit } from './scenePaintPicking';
import { slabGeometry } from './sceneProjection';

function rayHit(object: THREE.Object3D, start: THREE.Vector3, direction: THREE.Vector3) {
  object.updateWorldMatrix(true, true);
  const hit = new THREE.Raycaster(start, direction).intersectObject(object, true)[0];
  assert.ok(hit, 'the real mesh must be intersected'); return hit;
}

function mesh() { return new THREE.Mesh(new THREE.BoxGeometry(.4, .4, .4), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); }

test('wall painting follows its actual hit face and stable ID across levels rather than the active wall index', () => {
  const project = addLevel(createDefaultProject(), { copy: true }), lower = project.levels[0], upper = project.levels[1], wall = lower.walls[2];
  const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(4, 0); shape.lineTo(4, 2); shape.lineTo(0, 2); shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: .1, bevelEnabled: false }); geometry.translate(0, 0, -.05); geometry.clearGroups();
  const normals = geometry.getAttribute('normal');
  for (let index = 0; index < normals.count; index += 3) geometry.addGroup(index, 3, normals.getZ(index) < -.5 ? 1 : 0);
  const group = new THREE.Group(), wallMesh = new THREE.Mesh(geometry, [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]); group.add(wallMesh);
  group.userData.selection = { kind: 'wall', id: wall.id, index: 999 };
  const left = scenePaintTarget(project, upper.id, rayHit(group, new THREE.Vector3(2, 1, 1), new THREE.Vector3(0, 0, -1)), 'right');
  const right = scenePaintTarget(project, upper.id, rayHit(group, new THREE.Vector3(2, 1, -1), new THREE.Vector3(0, 0, 1)), 'left');
  assert.deepEqual(left, { levelId: lower.id, selection: { kind: 'wall', id: wall.id, index: 2 }, wallSide: 'left' });
  assert.deepEqual(right, { ...left, wallSide: 'right' });
  geometry.dispose(); (wallMesh.material as THREE.Material[]).forEach(material => material.dispose());
});

test('a slab top paints the upper floor and its actual underside paints only the lower ceiling', () => {
  const project = addLevel(createDefaultProject(), { copy: true }), lower = project.levels[0], upper = project.levels[1], floor = upper.surfaces[0];
  const geometry = slabGeometry(upper.outline.map(id => upper.points.find(point => point.id === id)!), [], .18);
  const slab = new THREE.Mesh(geometry, [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
  slab.rotation.x = -Math.PI / 2; slab.position.y = upper.elevation; slab.userData.selection = { kind: 'floor', id: floor.id };
  const top = scenePaintTarget(project, lower.id, rayHit(slab, new THREE.Vector3(1, 4, 0), new THREE.Vector3(0, -1, 0)));
  const bottom = scenePaintTarget(project, upper.id, rayHit(slab, new THREE.Vector3(1, 1, 0), new THREE.Vector3(0, 1, 0)));
  assert.deepEqual(top, { levelId: upper.id, selection: { kind: 'floor', id: floor.id } });
  assert.deepEqual(bottom, { levelId: lower.id, selection: { kind: 'ceiling', id: floor.id } });
  geometry.dispose(); (slab.material as THREE.Material[]).forEach(material => material.dispose());
});

test('roof exterior and interior mesh hit faces stay independent', () => {
  const project = createDefaultProject(), roof = project.roofs[0];
  const geometry = new THREE.BoxGeometry(2, .2, 2); geometry.groups.forEach(group => { group.materialIndex = group.start === 18 ? 1 : 0; });
  const object = new THREE.Mesh(geometry, [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial()]); object.userData.selection = { kind: 'roof', id: roof.id };
  const top = scenePaintTarget(project, project.activeLevelId, rayHit(object, new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0)));
  const bottom = scenePaintTarget(project, project.activeLevelId, rayHit(object, new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0)));
  assert.equal(top?.roofSide, 'finish'); assert.equal(bottom?.roofSide, 'undersideFinish');
  assert.equal(top?.levelId, roof.levelId); assert.equal(bottom?.selection.id, roof.id);
  geometry.dispose(); (object.material as THREE.Material[]).forEach(material => material.dispose());
});

test('nested furniture, opening and lamp hits resolve their owning level and stair hits keep a connected floor', () => {
  let project = addLevel(createDefaultProject(), { copy: true }); project = addStair(project, { fromLevelId: project.levels[0].id, toLevelId: project.levels[1].id });
  const lower = project.levels[0], upper = project.levels[1];
  lower.furniture.push({ id: 'furniture', levelId: lower.id, type: 'bed', bedSize: 'double', color: '#ffffff', material: 'wood', x: 0, z: 0, width: 1, depth: 2, height: 1, rotation: 0 });
  lower.openings.push({ id: 'door', levelId: lower.id, wallId: lower.walls[0].id, type: 'door', doorStyle: 'frame', offset: 1, width: .9, height: 2, sill: 0 });
  for (const selection of [{ kind: 'furniture', id: 'furniture' }, { kind: 'opening', id: 'door' }, { kind: 'light', id: lower.lights[0].id }, { kind: 'stair', id: project.stairs[0].id }] as const) {
    const group = new THREE.Group(), nested = new THREE.Group(), object = mesh(); group.add(nested); nested.add(object); group.userData.selection = selection;
    const target = scenePaintTarget(project, upper.id, rayHit(group, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)));
    assert.deepEqual(target, { levelId: selection.kind === 'stair' ? upper.id : lower.id, selection });
    object.geometry.dispose(); (object.material as THREE.Material).dispose();
  }
});

test('keyboard targets resolve stable IDs and actual ceiling resources and reject deleted selections', () => {
  const project = createDefaultProject(), level = project.levels[0], roof = project.roofs[0];
  assert.deepEqual(selectedScenePaintTarget(project, level.id, { kind: 'wall', index: 1 }, 'right'), { levelId: level.id, selection: { kind: 'wall', id: level.walls[1].id, index: 1 }, wallSide: 'right' });
  assert.deepEqual(selectedScenePaintTarget(project, level.id, { kind: 'ceiling' }), { levelId: level.id, selection: { kind: 'ceiling', id: roof.id } });
  level.surfaces.push({ id: 'ceiling', levelId: level.id, kind: 'ceiling', outline: [...level.outline], elevation: 2.8, thickness: .1, holes: [], finish: whiteFinish() });
  assert.deepEqual(selectedScenePaintTarget(project, level.id, { kind: 'ceiling' })?.selection, { kind: 'ceiling', id: 'ceiling' });
  for (const kind of ['wall', 'floor', 'ceiling', 'furniture', 'opening', 'light', 'stair', 'roof'] as const) assert.equal(selectedScenePaintTarget(project, level.id, { kind, id: 'deleted', index: 0 }), null);
  assert.equal(selectedScenePaintTarget(project, level.id, null), null);
});

test('hidden ancestor geometry and shadow-only meshes never become paint targets', () => {
  const camera = new THREE.PerspectiveCamera(), group = new THREE.Group(), object = mesh(); group.add(object);
  const hit = rayHit(group, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1));
  assert.equal(visiblePaintHit(hit, camera), true); group.visible = false; assert.equal(visiblePaintHit(hit, camera), false);
  group.visible = true; object.layers.set(1); assert.equal(visiblePaintHit(hit, camera), false);
  object.geometry.dispose(); (object.material as THREE.Material).dispose();
});

test('scene eyedropper samples document tints rather than rendered shadows, textures or unrelated hardware', () => {
  const project = createDefaultProject(), level = project.levels[0], object = mesh();
  level.walls[0].left.color = '#112233'; level.walls[0].right.color = '#445566';
  level.furniture.push({ id: 'bed', levelId: level.id, type: 'bed', bedSize: 'single', color: '#778899', material: 'wood', x: 0, z: 0, width: 1, depth: 2, height: 1, rotation: 0 });
  const hit = rayHit(object, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1));
  assert.equal(sampleScenePaintColor(project, { levelId: level.id, selection: { kind: 'wall', id: level.walls[0].id, index: 0 }, wallSide: 'right' }, hit), '#445566');
  assert.equal(sampleScenePaintColor(project, { levelId: level.id, selection: { kind: 'furniture', id: 'bed' } }, hit), '#778899');
  assert.throws(() => sampleScenePaintColor(project, { levelId: level.id, selection: { kind: 'furniture', id: 'deleted' } }, hit));
  object.geometry.dispose(); (object.material as THREE.Material).dispose();
});

test('original custom model sampling reads the actual material face in sRGB without mutating it', () => {
  const project = createDefaultProject(), level = project.levels[0];
  level.furniture.push({ id: 'custom', levelId: level.id, type: 'custom', assetId: '00000000-0000-4000-8000-000000000000', name: 'Original', color: null, material: null, x: 0, z: 0, width: 1, depth: 1, height: 1, rotation: 0 });
  const materials = [new THREE.MeshStandardMaterial({ color: '#123456' }), new THREE.MeshStandardMaterial({ color: '#aabbcc' })];
  const geometry = new THREE.BoxGeometry(); geometry.groups.forEach(group => { group.materialIndex = group.start === 30 ? 1 : 0; });
  const object = new THREE.Mesh(geometry, materials), target = { levelId: level.id, selection: { kind: 'furniture' as const, id: 'custom' } };
  const front = rayHit(object, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1));
  const back = rayHit(object, new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, 1));
  const originalColors = materials.map(material => material.color.toArray());
  assert.equal(sampleScenePaintColor(project, target, front), '#123456');
  assert.equal(sampleScenePaintColor(project, target, back), '#aabbcc');
  assert.deepEqual(materials.map(material => material.color.toArray()), originalColors);
  level.furniture[0].color = '#ABCDEF'; assert.equal(sampleScenePaintColor(project, target, back), '#abcdef');
  object.geometry.dispose(); materials.forEach(material => material.dispose());
});

test('custom part colors use the nearest authored node before the whole-model tint and ignore unregistered keys', () => {
  const project = createDefaultProject(), level = project.levels[0];
  level.furniture.push({ id: 'custom', levelId: level.id, type: 'custom', assetId: '00000000-0000-4000-8000-000000000000', name: 'Custom', color: '#223344', material: 'wood', parts: { '0': { color: '#445566' }, '1': { color: '#AABBCC' } }, x: 0, z: 0, width: 1, depth: 1, height: 1, rotation: 0 });
  const owner = new THREE.Group(), parent = new THREE.Group(), object = mesh(); owner.add(parent); parent.add(object);
  owner.userData.selection = { kind: 'furniture', id: 'custom' }; parent.userData.modelNodeKey = '0'; object.userData.modelNodeKey = '1';
  const hit = rayHit(owner, new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)), target = { levelId: level.id, selection: { kind: 'furniture' as const, id: 'custom' } };
  assert.equal(sampleScenePaintColor(project, target, hit), '#aabbcc');
  object.userData.modelNodeKey = 'deleted'; assert.equal(sampleScenePaintColor(project, target, hit), '#445566');
  parent.userData.modelNodeKey = 'deleted'; assert.equal(sampleScenePaintColor(project, target, hit), '#223344');
  level.furniture[0].color = null;
  assert.equal(sampleScenePaintColor(project, target, { ...hit, object: owner }), '#cccccc');
  object.geometry.dispose(); (object.material as THREE.Material).dispose();
});

test('keyboard sampling uses the first visible GLB part and its first material, ignoring hidden parts and placement overlays', () => {
  const project = createDefaultProject(), level = project.levels[0];
  level.furniture.push({ id: 'custom', levelId: level.id, type: 'custom', assetId: '00000000-0000-4000-8000-000000000000', name: 'Original', color: null, material: null, parts: { '0': { color: '#AABBCC' } }, x: 0, z: 0, width: 1, depth: 1, height: 1, rotation: 0 });
  const target = { levelId: level.id, selection: { kind: 'furniture' as const, id: 'custom' } }, ancestor = new THREE.Group(), owner = new THREE.Group(), hidden = new THREE.Group();
  const overlay = mesh(), hiddenPart = mesh(), first = new THREE.Mesh(new THREE.BoxGeometry(), [new THREE.MeshStandardMaterial({ color: '#123456' }), new THREE.MeshStandardMaterial({ color: '#654321' })]);
  ancestor.add(owner); owner.add(overlay, hidden, first); hidden.add(hiddenPart); hidden.visible = false; owner.userData.placementOverlay = overlay;
  assert.equal(sampleSceneObjectColor(project, target, owner), '#123456');
  first.userData.modelNodeKey = '0'; assert.equal(sampleSceneObjectColor(project, target, owner), '#aabbcc');
  first.userData.modelNodeKey = 'missing'; level.furniture[0].color = '#445566';
  assert.equal(sampleSceneObjectColor(project, target, owner), '#445566');
  level.furniture[0].color = null; first.visible = false;
  assert.equal(sampleSceneObjectColor(project, target, owner), '#cccccc');
  first.visible = true; ancestor.visible = false;
  assert.equal(sampleSceneObjectColor(project, target, owner), '#cccccc');
  assert.equal(sampleSceneObjectColor(project, target), '#cccccc');
  assert.throws(() => sampleSceneObjectColor(project, { ...target, levelId: 'deleted' }, owner));
  for (const object of [overlay, hiddenPart, first]) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose()); }
});
