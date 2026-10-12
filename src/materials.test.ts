import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createCeilingMaterial, createFabricMaterial, createFloorMaterial, createWallMaterial, createWoodMaterial, disposeArchitecturalTextures } from './materials';
import { createDefaultRoom } from './model';
import type { FloorFinish } from './types';

test('all floor finishes construct light-reactive materials in both quality modes without browser textures', () => {
  const room = createDefaultRoom();
  const finishes: FloorFinish[] = ['wood', 'tile-grid', 'tile-brick', 'tile-checker', 'marble', 'concrete'];
  for (const floorFinish of finishes) for (const renderQuality of ['standard', 'realistic'] as const) {
    const material = createFloorMaterial({ ...room, floorFinish, renderQuality, floorColor: '#35a4c8' });
    assert.equal(material.color.getHexString(), '35a4c8');
    assert.ok(material.colorNode); assert.equal(material.lights, true);
    assert.equal(material.map, null); assert.equal(material.normalMap, null);
    if (renderQuality === 'realistic') {
      assert.ok(material instanceof THREE.MeshPhysicalNodeMaterial);
      assert.ok(material.normalNode instanceof THREE.NormalMapNode);
      assert.ok(material.roughnessNode);
    } else {
      assert.equal(material.normalNode, null);
      assert.equal(material.roughnessNode, null);
    }
    material.dispose();
  }
});

test('room rebuilds use independent materials, preserve chosen paint and support interior ceiling faces', () => {
  const wall = createWallMaterial('#123456', 'realistic');
  const ceiling = createCeilingMaterial('#abcdef', 'realistic');
  const wood = createWoodMaterial('#876543', 'realistic');
  const standard = createWallMaterial('#123456', 'standard');
  assert.equal(wall.color.getHexString(), '123456'); assert.equal(ceiling.color.getHexString(), 'abcdef');
  assert.equal(wall.side, THREE.DoubleSide); assert.equal(ceiling.side, THREE.DoubleSide);
  assert.ok(wall.normalNode); assert.ok(ceiling.normalNode); assert.ok(wood.normalNode);
  assert.equal(standard.normalNode, null);
  assert.notEqual(wall.normalNode, ceiling.normalNode);
  wall.dispose();
  assert.ok(ceiling.normalNode); assert.equal(ceiling.color.getHexString(), 'abcdef');
  ceiling.dispose(); wood.dispose(); standard.dispose();
});

test('architectural materials use photographed PBR maps with custom tint and share textures across rebuilds', () => {
  const room = createDefaultRoom();
  const finishes: FloorFinish[] = ['wood', 'tile-grid', 'tile-brick', 'tile-checker', 'marble', 'concrete'];
  const floors = finishes.map(floorFinish => createFloorMaterial({ ...room, floorFinish, renderQuality: 'hyperrealistic', floorColor: '#35a4c8' }));
  const wood = createWoodMaterial('#876543', 'hyperrealistic');
  const fabric = createFabricMaterial('#abcdef', 'hyperrealistic');
  const wall = createWallMaterial('#123456', 'hyperrealistic');
  const ceiling = createCeilingMaterial('#654321', 'hyperrealistic');
  const materials = [...floors, wood, fabric, wall, ceiling];
  for (const material of materials) {
    assert.ok(material instanceof THREE.MeshPhysicalNodeMaterial);
    assert.equal(material.lights, true);
    assert.ok(material.colorNode); assert.ok(material.normalNode); assert.ok(material.roughnessNode); assert.ok(material.aoNode);
    assert.ok(material.map); assert.ok(material.normalMap); assert.ok(material.roughnessMap);
    assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
    assert.equal(material.normalMap.colorSpace, THREE.NoColorSpace);
    assert.equal(material.roughnessMap.colorSpace, THREE.NoColorSpace);
    assert.equal(material.roughnessMap, material.aoMap);
    assert.equal(material.map.wrapS, THREE.RepeatWrapping); assert.equal(material.map.wrapT, THREE.RepeatWrapping);
    assert.match(material.map.name, /^\/materials\/(wood|plaster|stone|marble|fabric)\/color\.jpg$/);
    // Constructing materials on the server must not attempt image downloads or require a DOM.
    assert.equal(material.map.image, null);
  }
  floors.forEach(material => assert.equal(material.color.getHexString(), '35a4c8'));
  assert.equal(wall.color.getHexString(), '123456'); assert.equal(ceiling.color.getHexString(), '654321');
  assert.equal(wood.map, floors[0].map); assert.equal(wall.map, ceiling.map);
  assert.equal(wall.side, THREE.DoubleSide); assert.equal(ceiling.side, THREE.DoubleSide);
  const paintRelief = ((wall.normalNode as THREE.NormalMapNode).scaleNode as THREE.ConstNode<THREE.Vector2>).value;
  const woodRelief = ((wood.normalNode as THREE.NormalMapNode).scaleNode as THREE.ConstNode<THREE.Vector2>).value;
  assert.ok(paintRelief.x > 0 && paintRelief.x < woodRelief.x / 4, 'paint retains a finer surface than exposed wood');
  assert.equal((fabric as THREE.MeshPhysicalNodeMaterial).sheen, 0.5);
  assert.equal(floors[1].map, floors[2].map); assert.equal(floors[1].map, floors[3].map);

  const cached = new Set(materials.flatMap(material => [material.map!, material.normalMap!, material.roughnessMap!]));
  let disposed = 0;
  cached.forEach(map => map.addEventListener('dispose', () => disposed++));
  materials.forEach(material => material.dispose());
  assert.equal(disposed, 0);
  disposeArchitecturalTextures();
  assert.equal(disposed, cached.size);
  disposeArchitecturalTextures();
  assert.equal(disposed, cached.size);
  const rebuilt = createWoodMaterial('#876543', 'hyperrealistic');
  assert.notEqual(rebuilt.map, wood.map);
  rebuilt.dispose(); disposeArchitecturalTextures();
});
