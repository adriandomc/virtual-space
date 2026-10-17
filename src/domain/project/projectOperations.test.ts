import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProject, levelOutline, projectToRoom, signedRingArea, validateProjectDocument } from './projectDocument.js';
import { addLevel, addRoom, addStair, addWall, deleteStair, deleteWall, movePoint, ProjectHistory, splitWall, updateHole, updateStair } from './projectOperations.js';

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

test('moving and rotating every stair shape carries its custom upper-floor opening without changing its identity', () => {
  for (const type of ['straight', 'landing', 'l', 'u', 'spiral'] as const) {
    const base = createDefaultProject(); base.levels[0].points.forEach(point => { point.x *= 4; point.z *= 4; });
    let project = addLevel(base, { copy: true });
    project = addStair(project, { fromLevelId: project.levels[0].id, toLevelId: project.levels[1].id, type, x: -1, z: -2, rotation: 25 });
    const upper = project.levels[1], floor = upper.surfaces[0], hole = floor.holes[0];
    project = updateHole(project, upper.id, floor.id, hole.id, hole.vertices);
    const source = structuredClone(project), stair = project.stairs[0];
    const moved = updateStair(project, stair.id, { x: 1, z: -1, rotation: 115 }), opening = moved.levels[1].surfaces[0].holes[0];
    assert.equal(opening.id, hole.id); assert.equal(opening.stairId, stair.id);
    assert.deepEqual(opening.vertices, moved.stairs[0].hole);
    hole.vertices.forEach((point, index) => {
      assert(Math.abs(opening.vertices[index].x - (1 + point.z - stair.z)) < 1e-9);
      assert(Math.abs(opening.vertices[index].z - (-1 - point.x + stair.x)) < 1e-9);
    });
    assert.deepEqual(moved.levels[0], project.levels[0]);
    assert.deepEqual(project, source); validateProjectDocument(moved);
    const painted = updateStair(moved, stair.id, { finish: { ...stair.finish, color: '#aabbcc' } });
    assert.deepEqual(painted.stairs[0].hole, moved.stairs[0].hole);
    const returned = updateStair(moved, stair.id, { x: stair.x, z: stair.z, rotation: stair.rotation });
    returned.stairs[0].hole!.forEach((point, index) => { assert(Math.hypot(point.x - hole.vertices[index].x, point.z - hole.vertices[index].z) < 1e-9); });
    const beforeInvalid = structuredClone(moved);
    assert.throws(() => updateStair(moved, stair.id, { x: 49, z: 49 }), /hueco|superficie/);
    assert.deepEqual(moved, beforeInvalid);
  }
});

test('stair placement preserves explicit custom-hole replacement and automatic-hole generation', () => {
  const base = createDefaultProject(); base.levels[0].points.forEach(point => { point.x *= 4; point.z *= 4; });
  let project = addLevel(base, { copy: true });
  project = addStair(project, { fromLevelId: project.levels[0].id, toLevelId: project.levels[1].id, type: 'spiral', x: 0, z: 0, rotation: 0 });
  const stair = project.stairs[0], floor = project.levels[1].surfaces[0], hole = floor.holes[0];
  const automatic = updateStair(project, stair.id, { x: 2, z: 1, rotation: 90 });
  assert.equal(automatic.stairs[0].hole, null);
  hole.vertices.forEach((point, index) => {
    const target = automatic.levels[1].surfaces[0].holes[0].vertices[index];
    assert(Math.hypot(target.x - (2 + point.z), target.z - (1 - point.x)) < 1e-9);
  });
  project = updateHole(project, project.levels[1].id, floor.id, hole.id, hole.vertices);
  const replacement = [{ x: 2, z: 2 }, { x: 4, z: 2 }, { x: 4, z: 4 }, { x: 2, z: 4 }];
  const replaced = updateStair(project, stair.id, { x: 3, z: 3, rotation: 90, hole: replacement });
  assert.deepEqual(replaced.stairs[0].hole, replacement);
  assert.deepEqual(replaced.levels[1].surfaces[0].holes[0].vertices, replacement);
  assert.equal(replaced.levels[1].surfaces[0].holes[0].id, hole.id);
  const reset = updateStair(replaced, stair.id, { hole: null });
  assert.equal(reset.stairs[0].hole, null);
  assert.notDeepEqual(reset.levels[1].surfaces[0].holes[0].vertices, replacement);
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
