import assert from 'node:assert/strict';
import test from 'node:test';
import { addFurniture, addLight, addOpening, BED_SIZES, bounds, createDefaultRoom, fitFurniture, fitRoom, furnitureContains, furnitureCorners, furnitureInside, furniturePlacementIssues, furnitureWalkable, interiorPoint, interiorWalkPoint, invalidFurnitureIds, itemWorldPosition, moveSceneItem, pointInPolygon, polygonArea, resizeRoom, snapPlanPoint, toggleSceneInteraction, validateRoom, walkablePoint } from './model';
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

test('las aberturas de alta manual conservan las dimensiones exactas introducidas', () => {
  const room = { ...createDefaultRoom(), openings: [] };
  const doorRoom = addOpening(room, 'door', 0, { width: 0.82, height: 2.23, doorStyle: 'left' });
  assert.deepEqual([doorRoom.openings[0].width, doorRoom.openings[0].height, doorRoom.openings[0].sill, doorRoom.openings[0].doorStyle], [0.82, 2.23, 0, 'left']);
  const windowRoom = addOpening(room, 'window', 1, { width: 1.23, height: 1.47, sill: 0.67 });
  assert.deepEqual([windowRoom.openings[0].width, windowRoom.openings[0].height, windowRoom.openings[0].sill], [1.23, 1.47, 0.67]);
  assert.equal('doorStyle' in windowRoom.openings[0], false);
  for (const options of [
    { width: 0.9, height: 0 }, { width: 0.9, height: NaN }, { width: 0.9, height: 3 },
    { width: 6, height: 2 }, { width: 0.9, height: 2, sill: 1 },
  ]) assert.throws(() => addOpening(room, 'window', 0, options));
  assert.throws(() => addOpening(room, 'door', 0, { width: 0.9, height: 2, sill: 0.1 }));
  assert.throws(() => addOpening(room, 'window', 0, { width: 0.9, height: 2, doorStyle: 'frame' }));
  const occupied = addOpening(room, 'door', 0, { width: 4.5, height: 2 });
  assert.throws(() => addOpening(occupied, 'door', 0, { width: 0.9, height: 2 }), /espacio/);
  assert.deepEqual(occupied.openings.map(item => item.width), [4.5]);
});

test('conserva el sentido de puerta al mover, ajustar y guardar y rechaza estilos inválidos', () => {
  const base = createDefaultRoom();
  for (const doorStyle of ['right', 'left', 'frame'] as const) {
    const room = addOpening({ ...base, openings: [] }, 'door', 0, { width: 0.9, height: 2.1, doorStyle });
    const id = room.openings[0].id;
    for (const result of [fitRoom(room), resizeRoom(room, 6, 5), moveSceneItem(room, { kind: 'opening', id }, { x: -2.5, z: 0 }), validateRoom(JSON.parse(JSON.stringify(room)))]) assert.equal(result.openings[0].doorStyle, doorStyle);
    for (const invalid of ['both', '', null, 1, {}]) assert.throws(() => validateRoom({ ...room, openings: [{ ...room.openings[0], doorStyle: invalid }] }), /apertura de puerta/);
  }
  assert.equal('doorStyle' in validateRoom(base).openings[0], false);
});

test('el alta manual permite una ventana sobre una puerta sin superponerlas verticalmente', () => {
  const room = addOpening({ ...createDefaultRoom(), openings: [] }, 'door', 0, { width: 5, height: 2.1, doorStyle: 'frame' });
  const withTransom = addOpening(room, 'window', 0, { width: 1.25, height: 0.4, sill: 2.2 });
  assert.deepEqual(withTransom.openings[0], room.openings[0]);
  assert.deepEqual([withTransom.openings[1].width, withTransom.openings[1].height, withTransom.openings[1].sill], [1.25, 0.4, 2.2]);
  const contact = addOpening(room, 'window', 0, { width: 1.25, height: 0.4, sill: 2.1 });
  assert.equal(contact.openings.length, 2);
  assert.doesNotThrow(() => validateRoom(contact));
  assert.throws(() => addOpening(room, 'window', 0, { width: 1.25, height: 0.4, sill: 2.09 }), /espacio/);
});

test('las puertas nuevas empiezan cerradas y el estado se conserva al mover, ajustar y guardar', () => {
  const base = { ...createDefaultRoom(), openings: [] };
  for (const doorStyle of ['right', 'left'] as const) {
    const room = addOpening(base, 'door', 0, { width: 0.9, height: 2.1, doorStyle });
    assert.equal(room.openings[0].open, false);
    const selection = { kind: 'opening' as const, id: room.openings[0].id };
    const opened = toggleSceneInteraction(room, selection);
    assert.equal(opened.openings[0].open, true);
    for (const result of [fitRoom(opened), resizeRoom(opened, 6, 5), moveSceneItem(opened, selection, { x: -2.5, z: 0 }), validateRoom(JSON.parse(JSON.stringify(opened)))]) assert.equal(result.openings[0].open, true);
    assert.deepEqual(toggleSceneInteraction(opened, selection), room);
  }
  assert.equal('open' in addOpening(base, 'door', 0).openings[0], true);
  assert.equal('open' in addOpening(base, 'door', 0, { width: 0.9, height: 2.1, doorStyle: 'frame' }).openings[0], false);
  assert.equal('open' in addOpening(base, 'window', 0, { width: 0.9, height: 1 }).openings[0], false);
  const legacy = validateRoom(createDefaultRoom());
  assert.equal('open' in legacy.openings[0], false);
  assert.equal(toggleSceneInteraction(legacy, { kind: 'opening', id: legacy.openings[0].id }).openings[0].open, false);
});

test('interactúa sólo con puertas con hoja y focos sin modificar otras propiedades', () => {
  const base = createDefaultRoom();
  const room = { ...base, openings: [...base.openings, { ...base.openings[0], id: 'frame', wall: 0, doorStyle: 'frame' as const, open: false }] };
  const lit = toggleSceneInteraction(room, { kind: 'light', id: room.lights[0].id });
  assert.deepEqual(lit, { ...room, lights: [{ ...room.lights[0], enabled: true }] });
  assert.deepEqual(toggleSceneInteraction(lit, { kind: 'light', id: room.lights[0].id }), room);
  for (const selection of [{ kind: 'opening' as const, id: room.openings[1].id }, { kind: 'opening' as const, id: 'frame' }, { kind: 'opening' as const, id: 'missing' }, { kind: 'light' as const, id: 'missing' }, { kind: 'furniture' as const, id: 'missing' }, { kind: 'floor' as const }]) assert.equal(toggleSceneInteraction(room, selection), room);
});

test('rechaza estados corruptos de puertas y estados en ventanas', () => {
  const room = createDefaultRoom();
  for (const open of [null, '', 'false', 0, 1, {}, []]) assert.throws(() => validateRoom({ ...room, openings: [{ ...room.openings[0], open }] }), /estado de puerta/);
  for (const open of [true, false]) assert.throws(() => validateRoom({ ...room, openings: [{ ...room.openings[1], open }] }), /sólo corresponde/);
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

test('conserva estilos de muebles y omite los campos ausentes de proyectos anteriores', () => {
  for (const type of ['bed', 'wardrobe', 'vanity', 'nightstand'] as const) {
    const room = addFurniture(createDefaultRoom(), type);
    const legacy = validateRoom(JSON.parse(JSON.stringify(room))).furniture[0];
    assert.equal('material' in legacy, false);
    assert.equal('color' in legacy, false);
    for (const material of ['wood', 'plastic', 'metal'] as const) {
      const item = { ...legacy, material, color: '#A5B6C7' };
      const styled = validateRoom({ ...room, furniture: [item] });
      assert.deepEqual(styled.furniture[0], item);
      const variants = [
        fitFurniture(styled, { ...item, x: 10 }),
        fitRoom(styled).furniture[0],
        resizeRoom(styled, 6, 5).furniture[0],
        moveSceneItem(styled, { kind: 'furniture', id: item.id }, { x: 0, z: 0, rotation: 15 }).furniture[0],
      ];
      if (type === 'bed') variants.push(validateRoom({ ...styled, furniture: [{ ...item, bedSize: 'king', width: BED_SIZES.king.width, depth: BED_SIZES.king.depth }] }).furniture[0]);
      for (const changed of variants) {
        assert.equal(changed.material, material);
        assert.equal(changed.color, item.color);
      }
    }
    for (const patch of [{ material: 'metal' }, { color: '#abcdef' }]) assert.deepEqual(validateRoom({ ...room, furniture: [{ ...legacy, ...patch }] }).furniture[0], { ...legacy, ...patch });
  }
});

test('rechaza materiales y colores de mueble inválidos sin convertir campos ausentes', () => {
  const room = addFurniture(createDefaultRoom(), 'nightstand'), item = room.furniture[0];
  for (const material of ['glass', 'constructor', '', null, 1, false, {}]) assert.throws(() => validateRoom({ ...room, furniture: [{ ...item, material }] }), /material de mueble/);
  for (const color of ['red', '#abc', '#abcdef00', '', null, 1, false, {}]) assert.throws(() => validateRoom({ ...room, furniture: [{ ...item, color }] }), /Color de mueble/);
  assert.deepEqual(validateRoom(room).furniture[0], item);
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

test('conserva posición y dimensiones elegidas de muebles al cambiar la planta', () => {
  const source = addFurniture(createDefaultRoom(), 'bed', 'king'), bed = source.furniture[0];
  const moved = fitFurniture(source, { ...bed, x: 10 });
  assert.equal(moved.x, 10);
  assert.deepEqual(furniturePlacementIssues(source, moved), { outside: true, overlap: false });
  assert.equal(moved.width, 2);
  const resized = resizeRoom(source, 2, 1.9);
  assert.deepEqual(resized.furniture, source.furniture);
  assert.equal(furniturePlacementIssues(resized, resized.furniture[0]).outside, true);
  assert.deepEqual(resizeRoom(source, 1.5, 2).furniture, source.furniture);
  assert.deepEqual(source.furniture[0], bed);
  const positioned = { ...bed, x: 1, z: 0.8 };
  const resizedLarge = resizeRoom({ ...source, furniture: [positioned] }, 6, 5);
  assert.deepEqual(resizedLarge.furniture[0], positioned);
  assert.deepEqual(fitRoom(source).furniture, source.furniture);
});

test('añadir en un cuarto ocupado conserva los muebles y advierte de superposición', () => {
  const room = addFurniture(createDefaultRoom(), 'bed'), bed = room.furniture[0];
  assert.doesNotThrow(() => validateRoom({ ...room, furniture: [bed, { ...bed, id: 'other-bed' }] }));
  const full: FurnitureItem = { id: 'full', type: 'wardrobe', x: 0, z: 0, width: 5, depth: 4, height: 2, rotation: 0 };
  const added = addFurniture({ ...room, furniture: [full] }, 'nightstand');
  assert.deepEqual(added.furniture[0], full);
  assert.deepEqual([added.furniture[1].x, added.furniture[1].z], [0, 0]);
  assert.deepEqual(invalidFurnitureIds(added), new Set(added.furniture.map(item => item.id)));
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
  const added = addFurniture(tiny, 'bed', 'king');
  assert.equal(added.furniture.length, 1);
  assert.equal(furniturePlacementIssues(added, added.furniture[0]).outside, true);
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
  assert.equal(validateRoom({ ...stored, renderQuality: 'hyperrealistic' }).renderQuality, 'hyperrealistic');
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

test('el movimiento ajusta cuadrícula sin detenerse por paredes u otros muebles', () => {
  let room = addFurniture(createDefaultRoom(), 'nightstand');
  const id = room.furniture[0].id;
  room = moveSceneItem(room, { kind: 'furniture', id }, { x: 0.24, z: 0.34 });
  assert.equal(room.furniture[0].x, 0.2);
  assert.equal(room.furniture[0].z, 0.3);
  const clamped = moveSceneItem(room, { kind: 'furniture', id }, { x: 20, z: 0.3 });
  assert.equal(clamped.furniture[0].x, 20);
  assert.deepEqual(furniturePlacementIssues(clamped, clamped.furniture[0]), { outside: true, overlap: false });
  const obstacle = { ...room.furniture[0], id: 'obstacle', x: 1, z: 0.3 };
  const collisionRoom = validateRoom({ ...room, furniture: [room.furniture[0], obstacle] });
  const overlapping = moveSceneItem(collisionRoom, { kind: 'furniture', id }, { x: 1, z: 0.3 });
  assert.equal(overlapping.furniture[0].x, 1);
  assert.deepEqual(invalidFurnitureIds(overlapping), new Set([id, obstacle.id]));
  const unlocked = moveSceneItem({ ...room, editing: { ...room.editing, snap: false, bounds: false } }, { kind: 'furniture', id }, { x: 8.234, z: 7.567, rotation: 45 });
  assert.equal(unlocked.furniture[0].x, 8.234);
  assert.equal(unlocked.furniture[0].z, 7.567);
  assert.equal(unlocked.furniture[0].rotation, 45);
  assert.doesNotThrow(() => validateRoom(unlocked));
  assert.doesNotThrow(() => validateRoom({ ...unlocked, editing: { ...unlocked.editing, bounds: true } }));
  const limited = moveSceneItem(room, { kind: 'furniture', id }, { x: 70, z: -80 });
  assert.deepEqual([limited.furniture[0].x, limited.furniture[0].z], [50, -50]);
  assert.throws(() => moveSceneItem(room, { kind: 'furniture', id }, { x: NaN, z: 0 }));
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

test('una planta cóncava advierte de muebles fuera sin impedir su movimiento', () => {
  const base = createDefaultRoom(), vertices = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 1 }, { x: 1, z: 1 }, { x: 1, z: 5 }, { x: 0, z: 5 }];
  const room = validateRoom({ ...base, vertices, wallColors: vertices.map(() => '#ffffff'), openings: [], lights: [], furniture: [{ id: 'small', type: 'nightstand', x: 0.5, z: 3, width: 0.4, depth: 0.4, height: 0.5, rotation: 0 }] });
  const moved = moveSceneItem(room, { kind: 'furniture', id: 'small' }, { x: 3, z: 3 });
  assert.deepEqual([moved.furniture[0].x, moved.furniture[0].z], [3, 3]);
  assert.equal(furniturePlacementIssues(moved, moved.furniture[0]).outside, true);
  assert.equal(itemWorldPosition(room, { kind: 'furniture', id: 'small' })?.y, 0.25);
  assert.equal(itemWorldPosition(room, { kind: 'ceiling' })?.y, room.height);
  assert.equal(itemWorldPosition(room, { kind: 'floor' })?.y, 0);
  assert.equal(itemWorldPosition(room, { kind: 'furniture', id: 'missing' }), null);
});

test('un salto del puntero alcanza el destino aunque atraviese otro mueble', () => {
  const base = createDefaultRoom();
  const moving: FurnitureItem = { id: 'moving', type: 'nightstand', x: -1, z: 0, width: 0.1, depth: 0.1, height: 0.55, rotation: 0 };
  const obstacle = { ...moving, id: 'obstacle', x: 0.5, depth: 0.5 };
  const room = validateRoom({ ...base, furniture: [moving, obstacle], editing: { ...base.editing, step: 1 } });
  assert.equal(furnitureInside({ ...moving, x: 1 }, room.vertices), true);
  const moved = moveSceneItem(room, { kind: 'furniture', id: moving.id }, { x: 1, z: 0 });
  assert.equal(moved.furniture[0].x, 1);
  assert.equal(moved.furniture[0].z, 0);
  assert.deepEqual(moved.furniture[1], obstacle);
  assert.equal(invalidFurnitureIds(moved).size, 0);
  const precise = moveSceneItem({ ...room, editing: { ...room.editing, snap: false } }, { kind: 'furniture', id: moving.id }, { x: 1, z: 0 });
  assert.equal(precise.furniture[0].x, 1);
});

test('un mueble puede cruzar entre ramas de una planta en L y la luz mantiene sus límites', () => {
  const base = createDefaultRoom(), vertices = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 1 }, { x: 1, z: 1 }, { x: 1, z: 5 }, { x: 0, z: 5 }];
  const moving: FurnitureItem = { id: 'moving', type: 'nightstand', x: 0.5, z: 3, width: 0.2, depth: 0.2, height: 0.55, rotation: 0 };
  const room = validateRoom({ ...base, vertices, wallColors: vertices.map(() => '#ffffff'), openings: [], furniture: [moving], lights: [{ ...base.lights[0], x: 0.5, z: 3 }] });
  const target = { x: 3, z: 0.5 };
  assert.equal(furnitureInside({ ...moving, ...target }, vertices, room.thickness / 2 + 0.02), true);
  const furniture = moveSceneItem(room, { kind: 'furniture', id: moving.id }, target).furniture[0];
  assert.equal(furniture.x, target.x);
  assert.equal(furniture.z, target.z);
  assert.equal(furnitureInside(furniture, vertices, room.thickness / 2 + 0.02), true);
  const light = moveSceneItem(room, { kind: 'light', id: room.lights[0].id }, target).lights[0];
  assert.ok(light.x <= 1 + 1e-7);
  assert.ok(light.z >= 2.5 - 1e-7);
  assert.equal(pointInPolygon(light, vertices), true);
});

test('reactivar límites conserva la posición elegida incluso si la cama está fuera', () => {
  const base = createDefaultRoom();
  const bed: FurnitureItem = { id: 'bed', type: 'bed', bedSize: 'queen', x: 7, z: 0.2, width: 1.5, depth: 1.9, height: 1.1, rotation: 0 };
  const nightstand: FurnitureItem = { id: 'nightstand', type: 'nightstand', x: 1.7, z: 0.2, width: 0.5, depth: 0.45, height: 0.55, rotation: 0 };
  const outside = validateRoom({ ...base, editing: { ...base.editing, bounds: false }, furniture: [bed, nightstand] });
  const fitted = fitRoom({ ...outside, editing: { ...outside.editing, bounds: true } });
  assert.deepEqual(fitted.furniture[1], nightstand);
  assert.deepEqual(fitted.furniture.map(item => item.id), ['bed', 'nightstand']);
  assert.deepEqual(fitted.furniture[0], bed);
  assert.deepEqual(invalidFurnitureIds(fitted), new Set([bed.id]));
  const moved = moveSceneItem(fitted, { kind: 'furniture', id: bed.id }, { x: -0.3, z: 0 });
  assert.equal(moved.furniture[0].x, -0.3);
});

test('permite entrar y salir de superposiciones sin recolocar otros objetos', () => {
  const base = createDefaultRoom();
  const item: FurnitureItem = { id: 'moving', type: 'nightstand', x: 0, z: 0, width: 0.5, depth: 0.5, height: 0.55, rotation: 0 };
  const overlap = { ...item, id: 'legacy', x: 0.2 }, obstacle = { ...item, id: 'obstacle', x: 1.5 };
  const room = validateRoom({ ...base, furniture: [item, overlap, obstacle] });
  const moved = moveSceneItem(room, { kind: 'furniture', id: item.id }, { x: 2, z: 0 });
  assert.equal(moved.furniture[0].x, 2);
  assert.equal(invalidFurnitureIds(moved).size, 0);
  const returned = moveSceneItem(moved, { kind: 'furniture', id: item.id }, { x: 0.2, z: 0 });
  assert.equal(returned.furniture[0].x, 0.2);
  assert.deepEqual(invalidFurnitureIds(returned), new Set([item.id, overlap.id]));
  const fitted = fitRoom(room);
  assert.deepEqual(fitted.furniture, room.furniture);
});

test('las advertencias usan huellas rotadas y no marcan contacto exacto como superposición', () => {
  const base = createDefaultRoom();
  const item: FurnitureItem = { id: 'a', type: 'nightstand', x: 0, z: 0, width: 2, depth: 0.2, height: 0.55, rotation: 45 };
  const separate = { ...item, id: 'b', z: 0.3 };
  const separatedRoom = validateRoom({ ...base, furniture: [item, separate] });
  assert.equal(invalidFurnitureIds(separatedRoom).size, 0);
  const overlappingRoom = validateRoom({ ...base, furniture: [item, { ...separate, z: 0.1 }] });
  assert.deepEqual(invalidFurnitureIds(overlappingRoom), new Set(['a', 'b']));
  const square = { ...item, width: 0.5, depth: 0.5, rotation: 0 };
  const contact = validateRoom({ ...base, furniture: [square, { ...square, id: 'b', x: 0.5 }] });
  assert.equal(invalidFurnitureIds(contact).size, 0);
  const wallContact = { ...square, x: 2.5 - base.thickness / 2 - square.width / 2 };
  assert.deepEqual(furniturePlacementIssues(base, wallContact), { outside: false, overlap: false });
  assert.equal(furniturePlacementIssues(base, { ...wallContact, x: wallContact.x + 0.001 }).outside, true);
});

test('las advertencias detectan huellas que cruzan entrantes con esquinas interiores', () => {
  const vertices = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 5 }, { x: 3, z: 5 }, { x: 3, z: 2 }, { x: 2, z: 2 }, { x: 2, z: 5 }, { x: 0, z: 5 }];
  const item: FurnitureItem = { id: 'notch', type: 'bed', bedSize: 'king', x: 2.5, z: 1.6, width: 4, depth: 2.5, height: 1.1, rotation: 0 };
  const room = validateRoom({ ...createDefaultRoom(), vertices, wallColors: vertices.map(() => '#ffffff'), openings: [], lights: [], furniture: [item] });
  assert.equal(furnitureCorners(item).every(p => pointInPolygon(p, vertices)), true);
  assert.deepEqual(furniturePlacementIssues(room, item), { outside: true, overlap: false });
  assert.deepEqual(invalidFurnitureIds(room), new Set([item.id]));
});
