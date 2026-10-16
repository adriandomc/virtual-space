import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProject, type ParametricRoof, type ProjectDocument } from '../../domain/project/projectDocument.js';
import { addLevel, addStair, addWall, setLevelHeight } from '../../domain/project/projectOperations.js';
import { buildStairGeometry } from '../../domain/project/projectGeometry.js';
import { ArchitecturalNavigation, type WalkState } from './architecturalNavigation.js';

function stairProject(type: 'straight' | 'landing' | 'l' | 'u' | 'spiral'): ProjectDocument {
  let project = createDefaultProject(); project.levels[0].points.forEach(p => { p.x *= 4; p.z *= 4; });
  if (type === 'spiral') project = setLevelHeight(project, project.levels[0].id, 4.8);
  project = addLevel(project, { copy: true });
  return addStair(project, { type, fromLevelId: project.levels[0].id, toLevelId: project.levels[1].id, x: 0, z: 0, rotation: 0, ...(type === 'spiral' ? { turns: 2 } : {}) });
}

test('all five stairs support continuous ascent and descent without jumping between overlapped turns', () => {
  for (const type of ['straight', 'landing', 'l', 'u', 'spiral'] as const) {
    const project = stairProject(type), geometry = buildStairGeometry(project, project.stairs[0]), navigation = new ArchitecturalNavigation(project);
    let state = navigation.start(project.levels[0].id, geometry.path[0])!; assert(state);
    const walkTo = (end: { x: number; z: number }) => { const count = Math.max(1, Math.ceil(Math.hypot(end.x - state.x, end.z - state.z) / .025)); for (let i = 0; i < count; i++) { const before = state.y; state = navigation.move(state, { x: (end.x - state.x) / (count - i), z: (end.z - state.z) / (count - i) }); assert(!state.blocked, `${type} traversal blocked at ${state.x}, ${state.z}`); assert(Math.abs(state.y - before) < .1, `${type} jumped vertically`); } };
    geometry.path.slice(1).forEach(walkTo); assert(Math.abs(state.y - project.levels[1].elevation) < 1e-6); assert.equal(state.levelId, project.levels[1].id);
    [...geometry.path].reverse().slice(1).forEach(walkTo); assert(Math.abs(state.y) < 1e-6);
  }
});

test('navigation never chooses another story by X/Z alone and rejects unsupported drops', () => {
  const project = addLevel(createDefaultProject(), { copy: false }), navigation = new ArchitecturalNavigation(project), lower = navigation.start(project.levels[0].id, { x: 0, z: 0 })!, upper = navigation.start(project.levels[1].id, { x: 0, z: 0 })!;
  assert.equal(navigation.move(lower, { x: .5, z: 0 }).y, 0); assert.equal(navigation.move(upper, { x: .5, z: 0 }).y, 2.8);
  assert(navigation.move(lower, { x: 20, z: 0 }).blocked);
});

test('body collision respects an interior wall, a closed door, an open leaf and a frame', () => {
  let project = createDefaultProject(), levelId = project.levels[0].id; project = addWall(project, levelId, { x: 0, z: -2 }, { x: 0, z: 2 });
  const level = project.levels[0], wall = level.walls.at(-1)!;
  const blocked = () => { const navigation = new ArchitecturalNavigation(project), state = navigation.start(levelId, { x: -.6, z: 0 })!; return navigation.move(state, { x: 1.2, z: 0 }); };
  assert(blocked().blocked);
  level.openings.push({ id: crypto.randomUUID(), levelId, wallId: wall.id, type: 'door', doorStyle: 'right', open: false, offset: 1.4, width: 1.2, height: 2.2, sill: 0 }); assert(blocked().blocked);
  level.openings[0].open = true; assert(!blocked().blocked);
  level.openings[0].doorStyle = 'frame'; delete level.openings[0].open; assert(!blocked().blocked);
});

test('the real roof underside controls headroom instead of an invented flat ceiling', () => {
  const project = createDefaultProject(); project.roofs[0] = { ...project.roofs[0], type: 'gable', pitch: 30, baseHeight: 1.2 } as ParametricRoof;
  const navigation = new ArchitecturalNavigation(project);
  assert(navigation.headroom({ x: 0, y: 0, z: 0 }) > 2); assert(navigation.headroom({ x: -2.3, y: 0, z: 0 }) < 1.7);
  const middle = navigation.start(project.levels[0].id, { x: 0, z: 0 })!; assert(middle); assert(navigation.move(middle, { x: -2.1, z: 0 }).blocked);
});

test('swept movement cannot tunnel through furniture or walls and stale support IDs are rejected', () => {
  const project = createDefaultProject(), level = project.levels[0];
  level.furniture.push({ id: crypto.randomUUID(), levelId: level.id, type: 'bed', bedSize: 'single', material: 'wood', color: '#ffffff', x: 0, z: 0, width: .1, depth: .5, height: .2, rotation: 0 });
  const navigation = new ArchitecturalNavigation(project), state = navigation.start(level.id, { x: -1, z: 0 })!; assert(navigation.move(state, { x: 2, z: 0 }).blocked);
  assert(navigation.move({ ...state, surfaceId: 'removed' } as WalkState, { x: 0, z: 0 }).blocked); assert(!navigation.hasSurface('removed'));
});
