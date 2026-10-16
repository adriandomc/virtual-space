import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultProject, validateProjectDocument } from './projectDocument';
import { addFurniture, resizeRoom } from './model';
import { projectToRoom, updateProjectRoom } from './projectDocument';
import { createBlankProject, skipOnboardingStep } from './onboardingModel';

test('new projects have a single white level, flat roof and light without automatic furniture or openings', () => {
  const project = validateProjectDocument(createBlankProject());
  assert.equal(project.version, 3); assert.equal(project.setupStep, 0);
  assert.equal(project.levels.length, 1); assert.equal(project.roofs[0].type, 'flat');
  const level = project.levels[0];
  assert.equal(level.lights.length, 1); assert.equal(level.furniture.length, 0); assert.equal(level.openings.length, 0);
  assert.ok(level.walls.every(wall => wall.left.color === '#ffffff' && wall.right.color === '#ffffff'));
});

test('skipping every step preserves construction, finishes, furniture and references', () => {
  let project = createBlankProject();
  const room = addFurniture(resizeRoom(projectToRoom(project), 7, 6), 'bed', 'queen');
  project = updateProjectRoom(project, project.activeLevelId, { ...room, floorFinish: 'wood', ceilingColor: '#123456' });
  const original = structuredClone(project);
  for (const _step of ['plan', 'roof', 'colors', 'decoration']) assert.equal(skipOnboardingStep(project), project);
  assert.deepEqual(project, original);
});

test('the canonical setup contract accepts four steps and finishing removes setup state', () => {
  const project = createDefaultProject();
  for (const setupStep of [0, 1, 2, 3]) assert.equal(validateProjectDocument({ ...project, setupStep }).setupStep, setupStep);
  for (const setupStep of [-1, 4, .5, '1', null, true]) assert.throws(() => validateProjectDocument({ ...project, setupStep }));
  assert.equal(validateProjectDocument(project).setupStep, undefined);
});
