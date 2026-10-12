import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createCeilingMaterial, createFloorMaterial, createWallMaterial, createWoodMaterial } from './materials';
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
