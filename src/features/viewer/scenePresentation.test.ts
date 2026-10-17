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
