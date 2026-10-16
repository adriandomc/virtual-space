import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';
import { createDefaultProject, validateProjectDocument, type ProjectLevel } from './projectDocument';
import { addLevel, addRoof, addStair } from './projectOperations';
import { assembleProject, projectScopes, readProjectScope, writeProjectScope } from './collaborativeProject';
import { stableStringify } from './sameData';
const createDefaultRoom = () => createDefaultProject().levels[0];
const readYRoom = (doc: Y.Doc) => readProjectScope(doc) as ProjectLevel;
const seedYRoom = (doc: Y.Doc, level: ProjectLevel) => writeProjectScope(doc, level);
const writeYRoom = (doc: Y.Doc, level: ProjectLevel, previous: ProjectLevel) => writeProjectScope(doc, level, previous);
const validateRoom = (level: ProjectLevel) => level;

test('a canonical JSON roundtrip preserves unchanged roof map identities during an ordinary metadata edit', () => {
  const doc = new Y.Doc(), previous = projectScopes(createDefaultProject()).meta;
  try {
    writeProjectScope(doc, previous);
    const roofs = doc.getMap('data').get('roofs') as Y.Map<unknown>, roofId = String((previous.roofs as { id: string }[])[0].id), roof = roofs.get(roofId), vector = Y.encodeStateVector(doc);
    const next = JSON.parse(stableStringify(previous)); next.name = 'Renamed';
    writeProjectScope(doc, next, previous);
    assert.equal(doc.getMap('data').get('roofs'), roofs); assert.equal(roofs.get(roofId), roof, 'key ordering must not replace entity identities');
    assert.equal(Y.decodeUpdate(Y.encodeStateAsUpdate(doc, vector)).structs.length, 1, 'only the edited name is written');
    assert.deepEqual(readProjectScope(doc), next);
  } finally { doc.destroy(); }
});

test('every persisted entity collection rejects raw JSON arrays instead of accepting a destructive map conversion', () => {
  const project = createDefaultProject(), scopes = projectScopes(project);
  for (const key of ['furniture', 'openings', 'lights', 'walls', 'surfaces', 'points', 'stairs', 'roofs']) {
    const doc = new Y.Doc(), value = ['stairs', 'roofs'].includes(key) ? scopes.meta : scopes[project.activeLevelId];
    try {
      writeProjectScope(doc, value);
      assert.deepEqual(readProjectScope(doc), value);
      doc.getMap('data').set(key, structuredClone(value[key]));
      assert.throws(() => readProjectScope(doc), /Los cambios no son válidos/, key + ' must retain its keyed Y.Map contract');
    } finally { doc.destroy(); }
  }
});

test('simultaneous roof and stair finishes on different levels merge by persistent entity ID', () => {
  let project = addLevel(addLevel(createDefaultProject(), { copy: true }), { copy: true });
  project = addRoof(project, project.levels[0].id);
  project = addStair(project, { fromLevelId: project.levels[0].id, toLevelId: project.levels[1].id });
  project = addStair(project, { fromLevelId: project.levels[1].id, toLevelId: project.levels[2].id });
  const seed = new Y.Doc(); writeProjectScope(seed, projectScopes(project).meta);
  const docs = [0, 1].map(() => { const doc = new Y.Doc(); Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed)); return doc; });
  try {
    const colors = ['#112233', '#aabbcc'];
    const updates = docs.map((doc, index) => {
      const previous = readProjectScope(doc), vector = Y.encodeStateVector(doc), next = structuredClone(previous);
      (next.roofs as typeof project.roofs)[index].finish.color = colors[index];
      (next.stairs as typeof project.stairs)[index].finish.color = colors[index];
      writeProjectScope(doc, next, previous); return Y.encodeStateAsUpdate(doc, vector);
    });
    docs.forEach((doc, index) => Y.applyUpdate(doc, updates[1 - index]));
    const metadata = readProjectScope(docs[0]);
    assert.deepEqual(metadata, readProjectScope(docs[1]));
    const result = validateProjectDocument(assembleProject({ ...projectScopes(project), meta: metadata }));
    assert.deepEqual(result.roofs.map(roof => roof.finish.color), colors);
    assert.deepEqual(result.stairs.map(stair => stair.finish.color), colors);
    assert.deepEqual(result.roofs.map(roof => roof.id), project.roofs.map(roof => roof.id));
    assert.deepEqual(result.stairs.map(stair => stair.id), project.stairs.map(stair => stair.id));
  } finally { for (const doc of [seed, ...docs]) doc.destroy(); }
});

function copies(room: ProjectLevel) {
  const first = new Y.Doc(), second = new Y.Doc();
  seedYRoom(first, room); Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
  return [first, second];
}
function change(doc: Y.Doc, patch: (room: ProjectLevel) => ProjectLevel) {
  const previous = readYRoom(doc), vector = Y.encodeStateVector(doc);
  writeYRoom(doc, patch(previous), previous);
  return Y.encodeStateAsUpdate(doc, vector);
}

test('Yjs conserva cambios simultáneos en objetos y campos distintos', () => {
  const room = createDefaultRoom();
  room.furniture = [{ id: 'ropero', levelId: room.id, type: 'wardrobe', variant: 'wardrobe-classic', material: 'wood', color: '#b8a084', width: 1, height: 2, depth: 0.6, x: 0, z: 0, rotation: 0 }];
  const [first, second] = copies(room);
  const one = change(first, value => ({ ...value, furniture: [{ ...value.furniture[0], x: 1 }], name: 'Updated level' }));
  const two = change(second, value => ({ ...value, furniture: [{ ...value.furniture[0], color: '#aabbcc' }], lights: value.lights.map(light => ({ ...light, lumens: 0 })) }));
  Y.applyUpdate(first, two); Y.applyUpdate(second, one);
  const result = validateRoom(readYRoom(first));
  assert.deepEqual(result, readYRoom(second));
  assert.equal(result.furniture[0].x, 1); assert.equal(result.furniture[0].color, '#aabbcc');
  assert.equal(result.name, 'Updated level'); assert.equal(result.lights[0].lumens, 0);
  first.destroy(); second.destroy();
});

test('Yjs conserva colores simultáneos de paredes distintas', () => {
  const [first, second] = copies(createDefaultRoom());
  const one = change(first, room => ({ ...room, walls: room.walls.map((wall, index) => index ? wall : { ...wall, left: { ...wall.left, color: '#112233' } }) }));
  const two = change(second, room => ({ ...room, walls: room.walls.map((wall, index) => index !== 1 ? wall : { ...wall, left: { ...wall.left, color: '#aabbcc' } }) }));
  Y.applyUpdate(first, two); Y.applyUpdate(second, one);
  assert.deepEqual(readYRoom(first), readYRoom(second));
  assert.deepEqual(readYRoom(first).walls.slice(0, 2).map(wall => wall.left.color), ['#112233', '#aabbcc']);
  first.destroy(); second.destroy();
});

test('un color atrasado no repone el contorno anterior y un borrado no revive por movimiento', () => {
  const room = createDefaultRoom();
  room.openings = [];
  room.furniture = [{ id: 'ropero', levelId: room.id, type: 'wardrobe', variant: 'wardrobe-classic', material: 'wood', color: '#b8a084', width: 1, height: 2, depth: 0.6, x: 0, z: 0, rotation: 0 }];
  const [first, second] = copies(room);
  const vertices = room.points.map(point => ({ ...point, x: point.x * 1.1 }));
  const one = change(first, value => ({ ...value, points: vertices, furniture: [] }));
  const two = change(second, value => ({ ...value, walls: value.walls.map(wall => ({ ...wall, left: { ...wall.left, color: '#112233' } })), furniture: [{ ...value.furniture[0], x: 1 }] }));
  Y.applyUpdate(first, two); Y.applyUpdate(second, one);
  assert.deepEqual(validateRoom(readYRoom(first)), validateRoom(readYRoom(second)));
  assert.deepEqual(readYRoom(first).points, vertices); assert.equal(readYRoom(first).furniture.length, 0);
  first.destroy(); second.destroy();
});

test('el cambio usa la versión mostrada y conserva otros campos recibidos entretanto', () => {
  const [first, second] = copies(createDefaultRoom()), displayed = readYRoom(first);
  const remote = change(second, value => ({ ...value, lights: value.lights.map(light => ({ ...light, enabled: false })) }));
  Y.applyUpdate(first, remote);
  writeYRoom(first, { ...displayed, name: 'Otro nombre' }, displayed);
  assert.equal(readYRoom(first).lights[0].enabled, false); assert.equal(readYRoom(first).name, 'Otro nombre');
  first.destroy(); second.destroy();
});

test('las primeras ediciones simultáneas de una pieza conservan acabado y transformación', () => {
  const room = createDefaultRoom();
  room.furniture = [{ id: 'custom', levelId: room.id, type: 'custom', material: null, color: null, name: 'Modelo', assetId: '3141abd1-94c5-4858-a5f9-7c337f1622df', width: 1, height: 1, depth: 1, x: 0, z: 0, rotation: 0 }];
  const [first, second] = copies(room);
  assert.deepEqual(readYRoom(first), room);
  const one = change(first, value => ({ ...value, furniture: [{ ...value.furniture[0], parts: { '0': { color: '#112233' } } }] }));
  const two = change(second, value => ({ ...value, furniture: [{ ...value.furniture[0], parts: { '0': { position: { x: 1, y: 2, z: 3 } } } }] }));
  Y.applyUpdate(first, two); Y.applyUpdate(second, one);
  assert.deepEqual(validateRoom(readYRoom(first)), validateRoom(readYRoom(second)));
  assert.deepEqual(readYRoom(first).furniture[0].parts, { '0': { color: '#112233', position: { x: 1, y: 2, z: 3 } } });
  first.destroy(); second.destroy();
});

test('un arrastre desde una vista atrasada no vuelve a crear un mueble ya eliminado', () => {
  const room = createDefaultRoom();
  room.furniture = [{ id: 'ropero', levelId: room.id, type: 'wardrobe', variant: 'wardrobe-classic', material: 'wood', color: '#b8a084', width: 1, height: 2, depth: 0.6, x: 0, z: 0, rotation: 0 }];
  const [first, second] = copies(room), displayed = readYRoom(first);
  const deletion = change(second, value => ({ ...value, furniture: [] }));
  Y.applyUpdate(first, deletion);
  writeYRoom(first, { ...displayed, furniture: [{ ...displayed.furniture[0], x: 1 }] }, displayed);
  assert.equal(readYRoom(first).furniture.length, 0);
  first.destroy(); second.destroy();
});

test('los campos internos no ocultan datos ni permiten identidades distintas del mapa', () => {
  const [doc] = copies(createDefaultRoom()), root = doc.getMap<unknown>('data');
  const lights = root.get('lights') as Y.Map<Y.Map<unknown>>, light = [...lights.values()][0];
  const identity = light.get('id'); light.set('id', 'forged-id'); assert.throws(() => readYRoom(doc)); light.set('id', identity);
  light.set('__proto__', { hidden: 'Contenido no admitido' }); assert.throws(() => readYRoom(doc)); light.delete('__proto__');
  root.set('hidden', new Y.Array()); (root.get('hidden') as Y.Array<unknown>).push(['hidden']); assert.throws(() => readYRoom(doc));
  doc.destroy();
});

test('un documento de texto o lista no puede insertar contenido invisible dentro del mapa', () => {
  const [doc] = copies(createDefaultRoom()), incompatible = new Y.Doc();
  incompatible.getArray('data').push(['Contenido oculto']);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(incompatible));
  assert.throws(() => readYRoom(doc));
  doc.destroy(); incompatible.destroy();
});


test('resetting a custom part removes optional overrides rather than persisting an empty hidden state', () => {
  const level = createDefaultRoom();
  level.furniture = [{ id: 'custom-reset', levelId: level.id, type: 'custom', material: null, color: null, name: 'Reset model', assetId: '3141abd1-94c5-4858-a5f9-7c337f1622df', width: 1, height: 1, depth: 1, x: 0, z: 0, rotation: 0, parts: { '0': { color: '#112233' } } }];
  const [doc, other] = copies(level), previous = readYRoom(doc);
  writeYRoom(doc, { ...previous, furniture: previous.furniture.map(item => ({ ...item, parts: undefined })) }, previous);
  assert.equal(Object.hasOwn(readYRoom(doc).furniture[0], 'parts'), false); doc.destroy(); other.destroy();
});

test('structural patches preserve actor history, pending paint and explicit collection order', () => {
  const level = createDefaultRoom(), [server, client] = copies(level), previous = readYRoom(client);
  const vector = Y.encodeStateVector(client);
  writeYRoom(client, { ...previous, walls: previous.walls.map((wall, index) => index ? wall : { ...wall, left: { ...wall.left, color: '#123456' } }) }, previous);
  const pending = Y.encodeStateAsUpdate(client, vector), structural = { ...level, height: level.height + .1, points: [...level.points].reverse(), walls: [...level.walls].reverse() };
  writeYRoom(server, structural, level);
  Y.applyUpdate(server, pending);
  const saved = readYRoom(server);
  assert.equal(server.store.pendingStructs, null);
  assert.equal(saved.height, structural.height);
  assert.deepEqual(saved.points.map(point => point.id), structural.points.map(point => point.id));
  assert.deepEqual(saved.walls.map(wall => wall.id), structural.walls.map(wall => wall.id));
  assert.equal(saved.walls.find(wall => wall.id === level.walls[0].id)!.left.color, '#123456');
  server.destroy(); client.destroy();
});

test('collection order metadata rejects hidden objects and duplicate IDs', () => {
  const [doc, other] = copies(createDefaultRoom()), root = doc.getMap<unknown>('data'), points = root.get('points') as Y.Map<unknown>;
  points.set('_order', { hidden: 'payload' }); assert.throws(() => readYRoom(doc));
  points.set('_order', ['point', 'point']); assert.throws(() => readYRoom(doc));
  doc.destroy(); other.destroy();
});

test('three simultaneous additions converge even when unlisted IDs arrive in different orders', () => {
  const level = createDefaultRoom(), seed = new Y.Doc(); seedYRoom(seed, level);
  const docs = [0, 1, 2].map(() => { const doc = new Y.Doc(); Y.applyUpdate(doc, Y.encodeStateAsUpdate(seed)); return doc; });
  const updates = docs.map((doc, index) => change(doc, before => ({ ...before, furniture: [{ id: ['aaa', 'bbb', 'ccc'][index], levelId: level.id, type: 'wardrobe', variant: 'wardrobe-classic', material: 'wood', color: '#abcdef', width: 1, height: 1, depth: 1, x: 0, z: 0, rotation: 0 }] })));
  docs.forEach((doc, index) => [0, 1, 2].filter(other => other !== index).reverse().forEach(other => Y.applyUpdate(doc, updates[other])));
  assert.deepEqual(readYRoom(docs[0]), readYRoom(docs[1])); assert.deepEqual(readYRoom(docs[0]), readYRoom(docs[2]));
  assert.equal(readYRoom(docs[0]).furniture.length, 3);
  for (const doc of [seed, ...docs]) doc.destroy();
});
