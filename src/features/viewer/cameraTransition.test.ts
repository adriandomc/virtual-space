import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Euler, Quaternion, Vector3 } from 'three';
import { createCameraTransition, sampleCameraTransition } from './cameraTransition';

const pose = (x: number, y: number, z: number, yaw = 0) => ({ position: new Vector3(x, y, z), quaternion: new Quaternion().setFromEuler(new Euler(0, yaw, 0, 'YXZ')) });

test('camera travel has exact endpoints, smooth intermediate positions, and no overshoot', () => {
  const from = pose(-8, 7, 9, Math.PI / 2), to = pose(0, 1.65, 0), camera = pose(0, 0, 0);
  const transition = createCameraTransition(from, to, 100, 1100);
  assert.equal(sampleCameraTransition(transition, 50, camera), false);
  assert.deepEqual(camera, from);
  sampleCameraTransition(transition, 650, camera);
  assert.ok(camera.position.distanceTo(from.position.clone().lerp(to.position, 0.5)) < 1e-12);
  assert.ok(camera.quaternion.angleTo(from.quaternion.clone().slerp(to.quaternion, 0.5)) < 1e-7);
  let lastDistance = camera.position.distanceTo(to.position);
  for (let now = 660; now <= 1200; now += 10) {
    sampleCameraTransition(transition, now, camera);
    const distance = camera.position.distanceTo(to.position);
    assert.ok(Number.isFinite(distance) && distance <= lastDistance);
    lastDistance = distance;
  }
  assert.equal(sampleCameraTransition(transition, 2000, camera), true);
  assert.deepEqual(camera, to);
  sampleCameraTransition(transition, 101, camera);
  assert.ok(camera.position.distanceTo(from.position) < 1e-6);
  sampleCameraTransition(transition, 1199, camera);
  assert.ok(camera.position.distanceTo(to.position) < 1e-6);
});

test('retargeting captures the current pose, preserving continuity during rapid step changes', () => {
  const orbit = pose(-8, 7, 9, Math.PI / 2), walk = pose(0, 1.65, 0), camera = pose(0, 0, 0);
  sampleCameraTransition(createCameraTransition(orbit, walk, 0), 390, camera);
  const interrupted = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
  const returning = createCameraTransition(camera, orbit, 390);
  camera.position.set(100, 100, 100);
  camera.quaternion.identity();
  assert.equal(sampleCameraTransition(returning, 390, camera), false);
  assert.deepEqual(camera, interrupted);
  assert.equal(sampleCameraTransition(returning, 1490, camera), true);
  assert.deepEqual(camera, orbit);
});
