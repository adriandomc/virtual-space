import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { createDefaultRoom, resizeRoom } from './model';
import { createBlankRoom } from './onboardingModel';
import { createServer } from './server';

async function listen(server: Server) {
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return 'http://127.0.0.1:' + address.port;
}
const close = (server: Server) => new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));

test('la preparación se reanuda después de reiniciar y al finalizar conserva el diseño', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'virtual-space-onboarding-'));
  const options = { dataDir: join(directory, 'data'), staticDir: join(directory, 'dist') };
  let server = createServer(options), base = await listen(server);
  try {
    const registered = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username: 'onboarding_owner', password: 'test-password', confirmPassword: 'test-password', termsVersion: '2026-10-13' }) });
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get('set-cookie')!.split(';')[0];
    async function send(path: string, method = 'GET', body?: unknown, expectedStatus = 200) {
      const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
      const result = await response.json();
      assert.equal(response.status, expectedStatus, JSON.stringify(result));
      return result;
    }
    const id = randomUUID(), existingId = randomUUID(), initial = createBlankRoom(), existing = createDefaultRoom();
    const path = '/api/rooms/' + id;
    const created = await send('/api/rooms', 'POST', { id, room: initial }, 201);
    assert.equal(created.room.setupStep, 0);
    await send('/api/rooms', 'POST', { id: existingId, room: existing }, 201);
    const changed = { ...resizeRoom(initial, 7.2, 5.4), setupStep: 1 as const, name: 'Mi diseño preparado', height: 3.2, wallColors: initial.wallColors.map(() => '#4b6875'), ceilingColor: '#ece6db', floorColor: '#c3b29b', floorFinish: 'tile-grid' as const };
    const saved = await send(path, 'PUT', { room: changed, revision: created.revision });
    assert.equal(saved.revision, created.revision + 1);

    await close(server);
    server = createServer(options); base = await listen(server);
    const resumed = await send(path);
    assert.deepEqual(resumed.room, changed);
    assert.equal(resumed.revision, saved.revision);
    const pendingLibrary = await send('/api/rooms');
    assert.equal(pendingLibrary.rooms.find((room: { id: string }) => room.id === id).setupStep, 1);
    assert.equal(Object.hasOwn(pendingLibrary.rooms.find((room: { id: string }) => room.id === existingId), 'setupStep'), false);
    assert.deepEqual((await send('/api/rooms/' + existingId)).room, existing);

    const { setupStep: _step, ...completed } = changed;
    await send(path, 'PUT', { room: completed, revision: resumed.revision });
    const finished = await send(path);
    assert.deepEqual(finished.room, completed);
    assert.equal(Object.hasOwn(finished.room, 'setupStep'), false);
    const finishedLibrary = await send('/api/rooms');
    assert.equal(Object.hasOwn(finishedLibrary.rooms.find((room: { id: string }) => room.id === id), 'setupStep'), false);
    assert.deepEqual((await send('/api/rooms/' + existingId)).room, existing);
  } finally {
    await close(server);
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('virtual-space-onboarding-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
