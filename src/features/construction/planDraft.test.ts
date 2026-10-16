import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultProject, projectToRoom, updateProjectRoom } from '../../domain/project/projectDocument';
import { addHole, addLevel, addRoom, movePoint } from '../../domain/project/projectOperations';
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
