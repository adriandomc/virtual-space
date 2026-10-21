import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { addLevel, addRoof } from '../../domain/project/projectOperations';
import { createDefaultProject, projectToRoom } from '../../domain/project/projectDocument';
import type { RoomSceneProps, SceneRuntime } from './sceneRuntime';
import { updatePresentation } from './scenePresentation';

function fixture(project = createDefaultProject()) {
  const projectExtras = new THREE.Group();
  for (const roof of project.roofs) { const group = new THREE.Group(); group.userData.selection = { kind: 'roof', id: roof.id }; group.userData.levelIds = [roof.levelId]; group.add(new THREE.Object3D()); projectExtras.add(group); }
  const runtime = {
    project, activeLevelId: project.activeLevelId, projectExtras, content: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    levelViews: new Map(project.levels.map(level => [level.id, { resident: true, runtime: { builtRoom: projectToRoom(project, level.id), content: new THREE.Group(), objects: new Map(), walls: [], ceilings: [] } }])),
    graphics: { distance: 40 },
  } as unknown as SceneRuntime;
  const props = { room: projectToRoom(project), mode: 'orbit', selection: null, presentation: { walls: 'cut', roofs: false, levels: 'active' } } as RoomSceneProps;
  return { project, runtime, props, roofGroup: (id: string) => projectExtras.children.find(group => group.userData.selection.id === id)! };
}

test('selecting a real roof-backed ceiling reveals only its roof for manual color editing and preview', () => {
  let project = createDefaultProject(); project = addRoof(project, project.activeLevelId, { type: 'flat' });
  const { runtime, props, roofGroup } = fixture(project), [first, second] = project.roofs;
  updatePresentation(runtime, props, .016); assert.equal(roofGroup(first.id).children[0].layers.isEnabled(0), false);
  props.selection = { kind: 'ceiling', id: second.id };
  updatePresentation(runtime, props, .016);
  assert.equal(roofGroup(first.id).children[0].layers.isEnabled(0), false); assert.equal(roofGroup(second.id).children[0].layers.isEnabled(0), true);
  project.roofs[1].undersideFinish.color = '#123456'; updatePresentation(runtime, props, .016);
  assert.equal(roofGroup(second.id).children[0].layers.isEnabled(0), true);
  props.selection = { kind: 'wall', index: 0, id: project.levels[0].walls[0].id }; updatePresentation(runtime, props, .016);
  assert.equal(roofGroup(second.id).children[0].layers.isEnabled(0), false);
});

test('a lower slab ceiling never reveals an unrelated roof and a ceiling without an ID selects its first real target', () => {
  const { project, runtime, props, roofGroup } = fixture();
  props.selection = { kind: 'ceiling' }; updatePresentation(runtime, props, .016); assert.equal(roofGroup(project.roofs[0].id).children[0].layers.isEnabled(0), true);
  const multiple = addLevel(createDefaultProject(), { copy: true }), lower = multiple.levels[0], upper = multiple.levels[1], context = fixture(multiple);
  context.runtime.activeLevelId = lower.id; context.props.presentation!.levels = 'all'; context.props.selection = { kind: 'ceiling', id: upper.surfaces[0].id };
  updatePresentation(context.runtime, context.props, .016); assert(context.runtime.projectExtras!.children.every(group => !group.children[0].layers.isEnabled(0)));
  context.props.presentation!.roofs = true; updatePresentation(context.runtime, context.props, .016); assert(context.runtime.projectExtras!.children.every(group => group.children[0].layers.isEnabled(0)));
});

test('cached level layers still reset slab ceiling overrides and update camera-facing walls', () => {
  const project = addLevel(createDefaultProject(), { copy: true }), lower = project.levels[0], upper = project.levels[1];
  const { runtime, props } = fixture(project);
  runtime.activeLevelId = lower.id;
  const upperView = runtime.levelViews!.get(upper.id)!.runtime;
  const slab = new THREE.Object3D(); slab.userData.slabSurfaceId = upper.surfaces[0].id;
  upperView.content.add(slab); upperView.objects.set(`floor:${upper.surfaces[0].id}`, slab);
  const lowerView = runtime.levelViews!.get(lower.id)!.runtime, wall = new THREE.Group();
  wall.userData.selection = { kind: 'wall', id: lower.walls[0].id };
  lowerView.walls.push({ group: wall, index: 0, midpoint: { x: 0, z: 0 }, inward: { x: 1, z: 0 } } as typeof lowerView.walls[number]);
  runtime.camera.position.x = 1;
  updatePresentation(runtime, props, .016); assert.equal(slab.layers.mask, 2); assert.equal(wall.visible, true);
  props.selection = { kind: 'ceiling', id: upper.surfaces[0].id };
  updatePresentation(runtime, props, .016); assert.equal(slab.layers.mask, 1);
  props.selection = null; runtime.camera.position.x = -1;
  updatePresentation(runtime, props, .016); assert.equal(slab.layers.mask, 2); assert.equal(wall.visible, false);
});

test('independent ceiling fades settle even when visible surfaces have opposite targets', () => {
  const { runtime, props } = fixture(); runtime.animateView = true; runtime.ceilingOpacity = 0;
  const view = runtime.levelViews!.get(runtime.activeLevelId!)!.runtime;
  const first = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()), second = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
  first.userData.selection = { kind: 'ceiling', id: 'first' }; second.userData.selection = { kind: 'ceiling', id: 'second' };
  first.material.opacity = second.material.opacity = 0; view.ceilings = [first, second]; view.content.add(first, second);
  props.selection = { kind: 'ceiling', id: 'first' };
  assert.equal(updatePresentation(runtime, props, 1 / 60), true);
  for (let frame = 0; frame < 100; frame++) updatePresentation(runtime, props, 1 / 60);
  assert.equal(updatePresentation(runtime, props, 1 / 60), false);
  assert.equal(first.material.opacity, 1); assert.equal(second.material.opacity, 0);
  props.selection = { kind: 'ceiling', id: 'second' };
  for (let frame = 0; frame < 100; frame++) updatePresentation(runtime, props, 1 / 60);
  assert.equal(updatePresentation(runtime, props, 1 / 60), false);
  assert.equal(first.material.opacity, 0); assert.equal(second.material.opacity, 1);
  props.selection = null; props.presentation!.roofs = true;
  for (let frame = 0; frame < 100; frame++) updatePresentation(runtime, props, 1 / 60);
  assert.equal(updatePresentation(runtime, props, 1 / 60), false);
  assert.equal(first.material.opacity, 1); assert.equal(second.material.opacity, 1);
  first.geometry.dispose(); first.material.dispose(); second.geometry.dispose(); second.material.dispose();
});
