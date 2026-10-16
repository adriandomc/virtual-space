import { TERMS_VERSION } from '../../src/domain/policies/legalPolicy';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { addOpening, createDefaultRoom, furniturePlacementIssues, invalidFurnitureIds, moveSceneItem, toggleSceneInteraction } from '../../src/domain/project/model';
import { createDefaultProject, projectToRoom, updateProjectRoom } from '../../src/domain/project/projectDocument';
import { createServer } from '../../src/server/server';
import type { FurnitureItem } from '../../src/domain/project/types';

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
  const register = await fetch(base + '/api/auth/register', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'placement_owner', password: 'test-password', confirmPassword: 'test-password', termsVersion: TERMS_VERSION }) });
  assert.equal(register.status, 201);
  const cookie = register.headers.get('set-cookie')!.split(';')[0];
  const send = (path: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const id = randomUUID(), path = '/api/rooms/' + id, baseProject = createDefaultProject(undefined, undefined, id);
  const canonical = (view: ReturnType<typeof createDefaultRoom>) => updateProjectRoom(baseProject, baseProject.activeLevelId, view);
  const item: FurnitureItem = { id: 'moving', type: 'nightstand', variant: 'nightstand-classic', x: -1, z: 0, width: 0.5, depth: 0.5, height: 0.55, rotation: 0, material: 'metal', color: '#aabbcc' };
  const room = { ...addOpening({ ...createDefaultRoom(), openings: [] }, 'door', 0, { width: 0.87, height: 2.17, doorStyle: 'left' }), furniture: [item, { ...item, id: 'fixed', x: 0 }] };
  try {
    assert.equal((await send('/api/rooms', 'POST', { id, project: canonical(room) })).status, 201);
    const overlap = moveSceneItem(room, { kind: 'furniture', id: item.id }, { x: 0, z: 0 });
    assert.deepEqual(invalidFurnitureIds(overlap), new Set(['moving', 'fixed']));
    const savedOverlap = await send(path, 'PUT', { project: canonical(overlap), revision: 1, operationId: randomUUID() });
    assert.equal(savedOverlap.status, 200); assert.equal((await savedOverlap.json()).revision, 2);
    const outside = moveSceneItem(overlap, { kind: 'furniture', id: item.id }, { x: 8, z: -5, rotation: 45 });
    assert.equal(outside.editing.bounds, true);
    assert.deepEqual(furniturePlacementIssues(outside, outside.furniture[0]), { outside: true, overlap: false });
    assert.equal((await send(path, 'PUT', { project: canonical(outside), revision: 2, operationId: randomUUID() })).status, 200);
    for (const patch of [{ x: 51 }, { z: NaN }, { width: -1 }, { height: 9 }, { rotation: Infinity }, { material: 'glass' }]) {
      assert.equal((await send(path, 'PUT', { project: { ...canonical(outside), levels: [{ ...canonical(outside).levels[0], furniture: canonical(outside).levels[0].furniture.map((item, index) => index ? item : { ...item, ...patch }) }] }, revision: 3, operationId: randomUUID() })).status, 400);
    }
    assert.equal((await send(path, 'PUT', { project: { ...canonical(outside), levels: [{ ...canonical(outside).levels[0], openings: canonical(outside).levels[0].openings.map(item => ({ ...item, doorStyle: 'both' })) }] }, revision: 3, operationId: randomUUID() })).status, 400);
    const afterInvalid = await (await send(path)).json();
    assert.equal(afterInvalid.revision, 3); assert.deepEqual(afterInvalid.project, canonical(outside));
    await close(server); server = createServer({ dataDir }); base = await listen(server);
    const reopened = await (await send(path)).json();
    assert.equal(reopened.revision, 3); assert.deepEqual(reopened.project, canonical(outside));
    const corrected = moveSceneItem(outside, { kind: 'furniture', id: item.id }, { x: 1, z: 0, rotation: 0 });
    assert.equal(invalidFurnitureIds(corrected).size, 0);
    assert.equal((await send(path, 'PUT', { project: canonical(corrected), revision: 3, operationId: randomUUID() })).status, 200);
    const final = await (await send(path)).json();
    assert.equal(final.revision, 4); assert.deepEqual(final.project, canonical(corrected));
  } finally { await close(server); rmSync(dataDir, { recursive: true, force: true }); }
});

test('guarda puertas y focos al interactuar y conserva los estados después de reiniciar', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'virtual-space-interactions-'));
  assert.ok(resolve(dataDir).startsWith(resolve(tmpdir()) + sep));
  let server = createServer({ dataDir }), base = await listen(server);
  const register = await fetch(base + '/api/auth/register', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'interaction_owner', password: 'test-password', confirmPassword: 'test-password', termsVersion: TERMS_VERSION }) });
  assert.equal(register.status, 201);
  const cookie = register.headers.get('set-cookie')!.split(';')[0];
  const send = (path: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const id = randomUUID(), path = '/api/rooms/' + id, baseProject = createDefaultProject(undefined, undefined, id);
  const canonical = (view: ReturnType<typeof createDefaultRoom>) => updateProjectRoom(baseProject, baseProject.activeLevelId, view);
  const emptyRoom = createDefaultRoom();
  const room = addOpening({ ...emptyRoom, lights: emptyRoom.lights.map(light => ({ ...light, enabled: false })) }, 'door', 0, { width: 0.9, height: 2.1, doorStyle: 'left' });
  const door = { kind: 'opening' as const, id: room.openings[0].id }, light = { kind: 'light' as const, id: room.lights[0].id };
  try {
    assert.equal((await send('/api/rooms', 'POST', { id, project: canonical(room) })).status, 201);
    const interacted = toggleSceneInteraction(toggleSceneInteraction(room, door), light);
    assert.equal(interacted.openings[0].open, true); assert.equal(interacted.lights[0].enabled, true);
    assert.equal((await send(path, 'PUT', { project: canonical(interacted), revision: 1, operationId: randomUUID() })).status, 200);
    for (const open of [null, 'false', 0, {}]) assert.equal((await send(path, 'PUT', { project: { ...canonical(interacted), levels: [{ ...canonical(interacted).levels[0], openings: canonical(interacted).levels[0].openings.map(item => ({ ...item, open })) }] }, revision: 2, operationId: randomUUID() })).status, 400);
    const beforeRestart = await (await send(path)).json();
    assert.equal(beforeRestart.revision, 2); assert.deepEqual(beforeRestart.project, canonical(interacted));
    await close(server); server = createServer({ dataDir }); base = await listen(server);
    const reopened = await (await send(path)).json();
    assert.equal(reopened.revision, 2); assert.deepEqual(reopened.project, canonical(interacted));
    const reset = toggleSceneInteraction(toggleSceneInteraction(projectToRoom(reopened.project), door), light);
    assert.equal((await send(path, 'PUT', { project: canonical(reset), revision: 2, operationId: randomUUID() })).status, 200);
    const final = await (await send(path)).json();
    assert.equal(final.revision, 3); assert.deepEqual(final.project, canonical(room));
  } finally { await close(server); rmSync(dataDir, { recursive: true, force: true }); }
});
