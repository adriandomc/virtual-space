import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { applyPresentationLayers } from './scenePresentationLayers';

test('unchanged layer visibility does not visit every descendant on another frame', () => {
  const root = new THREE.Group().add(new THREE.Group().add(new THREE.Object3D()));
  let visits = 0;
  const mask = () => { visits++; return 2; };
  assert.equal(applyPresentationLayers(root, 'hidden', mask), true); assert.equal(visits, 3);
  for (let frame = 0; frame < 120; frame++) assert.equal(applyPresentationLayers(root, 'hidden', mask), false);
  assert.equal(visits, 3);
  assert.equal(applyPresentationLayers(root, 'visible', () => 1), true);
  root.traverse(object => assert.equal(object.layers.mask, 1));
});

test('late async model descendants and replaced wall bundles invalidate unchanged root identities', () => {
  const root = new THREE.Group(), bundle = new THREE.Group(), model = new THREE.Group();
  root.add(bundle); bundle.add(model);
  applyPresentationLayers(root, 'hidden', () => 2);
  const late = new THREE.Group().add(new THREE.Object3D()); model.add(late);
  assert.equal(applyPresentationLayers(root, 'hidden', () => 2), true);
  late.traverse(object => assert.equal(object.layers.mask, 2));
  root.remove(bundle); root.add(new THREE.Group().add(new THREE.Object3D()));
  assert.equal(applyPresentationLayers(root, 'hidden', () => 2), true);
  bundle.add(new THREE.Object3D());
  assert.equal(applyPresentationLayers(root, 'hidden', () => 2), false, 'detached subtrees no longer invalidate the former owner');
  root.add(bundle); assert.equal(applyPresentationLayers(root, 'hidden', () => 2), true);
  root.traverse(object => assert.equal(object.layers.mask, 2));
});

test('base shadow masks and ceiling override changes survive visibility caching', () => {
  const root = new THREE.Group(), floor = new THREE.Object3D(), shadow = new THREE.Object3D();
  shadow.layers.set(1); root.add(floor, shadow);
  const apply = (key: string, visible: boolean) => applyPresentationLayers(root, key, object => {
    object.userData.baseLayerMask ??= object.layers.mask; return visible ? object.userData.baseLayerMask : 2;
  });
  apply('hidden:ceiling-a', false); floor.layers.set(0);
  assert.equal(apply('hidden:ceiling-a', false), false); assert.equal(floor.layers.mask, 1);
  apply('hidden:ceiling-b', false); assert.equal(floor.layers.mask, 2);
  apply('visible', true); assert.equal(floor.layers.mask, 1); assert.equal(shadow.layers.mask, 2);
});
