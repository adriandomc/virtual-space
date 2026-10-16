import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ceilingFinishTargets, createDefaultProject, projectAssetIds, projectStructure, projectToRoom, updateCeilingFinish, updateProjectRoom, validateProjectDocument } from './projectDocument.js';
import { addLevel, addRoom, addRoof, addWall } from './projectOperations.js';

test('the only project format is version 3 with one explicit white shell, slab, roof and light', () => {
  const project = validateProjectDocument(createDefaultProject());
  assert.equal(project.version, 3); assert.equal(project.levels.length, 1); assert.equal(project.levels[0].furniture.length, 0); assert.equal(project.levels[0].openings.length, 0); assert.equal(project.levels[0].lights.length, 1); assert.equal(project.roofs[0].type, 'flat');
  assert(project.levels[0].walls.every(w => w.left.color === '#ffffff' && w.right.color === '#ffffff'));
  assert.throws(() => validateProjectDocument({ ...project, version: 2 }), /versión/);
  assert.throws(() => validateProjectDocument(projectToRoom(project)), /campos/);
  assert.throws(() => validateProjectDocument({ ...project, oldRoom: {} }), /campos/);
  const missing = structuredClone(project) as Record<string, unknown>; delete missing.stairs;
  assert.throws(() => validateProjectDocument(missing), /campos/);
});

test('required current data and global cross references are validated', () => {
  const project = createDefaultProject(); const broken = structuredClone(project); broken.levels[0].walls[0].endId = 'missing'; assert.throws(() => validateProjectDocument(broken), /referencia/);
  const duplicate = structuredClone(project); duplicate.levels[0].lights[0].id = duplicate.levels[0].walls[0].id; assert.throws(() => validateProjectDocument(duplicate), /únicos/);
  const wrongLevel = structuredClone(project); wrongLevel.levels[0].lights[0].levelId = 'other'; assert.throws(() => validateProjectDocument(wrongLevel), /otro nivel/);
  const nan = structuredClone(project); nan.levels[0].height = NaN; assert.throws(() => validateProjectDocument(nan));
  const reserved = structuredClone(project), level = reserved.levels[0]; level.id = 'meta'; reserved.activeLevelId = 'meta'; level.walls.forEach(w => { w.levelId = 'meta'; }); level.surfaces.forEach(s => { s.levelId = 'meta'; }); level.lights.forEach(light => { light.levelId = 'meta'; }); reserved.roofs.forEach(roof => { roof.levelId = 'meta'; }); assert.throws(() => validateProjectDocument(reserved), /reservado/);
});

test('level projections preserve stable interior walls, face finishes, openings and unrelated levels', () => {
  let project = addLevel(createDefaultProject(), { copy: true, name: 'Upper' });
  const levelId = project.levels[0].id;
  project = addWall(project, levelId, { x: 0, z: -2 }, { x: 0, z: 2 });
  const upper = structuredClone(project.levels[1]), room = projectToRoom(project, levelId), wall = project.levels[0].walls.at(-1)!;
  assert(room.wallSegments!.some(segment => segment.id === wall.id));
  room.wallColors[room.wallIds!.indexOf(wall.id)] = '#123456'; room.name = 'Changed';
  const next = updateProjectRoom(project, levelId, room);
  assert.equal(next.levels[0].walls.find(w => w.id === wall.id)!.left.color, '#123456');
  assert.equal(next.levels[0].walls.find(w => w.id === wall.id)!.right.color, '#ffffff');
  assert.deepEqual(next.levels[1], upper); assert.equal(next.name, 'Changed'); assert.deepEqual(projectAssetIds(next), []);
});

test('elevation is derived, maximum 12 levels, and empty levels have no hidden decoration', () => {
  let project = createDefaultProject();
  for (let i = 1; i < 12; i++) project = addLevel(project);
  assert.equal(project.levels.length, 12); assert(Math.abs(project.levels[11].elevation - 30.8) < 1e-6); assert.equal(project.levels[1].walls.length, 0); assert.equal(project.levels[1].lights.length, 0);
  assert.throws(() => addLevel(project), /límites/);
  const bad = structuredClone(project); bad.levels[3].elevation += .1; assert.throws(() => validateProjectDocument(bad), /elevación/);
});

test('structural fingerprints separate appearance edits and topology changes', () => {
  const project = createDefaultProject(), painted = structuredClone(project); painted.levels[0].walls[0].right.color = '#112233'; painted.levels[0].lights[0].enabled = false;
  assert.equal(projectStructure(project), projectStructure(painted));
  painted.levels[0].walls[0].thickness += .01; assert.notEqual(projectStructure(project), projectStructure(painted));
});

test('JSON object key order cannot turn an appearance edit into a structural conflict', () => {
  const project = createDefaultProject();
  const reordered = validateProjectDocument(JSON.parse(JSON.stringify(project, (_key, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).reverse()) : value)));
  assert.equal(projectStructure(project), projectStructure(reordered));
  reordered.levels[0].walls[0].left.color = '#123456';
  assert.equal(projectStructure(project), projectStructure(reordered));
  reordered.levels[0].walls[0].thickness += .01;
  assert.notEqual(projectStructure(project), projectStructure(reordered));
});

test('ordinary object changes preserve all independent surface and roof finishes and untouched level references', () => {
  let project = createDefaultProject(); const id = project.activeLevelId;
  project = addRoom(project, id, [{ x: -.5, z: -.5 }, { x: .5, z: -.5 }, { x: .5, z: .5 }, { x: -.5, z: .5 }]);
  project = addRoof(project, id); project = addLevel(project, { copy: false });
  project.levels[0].surfaces[0].finish = { color: '#112233', material: 'marble' }; project.levels[0].surfaces[1].finish = { color: '#abcdef', material: 'wood' };
  project.roofs[0].undersideFinish.color = '#123456'; project.roofs[1].undersideFinish.color = '#fedcba';
  const room = projectToRoom(project, id); room.lights[0].enabled = false;
  const next = updateProjectRoom(project, id, room);
  assert.deepEqual(next.levels[0].surfaces.map(s => s.finish), project.levels[0].surfaces.map(s => s.finish)); assert.deepEqual(next.roofs.map(r => r.undersideFinish), project.roofs.map(r => r.undersideFinish)); assert.equal(next.levels[1], project.levels[1]);
});

test('geometry validation reuse never trusts IDs, missing references or invalid field types', () => {
  const project = createDefaultProject(); validateProjectDocument(project); validateProjectDocument(structuredClone(project));
  const crossing = structuredClone(project); crossing.levels[0].points[1].x = -3; crossing.levels[0].points[1].z = 1;
  assert.throws(() => validateProjectDocument(crossing), /polígono/);
  const reference = structuredClone(project); reference.levels[0].walls[0].startId = 'unknown'; assert.throws(() => validateProjectDocument(reference), /referencia/);
  const field = structuredClone(project); (field.levels[0].walls[0] as unknown as { height: unknown }).height = '2.8'; assert.throws(() => validateProjectDocument(field), /medidas/);
  const appearance = structuredClone(project); appearance.levels[0].walls[0].left.color = 'invalid'; assert.throws(() => validateProjectDocument(appearance), /hexadecimal/);
  const extra = structuredClone(project); Object.assign(extra.levels[0].walls[0], { inherited: true }); assert.throws(() => validateProjectDocument(extra), /campos/);
  const nonFinite = structuredClone(project); nonFinite.levels[0].points[0].x = Infinity; assert.throws(() => validateProjectDocument(nonFinite), /medidas/);
  const prototype = structuredClone(project); Object.setPrototypeOf(prototype.levels[0], { injected: true }); assert.throws(() => validateProjectDocument(prototype), /datos inválidos/);
  const polluted = JSON.parse(JSON.stringify(project)); Object.defineProperty(polluted.levels[0], '__proto__', { value: { injected: true }, enumerable: true }); assert.throws(() => validateProjectDocument(polluted), /campos/);
});

test('the part override budget counts all custom instances across levels before expensive geometry checks', () => {
  const project = addLevel(createDefaultProject());
  const parts = Object.fromEntries(Array.from({ length: 512 }, (_, i) => [String(i), { visible: true }]));
  for (let i = 0; i < 4; i++) { const level = project.levels[i % 2]; level.furniture.push({ id: 'custom-' + i, levelId: level.id, type: 'custom', assetId: crypto.randomUUID(), name: 'Part budget test', material: null, color: null, parts: structuredClone(parts), x: 0, z: 0, width: 1, depth: 1, height: 1, rotation: 0 }); }
  validateProjectDocument(project);
  project.levels[1].furniture[0].parts!['0'] = { color: '#112233' }; validateProjectDocument(project);
  const item = structuredClone(project.levels[1].furniture[0]); item.id = 'custom-extra'; item.parts = { '0': { visible: false } }; project.levels[1].furniture.push(item);
  project.levels[0].points[0].x = Infinity;
  assert.throws(() => validateProjectDocument(project), /demasiadas modificaciones/);
});

test('every floor requires its own independent underside and ceiling surfaces reject that field', () => {
  const project = createDefaultProject(), floor = project.levels[0].surfaces[0]; assert.equal(floor.undersideFinish?.color, '#ffffff');
  const missing = structuredClone(project); delete (missing.levels[0].surfaces[0] as any).undersideFinish; assert.throws(() => validateProjectDocument(missing), /campos/);
  const invalid = structuredClone(project); invalid.levels[0].surfaces[0].undersideFinish!.color = 'invalid'; assert.throws(() => validateProjectDocument(invalid), /hexadecimal/);
  const ceiling = structuredClone(project); (ceiling.levels[0].surfaces as any[]).push({ ...structuredClone(floor), id: crypto.randomUUID(), kind: 'ceiling', elevation: 2.8 }); assert.throws(() => validateProjectDocument(ceiling), /campos/);
  delete (ceiling.levels[0].surfaces.at(-1) as any).undersideFinish; validateProjectDocument(ceiling);
  for (const created of [addLevel(project), addLevel(project, { copy: true }), addRoom(project, project.activeLevelId, [{ x: -.5, z: -.5 }, { x: .5, z: -.5 }, { x: .5, z: .5 }, { x: -.5, z: .5 }])]) { validateProjectDocument(created); assert(created.levels.flatMap(level => level.surfaces).every(surface => surface.kind !== 'floor' || !!surface.undersideFinish)); }
});

test('painting the lower ceiling edits the actual upper slab underside without changing either floor top or upper roof', () => {
  const project = addLevel(createDefaultProject(), { copy: true }), lowerId = project.levels[0].id, upper = project.levels[1], floor = upper.surfaces.find(surface => surface.kind === 'floor')!;
  floor.finish = { color: '#123456', material: 'wood' }; floor.undersideFinish = { color: '#aabbcc', material: 'concrete' };
  const tops = project.levels.map(level => structuredClone(level.surfaces.map(surface => surface.finish))), roofs = structuredClone(project.roofs);
  assert.equal(projectToRoom(project, lowerId).ceilingColor, '#aabbcc'); assert.deepEqual(ceilingFinishTargets(project, lowerId).map(target => target.id), [floor.id]);
  const painted = updateCeilingFinish(project, lowerId, { color: '#334455', material: 'marble' }, floor.id);
  assert.deepEqual(painted.levels[1].surfaces[0].undersideFinish, { color: '#334455', material: 'marble' });
  assert.deepEqual(painted.levels.map(level => level.surfaces.map(surface => surface.finish)), tops); assert.deepEqual(painted.roofs, roofs);
  assert.equal(projectStructure(painted), projectStructure(project), 'underside changes are ordinary collaboration fields');
  const room = projectToRoom(painted, lowerId); room.ceilingColor = '#ddeeff'; const bridged = updateProjectRoom(painted, lowerId, room);
  assert.equal(bridged.levels[1].surfaces[0].undersideFinish!.color, '#ddeeff'); assert.deepEqual(bridged.levels.map(level => level.surfaces.map(surface => surface.finish)), tops); assert.deepEqual(bridged.roofs, roofs);
  assert.equal(projectToRoom(bridged, lowerId).ceilingColor, '#ddeeff'); validateProjectDocument(bridged);
});

test('ceiling targeting uses an explicit ceiling before slabs and the top roof when there is no next level', () => {
  const project = addLevel(createDefaultProject(), { copy: true }), level = project.levels[0], upper = project.levels[1];
  const { undersideFinish: _underside, ...base } = level.surfaces[0];
  level.surfaces.push({ ...base, id: crypto.randomUUID(), kind: 'ceiling', elevation: level.height, finish: { color: '#112233', material: 'wood' } });
  const changed = updateCeilingFinish(project, level.id, { color: '#445566' });
  assert.equal(changed.levels[0].surfaces.at(-1)!.finish.color, '#445566'); assert.equal(changed.levels[1], upper);
  const top = updateCeilingFinish(changed, upper.id, { material: 'marble', color: '#aabbcc' });
  assert.deepEqual(top.roofs[0].undersideFinish, { color: '#aabbcc', material: 'marble' }); assert.deepEqual(top.roofs[0].finish, project.roofs[0].finish);
});
