import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { addCustomFurniture, addFurniture, createDefaultRoom, fitRoom, validateRoom } from './model';
import { FURNITURE_CATALOG } from './furnitureCatalog';
import type { FurnitureItem } from './types';

const custom = (): FurnitureItem => ({ id: randomUUID(), type: 'custom', name: 'Modelo propio', assetId: randomUUID(), x: 0, z: 0, width: 1, height: 1, depth: .5, rotation: 0 });
const roomWith = (item: unknown) => ({ ...createDefaultRoom(), furniture: [item] });

test('all catalog variants persist their identity and dimensions and reject cross-category variants', () => {
  for (const preset of FURNITURE_CATALOG) {
    const room = addFurniture(createDefaultRoom(), preset.type, 'double', preset.id), item = room.furniture[0];
    assert.equal(item.variant, preset.id); assert.equal(item.type, preset.type);
    assert.equal(item.width, preset.width); assert.equal(item.depth, preset.depth); assert.equal(item.height, preset.height);
    assert.equal(validateRoom(JSON.parse(JSON.stringify(room))).furniture[0].variant, preset.id);
    assert.equal(fitRoom(room).furniture[0].variant, preset.id);
    const wrong = preset.type === 'wardrobe' ? 'vanity' : 'wardrobe';
    assert.throws(() => validateRoom(roomWith({ ...item, type: wrong })));
  }
  const plain = addFurniture(createDefaultRoom(), 'wardrobe').furniture[0];
  assert.equal(plain.variant, undefined);
  for (const variant of [null, [], {}, 1, 'constructor', 'missing', '']) assert.throws(() => validateRoom(roomWith({ ...plain, variant })));
  assert.throws(() => addFurniture(createDefaultRoom(), 'custom'));
  assert.throws(() => addFurniture(createDefaultRoom(), 'wardrobe', 'double', 'vanity-round'));
});

test('custom asset and piece settings survive JSON roundtrips without inheriting unexpected fields', () => {
  const item = { ...custom(), name: '  Mi ropero  ', parts: { '0': { material: 'metal', color: '#123456', visible: false, position: { x: 2, y: -.5, z: .3 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: .5, y: 2, z: 1 }, unexpected: 'discard' }, '511': { color: '#abcdef' } }, unexpected: 'discard' };
  const result = validateRoom(roomWith(item)).furniture[0];
  assert.equal(result.name, item.name); assert.equal(result.assetId, item.assetId);
  assert.deepEqual(result.parts, { '0': { material: 'metal', color: '#123456', visible: false, position: { x: 2, y: -.5, z: .3 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: .5, y: 2, z: 1 } }, '511': { color: '#abcdef' } });
  assert.equal('unexpected' in result, false);
  assert.deepEqual(validateRoom(JSON.parse(JSON.stringify(roomWith(result)))).furniture[0], result);
  assert.deepEqual(fitRoom(validateRoom(roomWith(result))).furniture[0].parts, result.parts);
});

test('custom asset identifiers, names, category fields and part identities are validated', () => {
  for (const patch of [{ assetId: '../file' }, { assetId: '' }, { assetId: null }, { assetId: 12 }, { name: '' }, { name: ' ' }, { name: 'a'.repeat(81) }, { parts: [] }, { parts: null }, { parts: { '512': {} } }, { parts: { '-1': {} } }, { parts: { '01': {} } }, { parts: { 'a': {} } }, { parts: { '0': [] } }, { parts: { '0': null } }, { variant: 'wardrobe-classic' }, { bedSize: 'double' }]) assert.throws(() => validateRoom(roomWith({ ...custom(), ...patch })));
  const polluted = JSON.parse('{"__proto__":{"material":"wood"}}');
  assert.throws(() => validateRoom(roomWith({ ...custom(), parts: polluted })));
  assert.equal(({} as { material?: string }).material, undefined);
  for (const patch of [{ assetId: randomUUID() }, { parts: {} }, { name: 'Modelo' }]) assert.throws(() => validateRoom(roomWith({ ...addFurniture(createDefaultRoom(), 'wardrobe').furniture[0], ...patch })));
});

test('piece transforms, colors, visibility and materials reject coercion and unsafe numeric values', () => {
  for (const patch of [{ material: ['wood'] }, { material: { toString: () => 'wood' } }, { material: null }, { material: 'glass' }, { color: 'red' }, { color: '#12345g' }, { color: 123456 }, { visible: 1 }, { visible: 'false' }, { visible: null }]) assert.throws(() => validateRoom(roomWith({ ...custom(), parts: { '0': patch } })));
  for (const field of ['position', 'rotation', 'scale']) {
    for (const vector of [[], null, { x: NaN, y: 0, z: 0 }, { x: Infinity, y: 0, z: 0 }, { x: '1', y: 1, z: 1 }, { x: 0, y: 0 }, { x: field === 'scale' ? 0 : field === 'rotation' ? 361 : 21, y: 1, z: 1 }, { x: field === 'scale' ? 11 : field === 'rotation' ? -361 : -21, y: 1, z: 1 }]) assert.throws(() => validateRoom(roomWith({ ...custom(), parts: { '0': { [field]: vector } } })));
  }
  assert.doesNotThrow(() => validateRoom(roomWith({ ...custom(), parts: Object.fromEntries(Array.from({ length: 512 }, (_, id) => [id, { visible: id % 2 === 0 }])) })));
});

test('importing a large own model fits room height and preserves asset identity', () => {
  const asset = { id: randomUUID(), name: 'Modelo grande', width: 40, height: 20, depth: 30 }, room = addCustomFurniture(createDefaultRoom(), asset), item = room.furniture[0];
  assert.equal(item.type, 'custom'); assert.equal(item.assetId, asset.id); assert.equal(item.name, asset.name);
  assert.ok(item.height <= room.height && item.width <= 10 && item.depth <= 10);
  assert.equal(item.variant, undefined); assert.equal(item.parts, undefined);
  assert.doesNotThrow(() => validateRoom(room));
});
