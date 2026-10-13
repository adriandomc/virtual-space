import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';
import { createDefaultRoom, validateRoom } from './model';
import { readYRoom, seedYRoom, writeYRoom } from './collaborativeRoom';
import type { Room } from './types';

function copies(room: Room) {
  const first = new Y.Doc(), second = new Y.Doc();
  seedYRoom(first, room); Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
  return [first, second];
}
function change(doc: Y.Doc, patch: (room: Room) => Room) {
  const previous = readYRoom(doc), vector = Y.encodeStateVector(doc);
  writeYRoom(doc, patch(previous), previous);
  return Y.encodeStateAsUpdate(doc, vector);
}

test('Yjs conserva cambios simultáneos en objetos y campos distintos', () => {
  const room = createDefaultRoom();
  room.furniture = [{ id: 'ropero', type: 'wardrobe', width: 1, height: 2, depth: 0.6, x: 0, z: 0, rotation: 0 }];
  const [first, second] = copies(room);
  const one = change(first, value => ({ ...value, furniture: [{ ...value.furniture[0], x: 1 }], ceilingColor: '#112233' }));
  const two = change(second, value => ({ ...value, furniture: [{ ...value.furniture[0], color: '#aabbcc' }], sun: { ...value.sun, hour: 10 } }));
  Y.applyUpdate(first, two); Y.applyUpdate(second, one);
  const result = validateRoom(readYRoom(first));
  assert.deepEqual(result, readYRoom(second));
  assert.equal(result.furniture[0].x, 1); assert.equal(result.furniture[0].color, '#aabbcc');
  assert.equal(result.ceilingColor, '#112233'); assert.equal(result.sun.hour, 10);
  first.destroy(); second.destroy();
});

test('Yjs conserva colores simultáneos de paredes distintas', () => {
  const [first, second] = copies(createDefaultRoom());
  const one = change(first, room => ({ ...room, wallColors: room.wallColors.map((color, index) => index === 0 ? '#112233' : color) }));
  const two = change(second, room => ({ ...room, wallColors: room.wallColors.map((color, index) => index === 1 ? '#aabbcc' : color) }));
  Y.applyUpdate(first, two); Y.applyUpdate(second, one);
  assert.deepEqual(readYRoom(first), readYRoom(second));
  assert.deepEqual(readYRoom(first).wallColors.slice(0, 2), ['#112233', '#aabbcc']);
  first.destroy(); second.destroy();
});

test('un color atrasado no repone el contorno anterior y un borrado no revive por movimiento', () => {
  const room = createDefaultRoom();
  room.openings = [];
  room.furniture = [{ id: 'ropero', type: 'wardrobe', width: 1, height: 2, depth: 0.6, x: 0, z: 0, rotation: 0 }];
  const [first, second] = copies(room);
  const vertices = [{ x: -3, z: -2 }, { x: 3, z: -2 }, { x: 3, z: 2 }, { x: -3, z: 2 }];
  const one = change(first, value => ({ ...value, vertices, furniture: [] }));
  const two = change(second, value => ({ ...value, wallColors: value.wallColors.map(() => '#112233'), furniture: [{ ...value.furniture[0], x: 1 }] }));
  Y.applyUpdate(first, two); Y.applyUpdate(second, one);
  assert.deepEqual(validateRoom(readYRoom(first)), validateRoom(readYRoom(second)));
  assert.deepEqual(readYRoom(first).vertices, vertices); assert.equal(readYRoom(first).furniture.length, 0);
  first.destroy(); second.destroy();
});

test('el cambio usa la versión mostrada y conserva otros campos recibidos entretanto', () => {
  const [first, second] = copies(createDefaultRoom()), displayed = readYRoom(first);
  const remote = change(second, value => ({ ...value, floorColor: '#aabbcc' }));
  Y.applyUpdate(first, remote);
  writeYRoom(first, { ...displayed, name: 'Otro nombre' }, displayed);
  assert.equal(readYRoom(first).floorColor, '#aabbcc'); assert.equal(readYRoom(first).name, 'Otro nombre');
  first.destroy(); second.destroy();
});

test('las primeras ediciones simultáneas de una pieza conservan acabado y transformación', () => {
  const room = createDefaultRoom();
  room.furniture = [{ id: 'custom', type: 'custom', name: 'Modelo', assetId: '3141abd1-94c5-4858-a5f9-7c337f1622df', width: 1, height: 1, depth: 1, x: 0, z: 0, rotation: 0 }];
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
  room.furniture = [{ id: 'ropero', type: 'wardrobe', width: 1, height: 2, depth: 0.6, x: 0, z: 0, rotation: 0 }];
  const [first, second] = copies(room), displayed = readYRoom(first);
  const deletion = change(second, value => ({ ...value, furniture: [] }));
  Y.applyUpdate(first, deletion);
  writeYRoom(first, { ...displayed, furniture: [{ ...displayed.furniture[0], x: 1 }] }, displayed);
  assert.equal(readYRoom(first).furniture.length, 0);
  first.destroy(); second.destroy();
});

test('los campos internos no permiten datos ocultos que evadan la validación del cuarto', () => {
  const [doc] = copies(createDefaultRoom()), root = doc.getMap<unknown>('room');
  const topology = root.get('topology') as Record<string, unknown>;
  root.set('topology', { ...topology, hidden: 'Contenido no admitido' });
  assert.throws(() => readYRoom(doc));
  root.set('topology', topology);
  (root.get('wallColorOverrides') as Y.Map<unknown>).set('unrelated', { hidden: 'Contenido no admitido' });
  assert.throws(() => readYRoom(doc));
  (root.get('wallColorOverrides') as Y.Map<unknown>).delete('unrelated');
  (root.get('sun') as Y.Map<unknown>).set('__proto__', { hidden: 'Contenido no admitido' });
  assert.throws(() => readYRoom(doc)); doc.destroy();
});

test('un documento de texto o lista no puede insertar contenido invisible dentro del mapa', () => {
  const [doc] = copies(createDefaultRoom()), incompatible = new Y.Doc();
  incompatible.getArray('room').push(['Contenido oculto']);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(incompatible));
  assert.throws(() => readYRoom(doc));
  doc.destroy(); incompatible.destroy();
});
