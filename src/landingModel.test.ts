import assert from 'node:assert/strict';
import test from 'node:test';
import { createLandingRoom, LANDING_WARDROBE_ID, updateLandingWardrobe } from './landingModel';
import { interiorWalkPoint, invalidFurnitureIds, toggleSceneInteraction, validateRoom } from './model';

test('el demo comienza sin superposiciones, con espacio para caminar y una puerta cerrada', () => {
  const room = createLandingRoom();
  assert.deepEqual(validateRoom(room), room);
  assert.equal(invalidFurnitureIds(room).size, 0);
  assert.notEqual(interiorWalkPoint(room), null);
  assert.equal(room.openings.find(item => item.type === 'door')?.open, false);
  assert.equal(room.lights[0].enabled, true);
  room.furniture[0].x = 8;
  assert.notEqual(createLandingRoom().furniture[0].x, 8);
});

test('editar el ropero mantiene el resto del demo y las interacciones del recorrido', () => {
  const initial = createLandingRoom();
  const toured = toggleSceneInteraction(toggleSceneInteraction(initial, { kind: 'opening', id: 'demo-door' }), { kind: 'light', id: 'demo-light' });
  const edited = updateLandingWardrobe(toured, { x: 1.2, width: 1.3, color: '#71818e', material: 'metal' });
  assert.equal(edited.furniture.find(item => item.id === LANDING_WARDROBE_ID)?.color, '#71818e');
  assert.equal(edited.furniture.find(item => item.id === LANDING_WARDROBE_ID)?.material, 'metal');
  assert.deepEqual(edited.furniture.filter(item => item.id !== LANDING_WARDROBE_ID), toured.furniture.filter(item => item.id !== LANDING_WARDROBE_ID));
  assert.deepEqual(edited.openings, toured.openings);
  assert.deepEqual(edited.lights, toured.lights);
  assert.equal(initial.openings[0].open, false);
  assert.equal(initial.lights[0].enabled, true);
  assert.throws(() => updateLandingWardrobe(edited, { height: 8 }));
  assert.throws(() => updateLandingWardrobe(edited, { color: '' }));
});
