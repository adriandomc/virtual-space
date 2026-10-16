import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProject, levelOutline, projectToRoom, signedRingArea, validateProjectDocument } from './projectDocument.js';
import { addLevel, addRoom, addStair, addWall, deleteStair, deleteWall, movePoint, ProjectHistory, splitWall, updateHole } from './projectOperations.js';

test('wall insertion splits topology with stable opening references and preserves ordinary objects', () => {
  const project = createDefaultProject(), level = project.levels[0], wall = level.walls[0];
  level.openings.push({ id: crypto.randomUUID(), levelId: level.id, wallId: wall.id, type: 'window', width: .6, height: .8, sill: 1, offset: 3 });
  const next = addWall(project, level.id, { x: 0, z: -2 }, { x: 0, z: 2 }), changed = next.levels[0];
  assert.equal(changed.walls.length, 7); const opening = changed.openings[0], newWall = changed.walls.find(w => w.id === opening.wallId)!;
  assert.notEqual(newWall.id, wall.id); assert(Math.abs(opening.offset - .5) < 1e-6); assert.equal(project.levels[0].walls.length, 4); validateProjectDocument(next);
  assert.throws(() => splitWall(project, level.id, wall.id, .65), /atravesaría/);
});

test('additive rooms retain the previous floor plan, partition surfaces and existing wall IDs', () => {
  const original = createDefaultProject(), id = original.levels[0].id, ids = original.levels[0].walls.map(w => w.id);
  const expanded = addRoom(original, id, [{ x: 2.5, z: -1 }, { x: 4.5, z: -1 }, { x: 4.5, z: 1 }, { x: 2.5, z: 1 }]);
  assert.equal(Math.abs(signedRingArea(levelOutline(expanded.levels[0]))), 24); ids.forEach(id => assert(expanded.levels[0].walls.some(w => w.id === id))); assert.equal(expanded.levels[0].lights[0].id, original.levels[0].lights[0].id);
  const partitioned = addRoom(original, id, [{ x: -.5, z: -.5 }, { x: .5, z: -.5 }, { x: .5, z: .5 }, { x: -.5, z: .5 }]);
  assert.equal(partitioned.levels[0].surfaces.length, 2); assert(partitioned.levels[0].surfaces.some(s => s.holes.length === 1));
});

test('an invalid structural operation leaves the entire document and history unchanged', () => {
  const project = createDefaultProject(), history = new ProjectHistory(project), level = project.levels[0];
  assert.throws(() => history.apply(p => movePoint(p, level.id, level.outline[0], { x: 100, z: 0 })));
  assert.deepEqual(history.value, project); assert.equal(history.canUndo, false);
  history.apply(p => addWall(p, level.id, { x: 0, z: -2 }, { x: 0, z: 2 })); assert(history.canUndo); assert.equal(history.value.levels[0].walls.length, 7);
  assert.deepEqual(history.undo(), project); assert.equal(history.redo().levels[0].walls.length, 7);
});

test('copy structure never duplicates furniture, openings or lights and generated stair holes can be edited', () => {
  let project = addLevel(createDefaultProject(), { copy: true }); assert.equal(project.levels[1].walls.length, 4); assert.equal(project.levels[1].lights.length, 0); assert.equal(project.levels[1].openings.length, 0);
  project = addStair(project, { fromLevelId: project.levels[0].id, toLevelId: project.levels[1].id });
  const level = project.levels[1], floor = level.surfaces[0], hole = floor.holes[0], vertices = hole.vertices.map(p => ({ x: p.x, z: p.z * 1.1 }));
  const changed = updateHole(project, level.id, floor.id, hole.id, vertices); assert.deepEqual(changed.stairs[0].hole, vertices);
  const removed = deleteStair(changed, changed.stairs[0].id); assert.equal(removed.stairs.length, 0); assert.equal(removed.levels[1].surfaces[0].holes.length, 0); assert.equal(projectToRoom(removed).furniture.length, 0);
});

test('deleting walls prunes only unused points and empty levels contain only their outline points', () => {
  const base = createDefaultProject(), levelId = base.levels[0].id;
  base.levels[0].openings.push({ id: crypto.randomUUID(), levelId, wallId: base.levels[0].walls[0].id, type: 'window', width: .6, height: .8, sill: 1, offset: .3 });
  let project = addWall(base, levelId, { x: -1, z: -.4 }, { x: -.3, z: -.4 }); const first = project.levels[0].walls.at(-1)!;
  project = addWall(project, levelId, { x: -.3, z: -.4 }, { x: .5, z: .4 }); const second = project.levels[0].walls.at(-1)!;
  project = deleteWall(project, levelId, first.id);
  assert(!project.levels[0].points.some(point => point.id === first.startId)); assert(project.levels[0].points.some(point => point.id === first.endId)); assert(project.levels[0].walls.some(wall => wall.id === second.id));
  assert.deepEqual(project.levels[0].openings, base.levels[0].openings); assert.deepEqual(project.levels[0].surfaces, base.levels[0].surfaces);
  project = deleteWall(project, levelId, second.id); assert.deepEqual(project.levels[0].points, base.levels[0].points);
  const partitioned = addRoom(base, levelId, [{ x: -.6, z: -.6 }, { x: .6, z: -.6 }, { x: .6, z: .6 }, { x: -.6, z: .6 }]);
  const outerWallIds = new Set(base.levels[0].walls.map(wall => wall.id)); project = partitioned;
  for (const wall of partitioned.levels[0].walls.filter(wall => !outerWallIds.has(wall.id))) project = deleteWall(project, levelId, wall.id);
  assert.deepEqual(project.levels[0].surfaces, partitioned.levels[0].surfaces); assert.deepEqual(project.levels[0].points, partitioned.levels[0].points); assert.deepEqual(project.levels[0].openings, base.levels[0].openings);
  const empty = addLevel(partitioned, { copy: false }); assert.equal(empty.levels[1].points.length, empty.levels[1].outline.length); assert(empty.levels[1].points.every(point => empty.levels[1].outline.includes(point.id)));
  assert.deepEqual(empty.levels[0], partitioned.levels[0]); assert.equal(empty.levels[1].surfaces.length, 1); assert.equal(empty.levels[1].walls.length, 0); validateProjectDocument(empty);
});
