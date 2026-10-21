import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { FURNITURE_CATALOG } from '../../domain/models/furnitureCatalog';
import { addStoredFurniture, createFurnitureModel, updateFurnitureAppearance } from './furnitureRendering';
import { displayPartAt, groupDisplayGeometry } from './displayGeometry';
import { disposeContent } from './sceneResources';
import { createDefaultProject } from '../../domain/project/projectDocument';
import { scenePaintTarget, sampleScenePaintColor } from './scenePaintPicking';

test('catalogue display batches cut mesh submissions over 60% while editable originals retain every piece', () => {
  for (const quality of ['standard', 'realistic', 'hyperrealistic'] as const) {
    let originalMeshes = 0, displayMeshes = 0;
    for (const preset of FURNITURE_CATALOG) {
      const item = { id: preset.id, type: preset.type, variant: preset.id, width: preset.width, height: preset.height, depth: preset.depth, color: '#918273', material: 'wood' as const, x: 0, z: 0, rotation: 0 };
      const original = createFurnitureModel(item, quality), display = addStoredFurniture(new THREE.Group(), item, quality);
      originalMeshes += original.children.length; displayMeshes += display.children.length;
      original.updateWorldMatrix(true, true); display.updateWorldMatrix(true, true);
      const sourceBounds = new THREE.Box3().setFromObject(original), displayBounds = new THREE.Box3().setFromObject(display);
      assert(sourceBounds.min.distanceTo(displayBounds.min) < 1e-5); assert(sourceBounds.max.distanceTo(displayBounds.max) < 1e-5);
      const triangles = (root: THREE.Group) => root.children.reduce((sum, child) => { const mesh = child as THREE.Mesh; return sum + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3; }, 0);
      assert.equal(triangles(display), triangles(original));
      assert(original.children.every(child => !child.userData.displayParts), 'workshop/export retain individual definitions');
      disposeContent(original); disposeContent(display);
    }
    assert(displayMeshes <= originalMeshes * .4, `${quality}: ${displayMeshes}/${originalMeshes}`);
  }
});

test('merged hit triangles resolve their original pieces and retain furniture paint selection', () => {
  const project = createDefaultProject(), level = project.levels[0];
  const item = { id: 'item', levelId: level.id, type: 'nightstand' as const, variant: 'nightstand-classic', width: .5, height: .5, depth: .5, color: '#123456', material: 'wood' as const, x: 0, z: 0, rotation: 0 };
  level.furniture.push(item);
  const group = new THREE.Group(), material = new THREE.MeshBasicMaterial(); group.userData.selection = { kind: 'furniture', id: item.id };
  for (let index = 0; index < 2; index++) { const mesh = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, .5), material); mesh.position.x = index; mesh.name = `board-${index}`; mesh.userData.catalogPartId = String(index); group.add(mesh); }
  groupDisplayGeometry(group); group.updateWorldMatrix(true, true);
  for (let index = 0; index < 2; index++) {
    const hit = new THREE.Raycaster(new THREE.Vector3(index, 0, 2), new THREE.Vector3(0, 0, -1)).intersectObject(group, true)[0]; assert(hit);
    assert.equal(displayPartAt(hit)?.id, String(index));
    const target = scenePaintTarget(project, level.id, hit)!; assert.equal(target.selection.id, item.id);
    assert.equal(sampleScenePaintColor(project, target, hit), '#123456');
  }
  disposeContent(group);
});

test('catalogue color and material updates retain geometry and original hardware colors', () => {
  for (const quality of ['standard', 'realistic', 'hyperrealistic'] as const) {
    const item = { id: 'wardrobe', type: 'wardrobe' as const, variant: 'wardrobe-classic', width: 1.4, height: 2, depth: .6, color: '#112233', material: 'wood' as const, x: 0, z: 0, rotation: 0 };
    const display = addStoredFurniture(new THREE.Group(), item, quality), meshes = display.children as THREE.Mesh[], geometries = meshes.map(mesh => mesh.geometry), materials = meshes.map(mesh => mesh.material);
    updateFurnitureAppearance(display, { ...item, color: '#abcdef' }, quality);
    assert.deepEqual(meshes.map(mesh => mesh.geometry), geometries); assert.deepEqual(meshes.map(mesh => mesh.material), materials, 'tint uses existing material uniforms');
    for (const mesh of meshes) if (mesh.userData.furnitureMaterialRole === 'body') assert.equal((mesh.material as THREE.MeshStandardMaterial).color.getHexString(), 'abcdef');
    const hardware = meshes.filter(mesh => mesh.userData.furnitureMaterialRole === 'handles').map(mesh => mesh.material);
    updateFurnitureAppearance(display, { ...item, color: '#abcdef', material: 'metal' }, quality);
    assert.deepEqual(meshes.map(mesh => mesh.geometry), geometries); assert.deepEqual(meshes.filter(mesh => mesh.userData.furnitureMaterialRole === 'handles').map(mesh => mesh.material), hardware);
    disposeContent(display);
  }
});
