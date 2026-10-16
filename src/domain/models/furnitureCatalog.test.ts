import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { buildCatalogGeometry, getCatalogParts } from '../../features/viewer/catalogGeometry';
import { FURNITURE_CATALOG, getFurniturePreset, isFurnitureVariant } from './furnitureCatalog';

test('each category contains at least ten distinct validated models', () => {
  assert.equal(new Set(FURNITURE_CATALOG.map(item => item.id)).size, FURNITURE_CATALOG.length);
  for (const type of ['wardrobe', 'vanity', 'nightstand']) {
    const presets = FURNITURE_CATALOG.filter(item => item.type === type);
    assert.ok(presets.length >= 10);
    assert.equal(new Set(presets.map(item => JSON.stringify(getCatalogParts(type, item.id)))).size, presets.length);
    for (const preset of presets) {
      assert.ok(isFurnitureVariant(type, preset.id));
      assert.equal(getFurniturePreset(type, preset.id), preset);
      assert.ok(preset.width > 0 && preset.height > 0 && preset.depth > 0);
    }
  }
  assert.equal(isFurnitureVariant('wardrobe', 'vanity-round'), false);
  assert.equal(isFurnitureVariant('bed', 'wardrobe-classic'), false);
  for (const value of [null, {}, [], 1, '__proto__', 'missing']) assert.equal(isFurnitureVariant('wardrobe', value), false);
  assert.equal(getFurniturePreset('wardrobe'), undefined);
  assert.equal(getFurniturePreset('custom'), undefined);
});

test('all catalog models have bounded finite geometry, normals and texture coordinates in each shader mode', () => {
  const materials = { body: new THREE.MeshStandardMaterial(), face: new THREE.MeshStandardMaterial(), handles: new THREE.MeshStandardMaterial() };
  const sizes = [[0.15, 0.15, 0.1], [4, 0.2, 0.25], [0.25, 4, 3]];
  for (const quality of ['standard', 'realistic', 'hyperrealistic'] as const) for (const preset of FURNITURE_CATALOG) for (const dimensions of [[preset.width, preset.height, preset.depth], ...sizes]) {
    const [width, height, depth] = dimensions;
    const group = new THREE.Group();
    assert.equal(buildCatalogGeometry(group, { type: preset.type, variant: preset.id, width, height, depth }, materials, quality), true);
    group.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(group), epsilon = 0.00001;
    assert.ok(box.min.x >= -width / 2 - epsilon && box.max.x <= width / 2 + epsilon, `${preset.id}: horizontal bounds ${box.min.x}, ${box.max.x}`);
    assert.ok(box.min.y >= -epsilon && box.max.y <= height + epsilon, `${preset.id}: height bounds ${box.min.y}, ${box.max.y}`);
    assert.ok(box.min.z >= -depth / 2 - epsilon && box.max.z <= depth / 2 + epsilon, `${preset.id}: depth bounds ${box.min.z}, ${box.max.z}`);
    const extras = new Set<THREE.Material>();
    group.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const name of ['position', 'normal', 'uv']) for (const value of object.geometry.getAttribute(name).array) assert.ok(Number.isFinite(value), `${preset.id}: finite ${name}`);
      assert.ok(object.receiveShadow);
      object.geometry.dispose();
      if (!Object.values(materials).includes(object.material)) extras.add(object.material);
    });
    extras.forEach(material => material.dispose());
  }
  Object.values(materials).forEach(material => material.dispose());
});

test('invalid catalog variants do not create scene objects', () => {
  const group = new THREE.Group(), material = new THREE.MeshStandardMaterial();
  assert.equal(buildCatalogGeometry(group, { type: 'wardrobe', variant: 'missing', width: 1, height: 2, depth: .5 }, { body: material, face: material, handles: material }, 'standard'), false);
  assert.equal(group.children.length, 0);
  material.dispose();
});
