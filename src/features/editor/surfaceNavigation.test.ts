import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultProject } from '../../domain/project/projectDocument';
import { addLevel } from '../../domain/project/projectOperations';
import { closestSurfaceWall, surfaceMap } from './surfaceNavigation';

test('surface maps preserve proportions, centered coordinates and stable wall identities for each level', () => {
  const project = addLevel(createDefaultProject(), { copy: true }), before = structuredClone(project);
  const [lower, upper] = project.levels;
  upper.points.forEach(point => { point.x += 17; point.z -= 8; });
  const first = surfaceMap(lower), second = surfaceMap(upper);
  assert.deepEqual(first.walls.map(wall => [wall.start, wall.end]), second.walls.map(wall => [wall.start, wall.end]));
  assert.equal(first.walls[2].id, lower.walls[2].id);
  assert.equal(second.walls[2].id, upper.walls[2].id);
  assert.notEqual(first.walls[2].id, second.walls[2].id);
  const top = first.walls[0], right = first.walls[1];
  assert.equal(Math.abs(top.end.x - top.start.x) / Math.abs(right.end.z - right.start.z), 5 / 4);
  assert.equal((top.start.x + top.end.x) / 2, first.width / 2);
  assert.deepEqual(lower, before.levels[0]);
});

test('touch hit testing chooses the closest wall within a 44 pixel target instead of whichever SVG path overlaps last', () => {
  const level = createDefaultProject().levels[0], map = surfaceMap(level), top = map.walls[0];
  const middle = { x: (top.start.x + top.end.x) / 2, z: top.start.z };
  assert.equal(closestSurfaceWall(map, { ...middle, z: middle.z + 21 }, 22)?.id, top.id);
  assert.equal(closestSurfaceWall(map, { ...middle, z: middle.z + 23 }, 22), undefined);
  const corner = top.end;
  assert.equal(closestSurfaceWall(map, { x: corner.x - 10, z: corner.z + 2 }, 22)?.id, top.id);
  assert.equal(closestSurfaceWall(map, { x: corner.x - 2, z: corner.z + 10 }, 22)?.id, map.walls[1].id);
  assert.equal(closestSurfaceWall(map, { x: map.width / 2, z: map.height / 2 }, 22), undefined);
});

test('floor previews include real holes and retain separate surface ids and colors', () => {
  const level = createDefaultProject().levels[0];
  level.surfaces[0].holes.push({ id: crypto.randomUUID(), vertices: [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 }] });
  level.surfaces.push({ ...level.surfaces[0], id: crypto.randomUUID(), holes: [], finish: { color: '#123456', material: 'concrete' } });
  const map = surfaceMap(level);
  assert.equal(map.floors[0].path.match(/M /g)?.length, 2);
  assert.equal(map.floors[1].path.match(/M /g)?.length, 1);
  assert.equal(map.floors[1].id, level.surfaces[1].id);
  assert.equal(map.floors[1].color, '#123456');
});
