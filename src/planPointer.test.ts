import assert from 'node:assert/strict';
import test from 'node:test';
import { planGestureView, planGrabPosition, planPointerWorld, type PlanPointerFrame } from './planPointer';
import { snapPlanPoint } from './model';

test('the first drag follows the current SVG matrix when selection changes the layout', () => {
  const captured: PlanPointerFrame = { inverse: { a: 1.25, b: 0, c: 0, d: 1.25, e: -50, f: -100 }, view: { scale: 50, cx: 0, cz: 0 } };
  const down = { clientX: 312, clientY: 264 }, move = { clientX: 336, clientY: 288 };
  const start = planPointerWorld(down, captured), intended = planPointerWorld(move, captured);
  assert.deepEqual(start, { x: 0, z: 0 }); assert.deepEqual(intended, { x: .6, z: .6 });
  // The toolbar disappears after pointerdown; the new matrix keeps the item under the visible pointer.
  const reflowed: PlanPointerFrame = { inverse: { a: 1.2, b: 0, c: 0, d: 1.2, e: -43.2, f: -70.6 }, view: captured.view };
  const current = planPointerWorld(move, reflowed);
  assert.ok(Math.abs(current.x - .4) < 1e-10); assert.ok(Math.abs(current.z - .9) < 1e-10);
  const screenX = (current.x - reflowed.view.cx) * reflowed.view.scale + 340, screenY = (current.z - reflowed.view.cz) * reflowed.view.scale + 230;
  assert.ok(Math.abs((screenX - reflowed.inverse.e) / reflowed.inverse.a - move.clientX) < 1e-10);
  assert.ok(Math.abs((screenY - reflowed.inverse.f) / reflowed.inverse.d - move.clientY) < 1e-10);
  assert.notDeepEqual(current, intended, 'an obsolete inverse would detach the item from the visible pointer');
});

test('a captured plan frame also preserves rotated affine mapping and the initial zoom', () => {
  const frame: PlanPointerFrame = { inverse: { a: 0, b: -2, c: 2, d: 0, e: 300, f: 400 }, view: { scale: 20, cx: 5, cz: -2 } };
  const a = planPointerWorld({ clientX: 40, clientY: 30 }, frame), b = planPointerWorld({ clientX: 44, clientY: 36 }, frame);
  assert.ok(Math.abs(b.x - a.x - .6) < 1e-10); assert.ok(Math.abs(b.z - a.z + .4) < 1e-10);
});

test('a two-finger pan uses the actual letterboxed SVG transform for both axes', () => {
  // 1200 × 400 viewport: the 680 × 460 SVG is fitted by height, with horizontal margins.
  const frame: PlanPointerFrame = { inverse: { a: 1.15, b: 0, c: 0, d: 1.15, e: -350, f: 0 }, view: { scale: 50, cx: 0, cz: 0 } };
  const first = { clientX: 500, clientY: 150 }, second = { clientX: 700, clientY: 150 };
  const result = planGestureView({ clientX: 530, clientY: 190 }, { clientX: 730, clientY: 190 }, { frame, first, second });
  assert.equal(result.scale, 50); assert.ok(Math.abs(result.cx + .69) < 1e-10); assert.ok(Math.abs(result.cz + .92) < 1e-10);
});

test('pinching preserves the world point beneath the gesture center while it moves', () => {
  const frame: PlanPointerFrame = { inverse: { a: 2, b: 0, c: 0, d: 2, e: -80, f: -20 }, view: { scale: 60, cx: 2, cz: -3 } };
  const first = { clientX: 200, clientY: 140 }, second = { clientX: 260, clientY: 140 }, nextA = { clientX: 190, clientY: 170 }, nextB = { clientX: 310, clientY: 170 };
  const anchor = planPointerWorld({ clientX: 230, clientY: 140 }, frame), next = planGestureView(nextA, nextB, { frame, first, second });
  assert.equal(next.scale, 120);
  const after = planPointerWorld({ clientX: 250, clientY: 170 }, { ...frame, view: next }); assert.deepEqual(after, anchor);
});

test('wall snapping preserves the grab offset and does not jump to the pointer grid', () => {
  const anchor = { x: -2.5, z: -2 }, origin = { x: .033, z: -1.98 }, pointer = { x: .04, z: -1.98 };
  const grabbed = planGrabPosition(anchor, origin, pointer), target = snapPlanPoint(null, grabbed, { grid: true, step: .1, angles: false });
  assert.deepEqual(target, anchor); assert.ok(Math.abs(grabbed.x - anchor.x - .007) < 1e-10);
  const moved = snapPlanPoint(null, planGrabPosition(anchor, origin, { x: .247, z: -1.78 }), { grid: true, step: .1, angles: false });
  assert.deepEqual(moved, { x: -2.3, z: -1.8 });
});
