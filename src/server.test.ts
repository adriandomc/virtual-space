import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { request as rawRequest, type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createServer } from './server';
import { createDefaultRoom } from './model';

async function listen(server: Server) {
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return 'http://127.0.0.1:' + address.port;
}
const close = (server: Server) => new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X9S8AAAAASUVORK5CYII=', 'base64');

test('el servidor persiste proyectos y croquis con permisos, revisiones y rutas seguras', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'virtual-room-test-'));
  const dataDir = join(directory, 'data'), staticDir = join(directory, 'dist');
  mkdirSync(join(staticDir, 'assets'), { recursive: true });
  writeFileSync(join(staticDir, 'index.html'), '<html><title>3D Space</title></html>');
  writeFileSync(join(staticDir, 'assets', 'app.js'), 'console.log("room");'.repeat(1000));
  writeFileSync(join(directory, 'secret.txt'), 'private');
  let server = createServer({ dataDir, staticDir });
  let base = await listen(server);
  const id = randomUUID(), room = createDefaultRoom();
  const register = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username: 'Owner', password: 'test-password', confirmPassword: 'test-password' }) });
  assert.equal(register.status, 201);
  const cookie = register.headers.get('set-cookie')!.split(';')[0];
  const otherRegister = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username: 'Other', password: 'test-password', confirmPassword: 'test-password' }) });
  const otherCookie = otherRegister.headers.get('set-cookie')!.split(';')[0];
  const furniture = [
    { id: 'bed-queen', type: 'bed', bedSize: 'queen', material: 'wood', color: '#6b4935', x: -1.3, z: -0.7, width: 1.5, depth: 1.9, height: 0.55, rotation: 0 },
    { id: 'wardrobe', type: 'wardrobe', material: 'metal', color: '#a2b1bb', x: 1.65, z: -1.1, width: 0.6, depth: 1.2, height: 2.1, rotation: 90 },
    { id: 'vanity', type: 'vanity', material: 'plastic', color: '#c8b7cb', x: 1.3, z: 0.8, width: 1.1, depth: 0.55, height: 1.3, rotation: 0 },
    { id: 'nightstand', type: 'nightstand', x: 0, z: -1.1, width: 0.5, depth: 0.5, height: 0.6, rotation: 0 },
  ];
  const freeProjectId = randomUUID();
  const freeRoom = { ...room, editing: { snap: false, step: 0.2, bounds: false }, furniture: [{ ...furniture[0], x: 8, z: -4 }], lights: [{ ...room.lights[0], x: -6, z: 6 }] };
  const headers = { 'Content-Type': 'application/json', Cookie: cookie, Origin: base };
  const createBody = { id, room };
  const send = (path: string, method = 'GET', body?: unknown, auth = true) => fetch(base + path, { method, headers: auth ? headers : { 'Content-Type': 'application/json', Origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
  const path = '/api/rooms/' + id;
  try {
    await t.test('crea una sola vez dentro de la cuenta y el proyecto empieza privado', async () => {
      const created = await send('/api/rooms', 'POST', createBody);
      assert.equal(created.status, 201);
      const result = await created.json();
      assert.equal(result.id, id); assert.equal(result.revision, 1); assert.equal(result.hasSketch, false); assert.equal(result.shared, false);
      assert.equal((await send(path, 'GET', undefined, false)).status, 404);
      assert.equal((await fetch(base + path, { headers: { Cookie: otherCookie } })).status, 404);
      const retry = await send('/api/rooms', 'POST', createBody);
      assert.equal(retry.status, 200); assert.equal((await retry.json()).revision, 1);
      assert.equal((await fetch(base + '/api/rooms', { method: 'POST', headers: { ...headers, Cookie: otherCookie }, body: JSON.stringify(createBody) })).status, 409);
      const database = new DatabaseSync(join(dataDir, 'accounts.sqlite'));
      const stored = database.prepare('SELECT password_hash FROM users WHERE username = ?').get('owner')!;
      assert.notEqual(stored.password_hash, 'test-password'); assert.match(String(stored.password_hash), /^[0-9a-f]{128}$/);
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM rooms').get()!.count, 1);
      database.close();
    });
    await t.test('el enlace público muestra exactamente el proyecto sin exponer claves', async () => {
      assert.deepEqual(await (await send(path + '/share', 'POST', { enabled: true })).json(), { shared: true });
      const result = await (await send(path, 'GET', undefined, false)).json();
      assert.deepEqual(result.room, room); assert.equal(result.canEdit, false);
      assert.equal('editKey' in result, false); assert.equal('edit_hash' in result, false);
      assert.equal((await (await send(path)).json()).canEdit, true);
      assert.equal((await send(path, 'PUT', { room, revision: 1 }, false)).status, 401);
      assert.equal((await fetch(base + path, { method: 'PUT', headers: { ...headers, Cookie: otherCookie }, body: JSON.stringify({ room, revision: 1 }) })).status, 403);
      assert.equal((await fetch(base + path, { headers: { Authorization: 'Bearer ' + 'b'.repeat(64) } }).then(r => r.json())).canEdit, false);
    });
    await t.test('guarda cambios completos e impide sobrescribir una revisión posterior', async () => {
      const changed = { ...room, name: 'Cuarto compartido', furniture, showFurniture: false, ceilingColor: '#c8d7e2', floorFinish: 'tile-brick', renderQuality: 'hyperrealistic', editing: { snap: true, step: 0.25, bounds: true }, sun: { ...room.sun, hour: 9 } };
      const saved = await send(path, 'PUT', { room: changed, revision: 1 });
      assert.equal(saved.status, 200); assert.equal((await saved.json()).revision, 2);
      const repeated = await send(path, 'PUT', { room: changed, revision: 1 });
      assert.equal(repeated.status, 200); assert.equal((await repeated.json()).revision, 2);
      assert.equal((await send(path, 'PUT', { room, revision: 1 })).status, 409);
      assert.equal((await send(path, 'PUT', { room: { ...changed, height: -1 }, revision: 2 })).status, 400);
      assert.equal((await send(path, 'PUT', { room: changed, revision: 0.5 })).status, 400);
      assert.deepEqual((await (await send(path)).json()).room, changed);
      const publicRoom = await (await send(path, 'GET', undefined, false)).json();
      assert.deepEqual(publicRoom.room.furniture, furniture);
      assert.equal(publicRoom.canEdit, false);
      assert.equal((await send(path, 'PUT', { room: { ...changed, furniture: [] }, revision: 2 }, false)).status, 401);
      assert.deepEqual((await (await send(path)).json()).room.furniture, furniture);
    });
    await t.test('persiste ajustes y materiales y valida límites opcionales en la API', async () => {
      const current = (await (await send(path)).json()).room;
      for (const patch of [
        { floorFinish: 'glass' }, { renderQuality: 'ultra' }, { ceilingColor: '#12' },
        { editing: { ...current.editing, snap: 'yes' } }, { editing: { ...current.editing, bounds: 'false' } },
        { editing: { ...current.editing, step: 0 } }, { editing: { ...current.editing, step: 2 } },
      ]) assert.equal((await send(path, 'PUT', { room: { ...current, ...patch }, revision: 2 })).status, 400);
      const unchanged = await (await send(path)).json();
      assert.deepEqual(unchanged.room, current); assert.equal(unchanged.revision, 2);
      assert.equal((await send('/api/rooms', 'POST', { id: freeProjectId, room: freeRoom })).status, 201);
      const freePath = '/api/rooms/' + freeProjectId;
      await send(freePath + '/share', 'POST', { enabled: true });
      const outside = await (await send(freePath, 'GET', undefined, false)).json();
      assert.deepEqual(outside.room.furniture, freeRoom.furniture);
      assert.deepEqual(outside.room.lights, freeRoom.lights);
      assert.deepEqual(outside.room.editing, freeRoom.editing);
      assert.equal(outside.canEdit, false);
      assert.equal((await send(freePath, 'PUT', { room: { ...freeRoom, editing: { ...freeRoom.editing, bounds: true } }, revision: 1 })).status, 400);
      const stillOutside = await (await send(freePath)).json();
      assert.equal(stillOutside.revision, 1); assert.equal(stillOutside.room.editing.bounds, false);
      const furnitureOnly = { ...freeRoom, lights: room.lights, editing: { ...freeRoom.editing, bounds: true } };
      assert.equal((await send(freePath, 'PUT', { room: furnitureOnly, revision: 1 })).status, 200);
      assert.deepEqual((await (await send(freePath)).json()).room.furniture, freeRoom.furniture);
    });
    await t.test('valida medidas y tipos de muebles antes de guardar una distribución', async () => {
      const current = (await (await send(path)).json()).room;
      for (const item of [
        { ...furniture[0], type: 'sofa' }, { ...furniture[0], bedSize: 'california-king' },
        { ...furniture[0], width: -1 }, { ...furniture[0], height: current.height + 1 },
        { ...furniture[0], x: 51 }, { ...furniture[0], rotation: -1 },
        { ...furniture[0], material: 'glass' }, { ...furniture[0], material: null },
        { ...furniture[0], color: '#abc' }, { ...furniture[0], color: null },
      ]) assert.equal((await send(path, 'PUT', { room: { ...current, furniture: [item] }, revision: 2 })).status, 400);
      const unchanged = await (await send(path)).json();
      assert.equal(unchanged.revision, 2); assert.deepEqual(unchanged.room.furniture, furniture);
      const vertices = [{ x: 0, z: 0 }, { x: 5, z: 0 }, { x: 5, z: 1 }, { x: 1, z: 1 }, { x: 1, z: 5 }, { x: 0, z: 5 }];
      const concaveItem = { ...furniture[1], id: 'wardrobe-concave', x: 0.5, z: 3, width: 0.6, depth: 1.2, rotation: 0 };
      const concaveRoom = { ...room, vertices, wallColors: vertices.map(() => '#ffffff'), openings: [], lights: [], furniture: [concaveItem] };
      const concaveId = randomUUID();
      assert.equal((await send('/api/rooms', 'POST', { id: concaveId, room: concaveRoom })).status, 201);
      assert.deepEqual((await (await send('/api/rooms/' + concaveId)).json()).room.furniture, [concaveItem]);
      const outside = { ...concaveItem, x: 1, z: 1, width: 1, depth: 1 };
      assert.equal((await send('/api/rooms/' + concaveId, 'PUT', { room: { ...concaveRoom, furniture: [outside] }, revision: 1 })).status, 200);
      assert.deepEqual((await (await send('/api/rooms/' + concaveId)).json()).room.furniture, [outside]);
    });
    await t.test('valida identificadores, contenido y límite de cargas', async () => {
      assert.equal((await send('/api/rooms/not-a-uuid')).status, 400);
      assert.equal((await send('/api/rooms/' + randomUUID())).status, 404);
      assert.equal((await send('/api/rooms', 'POST', { ...createBody, room: null })).status, 400);
      assert.equal((await fetch(base + '/api/rooms', { method: 'POST', headers, body: '{broken' })).status, 400);
      assert.equal((await fetch(base + '/api/rooms', { method: 'POST', headers, body: ' '.repeat(1024 * 1024 + 1) })).status, 413);
      assert.equal((await fetch(base + '/api/rooms', { method: 'POST', headers: { Cookie: cookie, Origin: base }, body: JSON.stringify(createBody) })).status, 415);
    });
    await t.test('persiste el croquis binario con su versión sin cambiar la revisión del cuarto', async () => {
      assert.equal((await send(path + '/sketch')).status, 404);
      assert.equal((await fetch(base + path + '/sketch', { method: 'PUT', headers: { Origin: base, 'Content-Type': 'image/png' }, body: png })).status, 401);
      assert.equal((await fetch(base + path + '/sketch', { method: 'PUT', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'image/png' }, body: 'not a PNG' })).status, 400);
      assert.equal((await fetch(base + path + '/sketch', { method: 'PUT', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'image/svg+xml' }, body: '<svg />' })).status, 415);
      assert.equal((await fetch(base + path + '/sketch', { method: 'PUT', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'image/png' }, body: Buffer.alloc(10 * 1024 * 1024 + 1) })).status, 413);
      const put = await fetch(base + path + '/sketch', { method: 'PUT', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'image/png' }, body: png });
      assert.equal(put.status, 200); assert.deepEqual(await put.json(), { hasSketch: true, sketchVersion: 1 });
      const read = await send(path + '/sketch');
      assert.equal(read.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await read.arrayBuffer()), png);
      assert.equal((await fetch(base + path + '/sketch', { headers: { 'If-None-Match': read.headers.get('etag')! } })).status, 304);
      const metadata = await (await send(path)).json();
      assert.equal(metadata.hasSketch, true); assert.equal(metadata.sketchVersion, 1); assert.equal(metadata.revision, 2);
    });
    await t.test('reabrir el servidor conserva parámetros, permisos y croquis', async () => {
      await close(server);
      server = createServer({ dataDir, staticDir }); base = await listen(server);
      headers.Origin = base;
      const restored = await (await send(path)).json();
      assert.equal(restored.room.name, 'Cuarto compartido'); assert.equal(restored.room.showFurniture, false); assert.equal(restored.canEdit, true); assert.equal(restored.revision, 2);
      assert.deepEqual(restored.room.furniture, furniture);
      assert.deepEqual((await (await send(path, 'GET', undefined, false)).json()).room.furniture, furniture);
      assert.equal(restored.room.ceilingColor, '#c8d7e2'); assert.equal(restored.room.floorFinish, 'tile-brick'); assert.equal(restored.room.renderQuality, 'hyperrealistic');
      assert.deepEqual(restored.room.editing, { snap: true, step: 0.25, bounds: true });
      const restoredOutside = await (await send('/api/rooms/' + freeProjectId)).json();
      assert.deepEqual(restoredOutside.room.furniture, freeRoom.furniture);
      assert.deepEqual(restoredOutside.room.lights, room.lights);
      assert.deepEqual(restoredOutside.room.editing, { ...freeRoom.editing, bounds: true });
      assert.equal(restoredOutside.revision, 2);
      assert.deepEqual(Buffer.from(await (await send(path + '/sketch')).arrayBuffer()), png);
      assert.equal((await send(path + '/sketch', 'DELETE', undefined, false)).status, 401);
      const deleted = await send(path + '/sketch', 'DELETE');
      assert.deepEqual(await deleted.json(), { hasSketch: false, sketchVersion: 2 });
      assert.equal((await send(path + '/sketch')).status, 404);
    });
    await t.test('sirve la aplicación, comprime recursos y bloquea rutas fuera de dist', async () => {
      const html = await send('/');
      assert.equal(html.status, 200); assert.equal(html.headers.get('cache-control'), 'no-cache'); assert.match(await html.text(), /<title>3D Space<\/title>/);
      assert.equal((await send('/another-room')).status, 200);
      for (const route of ['/login', '/designs', '/editor?room=' + id, '/editor?room=' + id + '&setup=1']) {
        const page = await send(route);
        assert.equal(page.status, 200);
        assert.match(await page.text(), /<title>3D Space<\/title>/);
      }
      assert.equal((await send('/api/unknown')).status, 404);
      assert.equal((await send('/missing.js')).status, 404);
      const asset = await fetch(base + '/assets/app.js', { headers: { 'Accept-Encoding': 'gzip' } });
      assert.equal(asset.headers.get('content-encoding'), 'gzip'); assert.match(asset.headers.get('cache-control')!, /immutable/);
      assert.match(await asset.text(), /console.log/);
      const plain = await fetch(base + '/assets/app.js', { headers: { 'Accept-Encoding': 'gzip;q=0' } });
      assert.equal(plain.headers.get('content-encoding'), null);
      mkdirSync(join(staticDir, 'materials'));
      const texturePath = join(staticDir, 'materials', 'texture.jpg');
      writeFileSync(texturePath, png);
      const texture = await fetch(base + '/materials/texture.jpg');
      const etag = texture.headers.get('etag')!;
      assert.ok(etag);
      const cached = await fetch(base + '/materials/texture.jpg', { headers: { 'If-None-Match': etag } });
      assert.equal(cached.status, 304); assert.equal(await cached.text(), '');
      writeFileSync(texturePath, Buffer.concat([png, Buffer.from('changed')]));
      const updated = await fetch(base + '/materials/texture.jpg', { headers: { 'If-None-Match': etag } });
      assert.equal(updated.status, 200); assert.notEqual(updated.headers.get('etag'), etag);
      const head = await fetch(base + '/', { method: 'HEAD' });
      assert.equal(head.status, 200); assert.equal(await head.text(), '');
      const traversal = await new Promise<number>(accept => {
        const request = rawRequest(base, { path: '/%2e%2e/secret.txt' }, response => { response.resume(); accept(response.statusCode!); });
        request.end();
      });
      assert.equal(traversal, 403);
      assert.equal((await send('/%ZZ')).status, 400);
      assert.equal((await send('/%00')).status, 400);
    });
  } finally {
    await close(server);
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('virtual-room-test-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
