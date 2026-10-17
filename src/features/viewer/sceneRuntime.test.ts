import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createDefaultProject, projectToRoom } from '../../domain/project/projectDocument';
import { addLevel, addStair } from '../../domain/project/projectOperations';
import { fitOrbitCamera, resetCamera, finishViewTransition } from './sceneCamera';
import { disposeArchitecture, disposeContent } from './sceneResources';
import { canInteract, canMove, canRotate, sameSelection, sceneItemPosition } from './sceneSelection';
import type { RoomSceneProps, SceneRuntime } from './sceneRuntime';

function fixture(project = createDefaultProject()) {
  let focused = 0;
  const runtime = {
    project, activeLevelId: project.activeLevelId, presentation: { walls: 'cut', roofs: false, levels: 'all' },
    scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(43, 1, .025, 250),
    controls: { target: new THREE.Vector3(), update() {}, enabled: false },
    renderer: { domElement: { focus() { focused++; } } },
    objects: new Map(), invalidFurniture: new Set(), fittedDistance: 0,
    viewMode: 'orbit', viewTransition: null, orbitPose: null, walkBlocked: false,
    environment: null, architecturalEnvironment: null, sky: null, loadingSky: false,
  } as unknown as SceneRuntime;
  return { runtime, room: projectToRoom(project), focused: () => focused };
}

test('camera fitting retains viewing direction and user zoom while adapting to narrow viewports', () => {
  const { runtime, room } = fixture(addLevel(createDefaultProject(), { copy: true }));
  resetCamera(runtime, room, 'orbit');
  const target = runtime.controls.target.clone();
  const direction = runtime.camera.position.clone().sub(target).normalize();
  runtime.camera.position.sub(target).multiplyScalar(.7).add(target);
  runtime.camera.aspect = .45;
  fitOrbitCamera(runtime, room, true);
  const offset = runtime.camera.position.clone().sub(target);
  assert.ok(offset.clone().normalize().distanceTo(direction) < 1e-12);
  assert.ok(Math.abs(offset.length() / runtime.fittedDistance - .7) < 1e-12);
  assert.ok(runtime.camera.far > runtime.controls.maxDistance);
  assert.deepEqual(runtime.controls.target, target);
});

test('camera reset and transition completion keep walk focus and orbit targets in the runtime', () => {
  const { runtime, room, focused } = fixture();
  resetCamera(runtime, room, 'walk');
  assert.equal(runtime.viewMode, 'walk');
  assert.equal(runtime.controls.enabled, false);
  assert.equal(runtime.camera.fov, 70);
  assert.equal(runtime.walkBlocked, false);
  assert.equal(focused(), 1);
  assert.ok(runtime.camera.position.y > 0 && runtime.camera.position.y < room.height);
  const target = new THREE.Vector3(2, 1, -3);
  runtime.orbitPose = { position: new THREE.Vector3(-4, 5, 6), quaternion: new THREE.Quaternion(), target };
  runtime.viewMode = 'orbit';
  finishViewTransition(runtime);
  assert.equal(runtime.viewTransition, null);
  assert.equal(runtime.controls.enabled, true);
  assert.deepEqual(runtime.controls.target, target);
  assert.equal(focused(), 1);
});

test('disposing content releases shared buffers once, runs model cleanup and releases shadow maps', () => {
  const group = new THREE.Group(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  const first = new THREE.Mesh(geometry, material), second = new THREE.Mesh(geometry, [material, material]);
  const point = new THREE.PointLight(), sun = new THREE.DirectionalLight();
  let geometries = 0, materials = 0, models = 0, shadows = 0;
  geometry.addEventListener('dispose', () => geometries++);
  material.addEventListener('dispose', () => materials++);
  first.userData.disposeCustomModel = () => models++;
  point.shadow.dispose = sun.shadow.dispose = () => { shadows++; };
  group.add(first, second, point, sun);
  disposeContent(group);
  assert.deepEqual({ geometries, materials, models, shadows }, { geometries: 1, materials: 1, models: 1, shadows: 2 });
  assert.equal(group.children.length, 0);
  disposeContent(group);
  assert.equal(geometries, 1);
});

test('disposing the rendering environment invalidates asynchronous loads and releases all owned resources', () => {
  const { runtime } = fixture();
  let disposed = 0;
  const resource = () => ({ dispose() { disposed++; } });
  runtime.postProcessing = resource() as SceneRuntime['postProcessing'];
  runtime.architecturalEnvironment = resource() as THREE.RenderTarget;
  runtime.sky = resource() as THREE.DataTexture;
  runtime.areaTextures = { LTC_FLOAT_1: resource(), LTC_FLOAT_2: resource(), LTC_HALF_1: resource(), LTC_HALF_2: resource() } as SceneRuntime['areaTextures'];
  disposeArchitecture(runtime);
  assert.equal(runtime.disposed, true);
  assert.equal(disposed, 7);
});

test('selection helpers keep stable wall identity and restrict walking interactions to doors and lights', () => {
  const { room } = fixture();
  room.openings = [
    { id: 'frame', type: 'door', wall: 0, offset: .1, width: .9, height: 2, sill: 0, doorStyle: 'frame' },
    { id: 'door', type: 'door', wall: 1, offset: .1, width: .9, height: 2, sill: 0, doorStyle: 'left', open: false },
    { id: 'window', type: 'window', wall: 2, offset: .1, width: .9, height: 1, sill: .7 },
  ];
  assert.equal(sameSelection({ kind: 'wall', id: 'wall-a', index: 0 }, { kind: 'wall', id: 'wall-a', index: 3 }), true);
  assert.equal(canMove({ kind: 'light', id: room.lights[0].id }), true);
  assert.equal(canMove({ kind: 'stair', id: 'stair-a' }), true);
  assert.equal(canRotate({ kind: 'stair', id: 'stair-a' }), true);
  assert.equal(canRotate({ kind: 'light', id: 'light-a' }), false);
  assert.equal(canMove({ kind: 'roof', id: 'roof-a' }), false);
  assert.equal(canInteract(room, { kind: 'opening', id: 'frame' }), false);
  assert.equal(canInteract(room, { kind: 'opening', id: 'window' }), false);
  assert.equal(canInteract(room, { kind: 'opening', id: 'door' }), true);
  assert.equal(canInteract(room, { kind: 'light', id: room.lights[0].id }), true);
  assert.equal(canInteract(room, { kind: 'light', id: 'deleted-light' }), false);
});

test('stair handles stay on the active connected floor without adding its elevation twice', () => {
  let project = addLevel(createDefaultProject(), { copy: true });
  project = addStair(project, { fromLevelId: project.levels[0].id, toLevelId: project.levels[1].id, type: 'spiral' });
  const stair = project.stairs[0], selection = { kind: 'stair' as const, id: stair.id };
  for (const level of project.levels) {
    const props = { project, activeLevelId: level.id, room: projectToRoom(project, level.id) } as RoomSceneProps;
    assert.deepEqual(sceneItemPosition(props, selection), { x: stair.x, y: level.elevation + .15, z: stair.z });
  }
  assert.equal(sceneItemPosition({ project, room: projectToRoom(project) } as RoomSceneProps, { kind: 'stair', id: 'deleted' }), null);
});
