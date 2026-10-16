import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createDefaultProject, projectToRoom, type ProjectDocument } from '../../domain/project/projectDocument';
import { addLevel, addStair, addWall } from '../../domain/project/projectOperations';
import { architecturalViewBounds, indexedArchitectureGeometry, levelGeometrySignature, presentedLevelIds, projectedLevelScene, projectNavigationSignature, residentLevelIds, shadowLightIds, sceneResourceUsage, slabGeometry } from './sceneProjection';
import { buildRoofGeometry } from '../../domain/project/projectGeometry';
import { buildCatalogGeometry } from './catalogGeometry';
import { createDuvetGeometry, createPillowGeometry } from './beddingGeometry';

function fixture(count: number): ProjectDocument {
  let project = createDefaultProject();
  for (let index = 1; index < count; index++) project = addLevel(project, { copy: true });
  for (const level of project.levels) level.furniture = Array.from({ length: 4 }, (_, index) => ({ id: `f-${level.id}-${index}`, levelId: level.id, type: 'wardrobe', variant: 'wardrobe-classic', width: 1, depth: .5, height: 2, rotation: 0, x: -1.5 + index % 4, z: -1 + Math.floor(index / 4), color: '#aabbcc', material: 'wood' }));
  return project;
}

test('one, four and twelve floors retain detailed items only on the active floor', t => {
  for (const count of [1, 4, 12]) {
    const project = fixture(count), scenes = project.levels.map(level => projectedLevelScene(project, level.id, level.id === project.activeLevelId));
    assert.equal(scenes.reduce((total, scene) => total + scene.furniture.length, 0), 4);
    assert.equal(scenes.reduce((total, scene) => total + (scene.wallSegments?.length ?? 0), 0), count * 4);
    assert.equal(scenes.filter(scene => scene.lights.length > 0).length, count === 1 ? 1 : 0);
    assert.equal(project.levels.reduce((total, level) => total + level.furniture.length, 0), count * 4, 'viewport residency must not alter stored designs');
    const mesh = new THREE.Group();
    for (const roof of project.roofs) { const data = buildRoofGeometry(project, roof); mesh.add(new THREE.Mesh(indexedArchitectureGeometry(data.vertices, data.triangles, data.uvs), new THREE.MeshStandardMaterial())); }
    const usage = sceneResourceUsage(mesh); assert.ok(usage.geometryBytes < 65536); assert.ok(usage.triangles > 0);
    t.diagnostic(JSON.stringify({ levels: count, residentFurniture: 4, structuralWalls: count * 4, roofGeometryBytes: usage.geometryBytes }));
    mesh.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (object.material as THREE.Material).dispose(); } });
  }
});

test('inactive levels keep interior walls and openings, while stairs preload nearby connected levels only', () => {
  const base = fixture(3);
  let project = addWall(base, base.levels[0].id, { x: -.5, z: 0 }, { x: .5, z: 0 });
  const ground = project.levels[0], interior = ground.walls.at(-1)!;
  ground.openings.push({ id: 'internal-window', levelId: ground.id, wallId: interior.id, type: 'window', offset: .1, width: .5, height: .5, sill: .8 });
  const inactive = projectedLevelScene(project, ground.id, false);
  assert.equal(inactive.wallSegments!.length, ground.walls.length); assert.equal(inactive.openings[0].wall, ground.walls.length - 1); assert.equal(inactive.furniture.length, 0);
  project = addStair(project, { fromLevelId: ground.id, toLevelId: project.levels[1].id });
  project = addStair(project, { fromLevelId: project.levels[1].id, toLevelId: project.levels[2].id });
  const active = project.levels[1].id;
  assert.equal(residentLevelIds(project, active, true, { x: 0, z: 0 }, 40).size, 3);
  assert.equal(residentLevelIds(project, active, true, { x: 40, z: 40 }, 40).size, 1);
  assert.equal(residentLevelIds(project, active, false, { x: 0, z: 0 }, 40).size, 1);
});

test('floor filters follow elevation rather than array position and keep active IDs stable', () => {
  const project = fixture(4), active = project.levels[1];
  assert.deepEqual([...presentedLevelIds(project, active.id, 'active')], [active.id]);
  assert.equal(presentedLevelIds(project, active.id, 'below').size, 2);
  assert.equal(presentedLevelIds(project, active.id, 'all').size, 4);
  assert.ok(architecturalViewBounds(project, active.id, 'all').height > architecturalViewBounds(project, active.id, 'active').height * 3);
});

test('geometry detail tiers reduce mesh density independently from the realistic material mode', () => {
  const triangles: number[] = [], bedding: number[] = [];
  const material = new THREE.MeshPhysicalNodeMaterial({ color: '#aabbcc' });
  for (const detail of ['low', 'medium', 'high'] as const) {
    const group = new THREE.Group();
    buildCatalogGeometry(group, { type: 'wardrobe', variant: 'wardrobe-classic', width: 1, height: 2, depth: .5 }, { body: material, face: material, handles: material }, 'hyperrealistic', detail);
    triangles.push(sceneResourceUsage(group).triangles);
    group.traverse(object => { if (object instanceof THREE.Mesh) { assert.equal(object.material, material); object.geometry.dispose(); } });
    const duvet = createDuvetGeometry(1.4, 1.9, .9, detail), pillow = createPillowGeometry(.6, .16, .4, detail);
    bedding.push(duvet.index!.count + pillow.index!.count); duvet.dispose(); pillow.dispose();
  }
  assert.ok(triangles[0] < triangles[1] && triangles[1] < triangles[2]); assert.ok(bedding[0] < bedding[1] && bedding[1] < bedding[2]); material.dispose();
});

test('paint, door state and item transforms retain structural buffers; holes and wall dimensions invalidate them', () => {
  const project = fixture(1), room = projectToRoom(project), initial = levelGeometrySignature(room);
  const changed = structuredClone(room); changed.furniture[0].x += .2; changed.furniture[0].rotation = 15; changed.furniture[0].color = '#ee5511'; changed.floorColor = '#445566'; changed.wallSegments![0].leftColor = '#778899'; changed.lights[0].enabled = false;
  assert.equal(levelGeometrySignature(changed), initial);
  changed.wallSegments![0].height -= .2; assert.notEqual(levelGeometrySignature(changed), initial);
  const hole = structuredClone(room); hole.surfaces![0].holes.push({ id: 'hole', vertices: [{ x: -.2, z: -.2 }, { x: .2, z: -.2 }, { x: .2, z: .2 }, { x: -.2, z: .2 }] }); assert.notEqual(levelGeometrySignature(hole), initial);
});

test('extruded floors have real holes and downward slab thickness', () => {
  const outline = [{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: -2, z: 2 }], hole = outline.map(point => ({ x: point.x / 4, z: point.z / 4 }));
  const geometry = slabGeometry(outline, [hole], .2), floor = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); floor.rotation.x = -Math.PI / 2; floor.updateMatrixWorld();
  const ray = new THREE.Raycaster(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0));
  assert.equal(ray.intersectObject(floor).length, 0);
  ray.ray.origin.x = 1; assert.ok(ray.intersectObject(floor).length > 0);
  const box = new THREE.Box3().setFromObject(floor); assert.ok(Math.abs(box.min.y + .2) < 1e-6); assert.ok(Math.abs(box.max.y) < 1e-6);
  geometry.dispose(); (floor.material as THREE.Material).dispose();
});

test('resource accounting counts shared geometry and textures once', () => {
  const group = new THREE.Group(), geometry = new THREE.BoxGeometry(), texture = new THREE.Texture({ width: 512, height: 512 } as HTMLImageElement), material = new THREE.MeshStandardMaterial({ map: texture, aoMap: texture }); group.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  const one = sceneResourceUsage(group.children[0]), two = sceneResourceUsage(group);
  assert.equal(two.geometryBytes, one.geometryBytes); assert.equal(two.textureBytes, one.textureBytes); assert.equal(two.textures, 1); assert.equal(two.triangles, one.triangles * 2);
  geometry.dispose(); material.dispose(); texture.dispose();
});

test('moving, resizing and changing a doorway invalidates physical navigation', () => {
  const project = createDefaultProject(), level = project.levels[0];
  level.openings.push({ id: 'door', levelId: level.id, wallId: level.walls[0].id, type: 'door', doorStyle: 'right', open: false, offset: 1, width: .9, height: 2.1, sill: 0 });
  const signature = projectNavigationSignature(project);
  for (const patch of [{ offset: 2 }, { width: 1.1 }, { height: 1.8 }, { wallId: level.walls[1].id }, { doorStyle: 'left' }, { open: true }]) { const changed = structuredClone(project); Object.assign(changed.levels[0].openings[0], patch); assert.notEqual(projectNavigationSignature(changed), signature); }
});

test('changing detailed residency never invalidates architecture, while local shadows share one project budget', () => {
  const project = fixture(12);
  for (const level of project.levels) {
    const full = projectedLevelScene(project, level.id, true), unloaded = projectedLevelScene(project, level.id, false);
    assert.equal(levelGeometrySignature(full), levelGeometrySignature(unloaded));
    full.furniture[0].height -= .2; assert.equal(levelGeometrySignature(full), levelGeometrySignature(unloaded), 'item geometry is reconciled independently');
  }
  const resident = new Set(project.levels.slice(0, 3).map(level => level.id));
  for (const level of project.levels.slice(0, 3)) level.lights = Array.from({ length: 3 }, (_, index) => ({ id: `${level.id}-light-${index}`, levelId: level.id, x: index, y: 2, z: 0, name: 'Light', lumens: 800, temperature: 3000, enabled: true }));
  const active = project.levels[1].id, view = { x: 0, y: 4.4, z: 0 };
  const selected = shadowLightIds(project, active, resident, view, 3);
  assert.equal(selected.size, 3); assert.ok([...selected].every(id => project.levels[1].lights.some(light => light.id === id)));
  assert.equal(shadowLightIds(project, active, resident, view, 1).size, 1); assert.equal(shadowLightIds(project, active, resident, view, 0).size, 0);
});

test('wall and ceiling finish changes do not invalidate architectural buffers', () => {
  const project = createDefaultProject(), before = projectToRoom(project), changed = structuredClone(project);
  changed.levels[0].walls[0].left.material = 'wood'; changed.levels[0].walls[0].right.material = 'marble'; changed.levels[0].surfaces[0].finish.material = 'tile-checker';
  const floor = changed.levels[0].surfaces.find(surface => surface.kind === 'floor')!; floor.undersideFinish = { color: '#1144cc', material: 'marble' };
  assert.equal(levelGeometrySignature(projectToRoom(changed)), levelGeometrySignature(before));
});

test('slab cap groups select the actual underside and keep its apertures without duplicated geometry', () => {
  const outline = [{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: 2 }, { x: -2, z: 2 }], hole = outline.map(point => ({ x: point.x / 4, z: point.z / 4 }));
  const geometry = slabGeometry(outline, [hole], .2), materials = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), floor = new THREE.Mesh(geometry, materials);
  floor.rotation.x = -Math.PI / 2; floor.updateMatrixWorld();
  const above = new THREE.Raycaster(new THREE.Vector3(1, 1, 0), new THREE.Vector3(0, -1, 0)), below = new THREE.Raycaster(new THREE.Vector3(1, -1, 0), new THREE.Vector3(0, 1, 0));
  assert.equal(above.intersectObject(floor)[0].face!.materialIndex, 0); assert.equal(below.intersectObject(floor)[0].face!.materialIndex, 1);
  above.ray.origin.x = 0; below.ray.origin.x = 0; assert.equal(above.intersectObject(floor).length, 0); assert.equal(below.intersectObject(floor).length, 0);
  assert.deepEqual([...new Set(geometry.groups.map(group => group.materialIndex))].sort(), [0, 1, 2]);
  geometry.dispose(); materials.forEach(material => material.dispose());
});
