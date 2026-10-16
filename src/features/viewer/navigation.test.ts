import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDefaultRoom } from '../../domain/project/model';
import { daylightFactor, daylightOpeningArea, joystickVector, renderPixelRatio } from './navigation';

test('render density normalizes fractional device ratios and keeps desktop/mobile limits', () => {
  assert.equal(renderPixelRatio(1.0000000298, 'hyperrealistic', true), 1);
  assert.equal(renderPixelRatio(1.49999997, 'hyperrealistic', false), 1.5);
  assert.equal(renderPixelRatio(3, 'hyperrealistic', true), 1.75);
  assert.equal(renderPixelRatio(3, 'realistic', true), 2);
  assert.equal(renderPixelRatio(3, 'hyperrealistic', false), 1.5);
  assert.equal(renderPixelRatio(1.25, 'hyperrealistic', true), 1.25);
});

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

test('daylight enters windows, open doors, and empty frames, but not closed door leaves', () => {
  const room = createDefaultRoom();
  const door = { id: 'closed', type: 'door' as const, wall: 0, offset: 0, width: 1, height: 2, sill: 0 };
  room.openings = [
    { ...door, id: 'window', type: 'window', width: 1.5, height: 1 },
    { ...door, open: false, doorStyle: 'right' },
    { ...door, id: 'open', open: true, doorStyle: 'left' },
    { ...door, id: 'frame', doorStyle: 'frame' },
  ];
  assert.equal(daylightOpeningArea(room), 5.5);
  assert.equal(daylightOpeningArea({ ...room, openings: [room.openings[1]] }), 0);
  assert.equal(daylightOpeningArea({ ...room, openings: [{ ...room.openings[1], open: true }] }), 2);
  assert.equal(daylightOpeningArea({ ...room, openings: [] }), 0);
});
