import { TERMS_VERSION } from './legalPolicy';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import test from 'node:test';
import { createDefaultRoom } from './model';
import { createServer } from './server';

function modelFixture() {
  const binary = Buffer.alloc(36);
  [0, 0, 0, 1, 0, 0, 0, 1, 1].forEach((value, index) => binary.writeFloatLE(value, index * 4));
  const document = { asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
  const raw = Buffer.from(JSON.stringify(document)), json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(json);
  const data = Buffer.alloc(28 + json.length + binary.length);
  data.writeUInt32LE(0x46546c67, 0); data.writeUInt32LE(2, 4); data.writeUInt32LE(data.length, 8);
  data.writeUInt32LE(json.length, 12); data.writeUInt32LE(0x4e4f534a, 16); json.copy(data, 20);
  data.writeUInt32LE(binary.length, 20 + json.length); data.writeUInt32LE(0x004e4942, 24 + json.length); binary.copy(data, 28 + json.length);
  return data;
}

test('embedded viewer is the only frameable document and public reads never use an owner session', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'space-embed-server-')), staticDir = join(directory, 'dist');
  mkdirSync(join(staticDir, 'assets'), { recursive: true });
  writeFileSync(join(staticDir, 'index.html'), '<html><title>3D Space</title></html>');
  writeFileSync(join(staticDir, 'other.html'), '<html>Other</html>');
  writeFileSync(join(staticDir, 'assets', 'app.js'), 'console.log("app")');
  const server = createServer({ dataDir: join(directory, 'data'), staticDir, secureCookie: false, maintenance: false });
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port, id = randomUUID(), room = createDefaultRoom(), roomPath = '/api/rooms/' + id;
  const registration = await fetch(base + '/api/auth/register', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'embed_owner', password: 'Safe-test-password', confirmPassword: 'Safe-test-password', termsVersion: TERMS_VERSION }) });
  assert.equal(registration.status, 201);
  const cookie = registration.headers.get('set-cookie')!.split(';')[0];
  const headers = { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' };
  const send = (path: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const protectedResponse = (response: Response) => {
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.equal(response.headers.get('content-security-policy'), "frame-ancestors 'none'");
  };
  try {
    await t.test('only exact /embed HTML allows cross-origin frames, including HEAD and conditional responses', async () => {
      const response = await fetch(base + '/embed?room=' + id);
      assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /^text\/html/);
      assert.equal(response.headers.get('x-frame-options'), null);
      assert.equal(response.headers.get('content-security-policy'), 'frame-ancestors *');
      const head = await fetch(base + '/embed', { method: 'HEAD' });
      assert.equal(head.status, 200); assert.equal(head.headers.get('x-frame-options'), null); assert.equal(await head.text(), '');
      const unchanged = await fetch(base + '/embed', { headers: { 'If-None-Match': response.headers.get('etag')! } });
      assert.equal(unchanged.status, 304); assert.equal(unchanged.headers.get('x-frame-options'), null);
      assert.equal(unchanged.headers.get('content-security-policy'), 'frame-ancestors *');
      for (const path of ['/', '/login', '/editor?room=' + id, '/embed/', '/embed/editor', '/%65mbed', '/other.html', '/assets/app.js', '/api/auth/session', '/api/missing']) protectedResponse(await fetch(base + path));
      const rejected = await fetch(base + '/embed', { method: 'POST' });
      assert.equal(rejected.status, 405); protectedResponse(rejected);
    });
    assert.equal((await send('/api/rooms', 'POST', { id, room })).status, 201);
    const glb = modelFixture();
    const upload = async (name: string) => {
      const response = await fetch(base + '/api/models?room=' + id, { method: 'POST', headers: { ...headers, 'Content-Type': 'model/gltf-binary', 'X-Model-Name': name }, body: glb });
      assert.equal(response.status, 201); return (await response.json()).model.id as string;
    };
    const assetId = await upload('Visible'), unusedId = await upload('Unused');
    const assetPath = '/api/models/' + assetId + '?room=' + id + '&public=1';
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X9S8AAAAASUVORK5CYII=', 'base64');
    await t.test('private rooms and models stay hidden in public mode even with the owner cookie', async () => {
      assert.equal((await send(roomPath)).status, 200);
      assert.equal((await send(roomPath + '?public=1')).status, 404);
      assert.equal((await send(assetPath)).status, 404);
      assert.equal((await send(assetPath + '&metadata=1')).status, 404);
      assert.equal((await send('/api/models/' + assetId)).status, 200);
    });
    const updated = await send(roomPath, 'PUT', { revision: 1, room: { ...room, furniture: [{ id: 'model', type: 'custom', material: null, color: null, assetId, name: 'Visible', width: 1, depth: 1, height: 1, x: 0, z: 0, rotation: 0 }] } });
    assert.equal(updated.status, 200, await updated.text());
    assert.equal((await fetch(base + roomPath + '/sketch', { method: 'PUT', headers: { ...headers, 'Content-Type': 'image/png' }, body: png })).status, 200);
    assert.equal((await send(roomPath + '/sketch?public=1')).status, 404);
    assert.equal((await send(roomPath + '/share', 'POST', { enabled: true })).status, 200);
    await t.test('public mode remains a reader and exposes only referenced models from that public room', async () => {
      const response = await send(roomPath + '?public=1'); protectedResponse(response);
      assert.equal(response.status, 200);
      const snapshot = await response.json();
      assert.equal(snapshot.role, 'public'); assert.equal(snapshot.canEdit, false); assert.equal(snapshot.canManage, false);
      assert.equal(snapshot.accountId, null); assert.equal(snapshot.offlineAllowed, false);
      const model = await send(assetPath); assert.equal(model.status, 200); assert.deepEqual(Buffer.from(await model.arrayBuffer()), glb);
      assert.equal((await send(assetPath + '&metadata=1')).status, 200);
      assert.equal((await send('/api/models/' + unusedId + '?room=' + id + '&public=1')).status, 404);
      assert.equal((await send('/api/models/' + assetId + '?public=1')).status, 404);
      assert.equal((await send('/api/models/' + assetId + '?room=' + randomUUID() + '&public=1')).status, 404);
      assert.equal((await send(roomPath + '/sketch?public=1')).status, 200);
    });
    await t.test('public-mode mutations cannot acquire edit rights from a cookie', async () => {
      assert.equal((await send(roomPath + '?public=1', 'PUT', { revision: 2, room })).status, 403);
      assert.equal((await send(roomPath + '?public=1', 'DELETE')).status, 403);
      assert.equal((await send(roomPath + '/share?public=1', 'POST', { enabled: false })).status, 403);
      assert.equal((await send(roomPath + '/sketch?public=1', 'DELETE')).status, 403);
      assert.equal((await send(assetPath, 'DELETE')).status, 403);
      assert.equal((await (await send(roomPath)).json()).revision, 2);
    });
    await t.test('revoking public access immediately rejects room, sketch and model reads', async () => {
      assert.equal((await send(roomPath + '/share', 'POST', { enabled: false })).status, 200);
      for (const path of [roomPath + '?public=1', roomPath + '/sketch?public=1', assetPath, assetPath + '&metadata=1']) {
        const response = await send(path); assert.equal(response.status, 404); protectedResponse(response);
      }
      assert.equal((await send(roomPath)).status, 200);
    });
  } finally {
    await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
    assert.ok(basename(directory).startsWith('space-embed-server-') && resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
});
