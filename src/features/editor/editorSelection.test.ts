import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultProject, projectToRoom } from '../../domain/project/projectDocument';
import { addLevel } from '../../domain/project/projectOperations';
import { describeSurfaceSelection } from './editorSelection';

test('the inspector resolves stable wall ids and wall sides without falling back after deletion', () => {
  const project = createDefaultProject(), level = project.levels[0], wall = level.walls[2];
  wall.left.color = '#123456'; wall.right.color = '#abcdef';
  const room = projectToRoom(project);
  const target = describeSurfaceSelection(project, level.id, room, { kind: 'wall', index: 0, id: wall.id }, 'right');
  assert.equal(target.selectedWall, 2);
  assert.equal(target.selectedColor, '#abcdef');
  assert.equal(describeSurfaceSelection(project, level.id, room, { kind: 'wall', index: 0, id: 'deleted-wall' }, 'left').selectedWall, -1);
});

test('the inspector shows the selected floor region independently of the default floor', () => {
  const project = createDefaultProject(), level = project.levels[0];
  const floor = { ...level.surfaces[0], id: crypto.randomUUID(), finish: { color: '#123456', material: 'marble' as const } };
  level.surfaces.push(floor);
  const target = describeSurfaceSelection(project, level.id, projectToRoom(project), { kind: 'floor', id: floor.id }, 'left');
  assert.equal(target.selectedSurface?.id, floor.id);
  assert.equal(target.selectedColor, '#123456');
  assert.equal(target.surface, 'floor');
  const missing = describeSurfaceSelection(project, level.id, projectToRoom(project), { kind: 'floor', id: 'deleted-floor' }, 'left');
  assert.equal(missing.selectedSurface, undefined);
});

test('the lower-level ceiling inspector points at the upper slab underside, while the top level points at its roof', () => {
  const project = addLevel(createDefaultProject(), { copy: true });
  const [lower, upper] = project.levels;
  const slab = upper.surfaces.find(surface => surface.kind === 'floor')!;
  slab.undersideFinish.color = '#123456';
  const target = describeSurfaceSelection(project, lower.id, projectToRoom(project, lower.id), { kind: 'ceiling', id: slab.id }, 'left');
  assert.equal(target.selectedCeiling?.id, slab.id);
  assert.equal(target.selectedCeiling?.side, 'undersideFinish');
  assert.equal(target.selectedColor, '#123456');
  assert.equal(target.selectedSurface, undefined);
  const top = describeSurfaceSelection(project, upper.id, projectToRoom(project, upper.id), { kind: 'ceiling' }, 'left');
  assert.equal(top.selectedCeiling?.kind, 'roof');
  assert.equal(top.selectedCeiling?.levelId, upper.id);
});
