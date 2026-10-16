import { TERMS_VERSION } from './legalPolicy';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import test from 'node:test';
import { createServer } from './server';
import { createDefaultProject } from './projectDocument';

test('offline writes revalidate account, collaboration and revisions; sketch retries are idempotent', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'space-offline-server-'));
  const server = createServer({ dataDir: directory, maintenance: false });
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  const register = async (username: string) => {
    const response = await fetch(base + '/api/auth/register', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password: 'Safe-test-password', confirmPassword: 'Safe-test-password', termsVersion: TERMS_VERSION }) });
    assert.equal(response.status, 201);
    return { cookie: response.headers.get('set-cookie')!.split(';')[0], id: (await response.json()).user.id as string };
  };
  try {
    const owner = await register('offline_owner'), other = await register('offline_guest');
    const id = randomUUID(), room = createDefaultProject(undefined, undefined, id), path = '/api/rooms/' + id;
    const headers = { Cookie: owner.cookie, Origin: base, 'Content-Type': 'application/json' };
    const offline = { ...headers, 'X-Offline-Write': '1', 'X-Account-Id': owner.id };
    const send = (url: string, method = 'GET', body?: unknown, extra: Record<string, string> = headers) => fetch(base + url, { method, headers: extra, body: body === undefined ? undefined : JSON.stringify(body) });
    const created = await send('/api/rooms', 'POST', { id, project: room }); assert.equal(created.status, 201);
    await t.test('only the authenticated owner of a private, uninvited room is eligible', async () => {
      const snapshot = await (await send(path)).json(); assert.equal(snapshot.accountId, owner.id); assert.equal(snapshot.offlineAllowed, true);
      assert.equal((await send(path, 'PUT', { project: room, revision: 1, operationId: randomUUID() }, { ...offline, 'X-Account-Id': other.id })).status, 403);
      const result = await send(path, 'PUT', { project: { ...room, name: 'Offline save' }, revision: 1, operationId: randomUUID() }, offline);
      assert.equal(result.status, 200); assert.equal((await result.json()).revision, 2);
      assert.equal((await send(path, 'PUT', { project: room, revision: 1, operationId: randomUUID() }, offline)).status, 409);
    });
    await t.test('offline creation and deletion require matching account, private eligibility and the exact base revision', async () => {
      const pendingId = randomUUID(), pendingPath = '/api/rooms/' + pendingId;
      assert.equal((await send('/api/rooms', 'POST', { id: pendingId, project: { ...room, id: pendingId } }, { ...offline, 'X-Account-Id': other.id })).status, 403);
      assert.equal((await send('/api/rooms', 'POST', { id: pendingId, project: { ...room, id: pendingId } }, offline)).status, 201);
      assert.equal((await send('/api/rooms', 'POST', { id: pendingId, project: { ...room, id: pendingId } }, offline)).status, 200);
      const list = (await (await send('/api/rooms')).json()).rooms;
      assert.equal(list.find((value: { id: string }) => value.id === pendingId).offlineAllowed, true);
      assert.equal((await send(pendingPath, 'DELETE', { revision: 1, sketches: { [room.activeLevelId]: { hasSketch: false, version: 0, mutationId: null } } }, { ...offline, 'X-Account-Id': other.id })).status, 403);
      assert.equal((await send(pendingPath, 'DELETE', {}, offline)).status, 400);
      assert.equal((await send(pendingPath, 'PUT', { project: { ...room, id: pendingId, name: 'Remote change' }, revision: 1, operationId: randomUUID() })).status, 200);
      assert.equal((await send(pendingPath, 'DELETE', { revision: 1, sketches: { [room.activeLevelId]: { hasSketch: false, version: 0, mutationId: null } } }, offline)).status, 409);
      await send(pendingPath + '/share', 'POST', { enabled: true });
      assert.equal((await send(pendingPath, 'DELETE', { revision: 2, sketches: { [room.activeLevelId]: { hasSketch: false, version: 0, mutationId: null } } }, offline)).status, 409);
      await send(pendingPath + '/share', 'POST', { enabled: false });
      const pendingSketchMutation = randomUUID();
      const sketch = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X9S8AAAAASUVORK5CYII=', 'base64');
      assert.equal((await fetch(base + pendingPath + '/levels/' + room.activeLevelId + '/sketch', { method: 'PUT', headers: { ...headers, 'Content-Type': 'image/png', 'X-Room-Revision': '2', 'X-Sketch-Version': '0', 'X-Sketch-Request-Id': pendingSketchMutation }, body: sketch })).status, 200);
      assert.equal((await send(pendingPath, 'DELETE', { revision: 2, sketches: { [room.activeLevelId]: { hasSketch: false, version: 0, mutationId: null } } }, offline)).status, 409, 'a newer sketch must not be silently deleted');
      assert.equal((await send(pendingPath, 'DELETE', { revision: 2, sketches: { [room.activeLevelId]: { hasSketch: true, version: 1, mutationId: pendingSketchMutation } } }, offline)).status, 200);
      assert.equal((await send(pendingPath)).status, 404);
      assert.equal((await send('/api/rooms', 'POST', { id: pendingId, project: { ...room, id: pendingId } }, offline)).status, 409);
    });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X9S8AAAAASUVORK5CYII=', 'base64');
    const sketchId = randomUUID();
    const sketchHeaders = { ...offline, 'Content-Type': 'image/png', 'X-Room-Revision': '2', 'X-Sketch-Version': '0', 'X-Sketch-Request-Id': sketchId };
    await t.test('a lost image acknowledgement retries the same mutation without a new version', async () => {
      const upload = () => fetch(base + path + '/levels/' + room.activeLevelId + '/sketch', { method: 'PUT', headers: sketchHeaders, body: png });
      assert.equal((await upload()).status, 200);
      const repeated = await upload(); assert.equal(repeated.status, 200); assert.equal((await repeated.json()).version, 1);
      const stale = await fetch(base + path + '/levels/' + room.activeLevelId + '/sketch', { method: 'PUT', headers: { ...sketchHeaders, 'X-Sketch-Request-Id': randomUUID() }, body: png }); assert.equal(stale.status, 409);
      const crossOperation = await fetch(base + path + '/levels/' + room.activeLevelId + '/sketch', { method: 'DELETE', headers: sketchHeaders }); assert.equal(crossOperation.status, 409);
      const removeHeaders = { ...sketchHeaders, 'X-Sketch-Version': '1', 'X-Sketch-Request-Id': randomUUID() };
      assert.equal((await fetch(base + path + '/levels/' + room.activeLevelId + '/sketch', { method: 'DELETE', headers: removeHeaders })).status, 200);
      const removedAgain = await fetch(base + path + '/levels/' + room.activeLevelId + '/sketch', { method: 'DELETE', headers: removeHeaders }); assert.equal(removedAgain.status, 200); assert.equal((await removedAgain.json()).version, 2);
    });
    await t.test('even a pending invitation blocks room, sketch and model offline writes', async () => {
      const invite = await send(path + '/members', 'POST', { username: 'offline_guest', role: 'editor' }); assert.equal(invite.status, 201);
      const memberId = (await invite.json()).members[0].id;
      assert.equal((await (await send(path)).json()).offlineAllowed, false);
      assert.equal((await (await send('/api/rooms')).json()).rooms.find((value: { id: string }) => value.id === id).offlineAllowed, false);
      assert.equal((await send(path, 'PUT', { project: room, revision: 2, operationId: randomUUID() }, offline)).status, 409);
      assert.equal((await fetch(base + path + '/levels/' + room.activeLevelId + '/sketch', { method: 'PUT', headers: { ...sketchHeaders, 'X-Sketch-Version': '2', 'X-Sketch-Request-Id': randomUUID() }, body: png })).status, 409);
      assert.equal((await fetch(base + '/api/models?room=' + id, { method: 'POST', headers: { ...offline, 'Content-Type': 'model/gltf-binary', 'X-Model-Name': 'test.glb' }, body: Buffer.from('not uploaded') })).status, 409);
      assert.equal((await send(path + '/members/' + memberId, 'DELETE')).status, 200);
      assert.equal((await (await send(path)).json()).offlineAllowed, true);
      await send(path + '/share', 'POST', { enabled: true });
      assert.equal((await (await send(path)).json()).offlineAllowed, false);
      const publicSnapshot = await (await fetch(base + path)).json(); assert.equal(publicSnapshot.accountId, null); assert.equal(publicSnapshot.offlineAllowed, false);
      assert.equal((await send(path, 'PUT', { project: room, revision: 2, operationId: randomUUID() }, offline)).status, 409);
    });
  } finally {
    await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
    assert.ok(basename(directory).startsWith('space-offline-server-') && resolve(directory).startsWith(resolve(tmpdir())));
    rmSync(directory, { recursive: true, force: true });
  }
});
