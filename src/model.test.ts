import assert from 'node:assert/strict';
import test from 'node:test';
import { addFurniture, addLight, addOpening, BED_SIZES, bounds, createDefaultRoom, fitFurniture, fitRoom, furnitureContains, furnitureCorners, furnitureInside, furnitureWalkable, interiorPoint, interiorWalkPoint, pointInPolygon, polygonArea, resizeRoom, validateRoom, walkablePoint } from './model';
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
