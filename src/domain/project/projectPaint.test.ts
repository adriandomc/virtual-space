import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultProject, projectStructure, projectToRoom, updateProjectRoom, validateProjectDocument, whiteFinish } from './projectDocument.js';
import { addLevel, addRoom, addStair } from './projectOperations.js';
import { validateRoom } from './model.js';
import { paintProjectTarget, paintTargetColor, samplePaintTargetColor, type PaintTarget } from './projectPaint.js';

function fixture() {
  let project = addLevel(createDefaultProject(), { copy: true });
  project = addStair(project, { fromLevelId: project.levels[0].id, toLevelId: project.levels[1].id });
  const level = project.levels[0];
  level.furniture.push({ id: 'bed', levelId: level.id, type: 'bed', bedSize: 'double', width: 1.35, depth: 1.9, height: 1, x: 0, z: 0, rotation: 0, color: '#aabbcc', material: 'wood' });
  level.furniture.push({ id: 'model', levelId: level.id, type: 'custom', assetId: '00000000-0000-4000-8000-000000000000', name: 'Model', width: 1, depth: 1, height: 1, x: 1, z: 0, rotation: 0, color: null, material: null, parts: { '0': { color: '#123456', visible: false, material: 'metal', position: { x: 1, y: 0, z: 0 } } } });
  level.openings.push({ id: 'door', levelId: level.id, wallId: level.walls[0].id, type: 'door', doorStyle: 'left', open: false, offset: 1, width: .9, height: 2, sill: 0 });
  level.openings.push({ id: 'window', levelId: level.id, wallId: level.walls[1].id, type: 'window', offset: 1, width: .9, height: .8, sill: 1 });
  return validateProjectDocument(project);
}

test('bucket paints every stored kind with stable IDs on either floor and preserves construction', () => {
  const project = fixture(), level = project.levels[0], upper = project.levels[1], structure = projectStructure(project);
  const targets: PaintTarget[] = [
    ...(['left', 'right'] as const).map(wallSide => ({ levelId: level.id, selection: { kind: 'wall' as const, index: 999, id: level.walls[2].id }, wallSide })),
    { levelId: upper.id, selection: { kind: 'floor', id: upper.surfaces[0].id } },
    { levelId: level.id, selection: { kind: 'ceiling', id: upper.surfaces[0].id } },
    ...(['finish', 'undersideFinish'] as const).map(roofSide => ({ levelId: project.roofs[0].levelId, selection: { kind: 'roof' as const, id: project.roofs[0].id }, roofSide })),
    ...(['bed', 'model'] as const).map(id => ({ levelId: level.id, selection: { kind: 'furniture' as const, id } })),
    ...level.openings.map(opening => ({ levelId: level.id, selection: { kind: 'opening' as const, id: opening.id } })),
    { levelId: level.id, selection: { kind: 'light', id: level.lights[0].id } },
    { levelId: upper.id, selection: { kind: 'stair', id: project.stairs[0].id } },
  ];
  const original = structuredClone(project);
  for (const target of targets) {
    const painted = paintProjectTarget(project, target, '#ABC123');
    assert.equal(paintTargetColor(painted, target), '#abc123');
    assert.equal(projectStructure(painted), structure); assert.deepEqual(project, original);
    assert.deepEqual(validateProjectDocument(JSON.parse(JSON.stringify(painted))), painted);
  }
  const painted = paintProjectTarget(project, targets[7], '#aabbcc'), model = painted.levels[0].furniture[1];
  assert.equal(model.material, null); assert.equal(model.parts!['0'].color, '#aabbcc');
  assert.deepEqual(model.parts!['0'].position, original.levels[0].furniture[1].parts!['0'].position);
  assert.equal(model.parts!['0'].material, 'metal'); assert.equal(model.parts!['0'].visible, false);
});

test('ceilings resolve actual slabs, explicit ceilings and roof undersides without painting all zones', () => {
  const base = createDefaultProject(), level = base.levels[0], roof = base.roofs[0];
  const roofPaint = paintProjectTarget(base, { levelId: level.id, selection: { kind: 'ceiling', id: roof.id } }, '#112233');
  assert.equal(roofPaint.roofs[0].undersideFinish.color, '#112233'); assert.equal(roofPaint.roofs[0].finish.color, '#ffffff');
  level.surfaces.push({ id: 'ceiling', levelId: level.id, kind: 'ceiling', outline: [...level.outline], holes: [], thickness: .1, elevation: 2.8, finish: whiteFinish() });
  const explicit = paintProjectTarget(base, { levelId: level.id, selection: { kind: 'ceiling', id: 'ceiling' } }, '#445566');
  assert.equal(explicit.levels[0].surfaces[1].finish.color, '#445566'); assert.equal(explicit.roofs[0].undersideFinish.color, '#ffffff');
  const empty = createDefaultProject(), divided = addRoom(empty, empty.activeLevelId, [{ x: -.5, z: -.5 }, { x: .5, z: -.5 }, { x: .5, z: .5 }, { x: -.5, z: .5 }]);
  const first = paintProjectTarget(divided, { levelId: divided.activeLevelId, selection: { kind: 'floor' } }, '#778899');
  assert.equal(first.levels[0].surfaces.filter(surface => surface.finish.color === '#778899').length, 1);
});

test('invalid paint targets and colors leave the original project untouched', () => {
  const project = fixture(), before = structuredClone(project), levelId = project.levels[0].id;
  for (const selection of [{ kind: 'wall', index: 0 }, { kind: 'wall', index: 0, id: 'deleted' }, { kind: 'floor', id: 'deleted' }, { kind: 'ceiling', id: 'deleted' }, { kind: 'furniture', id: 'deleted' }, { kind: 'light', id: 'deleted' }, { kind: 'opening', id: 'deleted' }, { kind: 'roof', id: 'deleted' }, { kind: 'stair', id: 'deleted' }] as PaintTarget['selection'][]) {
    assert.throws(() => paintProjectTarget(project, { levelId, selection }, '#112233'));
  }
  for (const color of ['', '#abc', '#11223344', 'red', null, 123]) assert.throws(() => paintProjectTarget(project, { levelId, selection: { kind: 'floor' } }, color as string));
  assert.deepEqual(project, before);
});

test('optional opening and light paint survives shared parsing, projections and room updates', () => {
  let project = fixture(); const levelId = project.levels[0].id;
  for (const selection of [{ kind: 'opening', id: 'door' }, { kind: 'opening', id: 'window' }, { kind: 'light', id: project.levels[0].lights[0].id }] as PaintTarget['selection'][]) project = paintProjectTarget(project, { levelId, selection }, '#123456');
  const room = validateRoom(projectToRoom(project, levelId)), next = updateProjectRoom(project, levelId, room);
  assert.deepEqual(next, project); assert.equal(next.levels[0].lights[0].temperature, 2700); assert.equal(next.levels[0].openings[0].open, false);
  for (const group of ['openings', 'lights'] as const) for (const color of [null, undefined, '#fff', 'red', '#12345678']) {
    const broken = structuredClone(project); Object.assign(broken.levels[0][group][0], { color });
    assert.throws(() => validateProjectDocument(broken), /hexadecimal/);
    assert.throws(() => validateRoom(projectToRoom(broken, levelId)), /color/i);
  }
});

test('eyedropper samples stable surface sides and actual ceilings without changing the project', () => {
  const project = fixture(), lower = project.levels[0], upper = project.levels[1], roof = project.roofs[0];
  lower.walls[0].left.color = '#123456'; lower.walls[0].right.color = '#ABCDEF';
  upper.surfaces[0].finish.color = '#112233'; upper.surfaces[0].undersideFinish!.color = '#445566';
  roof.finish.color = '#778899'; roof.undersideFinish.color = '#aabbcc'; project.stairs[0].finish.color = '#ddccbb';
  const before = structuredClone(project);
  const cases: [PaintTarget, string][] = [
    [{ levelId: lower.id, selection: { kind: 'wall', id: lower.walls[0].id, index: 999 } }, '#123456'],
    [{ levelId: lower.id, selection: { kind: 'wall', id: lower.walls[0].id, index: 999 }, wallSide: 'right' }, '#abcdef'],
    [{ levelId: upper.id, selection: { kind: 'floor', id: upper.surfaces[0].id } }, '#112233'],
    [{ levelId: lower.id, selection: { kind: 'ceiling', id: upper.surfaces[0].id } }, '#445566'],
    [{ levelId: roof.levelId, selection: { kind: 'roof', id: roof.id } }, '#778899'],
    [{ levelId: roof.levelId, selection: { kind: 'roof', id: roof.id }, roofSide: 'undersideFinish' }, '#aabbcc'],
    [{ levelId: upper.id, selection: { kind: 'stair', id: project.stairs[0].id } }, '#ddccbb'],
    [{ levelId: lower.id, selection: { kind: 'furniture', id: 'bed' } }, '#aabbcc'],
  ];
  for (const [target, expected] of cases) assert.equal(samplePaintTargetColor(project, target, '#ff0000'), expected);
  assert.deepEqual(project, before);
});

test('eyedropper defaults distinguish opaque opening and lamp paint from original model colors', () => {
  const project = fixture(), level = project.levels[0];
  const opening = (id: string): PaintTarget => ({ levelId: level.id, selection: { kind: 'opening', id } });
  assert.equal(samplePaintTargetColor(project, opening('door')), '#c7b297');
  level.openings[0].doorStyle = 'frame'; delete level.openings[0].open;
  assert.equal(samplePaintTargetColor(project, opening('door')), '#efece3');
  assert.equal(samplePaintTargetColor(project, opening('window')), '#efece3');
  level.openings[1].color = '#ABCDEF'; assert.equal(samplePaintTargetColor(project, opening('window')), '#abcdef');
  const light: PaintTarget = { levelId: level.id, selection: { kind: 'light', id: level.lights[0].id } };
  assert.equal(samplePaintTargetColor(project, light), '#343931');
  level.lights[0].color = '#112233'; assert.equal(samplePaintTargetColor(project, light), '#112233');
  const model: PaintTarget = { levelId: level.id, selection: { kind: 'furniture', id: 'model' } };
  assert.equal(samplePaintTargetColor(project, model), '#cccccc');
  assert.equal(samplePaintTargetColor(project, model, '#ABCDEF'), '#abcdef');
  assert.equal(samplePaintTargetColor(project, model, 'red'), '#cccccc');
});

test('a sampling fallback never turns a deleted or stale target into a valid source', () => {
  const project = fixture(), before = structuredClone(project), levelId = project.levels[0].id;
  for (const kind of ['wall', 'floor', 'ceiling', 'furniture', 'opening', 'light', 'roof', 'stair'] as const) {
    assert.throws(() => samplePaintTargetColor(project, { levelId, selection: { kind, id: 'deleted', index: 0 } }, '#123456'));
  }
  assert.throws(() => samplePaintTargetColor(project, { levelId, selection: { kind: 'wall', index: 0 } }, '#123456'));
  assert.throws(() => samplePaintTargetColor(project, { levelId: 'deleted', selection: { kind: 'floor' } }, '#123456'));
  assert.deepEqual(project, before);
});
