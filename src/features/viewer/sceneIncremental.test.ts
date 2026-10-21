import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createDefaultProject, projectToRoom, type ProjectDocument } from '../../domain/project/projectDocument';
import { addLevel } from '../../domain/project/projectOperations';
import { buildProjectScene } from './sceneArchitecture';
import { disposeContent } from './sceneResources';
import type { SceneRuntime } from './sceneRuntime';
import { cachedRoofGeometry, clearSceneGeometryCache, sceneGeometryCacheUsage } from './sceneGeometryCache';
import { stableStringify } from '../../shared/sameData';

function runtimeFor(project: ProjectDocument) {
  const scene = new THREE.Scene(), content = new THREE.Group(); scene.add(content);
  return {
    project, activeLevelId: project.levels[0].id, scene, content, camera: new THREE.PerspectiveCamera(),
    renderer: { shadowMap: {}, domElement: { clientWidth: 1200 }, setPixelRatio() {} },
    graphics: { shadows: 512, textures: 512, renderScale: 1, geometry: 'low', distance: 40, ao: 'off', fps: 60 },
    objects: new Map(), walls: [], invalidFurniture: new Set(), viewMode: 'orbit', builtRoom: null,
    structure: '', ceiling: null, disposed: false, loadingSky: true, environment: null,
  } as unknown as SceneRuntime;
}
function fixture() {
  let project = createDefaultProject(); project = addLevel(project, { copy: true });
  project.renderQuality = 'standard';
  const level = project.levels[0];
  level.openings.push({ id: 'window', levelId: level.id, wallId: level.walls[0].id, type: 'window', offset: .5, width: 1, height: 1, sill: 1 });
  level.furniture.push({ id: 'cabinet', levelId: level.id, type: 'wardrobe', variant: 'wardrobe-classic', color: '#aabbcc', material: 'wood', width: 1, depth: .5, height: 2, x: 0, z: 0, rotation: 0 });
  return project;
}
function collectBuffers(root: THREE.Object3D) {
  const result = new Set<THREE.BufferGeometry>(); root.traverse(object => { if (object instanceof THREE.Mesh) result.add(object.geometry); }); return result;
}

test('painting uniforms retains all buffers, other levels and cached shadows', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) } });
  let runtime: SceneRuntime | undefined;
  try {
    const project = fixture(); runtime = runtimeFor(project); buildProjectScene(runtime, project);
    const before = collectBuffers(runtime.content), navigation = runtime.navigator;
    const untouched = runtime.levelViews!.get(project.levels[1].id)!.runtime.builtRoom;
    const wallMaterial = runtime.walls[0].material;
    runtime.scene.traverse(object => { if (object instanceof THREE.PointLight || object instanceof THREE.DirectionalLight) object.shadow.needsUpdate = false; });
    // Server storage sorts keys; parsing a saved document must not invalidate identical geometry.
    const next = JSON.parse(stableStringify(project)) as ProjectDocument, level = next.levels[0];
    level.walls[0].left.color = '#ff8800'; level.furniture[0].color = '#229922';
    level.surfaces[0].finish.color = '#eeeeff'; next.roofs[0].finish.color = '#123456';
    runtime.project = next; buildProjectScene(runtime, next);
    assert.deepEqual(collectBuffers(runtime.content), before);
    assert.equal(runtime.walls[0].material, wallMaterial);
    assert.equal(wallMaterial.color.getHexString(), 'ff8800');
    assert.equal(runtime.navigator, navigation);
    assert.equal(runtime.levelViews!.get(project.levels[1].id)!.runtime.builtRoom, untouched);
    runtime.scene.traverse(object => { if (object instanceof THREE.PointLight || object instanceof THREE.DirectionalLight) assert.equal(object.shadow.needsUpdate, false); });
  } finally { if (runtime) disposeContent(runtime.content); if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window'); }
});

test('a moved opening rebuilds only its old and new wall and moving furniture retains navigation', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) } });
  let runtime: SceneRuntime | undefined;
  try {
    let project = fixture(); runtime = runtimeFor(project); buildProjectScene(runtime, project);
    const floor = runtime.objects.get('floor'), walls = runtime.walls.map(wall => wall.group);
    const other = runtime.levelViews!.get(project.levels[1].id)!.runtime.content.children.slice();
    project = structuredClone(project); project.levels[0].openings[0].wallId = project.levels[0].walls[1].id;
    runtime.project = project; buildProjectScene(runtime, project);
    assert.equal(runtime.objects.get('floor'), floor);
    assert.notEqual(runtime.walls[0].group, walls[0]); assert.notEqual(runtime.walls[1].group, walls[1]);
    assert.equal(runtime.walls[2].group, walls[2]); assert.equal(runtime.walls[3].group, walls[3]);
    assert.deepEqual(runtime.levelViews!.get(project.levels[1].id)!.runtime.content.children, other);
    const navigation = runtime.navigator, furniture = runtime.objects.get('furniture:cabinet'), room = projectToRoom(project, project.levels[0].id);
    project = structuredClone(project); project.levels[0].furniture[0].x = room.furniture[0].x + .5;
    runtime.project = project; buildProjectScene(runtime, project);
    assert.equal(runtime.navigator, navigation); assert.equal(runtime.objects.get('furniture:cabinet'), furniture);
    assert.equal(furniture!.position.x, .5);
  } finally { if (runtime) disposeContent(runtime.content); if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window'); }
});

test('moving an interior surface point rebuilds its level even when the outer polygon and outline IDs are unchanged', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1, matchMedia: () => ({ matches: false }) } });
  let runtime: SceneRuntime | undefined;
  try {
    const project = fixture(), level = project.levels[0], surface = level.surfaces[0];
    level.points.push({ id: 'interior-surface-point', x: 0, z: 0 });
    surface.outline = [level.outline[0], level.outline[1], 'interior-surface-point', level.outline[3]];
    runtime = runtimeFor(project); buildProjectScene(runtime, project);
    const floor = runtime.objects.get(`floor:${surface.id}`) as THREE.Mesh;
    const untouched = runtime.levelViews!.get(project.levels[1].id)!.runtime.builtRoom;
    const next = structuredClone(project); next.levels[0].points.find(point => point.id === 'interior-surface-point')!.x = .5;
    runtime.project = next; buildProjectScene(runtime, next);
    const moved = runtime.objects.get(`floor:${surface.id}`) as THREE.Mesh;
    assert.notEqual(moved.geometry, floor.geometry);
    const vertices = moved.geometry.getAttribute('position');
    assert.ok(Array.from({ length: vertices.count }, (_, index) => vertices.getX(index)).includes(.5));
    assert.equal(runtime.levelViews!.get(project.levels[1].id)!.runtime.builtRoom, untouched);
  } finally { if (runtime) disposeContent(runtime.content); if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window'); }
});

test('roof derivations reuse geometry across tint changes and bound retired shapes', () => {
  clearSceneGeometryCache(); const project = createDefaultProject(), first = cachedRoofGeometry(project, project.roofs[0]);
  const tinted = structuredClone(project); tinted.roofs[0].finish.color = '#123456';
  assert.equal(cachedRoofGeometry(tinted, tinted.roofs[0]), first);
  for (let index = 0; index < 100; index++) { const next = structuredClone(project); next.levels[0].elevation = index; cachedRoofGeometry(next, next.roofs[0]); }
  assert.ok(sceneGeometryCacheUsage().entries <= 64); assert.ok(sceneGeometryCacheUsage().bytes <= 8 * 1024 * 1024);
  clearSceneGeometryCache();
});
