import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daylightFactor, joystickVector } from './navigation';

test('joystick preserves analog speed, ignores tiny movement, and caps diagonal speed', () => {
  assert.deepEqual(joystickVector(0.04, -0.03), { x: 0, z: 0 });
  assert.deepEqual(joystickVector(0.3, -0.4), { x: 0.3, z: -0.4 });
  assert.deepEqual(joystickVector(2, 0), { x: 1, z: 0 });
  const diagonal = joystickVector(3, -4);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.z) - 1) < 1e-12);
  assert.equal(diagonal.x, 0.6);
  assert.equal(diagonal.z, -0.8);
  assert.deepEqual(joystickVector(-3, 4), { x: -0.6, z: 0.8 });
});

test('indirect daylight requires openings, follows the day, and saturates for large openings', () => {
  assert.equal(daylightFactor(1, 0, 20), 0);
  assert.equal(daylightFactor(0, 4, 20), 0);
  assert.equal(daylightFactor(0.8, 1, 20), 0.2);
  assert.equal(daylightFactor(0.8, 10, 20), 0.8);
});
