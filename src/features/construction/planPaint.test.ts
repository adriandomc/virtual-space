import assert from 'node:assert/strict';
import test from 'node:test';
import { addFurniture, addOpening } from '../../domain/project/model';
import { createDefaultProject, projectToRoom, updateProjectRoom } from '../../domain/project/projectDocument';
import { addLevel, addStair } from '../../domain/project/projectOperations';
import { planPaintTarget } from './planPaint';

function sample() {
  let project = createDefaultProject();
  project = updateProjectRoom(project, project.activeLevelId, addFurniture(addOpening(projectToRoom(project), 'door', 0, { width: .9, height: 2 }), 'bed'));
  project = addLevel(project, { copy: true });
  return addStair(project, { fromLevelId: project.levels[0].id, toLevelId: project.levels[1].id, run: 3.4 });
}

test('plan paint resolves floors, both wall sides and every visible item category through stable identifiers', () => {
  const project = sample(), level = project.levels[0], id = level.id, before = structuredClone(project);
  assert.deepEqual(planPaintTarget(project, id, { planSurface: level.surfaces[0].id }, 'left'), { levelId: id, selection: { kind: 'floor', id: level.surfaces[0].id } });
  assert.deepEqual(planPaintTarget(project, id, { planWall: level.walls[2].id }, 'right'), { levelId: id, selection: { kind: 'wall', index: 2, id: level.walls[2].id }, wallSide: 'right' });
  for (const [kind, items] of [['furniture', level.furniture], ['opening', level.openings], ['light', level.lights]] as const) {
    assert.deepEqual(planPaintTarget(project, id, { planItem: items[0].id }, 'left'), { levelId: id, selection: { kind, id: items[0].id } });
  }
  for (const level of project.levels) assert.deepEqual(planPaintTarget(project, level.id, { planStair: project.stairs[0].id }, 'left'), { levelId: level.id, selection: { kind: 'stair', id: project.stairs[0].id } });
  assert.deepEqual(project, before);
});

test('plan paint never falls back to another surface for holes, absent ids or items on another level', () => {
  const project = sample(), [lower, upper] = project.levels;
  assert.equal(planPaintTarget(project, upper.id, { planHole: 'hole', planSurface: upper.surfaces[0].id }, 'left'), null);
  assert.equal(planPaintTarget(project, upper.id, { planWall: lower.walls[0].id }, 'left'), null);
  assert.equal(planPaintTarget(project, upper.id, { planItem: lower.furniture[0].id }, 'left'), null);
  assert.equal(planPaintTarget(project, upper.id, { planItem: lower.openings[0].id }, 'left'), null);
  assert.equal(planPaintTarget(project, upper.id, { planItem: lower.lights[0].id }, 'left'), null);
  assert.equal(planPaintTarget(project, lower.id, { planSurface: 'deleted-floor' }, 'left'), null);
  assert.equal(planPaintTarget(project, lower.id, { planStair: 'deleted-stair' }, 'left'), null);
  assert.equal(planPaintTarget(project, 'deleted-level', { planWall: lower.walls[0].id }, 'left'), null);
  assert.equal(planPaintTarget(project, lower.id, {}, 'left'), null);
});
