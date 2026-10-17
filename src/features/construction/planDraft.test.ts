import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultProject, projectToRoom, updateProjectRoom } from '../../domain/project/projectDocument';
import { addHole, addLevel, addRoom, addStair, movePoint } from '../../domain/project/projectOperations';
import { addFurniture } from '../../domain/project/model';
import { applyPlanMove, containingFloor, planUpdateActivityReason, samePlanBase, type PlanMoveIntent } from './planDraft';

test('resuming a pending move preserves current finishes and changes on other floors', () => {
  const base = addLevel(createDefaultProject(), { copy: true }), levelId = base.levels[0].id, vertex = base.levels[0].points[0];
  const latest = structuredClone(base); latest.levels[0].walls[0].left.color = '#123456'; latest.levels[1].points[0].x -= .2;
  const intent: PlanMoveIntent = { kind: 'point', id: vertex.id, position: { x: vertex.x - .2, z: vertex.z } };
  assert(samePlanBase(base, latest, levelId, intent));
  const result = applyPlanMove(latest, levelId, intent);
  assert.equal(result.levels[0].walls[0].left.color, '#123456'); assert.equal(result.levels[1].points[0].x, latest.levels[1].points[0].x);
  assert.equal(base.levels[0].points[0].x, vertex.x);
});

test('changed structural bases and independently moved items cannot be overwritten by old drag intents', () => {
  let base = createDefaultProject(); const levelId = base.activeLevelId;
  base = updateProjectRoom(base, levelId, addFurniture(projectToRoom(base), 'nightstand', 'double', 'nightstand-classic'));
  const id = base.levels[0].furniture[0].id, intent: PlanMoveIntent = { kind: 'item', selection: { kind: 'furniture', id }, position: { x: 1, z: 1 } };
  const moved = structuredClone(base); moved.levels[0].furniture[0].x += .2; assert.equal(samePlanBase(base, moved, levelId, intent), false);
  const painted = structuredClone(base); painted.levels[0].furniture[0].color = '#334455'; assert(samePlanBase(base, painted, levelId, intent));
  const result = applyPlanMove(painted, levelId, intent); assert.equal(result.levels[0].furniture[0].color, '#334455');
  const structural = movePoint(base, levelId, base.levels[0].points[0].id, { x: -2.6, z: -2 }); assert.equal(samePlanBase(base, structural, levelId, intent), false);
});

test('a hole is placed into its containing floor region instead of the first floor', () => {
  let project = createDefaultProject(); const levelId = project.activeLevelId;
  project = addRoom(project, levelId, [{ x: 2.5, z: -1 }, { x: 4, z: -1 }, { x: 4, z: 1 }, { x: 2.5, z: 1 }]);
  const vertices = [{ x: 3, z: -.3 }, { x: 3.5, z: -.3 }, { x: 3.5, z: .3 }, { x: 3, z: .3 }], surface = containingFloor(project, levelId, vertices)!;
  assert(surface); assert.notEqual(surface.id, project.levels[0].surfaces.find(item => item.kind === 'floor')!.id);
  const result = addHole(project, levelId, surface.id, vertices); assert.equal(result.levels[0].surfaces.find(item => item.id === surface.id)!.holes.length, 1);
  assert.equal(containingFloor(project, levelId, vertices.map(point => ({ x: point.x + 50, z: point.z }))), undefined);
});

test('object key order in a server acknowledgement is not a structural conflict', () => {
  const base = createDefaultProject(), reordered = JSON.parse(JSON.stringify(base), (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value);
  assert(samePlanBase(base, reordered, base.activeLevelId));
});

test('unfinished plan tools block an update synchronously, while a released valid move can flush', () => {
  const idle = { points: 0, uploading: false, archived: 0, pointers: 0, dragging: false, pending: false, blocked: false };
  assert.equal(planUpdateActivityReason(idle), '');
  for (const active of [{ points: 1 }, { uploading: true }, { archived: 1 }, { pointers: 1 }, { dragging: true }]) {
    assert.match(planUpdateActivityReason({ ...idle, ...active }), /borrador/);
  }
  assert.equal(planUpdateActivityReason({ ...idle, pending: true }), '', 'the update flush phase may persist a released valid movement');
  assert.match(planUpdateActivityReason({ ...idle, pending: true, blocked: true }), /movimiento pendiente/);
});

test('plan stair moves keep their linked upper floor opening in the same operation for every shape', () => {
  for (const type of ['straight', 'landing', 'l', 'u', 'spiral'] as const) {
    const levels = addLevel(createDefaultProject(), { copy: true });
    const base = addStair(levels, { fromLevelId: levels.levels[0].id, toLevelId: levels.levels[1].id, type, run: 3.4 });
    const stair = base.stairs[0], hole = base.levels[1].surfaces.flatMap(surface => surface.holes)[0];
    const intent: PlanMoveIntent = { kind: 'stair', id: stair.id, position: { x: stair.x + .1, z: stair.z + .1 } };
    for (const level of base.levels) {
      assert(samePlanBase(base, base, level.id, intent));
      const moved = applyPlanMove(base, level.id, intent), movedHole = moved.levels[1].surfaces.flatMap(surface => surface.holes)[0];
      assert.equal(moved.stairs[0].x, stair.x + .1); assert.equal(moved.stairs[0].z, stair.z + .1);
      assert.equal(movedHole.id, hole.id); assert.equal(movedHole.stairId, stair.id);
      for (const axis of ['x', 'z'] as const) for (const extent of [Math.min, Math.max]) assert(Math.abs(extent(...movedHole.vertices.map(point => point[axis])) - extent(...hole.vertices.map(point => point[axis])) - .1) < 1e-9, type + ' moves the hole by the same delta');
      assert.equal(base.stairs[0].x, stair.x); assert.deepEqual(base.levels[1].surfaces.flatMap(surface => surface.holes)[0], hole);
    }
    assert.throws(() => applyPlanMove(base, base.levels[0].id, { ...intent, position: { x: 100, z: 0 } }));
    assert.deepEqual(base.levels[1].surfaces.flatMap(surface => surface.holes)[0], hole, 'invalid drags never partly move an opening');
  }
});

test('a pending plan stair drag checks both connected floors without blocking unrelated finishes or levels', () => {
  const levels = addLevel(addLevel(createDefaultProject(), { copy: true }), { copy: true });
  const base = addStair(levels, { fromLevelId: levels.levels[0].id, toLevelId: levels.levels[1].id, run: 3.4 });
  const stair = base.stairs[0], intent: PlanMoveIntent = { kind: 'stair', id: stair.id, position: { x: stair.x + .1, z: stair.z } };
  const changedUpper = structuredClone(base); changedUpper.levels[1].points[0].x -= .1;
  assert.equal(samePlanBase(base, changedUpper, base.levels[0].id, intent), false);
  const changedLower = structuredClone(base); changedLower.levels[0].height += .1;
  assert.equal(samePlanBase(base, changedLower, base.levels[1].id, intent), false);
  const changedHole = structuredClone(base); changedHole.levels[1].surfaces.flatMap(surface => surface.holes)[0].vertices[0].x += .1;
  assert.equal(samePlanBase(base, changedHole, base.levels[0].id, intent), false);
  const latest = structuredClone(base); latest.levels[2].points[0].x -= .1; latest.stairs[0].finish.color = '#223344';
  assert(samePlanBase(base, latest, base.levels[0].id, intent));
  const moved = applyPlanMove(latest, base.levels[0].id, intent);
  assert.equal(moved.stairs[0].finish.color, '#223344'); assert.equal(moved.levels[2].points[0].x, latest.levels[2].points[0].x);
  const removed = structuredClone(base); removed.stairs = [];
  assert.equal(samePlanBase(base, removed, base.levels[0].id, intent), false);
  assert.equal(samePlanBase(removed, base, base.levels[0].id, intent), false);
});
