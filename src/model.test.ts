import assert from 'node:assert/strict';
import test from 'node:test';
import { addFurniture, addLight, addOpening, BED_SIZES, bounds, createDefaultRoom, fitFurniture, fitRoom, furnitureContains, furnitureCorners, furnitureInside, furnitureWalkable, interiorPoint, interiorWalkPoint, itemWorldPosition, moveSceneItem, pointInPolygon, polygonArea, resizeRoom, snapPlanPoint, validateRoom, walkablePoint } from './model';
import type { BedSize, FurnitureItem } from './types';

test('el cuarto inicial es válido, tiene 20 m² y aberturas reales', () => {
  const room = validateRoom(createDefaultRoom());
  assert.equal(polygonArea(room.vertices), 20);
  assert.equal(bounds(room.vertices).width, 5);
  assert.equal(room.openings.length, 2);
  assert.equal(room.showFurniture, true);
});

test('conserva muebles en proyectos compartidos y admite importaciones antiguas', () => {
  const room = createDefaultRoom();
  assert.equal(validateRoom({ ...room, showFurniture: false }).showFurniture, false);
  assert.equal(validateRoom({ ...room, showFurniture: undefined }).showFurniture, true);
  assert.throws(() => validateRoom({ ...room, showFurniture: 'sí' }));
});

test('la importación valida números, tipos, colores, límites e identificadores', () => {
  const room = createDefaultRoom();
  for (const patch of [
    { height: NaN }, { height: Infinity }, { thickness: 0 }, { version: 2 }, { name: '' },
    { wallColors: ['red', ...room.wallColors.slice(1)] },
    { sun: { ...room.sun, enabled: 'sí' } },
    { lights: [{ ...room.lights[0], lumens: -1 }] },
    { lights: [{ ...room.lights[0], temperature: 14000 }] },
    { lights: [room.lights[0], room.lights[0]] },
    { openings: [{ ...room.openings[0], wall: 0.5 }] },
    { openings: [{ ...room.openings[0], sill: 0.1 }] },
    { vertices: [{ x: 51, z: 0 }, { x: 52, z: 0 }, { x: 52, z: 2 }] },
  ]) assert.throws(() => validateRoom({ ...room, ...patch }));
  assert.throws(() => validateRoom(null));
  assert.throws(() => validateRoom({ ...room, lights: [{ ...room.lights[0], x: 20 }] }), /dentro/);
  const result = validateRoom({ ...room, unexpected: 'se descarta' });
  assert.equal('unexpected' in result, false);
});

test('rechaza contornos cruzados, repetidos y segmentos superpuestos', () => {
  const room = { ...createDefaultRoom(), openings: [], lights: [] };
  const polygons = [
    [{ x: -2, z: -2 }, { x: 2, z: 2 }, { x: -2, z: 2 }, { x: 2, z: -2 }],
    [{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 2, z: -2 }, { x: -2, z: 2 }],
    [{ x: -2, z: -2 }, { x: 2, z: -2 }, { x: 1, z: -2 }, { x: 1, z: 2 }, { x: -2, z: 2 }],
  ];
  for (const vertices of polygons) assert.throws(() => validateRoom({ ...room, vertices, wallColors: vertices.map(() => '#ffffff') }));
});

test('detecta interior de un cuarto cóncavo y deja margen para caminar', () => {
  const vertices = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 1 }, { x: 1, z: 1 }, { x: 1, z: 5 }, { x: 0, z: 5 }];
  assert.equal(pointInPolygon({ x: 0.5, z: 4 }, vertices), true);
  assert.equal(pointInPolygon({ x: 3, z: 3 }, vertices), false);
  assert.equal(pointInPolygon({ x: 0, z: 2 }, vertices), true);
  assert.equal(walkablePoint({ x: 0.1, z: 2 }, vertices), false);
  assert.equal(walkablePoint({ x: 0.5, z: 2 }, vertices), true);
  assert.equal(walkablePoint(interiorPoint(vertices), vertices), true);
  assert.equal(walkablePoint(interiorPoint([...vertices].reverse()), vertices), true);
});

test('al cambiar dimensiones conserva el cuarto centrado, luces y huecos válidos', () => {
  const source = createDefaultRoom();
  const result = resizeRoom(source, 3, 2);
  assert.equal(bounds(result.vertices).width, 3);
  assert.equal(bounds(result.vertices).depth, 2);
  assert.deepEqual(result.lights.map(p => p.id), source.lights.map(p => p.id));
  assert.deepEqual(result.openings.map(p => p.id), source.openings.map(p => p.id));
  assert.equal(result.openings[0].width, source.openings[0].width);
  assert.equal(result.openings[1].height, source.openings[1].height);
  assert.equal(result.openings[1].sill, source.openings[1].sill);
  assert.doesNotThrow(() => validateRoom(result));
  assert.equal(bounds(source.vertices).width, 5);
});

test('ajusta techo, posición de luces y abertura al acortar una pared', () => {
  const room = createDefaultRoom();
  const result = fitRoom({ ...room, height: 1.8, lights: [{ ...room.lights[0], x: 10 }] });
  assert.equal(result.lights[0].y, 1.8);
  assert.equal(pointInPolygon(result.lights[0], result.vertices), true);
  assert.equal(result.openings[0].height, 1.8);
  assert.equal(result.openings[1].sill + result.openings[1].height, 1.8);
});

test('un ajuste no relacionado conserva alturas máximas válidas importadas', () => {
  const room = createDefaultRoom();
  const candidate = validateRoom({ ...room, openings: [{ ...room.openings[0], height: room.height }], lights: [{ ...room.lights[0], y: room.height }] });
  const result = fitRoom({ ...candidate, showFurniture: false });
  assert.equal(result.openings[0].height, room.height);
  assert.equal(result.lights[0].y, room.height);
});

test('reubica aberturas superpuestas y rechaza achicar sin perderlas si no caben', () => {
  const room = createDefaultRoom();
  const a = { ...room.openings[0], wall: 0, offset: 0, width: 1 };
  const b = { ...a, id: 'door-2', offset: 0.5 };
  const result = fitRoom({ ...room, openings: [a, b] });
  assert.equal(result.openings[0].offset, 0);
  assert.equal(result.openings[1].offset, 1);
  assert.throws(() => validateRoom({ ...room, openings: [a, b] }), /superponen/);
  assert.throws(() => resizeRoom({ ...room, openings: [a, { ...b, offset: 1 }] }, 1.5, 4), /ya no caben/);
});

test('permite ventana arriba de una puerta sin solapamiento vertical', () => {
  const room = createDefaultRoom();
  const a = { ...room.openings[0], wall: 0, offset: 0, height: 1.8 };
  const b = { ...a, id: 'window-top', type: 'window' as const, sill: 1.9, height: 0.5 };
  assert.doesNotThrow(() => validateRoom({ ...room, openings: [a, b] }));
});

test('añade puertas y ventanas en el espacio libre y focos en el interior', () => {
  let room = createDefaultRoom();
  room = addOpening(room, 'door', 1);
  room = addOpening(room, 'window', 0);
  room = addLight(room);
  assert.equal(room.openings.length, 4);
  assert.equal(room.lights.length, 2);
  assert.doesNotThrow(() => validateRoom(room));
  const full = { ...room, openings: [{ ...room.openings[0], wall: 0, offset: 0, width: 5 }] };
  assert.throws(() => addOpening(full, 'door', 0), /espacio/);
});

test('importa cuartos antiguos sin muebles y conserva la nueva colección', () => {
  const room = createDefaultRoom();
  const { furniture: _furniture, ...legacy } = room;
  assert.deepEqual(validateRoom(legacy).furniture, []);
  assert.deepEqual(room.furniture, []);
  const furnished = addFurniture(room, 'bed', 'queen');
  assert.deepEqual(validateRoom(JSON.parse(JSON.stringify(furnished))).furniture, furnished.furniture);
});

test('añade los cuatro tamaños mexicanos de cama con dimensiones físicas', () => {
  const expected = { single: [1, 1.9], double: [1.35, 1.9], queen: [1.5, 1.9], king: [2, 1.9] };
  for (const size of Object.keys(BED_SIZES) as BedSize[]) {
    const room = addFurniture(createDefaultRoom(), 'bed', size), bed = room.furniture[0];
    assert.equal(bed.bedSize, size);
    assert.deepEqual([bed.width, bed.depth], expected[size]);
    assert.equal(bed.height, 1.1);
    assert.equal(furnitureInside(bed, room.vertices), true);
  }
});

test('añade ropero, tocador y buró sin apilarlos sobre la cama', () => {
  let room = addFurniture(createDefaultRoom(), 'bed');
  for (const type of ['wardrobe', 'vanity', 'nightstand'] as const) room = addFurniture(room, type);
  assert.deepEqual(room.furniture.map(p => p.type), ['bed', 'wardrobe', 'vanity', 'nightstand']);
  assert.deepEqual(room.furniture.map(p => p.height), [1.1, 2, 1.5, 0.55]);
  for (let i = 0; i < room.furniture.length; i++) for (let j = i + 1; j < room.furniture.length; j++) {
    const a = room.furniture[i], b = room.furniture[j];
    assert.ok(Math.abs(a.x - b.x) >= (a.width + b.width) / 2 - 1e-7 || Math.abs(a.z - b.z) >= (a.depth + b.depth) / 2 - 1e-7);
  }
  assert.doesNotThrow(() => validateRoom(room));
});

test('valida campos, identificadores y límites de muebles sin aceptar tipos desconocidos', () => {
  const room = addFurniture(createDefaultRoom(), 'bed'), bed = room.furniture[0];
  for (const patch of [
    { type: 'sofa' }, { type: 'constructor' }, { bedSize: 'california' }, { bedSize: null },
    { x: NaN }, { z: Infinity }, { x: 100 }, { width: 0.05 }, { depth: -1 }, { width: 11 },
    { height: 3 }, { rotation: -1 }, { rotation: 361 }, { id: '' }, { id: 'a'.repeat(65) },
  ]) assert.throws(() => validateRoom({ ...room, furniture: [{ ...bed, ...patch }] }));
  assert.throws(() => validateRoom({ ...room, furniture: [bed, bed] }), /identificadores únicos/);
  assert.throws(() => validateRoom({ ...room, furniture: Array.from({ length: 65 }, (_, i) => ({ ...bed, id: String(i) })) }), /64/);
  assert.throws(() => validateRoom({ ...room, furniture: [{ ...bed, type: 'wardrobe', bedSize: 'queen' }] }), /solo corresponde/);
  const clean = validateRoom({ ...room, furniture: [{ ...bed, unsafe: '<script>' }] });
  assert.equal('unsafe' in clean.furniture[0], false);
});

test('el giro coincide con Three.js y la huella completa queda dentro de la planta', () => {
  const room = createDefaultRoom();
  const item: FurnitureItem = { id: 'rotated', type: 'nightstand', x: 0, z: 0, width: 2, depth: 1, height: 0.55, rotation: 90 };
  const corner = furnitureCorners(item)[0];
  assert.ok(Math.abs(corner.x + 0.5) < 1e-7);
  assert.ok(Math.abs(corner.z - 1) < 1e-7);
  assert.equal(furnitureContains({ x: 0, z: 0.9 }, item, 0), true);
  assert.equal(furnitureContains({ x: 0.9, z: 0 }, item, 0), false);
  assert.equal(furnitureInside(item, room.vertices), true);
  const nearWall = { ...item, x: 1.9, width: 1, depth: 1, rotation: 0 };
  assert.equal(furnitureInside(nearWall, room.vertices), true);
  assert.equal(furnitureInside({ ...nearWall, rotation: 45 }, room.vertices), false);
  assert.equal(furnitureInside({ ...nearWall, rotation: NaN }, room.vertices), false);
  assert.equal(furnitureInside({ ...nearWall, rotation: 360 }, room.vertices), true);
});

test('rechaza una huella que cruza un entrante aunque sus cuatro esquinas estén dentro', () => {
  const vertices = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 5 }, { x: 3, z: 5 }, { x: 3, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 5 }, { x: 0, z: 5 }];
  const item: FurnitureItem = { id: 'notch', type: 'bed', bedSize: 'king', x: 2.5, z: 1.5, width: 4, depth: 3, height: 1.1, rotation: 0 };
  assert.equal(furnitureCorners(item).every(p => pointInPolygon(p, vertices)), true);
  assert.equal(furnitureInside(item, vertices), false);
  assert.equal(furnitureInside(item, [...vertices].reverse()), false);
  assert.equal(furnitureInside({ ...item, x: 1, z: 3, width: 1, depth: 2 }, vertices), true);
});

test('recoloca sin encoger muebles al cambiar la planta y rechaza si no caben', () => {
  const source = addFurniture(createDefaultRoom(), 'bed', 'king'), bed = source.furniture[0];
  const moved = fitFurniture(source, { ...bed, x: 10 });
  assert.equal(furnitureInside(moved, source.vertices), true);
  assert.equal(moved.width, 2);
  const resized = resizeRoom(source, 2, 1.9);
  assert.deepEqual(resized.furniture.map(p => [p.id, p.width, p.depth, p.height, p.rotation]), source.furniture.map(p => [p.id, p.width, p.depth, p.height, p.rotation]));
  assert.equal(furnitureInside(resized.furniture[0], resized.vertices), true);
  assert.throws(() => resizeRoom(source, 1.5, 2), /no cabe/);
  assert.deepEqual(source.furniture[0], bed);
  const positioned = { ...bed, x: 1, z: 0.8 };
  const scaled = resizeRoom({ ...source, furniture: [positioned] }, 6, 5);
  assert.equal(scaled.furniture[0].x, 1.2);
  assert.equal(scaled.furniture[0].z, 1);
  assert.deepEqual(fitRoom(source).furniture, source.furniture);
});

test('la edición manual admite superposición pero añadir requiere espacio libre', () => {
  const room = addFurniture(createDefaultRoom(), 'bed'), bed = room.furniture[0];
  assert.doesNotThrow(() => validateRoom({ ...room, furniture: [bed, { ...bed, id: 'other-bed' }] }));
  const full: FurnitureItem = { id: 'full', type: 'wardrobe', x: 0, z: 0, width: 5, depth: 4, height: 2, rotation: 0 };
  assert.throws(() => addFurniture({ ...room, furniture: [full] }, 'nightstand'), /No queda espacio/);
});

test('el recorrido encuentra un punto libre y colisiona con muebles aunque se oculten referencias', () => {
  const room = addFurniture(createDefaultRoom(), 'bed'), bed = room.furniture[0];
  assert.equal(furnitureWalkable({ x: bed.x, z: bed.z }, room), false);
  assert.equal(furnitureWalkable({ x: bed.x, z: bed.z }, { ...room, showFurniture: false }), false);
  assert.equal(furnitureWalkable({ x: -2.4, z: 0 }, room), false);
  const free = interiorWalkPoint(room);
  assert.ok(free);
  assert.equal(furnitureWalkable(free, room), true);
  const covered = { ...bed, width: 5, depth: 4 };
  assert.equal(interiorWalkPoint({ ...room, furniture: [covered] }), null);
});

test('la ubicación automática respeta la cara interior incluso con paredes gruesas', () => {
  for (const thickness of [0.15, 0.6]) {
    let room = { ...createDefaultRoom(), thickness };
    for (const type of ['bed', 'wardrobe', 'vanity', 'nightstand'] as const) room = addFurniture(room, type);
    const margin = thickness / 2 + 0.02;
    for (const item of room.furniture) {
      const corners = furnitureCorners(item);
      assert.ok(Math.min(...corners.map(p => p.x)) >= -2.5 + margin - 1e-7);
      assert.ok(Math.max(...corners.map(p => p.x)) <= 2.5 - margin + 1e-7);
      assert.ok(Math.min(...corners.map(p => p.z)) >= -2 + margin - 1e-7);
      assert.ok(Math.max(...corners.map(p => p.z)) <= 2 - margin + 1e-7);
      assert.equal(furnitureInside(item, room.vertices, margin), true);
    }
  }
  const tiny = resizeRoom({ ...createDefaultRoom(), openings: [] }, 2, 1.9);
  assert.throws(() => addFurniture(tiny, 'bed', 'king'), /no cabe/);
  const room = addFurniture(createDefaultRoom(), 'nightstand'), item = { ...room.furniture[0], x: -2.25, z: 0 };
  assert.equal(furnitureInside(item, room.vertices), true);
  assert.equal(furnitureInside(item, room.vertices, room.thickness / 2 + 0.02), false);
  assert.deepEqual(fitFurniture(room, item), item);
});

test('proyectos anteriores reciben techo, acabado, calidad y editor compatibles', () => {
  const { ceilingColor: _ceiling, floorFinish: _floor, renderQuality: _quality, editing: _editing, ...legacy } = createDefaultRoom();
  const room = validateRoom(legacy);
  assert.equal(room.ceilingColor, '#f2f0e9');
  assert.equal(room.floorFinish, 'wood');
  assert.equal(room.renderQuality, 'standard');
  assert.deepEqual(room.editing, { snap: true, step: 0.1, bounds: true });
  for (const patch of [{ ceilingColor: 'red' }, { floorFinish: 'plastic' }, { renderQuality: 'cinema' }, { editing: { ...room.editing, step: 0 } }, { editing: { ...room.editing, bounds: 'sí' } }]) assert.throws(() => validateRoom({ ...room, ...patch }));
  const stored = validateRoom({ ...room, ceilingColor: '#abcdef', floorFinish: 'tile-brick', renderQuality: 'realistic', editing: { snap: false, step: 0.25, bounds: false } });
  assert.equal(stored.floorFinish, 'tile-brick');
  assert.equal(stored.renderQuality, 'realistic');
  assert.equal(stored.editing.bounds, false);
});

test('el trazado ajusta cuadrícula y longitud/dirección de segmentos', () => {
  const raw = { x: 1.234, z: 0.091 };
  assert.deepEqual(snapPlanPoint(null, raw, { grid: false, step: 0.1, angles: false }), raw);
  assert.deepEqual(snapPlanPoint(null, raw, { grid: true, step: 0.1, angles: false }), { x: 1.2, z: 0.1 });
  assert.deepEqual(snapPlanPoint({ x: 0, z: 0 }, raw, { grid: true, step: 0.1, angles: true, angleStep: 90 }), { x: 1.2, z: 0 });
  const diagonal = snapPlanPoint({ x: 1, z: 1 }, { x: 2, z: 1.9 }, { grid: false, step: 0.1, angles: true, angleStep: 45 });
  assert.ok(Math.abs((diagonal.z - 1) / (diagonal.x - 1) - 1) < 1e-6);
  assert.throws(() => snapPlanPoint(null, raw, { grid: true, step: 0, angles: false }));
});

test('el movimiento de muebles ajusta cuadrícula y se detiene en paredes y objetos', () => {
  let room = addFurniture(createDefaultRoom(), 'nightstand');
  const id = room.furniture[0].id;
  room = moveSceneItem(room, { kind: 'furniture', id }, { x: 0.24, z: 0.34 });
  assert.equal(room.furniture[0].x, 0.2);
  assert.equal(room.furniture[0].z, 0.3);
  const clamped = moveSceneItem(room, { kind: 'furniture', id }, { x: 20, z: 0.3 });
  assert.equal(furnitureInside(clamped.furniture[0], room.vertices, room.thickness / 2 + 0.02), true);
  assert.ok(clamped.furniture[0].x < 2.5);
  const obstacle = { ...room.furniture[0], id: 'obstacle', x: 1, z: 0.3 };
  const collisionRoom = validateRoom({ ...room, furniture: [room.furniture[0], obstacle] });
  const stopped = moveSceneItem(collisionRoom, { kind: 'furniture', id }, { x: 1, z: 0.3 });
  assert.ok(stopped.furniture[0].x <= 0.5 + 1e-7);
  const unlocked = moveSceneItem({ ...room, editing: { ...room.editing, snap: false, bounds: false } }, { kind: 'furniture', id }, { x: 8.234, z: 7.567, rotation: 45 });
  assert.equal(unlocked.furniture[0].x, 8.234);
  assert.equal(unlocked.furniture[0].z, 7.567);
  assert.equal(unlocked.furniture[0].rotation, 45);
  assert.doesNotThrow(() => validateRoom(unlocked));
  assert.throws(() => validateRoom({ ...unlocked, editing: { ...unlocked.editing, bounds: true } }), /dentro/);
});

test('las luces usan límites opcionales y siempre mantienen altura válida', () => {
  const room = createDefaultRoom(), id = room.lights[0].id;
  const clamped = moveSceneItem(room, { kind: 'light', id }, { x: 10, z: 0, y: 20 });
  assert.equal(pointInPolygon(clamped.lights[0], room.vertices), true);
  assert.equal(clamped.lights[0].y, room.height);
  const free = moveSceneItem({ ...room, editing: { ...room.editing, bounds: false, snap: false } }, { kind: 'light', id }, { x: -7.123, z: 4.567, y: -1 });
  assert.equal(free.lights[0].x, -7.123);
  assert.equal(free.lights[0].y, 0.1);
  assert.throws(() => moveSceneItem(room, { kind: 'light', id }, { x: NaN, z: 0 }));
});

test('una ventana se transfiere entre paredes con altura, ancho e identificador intactos', () => {
  const room = createDefaultRoom(), window = room.openings[1];
  const moved = moveSceneItem(room, { kind: 'opening', id: window.id }, { x: 0, z: -2, y: 1.6 });
  const aperture = moved.openings.find(p => p.id === window.id)!;
  assert.equal(aperture.wall, 0);
  assert.equal(aperture.width, window.width);
  assert.equal(aperture.height, window.height);
  assert.equal(aperture.sill, 1);
  const position = itemWorldPosition(moved, { kind: 'opening', id: window.id });
  assert.ok(position);
  assert.equal(position.z, -2);
  const blocked = { ...room, openings: [...room.openings, { ...window, id: 'other', wall: 0, offset: 1.5, width: 2 }] };
  const adjusted = moveSceneItem(blocked, { kind: 'opening', id: window.id }, { x: 0, z: -2 });
  assert.doesNotThrow(() => validateRoom(adjusted));
  assert.equal(adjusted.openings.length, blocked.openings.length);
  const noSpace = validateRoom({ ...room, openings: [
    { ...window, width: 1, height: 0.3, sill: 2, wall: 0, offset: 0 },
    ...room.vertices.map((_, wall) => ({ ...window, id: `full-${wall}`, wall, width: wall % 2 === 0 ? 5 : 4, offset: 0, height: 0.3, sill: 1.1 })),
  ] });
  assert.throws(() => moveSceneItem(noSpace, { kind: 'opening', id: window.id }, { x: 0, z: -2, y: 1.25 }), /No queda espacio/);
});

test('el límite de una planta cóncava sigue activo al arrastrar y posiciones de selección son coherentes', () => {
  const base = createDefaultRoom(), vertices = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 1 }, { x: 1, z: 1 }, { x: 1, z: 5 }, { x: 0, z: 5 }];
  const room = validateRoom({ ...base, vertices, wallColors: vertices.map(() => '#ffffff'), openings: [], lights: [], furniture: [{ id: 'small', type: 'nightstand', x: 0.5, z: 3, width: 0.4, depth: 0.4, height: 0.5, rotation: 0 }] });
  const moved = moveSceneItem(room, { kind: 'furniture', id: 'small' }, { x: 3, z: 3 });
  assert.equal(furnitureInside(moved.furniture[0], vertices), true);
  assert.equal(itemWorldPosition(room, { kind: 'furniture', id: 'small' })?.y, 0.25);
  assert.equal(itemWorldPosition(room, { kind: 'ceiling' })?.y, room.height);
  assert.equal(itemWorldPosition(room, { kind: 'floor' })?.y, 0);
  assert.equal(itemWorldPosition(room, { kind: 'furniture', id: 'missing' }), null);
});

test('un salto del puntero se detiene antes del primer mueble incluso con cuadrícula gruesa', () => {
  const base = createDefaultRoom();
  const moving: FurnitureItem = { id: 'moving', type: 'nightstand', x: -1, z: 0, width: 0.1, depth: 0.1, height: 0.55, rotation: 0 };
  const obstacle = { ...moving, id: 'obstacle', x: 0.5, depth: 0.5 };
  const room = validateRoom({ ...base, furniture: [moving, obstacle], editing: { ...base.editing, step: 1 } });
  assert.equal(furnitureInside({ ...moving, x: 1 }, room.vertices), true);
  const stopped = moveSceneItem(room, { kind: 'furniture', id: moving.id }, { x: 1, z: 0 });
  assert.equal(stopped.furniture[0].x, 0);
  assert.equal(stopped.furniture[0].z, 0);
  assert.equal(stopped.furniture[1].x, obstacle.x);
  const precise = moveSceneItem({ ...room, editing: { ...room.editing, snap: false } }, { kind: 'furniture', id: moving.id }, { x: 1, z: 0 });
  assert.ok(precise.furniture[0].x <= 0.4 + 1e-6);
  assert.ok(precise.furniture[0].x > 0.39);
});

test('un destino válido en otra rama de una planta en L no atraviesa el exterior', () => {
  const base = createDefaultRoom(), vertices = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 1 }, { x: 1, z: 1 }, { x: 1, z: 5 }, { x: 0, z: 5 }];
  const moving: FurnitureItem = { id: 'moving', type: 'nightstand', x: 0.5, z: 3, width: 0.2, depth: 0.2, height: 0.55, rotation: 0 };
  const room = validateRoom({ ...base, vertices, wallColors: vertices.map(() => '#ffffff'), openings: [], furniture: [moving], lights: [{ ...base.lights[0], x: 0.5, z: 3 }] });
  const target = { x: 3, z: 0.5 };
  assert.equal(furnitureInside({ ...moving, ...target }, vertices, room.thickness / 2 + 0.02), true);
  const furniture = moveSceneItem(room, { kind: 'furniture', id: moving.id }, target).furniture[0];
  assert.ok(furniture.x <= 0.8 + 1e-7);
  assert.ok(furniture.z > 2.5);
  assert.equal(furnitureInside(furniture, vertices, room.thickness / 2 + 0.02), true);
  const light = moveSceneItem(room, { kind: 'light', id: room.lights[0].id }, target).lights[0];
  assert.ok(light.x <= 1 + 1e-7);
  assert.ok(light.z >= 2.5 - 1e-7);
  assert.equal(pointInPolygon(light, vertices), true);
});

test('reactivar límites conserva el buró y recoloca una cama externa sin superponerla', () => {
  const base = createDefaultRoom();
  const bed: FurnitureItem = { id: 'bed', type: 'bed', bedSize: 'queen', x: 7, z: 0.2, width: 1.5, depth: 1.9, height: 1.1, rotation: 0 };
  const nightstand: FurnitureItem = { id: 'nightstand', type: 'nightstand', x: 1.7, z: 0.2, width: 0.5, depth: 0.45, height: 0.55, rotation: 0 };
  const outside = validateRoom({ ...base, editing: { ...base.editing, bounds: false }, furniture: [bed, nightstand] });
  const fitted = fitRoom({ ...outside, editing: { ...outside.editing, bounds: true } });
  assert.deepEqual(fitted.furniture[1], nightstand);
  assert.deepEqual(fitted.furniture.map(item => item.id), ['bed', 'nightstand']);
  const placed = fitted.furniture[0];
  assert.equal(furnitureInside(placed, fitted.vertices), true);
  assert.ok(Math.abs(placed.x - nightstand.x) >= (placed.width + nightstand.width) / 2 - 1e-7 || Math.abs(placed.z - nightstand.z) >= (placed.depth + nightstand.depth) / 2 - 1e-7);
  const moved = moveSceneItem(fitted, { kind: 'furniture', id: bed.id }, { x: -0.3, z: 0 });
  assert.equal(moved.furniture[0].x, -0.3);
});

test('permite retirar una superposición antigua pero se detiene ante obstáculos nuevos', () => {
  const base = createDefaultRoom();
  const item: FurnitureItem = { id: 'moving', type: 'nightstand', x: 0, z: 0, width: 0.5, depth: 0.5, height: 0.55, rotation: 0 };
  const overlap = { ...item, id: 'legacy', x: 0.2 }, obstacle = { ...item, id: 'obstacle', x: 1.5 };
  const room = validateRoom({ ...base, furniture: [item, overlap, obstacle] });
  const moved = moveSceneItem(room, { kind: 'furniture', id: item.id }, { x: 2, z: 0 });
  assert.equal(moved.furniture[0].x, 1);
  const returned = moveSceneItem(moved, { kind: 'furniture', id: item.id }, { x: 0.2, z: 0 });
  assert.ok(returned.furniture[0].x >= 0.7 - 1e-7);
  const fitted = fitRoom(room);
  assert.deepEqual(fitted.furniture[0], item);
  assert.deepEqual(fitted.furniture[2], obstacle);
  const separated = fitted.furniture[1];
  assert.ok(Math.abs(separated.x - item.x) >= item.width - 1e-7 || Math.abs(separated.z - item.z) >= item.depth - 1e-7);
});
