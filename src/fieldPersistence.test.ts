import { TERMS_VERSION } from './legalPolicy';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { addOpening, createDefaultRoom } from './model';
import { createServer } from './server';

test('rechaza borradores incompletos sin modificar el diseño guardado y admite ceros válidos', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'virtual-space-fields-'));
  const server = createServer({ dataDir });
  try {
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const base = 'http://127.0.0.1:' + address.port;
    const registered = await fetch(base + '/api/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ username: 'field_test', password: 'test-password', confirmPassword: 'test-password', termsVersion: TERMS_VERSION }),
    });
    assert.equal(registered.status, 201);
    const cookie = registered.headers.get('set-cookie')!.split(';')[0];
    const send = (path: string, method = 'GET', body?: unknown) => fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const id = randomUUID(), path = '/api/rooms/' + id;
    const room = { ...addOpening(createDefaultRoom(), 'door', 0, { width: 0.9, height: 2.1, sill: 0, doorStyle: 'right' }), name: 'Mi diseño' };
    const created = await send('/api/rooms', 'POST', { id, room });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).revision, 1);

    for (const invalidRoom of [
      { ...room, name: '' },
      { ...room, name: ' \t\n ' },
      { ...room, height: null },
      { ...room, height: NaN },
      { ...room, openings: room.openings.map((opening, index) => index === 0 ? { ...opening, width: null } : opening) },
      { ...room, openings: room.openings.map((opening, index) => index === 0 ? { ...opening, width: NaN } : opening) },
      { ...room, floorColor: '#12' },
    ]) {
      const rejected = await send(path, 'PUT', { room: invalidRoom, revision: 1 });
      assert.equal(rejected.status, 400);
      const saved = await (await send(path)).json();
      assert.equal(saved.revision, 1);
      assert.deepEqual(saved.room, room);
    }

    const validRoom = { ...room, name: 'Cocina', lights: room.lights.map(light => ({ ...light, lumens: 0 })) };
    const updated = await send(path, 'PUT', { room: validRoom, revision: 1 });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json()).revision, 2);
    const saved = await (await send(path)).json();
    assert.equal(saved.revision, 2);
    assert.deepEqual(saved.room, validRoom);
  } finally {
    await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
    assert.ok(resolve(dataDir).startsWith(resolve(tmpdir()) + sep));
    rmSync(dataDir, { recursive: true, force: true });
  }
});
