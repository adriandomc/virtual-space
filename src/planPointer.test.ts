import assert from 'node:assert/strict';
import test from 'node:test';
import { planPointerWorld, type PlanPointerFrame } from './planPointer';

test('the first drag keeps its original coordinates when selecting an item changes the SVG layout', () => {
  const captured: PlanPointerFrame = { inverse: { a: 1.25, b: 0, c: 0, d: 1.25, e: -50, f: -100 }, view: { scale: 50, cx: 0, cz: 0 } };
  const down = { clientX: 312, clientY: 264 }, move = { clientX: 336, clientY: 288 };
  const start = planPointerWorld(down, captured), intended = planPointerWorld(move, captured);
  assert.deepEqual(start, { x: 0, z: 0 }); assert.deepEqual(intended, { x: .6, z: .6 });
  // The wall toolbar disappears after pointerdown. Using its new CTM would store a different position.
  const reflowed: PlanPointerFrame = { inverse: { a: 1.2, b: 0, c: 0, d: 1.2, e: -43.2, f: -70.6 }, view: captured.view };
  const wrong = planPointerWorld(move, reflowed);
  assert.ok(Math.abs(wrong.x - .4) < 1e-10); assert.ok(Math.abs(wrong.z - .9) < 1e-10);
  assert.deepEqual(planPointerWorld(move, captured), intended, 'later pointer events use the captured frame until release');
});

test('a captured plan frame also preserves rotated affine mapping and the initial zoom', () => {
  const frame: PlanPointerFrame = { inverse: { a: 0, b: -2, c: 2, d: 0, e: 300, f: 400 }, view: { scale: 20, cx: 5, cz: -2 } };
  const a = planPointerWorld({ clientX: 40, clientY: 30 }, frame), b = planPointerWorld({ clientX: 44, clientY: 36 }, frame);
  assert.ok(Math.abs(b.x - a.x - .6) < 1e-10); assert.ok(Math.abs(b.z - a.z + .4) < 1e-10);
});
