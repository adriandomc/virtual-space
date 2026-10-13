import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { addOpening, createDefaultRoom, furniturePlacementIssues, invalidFurnitureIds, moveSceneItem } from './model';
import { createServer } from './server';
import type { FurnitureItem } from './types';

async function listen(server: Server) {
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return 'http://127.0.0.1:' + address.port;
}
const close = (server: Server) => new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));

test('persisten superposiciones y muebles fuera sin aceptar coordenadas o medidas corruptas', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'virtual-space-placement-'));
  assert.ok(resolve(dataDir).startsWith(resolve(tmpdir()) + sep));
  let server = createServer({ dataDir }), base = await listen(server);
  const register = await fetch(base + '/api/auth/register', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'placement_owner', password: 'test-password', confirmPassword: 'test-password' }) });
  assert.equal(register.status, 201);
  const cookie = register.headers.get('set-cookie')!.split(';')[0];
  const send = (path: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const id = randomUUID(), path = '/api/rooms/' + id;
  const item: FurnitureItem = { id: 'moving', type: 'nightstand', x: -1, z: 0, width: 0.5, depth: 0.5, height: 0.55, rotation: 0, material: 'metal', color: '#aabbcc' };
  const room = { ...addOpening({ ...createDefaultRoom(), openings: [] }, 'door', 0, { width: 0.87, height: 2.17, doorStyle: 'left' }), furniture: [item, { ...item, id: 'fixed', x: 0 }] };
  try {
    assert.equal((await send('/api/rooms', 'POST', { id, room })).status, 201);
    const overlap = moveSceneItem(room, { kind: 'furniture', id: item.id }, { x: 0, z: 0 });
    assert.deepEqual(invalidFurnitureIds(overlap), new Set(['moving', 'fixed']));
    const savedOverlap = await send(path, 'PUT', { room: overlap, revision: 1 });
    assert.equal(savedOverlap.status, 200); assert.equal((await savedOverlap.json()).revision, 2);
    const outside = moveSceneItem(overlap, { kind: 'furniture', id: item.id }, { x: 8, z: -5, rotation: 45 });
    assert.equal(outside.editing.bounds, true);
    assert.deepEqual(furniturePlacementIssues(outside, outside.furniture[0]), { outside: true, overlap: false });
    assert.equal((await send(path, 'PUT', { room: outside, revision: 2 })).status, 200);
    for (const patch of [{ x: 51 }, { z: NaN }, { width: -1 }, { height: 9 }, { rotation: Infinity }, { material: 'glass' }]) {
      assert.equal((await send(path, 'PUT', { room: { ...outside, furniture: [{ ...outside.furniture[0], ...patch }, outside.furniture[1]] }, revision: 3 })).status, 400);
    }
    assert.equal((await send(path, 'PUT', { room: { ...outside, openings: [{ ...outside.openings[0], doorStyle: 'both' }] }, revision: 3 })).status, 400);
    const afterInvalid = await (await send(path)).json();
    assert.equal(afterInvalid.revision, 3); assert.deepEqual(afterInvalid.room, outside);
    await close(server); server = createServer({ dataDir }); base = await listen(server);
    const reopened = await (await send(path)).json();
    assert.equal(reopened.revision, 3); assert.deepEqual(reopened.room, outside);
    const corrected = moveSceneItem(outside, { kind: 'furniture', id: item.id }, { x: 1, z: 0, rotation: 0 });
    assert.equal(invalidFurnitureIds(corrected).size, 0);
    assert.equal((await send(path, 'PUT', { room: corrected, revision: 3 })).status, 200);
    const final = await (await send(path)).json();
    assert.equal(final.revision, 4); assert.deepEqual(final.room, corrected);
  } finally { await close(server); rmSync(dataDir, { recursive: true, force: true }); }
});
