import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { configurePointLightShadow } from './sceneLightShadows';

test('changing shadow size retains the light and renderer-owned target', () => {
  const parent = new THREE.Group(), light = new THREE.PointLight(); parent.add(light); light.castShadow = true;
  const target = new THREE.WebGLRenderTarget(); light.shadow.map = target; let disposed = 0; target.addEventListener('dispose', () => disposed++);
  const same = configurePointLightShadow(light, true, 1024);
  assert.equal(same, light); assert.equal(same.shadow.map, target); assert.equal(disposed, 0);
  assert.equal(same.shadow.mapSize.x, 1024); assert.equal(same.shadow.needsUpdate, true);
  same.shadow.needsUpdate = false; configurePointLightShadow(same, true, 1024); assert.equal(same.shadow.needsUpdate, false);
  target.dispose();
});

test('switching a bulb or its shadow budget replaces only its analytic light identity', () => {
  const fixture = new THREE.Group(), bulb = new THREE.Mesh(), light = new THREE.PointLight('#ffeebb', 90, 12, 2);
  fixture.add(bulb, light); light.castShadow = true; light.position.set(1, 2, 3); light.shadow.autoUpdate = false; light.shadow.camera.layers.enable(1); light.shadow.bias = -.001;
  const map = new THREE.WebGLRenderTarget(); light.shadow.map = map; let disposed = 0; map.addEventListener('dispose', () => disposed++);
  const off = configurePointLightShadow(light, false, 512);
  assert.notEqual(off.uuid, light.uuid); assert.equal(light.castShadow, true, 'old material nodes never observe an in-place castShadow change');
  assert.equal(light.parent, null); assert.equal(off.parent, fixture); assert.equal(bulb.parent, fixture); assert.equal(disposed, 1);
  assert.equal(off.shadow.map, null); assert.equal(off.castShadow, false); assert.equal(off.intensity, 90); assert.equal(off.color.getHexString(), 'ffeebb');
  assert.deepEqual(off.position.toArray(), [1, 2, 3]); assert.equal(off.shadow.autoUpdate, false); assert.equal(off.shadow.camera.layers.mask, light.shadow.camera.layers.mask); assert.equal(off.shadow.bias, -.001);
  const on = configurePointLightShadow(off, true, 1024);
  assert.notEqual(on.uuid, off.uuid); assert.equal(off.castShadow, false); assert.equal(on.castShadow, true); assert.equal(on.shadow.needsUpdate, true);
  assert.deepEqual(fixture.children, [bulb, on]); bulb.geometry.dispose(); (bulb.material as THREE.Material).dispose();
});
