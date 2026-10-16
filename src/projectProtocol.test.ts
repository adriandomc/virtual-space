import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultProject, validateProjectDocument } from './projectDocument';
import { splitWall, addLevel, addRoof, updateRoof } from './projectOperations';
import { mergeStructure, structureCommand } from './projectProtocol';

test('splitting a wall remaps its door while preserving simultaneous open state and rejects a concurrent drag', () => {
  const previous = createDefaultProject(), level = previous.levels[0];
  level.openings.push({ id: 'door', levelId: level.id, wallId: level.walls[0].id, type: 'door', offset: 3, width: .9, height: 2.1, sill: 0, doorStyle: 'left', open: false });
  const next = splitWall(previous, level.id, level.walls[0].id, .5);
  const command = structureCommand(previous, next, { [level.id]: 1 }, 1)!;
  assert.equal(command.openingRemaps?.length, 1);
  const current = structuredClone(previous); current.levels[0].openings[0].open = true;
  const merged = validateProjectDocument(mergeStructure(current, command));
  assert.equal(merged.levels[0].openings[0].wallId, next.levels[0].openings[0].wallId);
  assert.equal(merged.levels[0].openings[0].offset, next.levels[0].openings[0].offset);
  assert.equal(merged.levels[0].openings[0].open, true); assert.equal(merged.levels[0].openings[0].doorStyle, 'left');
  current.levels[0].openings[0].offset += .1;
  assert.throws(() => mergeStructure(current, command), /abertura cambió/);
});

test('independent roof edits retain the other level geometry without a global ordering conflict', () => {
  let previous = addLevel(createDefaultProject(), { copy: true }); previous = addRoof(previous, previous.levels[0].id);
  const [upper, lower] = previous.roofs, revisions = Object.fromEntries(previous.levels.map(level => [level.id, 1]));
  const a = structureCommand(previous, updateRoof(previous, upper.id, { type: 'gable', pitch: 20 }), revisions, 1)!;
  const b = structureCommand(previous, updateRoof(previous, lower.id, { type: 'shed', pitch: 15 }), revisions, 1)!;
  assert.equal(a.expectedStructureRevision, undefined); assert.equal(b.expectedStructureRevision, undefined);
  assert.notDeepEqual(Object.keys(a.expected), Object.keys(b.expected));
  const merged = validateProjectDocument(mergeStructure(mergeStructure(previous, a), b));
  assert.equal(merged.roofs.find(roof => roof.id === upper.id)!.type, 'gable');
  assert.equal(merged.roofs.find(roof => roof.id === lower.id)!.type, 'shed');
});
