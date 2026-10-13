import assert from 'node:assert/strict';
import test from 'node:test';
import { addFurniture, addLight, addOpening, bounds, createDefaultRoom, resizeRoom, validateRoom } from './model';
import { createBlankRoom, resetOnboardingStep } from './onboardingModel';

test('los proyectos nuevos empiezan blancos, vacíos y con estructura válida', () => {
  const room = validateRoom(createBlankRoom());
  assert.deepEqual(room.vertices, createDefaultRoom().vertices);
  assert.deepEqual(room.wallColors, Array(4).fill('#f5f5f2'));
  assert.equal(room.floorFinish, 'concrete');
  assert.equal(room.floorColor, '#edede8');
  assert.equal(room.ceilingColor, '#ffffff');
  assert.deepEqual(room.furniture, []);
  assert.equal(room.showFurniture, false);
  assert.equal(room.openings.length, 0);
  assert.equal(room.lights.length, 1);
  assert.equal(room.lights[0].enabled, true);
  assert.equal(room.setupStep, 0);
});

test('omitir colores mantiene planta, objetos y luces elegidos', () => {
  const room = addFurniture(resizeRoom(createBlankRoom(), 7, 6), 'bed', 'queen');
  const reset = resetOnboardingStep({ ...room, setupStep: 1, floorFinish: 'wood', ceilingColor: '#123456', wallColors: room.vertices.map(() => '#654321') }, 'colors');
  assert.deepEqual(reset.vertices, room.vertices);
  assert.deepEqual(reset.furniture, room.furniture);
  assert.deepEqual(reset.lights, room.lights);
  assert.equal(reset.floorFinish, 'concrete');
  assert.deepEqual(reset.wallColors, Array(4).fill('#f5f5f2'));
  assert.equal(reset.setupStep, 1);
});

test('omitir decoración retira todos los muebles sin cambiar la habitación', () => {
  const room = { ...addLight(addOpening(addFurniture(createBlankRoom(), 'wardrobe'), 'door', 0)), showFurniture: true, ceilingColor: '#e0d0c0' };
  const reset = resetOnboardingStep(room, 'decoration');
  assert.deepEqual(reset.furniture, []);
  assert.equal(reset.showFurniture, false);
  assert.deepEqual(reset.vertices, room.vertices);
  assert.deepEqual(reset.openings, []);
  assert.equal(reset.lights.length, 1);
  assert.deepEqual(reset.lights[0], room.lights[0]);
  assert.equal(reset.ceilingColor, room.ceilingColor);
});

test('omitir croquis vuelve a dimensiones normales conservando acabado y muebles', () => {
  const room = addOpening(addFurniture(resizeRoom(createBlankRoom(), 7, 6), 'nightstand'), 'window', 1);
  const reset = resetOnboardingStep({ ...room, height: 4, floorFinish: 'marble', floorColor: '#bbbbaa', name: 'Estudio' }, 'plan');
  assert.equal(bounds(reset.vertices).width, 5);
  assert.equal(bounds(reset.vertices).depth, 4);
  assert.equal(reset.height, 2.8);
  assert.equal(reset.openings.length, 1);
  assert.equal(reset.openings[0].id, room.openings[0].id);
  assert.equal(reset.furniture.length, 1);
  assert.equal(reset.furniture[0].id, room.furniture[0].id);
  assert.equal(reset.floorFinish, 'marble');
  assert.equal(reset.floorColor, '#bbbbaa');
  assert.equal(reset.name, 'Estudio');
  assert.deepEqual(room.vertices, resizeRoom(createBlankRoom(), 7, 6).vertices);
});

test('omitir croquis no genera puertas ni ventanas en un diseño nuevo', () => {
  const reset = resetOnboardingStep(resizeRoom(createBlankRoom(), 6, 5), 'plan');
  assert.deepEqual(reset.openings, []);
  assert.equal(reset.lights.length, 1);
});

test('el paso de creación se valida y desaparece al terminar el diseño', () => {
  const room = createBlankRoom();
  for (const setupStep of [0, 1, 2] as const) assert.equal(validateRoom({ ...room, setupStep }).setupStep, setupStep);
  for (const setupStep of [-1, 3, 0.5, '1', null, true]) assert.throws(() => validateRoom({ ...room, setupStep }));
  const { setupStep: _, ...finished } = room;
  assert.equal(validateRoom(finished).setupStep, undefined);
});
