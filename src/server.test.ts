import { TERMS_VERSION } from './legalPolicy';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { request as rawRequest, type Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createServer } from './server';
import { createDefaultProject, projectToRoom, type ProjectDocument } from './projectDocument';
import { patchProject } from './projectTestFixture';
import type { FurnitureItem, Point } from './types';

async function listen(server: Server) {
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return 'http://127.0.0.1:' + address.port;
}
const close = (server: Server) => new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X9S8AAAAASUVORK5CYII=', 'base64');

test('current projects and per-level sketches persist with permissions, receipts and safe routes', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'virtual-room-test-'));
  const dataDir = join(directory, 'data'), staticDir = join(directory, 'dist');
  mkdirSync(join(staticDir, 'assets'), { recursive: true });
  writeFileSync(join(staticDir, 'index.html'), '<html><title>3D Space</title></html>');
  writeFileSync(join(staticDir, 'assets', 'app.js'), 'console.log("room");'.repeat(1000));
  writeFileSync(join(directory, 'secret.txt'), 'private');
  let server = createServer({ dataDir, staticDir }), base = await listen(server);
  const id = randomUUID(), project = createDefaultProject(undefined, undefined, id), levelId = project.levels[0].id;
  const register = async (username: string) => fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username, password: 'test-password', confirmPassword: 'test-password', termsVersion: TERMS_VERSION }) });
  const registration = await register('Owner'); assert.equal(registration.status, 201);
  const cookie = registration.headers.get('set-cookie')!.split(';')[0], otherCookie = (await register('Other')).headers.get('set-cookie')!.split(';')[0];
  const headers = { 'Content-Type': 'application/json', Cookie: cookie, Origin: base };
  const send = (path: string, method = 'GET', body?: unknown, auth = true) => fetch(base + path, { method, headers: auth ? headers : { 'Content-Type': 'application/json', Origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
  const path = '/api/rooms/' + id, sketchPath = path + '/levels/' + levelId + '/sketch', createBody = { id, project };
  const furniture: FurnitureItem[] = [
    { id: 'bed-queen', type: 'bed', bedSize: 'queen', material: 'wood', color: '#6b4935', x: -1.3, z: -.7, width: 1.5, depth: 1.9, height: .55, rotation: 0 },
    { id: 'wardrobe', type: 'wardrobe', variant: 'wardrobe-classic', material: 'metal', color: '#a2b1bb', x: 1.65, z: -1.1, width: .6, depth: 1.2, height: 2.1, rotation: 90 },
    { id: 'vanity', type: 'vanity', variant: 'vanity-classic', material: 'plastic', color: '#c8b7cb', x: 1.3, z: .8, width: 1.1, depth: .55, height: 1.3, rotation: 0 },
    { id: 'nightstand', type: 'nightstand', variant: 'nightstand-classic', material: 'wood', color: '#b8a084', x: 0, z: -1.1, width: .5, depth: .5, height: .6, rotation: 0 },
  ];
  let changed = project;
  const freeId = randomUUID(), free = createDefaultProject(undefined, undefined, freeId);
  free.editing = { snap: false, step: .2, bounds: false }; free.levels[0].furniture = [{ ...furniture[0], levelId: free.levels[0].id, x: 8, z: -4 }]; free.levels[0].lights[0].x = -6; free.levels[0].lights[0].z = 6;
  const put = (target: string, content: unknown, revision: number, operationId = randomUUID()) => send(target, 'PUT', { project: content, revision, operationId });
  const sketchHeaders = (version: number, revision = 2, mutation = randomUUID()) => ({ Cookie: cookie, Origin: base, 'Content-Type': 'image/png', 'X-Sketch-Version': String(version), 'X-Room-Revision': String(revision), 'X-Sketch-Request-Id': mutation });
  try {
    await t.test('creation is idempotent, private and isolated between accounts', async () => {
      const result = await send('/api/rooms', 'POST', createBody); assert.equal(result.status, 201); const snapshot = await result.json();
      assert.equal(snapshot.id, id); assert.equal(snapshot.revision, 1); assert.deepEqual(snapshot.project, project); assert.equal(snapshot.sketches[levelId].hasSketch, false); assert.equal(snapshot.shared, false);
      assert.equal((await send(path, 'GET', undefined, false)).status, 404); assert.equal((await fetch(base + path, { headers: { Cookie: otherCookie } })).status, 404);
      const retry = await send('/api/rooms', 'POST', createBody); assert.equal(retry.status, 200); assert.equal((await retry.json()).revision, 1);
      assert.equal((await fetch(base + '/api/rooms', { method: 'POST', headers: { ...headers, Cookie: otherCookie }, body: JSON.stringify(createBody) })).status, 409);
      const database = new DatabaseSync(join(dataDir, 'accounts.sqlite')); try { const stored = database.prepare('SELECT password_hash FROM users WHERE username = ?').get('owner')!; assert.notEqual(stored.password_hash, 'test-password'); assert.match(String(stored.password_hash), /^[0-9a-f]{128}$/); assert.equal(database.prepare('SELECT COUNT(*) AS count FROM rooms').get()!.count, 1); assert.equal(database.prepare('SELECT COUNT(*) AS count FROM project_levels').get()!.count, 1); } finally { database.close(); }
    });
    await t.test('public snapshots expose the exact canonical project without private credentials', async () => {
      assert.deepEqual(await (await send(path + '/share', 'POST', { enabled: true })).json(), { shared: true });
      const result = await (await send(path, 'GET', undefined, false)).json(); assert.deepEqual(result.project, project); assert.equal(result.canEdit, false); assert.equal('editKey' in result, false); assert.equal('edit_hash' in result, false);
      assert.equal((await (await send(path)).json()).canEdit, true); assert.equal((await send(path, 'PUT', { project, revision: 1, operationId: randomUUID() }, false)).status, 401);
      assert.equal((await fetch(base + path, { method: 'PUT', headers: { ...headers, Cookie: otherCookie }, body: JSON.stringify({ project, revision: 1, operationId: randomUUID() }) })).status, 403);
    });
    await t.test('complete saves use durable mutation receipts and reject stale or malformed revisions', async () => {
      changed = patchProject(project, { name: 'Cuarto compartido', furniture, ceilingColor: '#c8d7e2', floorFinish: 'tile-brick', renderQuality: 'hyperrealistic', editing: { snap: true, step: .25, bounds: true }, sun: { ...project.sun, hour: 9 } });
      const operationId = randomUUID(); const saved = await put(path, changed, 1, operationId); assert.equal(saved.status, 200); assert.equal((await saved.json()).revision, 2);
      const repeated = await put(path, changed, 1, operationId); assert.equal(repeated.status, 200); assert.equal((await repeated.json()).revision, 2);
      assert.equal((await put(path, project, 1)).status, 409); assert.equal((await put(path, changed, .5)).status, 400); assert.equal((await send(path, 'PUT', { project: changed, revision: 2 })).status, 400);
      assert.deepEqual((await (await send(path)).json()).project, changed);
      const publicProject = await (await send(path, 'GET', undefined, false)).json(); assert.deepEqual(projectToRoom(publicProject.project).furniture, furniture); assert.equal(publicProject.canEdit, false);
      assert.equal((await send(path, 'PUT', { project: changed, revision: 2, operationId: randomUUID() }, false)).status, 401);
    });
    await t.test('invalid appearance and object data cannot partially replace canonical records', async () => {
      const invalid = [
        { ...changed, renderQuality: 'ultra' }, { ...changed, editing: { ...changed.editing, snap: 'yes' } }, { ...changed, editing: { ...changed.editing, bounds: 'false' } }, { ...changed, editing: { ...changed.editing, step: 0 } }, { ...changed, editing: { ...changed.editing, step: 2 } },
        { ...changed, levels: changed.levels.map(l => ({ ...l, surfaces: l.surfaces.map(s => ({ ...s, finish: { ...s.finish, material: 'glass' } })) })) },
        { ...changed, levels: changed.levels.map(l => ({ ...l, height: -1 })) },
      ];
      for (const candidate of invalid) assert.equal((await put(path, candidate, 2)).status, 400);
      for (const item of [{ ...furniture[0], type: 'sofa' }, { ...furniture[0], bedSize: 'california-king' }, { ...furniture[0], width: -1 }, { ...furniture[0], height: 4 }, { ...furniture[0], x: 51 }, { ...furniture[0], rotation: -1 }, { ...furniture[0], material: 'glass' }, { ...furniture[0], material: null }, { ...furniture[0], color: '#abc' }, { ...furniture[0], color: null }]) assert.equal((await put(path, { ...changed, levels: changed.levels.map(l => ({ ...l, furniture: [{ ...item, levelId: l.id }] })) }, 2)).status, 400);
      const unchanged = await (await send(path)).json(); assert.equal(unchanged.revision, 2); assert.deepEqual(unchanged.project, changed);
    });
    await t.test('optional room bounds preserve free placement and enforce the chosen light boundary', async () => {
      assert.equal((await send('/api/rooms', 'POST', { id: freeId, project: free })).status, 201); const freePath = '/api/rooms/' + freeId;
      await send(freePath + '/share', 'POST', { enabled: true }); const outside = await (await send(freePath, 'GET', undefined, false)).json(); assert.deepEqual(outside.project, free);
      assert.equal((await put(freePath, { ...free, editing: { ...free.editing, bounds: true } }, 1)).status, 400);
      const corrected = structuredClone(free); corrected.editing.bounds = true; corrected.levels[0].lights[0].x = 0; corrected.levels[0].lights[0].z = 0;
      assert.equal((await put(freePath, corrected, 1)).status, 200); assert.deepEqual((await (await send(freePath)).json()).project.levels[0].furniture, free.levels[0].furniture);
    });
    await t.test('retired flat formats, mismatched project identities and oversized payloads are rejected', async () => {
      assert.equal((await send('/api/rooms/not-a-uuid')).status, 400); assert.equal((await send('/api/rooms/' + randomUUID())).status, 404);
      for (const body of [{ ...createBody, project: null }, { id: randomUUID(), room: projectToRoom(project) }, { id: randomUUID(), project }]) assert.equal((await send('/api/rooms', 'POST', body)).status, 400);
      assert.equal((await fetch(base + '/api/rooms', { method: 'POST', headers, body: '{broken' })).status, 400);
      assert.equal((await fetch(base + '/api/rooms', { method: 'POST', headers, body: ' '.repeat(4 * 1024 * 1024 + 1) })).status, 413);
      assert.equal((await fetch(base + '/api/rooms', { method: 'POST', headers: { Cookie: cookie, Origin: base }, body: JSON.stringify(createBody) })).status, 415);
    });
    await t.test('retired v2 clients receive an update instruction without changing current designs or bypassing permissions', async () => {
      const before = await (await send(path)).json(), beforeLibrary = await (await send('/api/rooms')).json();
      const oldRoom = { ...projectToRoom(changed), version: 2 }, message = 'La aplicación está desactualizada. Ve a Ajustes → Actualizar aplicación y vuelve a intentarlo.';
      for (const document of [{ room: oldRoom }, { project: { ...changed, version: 2 } }]) {
        const created = await send('/api/rooms', 'POST', { id: randomUUID(), ...document });
        assert.equal(created.status, 426); assert.deepEqual(await created.json(), { error: message });
        // The released v2 client saved { room, revision } without an operation ID.
        const saved = await send(path, 'PUT', { ...document, revision: 2 });
        assert.equal(saved.status, 426); assert.deepEqual(await saved.json(), { error: message });
        assert.equal((await send('/api/rooms', 'POST', { id: randomUUID(), ...document }, false)).status, 401);
        assert.equal((await send(path, 'PUT', { ...document, revision: 2 }, false)).status, 401);
        assert.equal((await fetch(base + path, { method: 'PUT', headers: { ...headers, Cookie: otherCookie }, body: JSON.stringify({ ...document, revision: 2 }) })).status, 403);
        assert.equal((await fetch(base + path, { method: 'PUT', headers: { ...headers, Origin: 'https://attacker.invalid' }, body: JSON.stringify({ ...document, revision: 2 }) })).status, 403);
      }
      for (const invalid of [null, {}, { ...changed, version: '2' }, { ...changed, version: 1 }, { ...changed, version: 4 }, { ...changed, name: '' }]) {
        assert.equal((await send('/api/rooms', 'POST', { id: randomUUID(), room: oldRoom, project: invalid })).status, 400, 'invalid canonical data is not an old client');
        assert.equal((await send(path, 'PUT', { room: oldRoom, project: invalid, revision: 2, operationId: randomUUID() })).status, 400);
      }
      assert.deepEqual(await (await send(path)).json(), before);
      assert.deepEqual(await (await send('/api/rooms')).json(), beforeLibrary);
      assert.equal((await (await send('/api/auth/session')).json()).user.username, 'owner');
    });
    await t.test('per-level binary sketches use revisions, stable receipts and conditional reads', async () => {
      assert.equal((await send(sketchPath)).status, 404); assert.equal((await send(path + '/sketch')).status, 404);
      assert.equal((await fetch(base + sketchPath, { method: 'PUT', headers: { Origin: base, 'Content-Type': 'image/png' }, body: png })).status, 401);
      assert.equal((await fetch(base + sketchPath, { method: 'PUT', headers: sketchHeaders(0), body: 'not a PNG' })).status, 400);
      assert.equal((await fetch(base + sketchPath, { method: 'PUT', headers: { ...sketchHeaders(0), 'Content-Type': 'image/svg+xml' }, body: '<svg />' })).status, 415);
      assert.equal((await fetch(base + sketchPath, { method: 'PUT', headers: sketchHeaders(0), body: Buffer.alloc(10 * 1024 * 1024 + 1) })).status, 413);
      const mutation = randomUUID(), requestHeaders = sketchHeaders(0, 2, mutation), saved = await fetch(base + sketchPath, { method: 'PUT', headers: requestHeaders, body: png }); assert.equal(saved.status, 200); assert.deepEqual(await saved.json(), { hasSketch: true, version: 1 });
      const retry = await fetch(base + sketchPath, { method: 'PUT', headers: requestHeaders, body: png }); assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), { hasSketch: true, version: 1 });
      assert.equal((await fetch(base + sketchPath, { method: 'PUT', headers: sketchHeaders(0), body: png })).status, 409);
      const read = await send(sketchPath); assert.equal(read.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await read.arrayBuffer()), png);
      assert.equal((await fetch(base + sketchPath, { headers: { 'If-None-Match': read.headers.get('etag')! } })).status, 304);
      const metadata = await (await send(path)).json(); assert.equal(metadata.sketches[levelId].hasSketch, true); assert.equal(metadata.sketches[levelId].version, 1); assert.equal(metadata.revision, 2);
    });
    await t.test('restart preserves normalized projects, permissions and per-level sketch bytes', async () => {
      await close(server); server = createServer({ dataDir, staticDir }); base = await listen(server); headers.Origin = base;
      const restored = await (await send(path)).json(); assert.deepEqual(restored.project, changed); assert.equal(restored.canEdit, true); assert.equal(restored.revision, 2);
      assert.deepEqual((await (await send(path, 'GET', undefined, false)).json()).project, changed); const freeRestored = await (await send('/api/rooms/' + freeId)).json(); assert.equal(freeRestored.project.editing.bounds, true); assert.equal(freeRestored.revision, 2);
      assert.deepEqual(Buffer.from(await (await send(sketchPath)).arrayBuffer()), png); assert.equal((await send(sketchPath, 'DELETE', undefined, false)).status, 401);
      const deleted = await fetch(base + sketchPath, { method: 'DELETE', headers: sketchHeaders(1) }); assert.equal(deleted.status, 200); assert.deepEqual(await deleted.json(), { hasSketch: false, version: 2 }); assert.equal((await send(sketchPath)).status, 404);
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
