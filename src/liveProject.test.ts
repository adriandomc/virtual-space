import { TERMS_VERSION } from './legalPolicy';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket as NodeWebSocket } from 'ws';
import * as Y from 'yjs';
import test from 'node:test';
import { createServer } from './server';
import { createDefaultProject, projectToRoom, type ProjectDocument } from './projectDocument';
import { patchProject } from './projectTestFixture';
import { sameData } from './sameData';
import { addLevel, removeLevel } from './projectOperations';
import { LiveProject, type ProjectSnapshot } from './liveProject';

const close = (server: Server) => new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
async function listen(server: Server) {
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return 'http://127.0.0.1:' + address.port;
}
function observedProject(url: string, cookie: string, origin: string, loseFirstAck = false) {
  const observation = { room: null as ProjectDocument | null, metadata: null as Omit<ProjectSnapshot, 'project'> | null, connected: false, pending: false, errors: [] as { message: string; denied?: boolean }[], recoveries: [] as ProjectDocument[], operationIds: [] as string[], sends: 0, connections: 0, discardedAcks: 0 };
  const waiters = new Set<() => void>();
  const publish = () => { for (const waiter of waiters) waiter(); };
  const sockets: NodeWebSocket[] = [];
  const factory = (address: string) => {
    observation.connections++;
    const underlying = new NodeWebSocket(address, { headers: { Cookie: cookie, Origin: origin } });
    sockets.push(underlying);
    const browser = {
      get readyState() { return underlying.readyState; },
      onmessage: null as ((event: { data: string }) => void) | null,
      onclose: null as ((event: { code: number }) => void) | null,
      onerror: null as (() => void) | null,
      send(data: string) { const value = JSON.parse(data); if (value.type === 'update') { observation.sends++; observation.operationIds.push(value.id); } underlying.send(data); },
      close() { underlying.close(); },
    };
    underlying.on('message', data => {
      if (loseFirstAck && JSON.parse(data.toString()).type === 'ack') {
        loseFirstAck = false; observation.discardedAcks++; underlying.terminate(); publish(); return;
      }
      browser.onmessage?.({ data: data.toString() });
    });
    underlying.on('close', code => { browser.onclose?.({ code }); publish(); });
    underlying.on('error', () => browser.onerror?.());
    return browser as unknown as WebSocket;
  };
  const project = new LiveProject(url, {
    project(room) { observation.room = room; publish(); },
    metadata(metadata) { observation.metadata = metadata; publish(); },
    state(connected, pending) { observation.connected = connected; observation.pending = pending; publish(); },
    error(message, denied) { observation.errors.push({ message, denied }); publish(); },
    recovery(project) { observation.recoveries.push(project); publish(); },
  }, factory);
  return {
    project, observation,
    wait(predicate: () => boolean, message = 'Expected project state') {
      if (predicate()) return Promise.resolve();
      return new Promise<void>((accept, reject) => {
        const check = () => { if (predicate()) { clearTimeout(timer); waiters.delete(check); accept(); } };
        const timer = setTimeout(() => { waiters.delete(check); reject(new Error(message + ': ' + JSON.stringify(observation))); }, 7000);
        waiters.add(check);
      });
    },
    destroy() { project.destroy(); for (const socket of sockets) socket.terminate(); },
  };
}

test('el cliente combina ediciones, confirma guardado, recibe croquis y recupera una confirmación perdida', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'virtual-space-live-client-')), server = createServer({ dataDir: join(directory, 'data'), maintenance: false }), base = await listen(server);
  const cookies: Record<string, string> = {};
  const request = (path: string, username: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers: { Cookie: cookies[username] ?? '', Origin: base, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const username of ['owner', 'editor']) {
    const registration = await request('/api/auth/register', username, 'POST', { username, password: 'Testing-password', confirmPassword: 'Testing-password', termsVersion: TERMS_VERSION });
    assert.equal(registration.status, 201); cookies[username] = registration.headers.get('set-cookie')!.split(';')[0];
  }
  const id = randomUUID(), path = '/api/rooms/' + id, room = createDefaultProject(undefined, undefined, id);
  room.levels[0].furniture = [{ id: 'ropero', levelId: room.activeLevelId, type: 'wardrobe', variant: 'wardrobe-classic', material: 'wood', color: '#b8a084', width: 1, height: 2, depth: 0.6, x: 0, z: 0, rotation: 0 }];
  await request('/api/rooms', 'owner', 'POST', { id, project: room });
  const invitation = (await (await request(path + '/members', 'owner', 'POST', { username: 'editor', role: 'editor' })).json()).members[0].id;
  await request('/api/notifications/' + invitation + '/accept', 'editor', 'POST', {});
  const owner = observedProject(base.replace('http:', 'ws:') + path + '/live', cookies.owner, base), editor = observedProject(base.replace('http:', 'ws:') + path + '/live', cookies.editor, base);
  let interrupted: ReturnType<typeof observedProject> | undefined;
  owner.project.connect(); editor.project.connect();
  try {
    await Promise.all([owner.wait(() => owner.observation.connected), editor.wait(() => editor.observation.connected)]);
    await t.test('muchos cambios de un mismo cliente mantienen acotado el historial de actores', async () => {
      for (let index = 0; index < 100; index++) {
        const previous = owner.observation.room!;
        owner.project.change({ ...previous, name: 'Cambio ' + index }, previous);
      }
      await owner.wait(() => !owner.observation.pending);
      await editor.wait(() => editor.observation.room?.name === 'Cambio 99');
      const database = new DatabaseSync(join(directory, 'data', 'accounts.sqlite'));
      try {
        const stored = database.prepare('SELECT y_state FROM rooms WHERE id=?').get(id)!;
        const state = Y.encodeStateVectorFromUpdate(stored.y_state as Uint8Array);
        assert.ok(Y.decodeStateVector(state).size <= 2, 'one seed and one editor actor suffice for repeated edits');
      } finally { database.close(); }
    });
    await t.test('dos vistas cambian distintos campos y varias ediciones se confirman en un solo lote', async () => {
      const ownerSends = owner.observation.sends, editorSends = editor.observation.sends;
      const previousOwner = owner.observation.room!, previousEditor = editor.observation.room!;
      owner.project.change(patchProject(previousOwner, { furniture: [{ ...previousOwner.levels[0].furniture[0], x: 1 }] }), previousOwner);
      const intermediate = owner.observation.room!;
      owner.project.change(patchProject(intermediate, { ceilingColor: '#112233' }), intermediate);
      editor.project.change(patchProject(previousEditor, { furniture: [{ ...previousEditor.levels[0].furniture[0], color: '#aabbcc' }] }), previousEditor);
      assert.equal(owner.project.hasPending, true); assert.equal(editor.project.hasPending, true);
      await Promise.all([
        owner.wait(() => !owner.observation.pending && owner.observation.room?.levels[0].furniture[0].color === '#aabbcc'),
        editor.wait(() => !editor.observation.pending && editor.observation.room?.levels[0].furniture[0].x === 1),
      ]);
      assert.equal(owner.observation.sends, ownerSends + 2); assert.equal(editor.observation.sends, editorSends + 1);
      const saved = await (await request(path, 'owner')).json();
      assert.deepEqual(owner.observation.room, saved.project); assert.deepEqual(editor.observation.room, saved.project);
      assert.equal(projectToRoom(saved.project).ceilingColor, '#112233'); assert.equal(owner.observation.errors.length, 0);
    });
    await t.test('el croquis subido en otra sesión actualiza los metadatos en vivo', async () => {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X9S8AAAAASUVORK5CYII=', 'base64');
      const levelId = owner.observation.room!.activeLevelId, snapshot = await (await request(path, 'owner')).json();
      const sketchPath = path + '/levels/' + levelId + '/sketch';
      const headers = { Cookie: cookies.owner, Origin: base, 'Content-Type': 'image/png', 'X-Sketch-Request-Id': randomUUID(), 'X-Sketch-Version': '0', 'X-Room-Revision': String(snapshot.revision) };
      const upload = await fetch(base + sketchPath, { method: 'PUT', headers, body: png }); assert.equal(upload.status, 200);
      await editor.wait(() => editor.observation.metadata?.sketches[levelId]?.hasSketch === true && editor.observation.metadata.sketches[levelId].version === 1);
      await fetch(base + sketchPath, { method: 'DELETE', headers: { ...headers, 'X-Sketch-Request-Id': randomUUID(), 'X-Sketch-Version': '1' } });
      await editor.wait(() => editor.observation.metadata?.sketches[levelId]?.hasSketch === false && editor.observation.metadata.sketches[levelId].version === 2);
    });
    await t.test('un lote rechazado conserva una copia recuperable sin repetirlo indefinidamente', async () => {
      const previous = owner.observation.room!, beforeSends = owner.observation.sends;
      owner.project.change(patchProject(previous, { furniture: [...previous.levels[0].furniture, { id: 'wrong-asset', type: 'custom', material: null, color: null, assetId: randomUUID(), name: 'Modelo ajeno', width: 1, height: 1, depth: 1, x: 0, z: 0, rotation: 0 }] }), previous);
      await owner.wait(() => owner.observation.errors.length > 0 && !owner.observation.pending);
      assert.equal(owner.project.hasPending, false);
      assert.deepEqual(owner.observation.room, previous);
      assert.equal(owner.observation.recoveries.length, 1);
      assert.equal(owner.project.recoveryProject?.levels[0].furniture.at(-1)?.id, 'wrong-asset');
      assert.throws(() => owner.project.change({ ...previous, name: 'No perder la recuperación' }, previous));
      await new Promise<void>(accept => setTimeout(accept, 180));
      assert.equal(owner.observation.sends, beforeSends + 1);
      owner.project.clearRecovery();
      const restored = owner.observation.room!;
      owner.project.change({ ...restored, name: 'Después del rechazo' }, restored);
      await owner.wait(() => !owner.observation.pending && owner.observation.room?.name === 'Después del rechazo');
      await editor.wait(() => editor.observation.room?.name === 'Después del rechazo');
      assert.equal((await (await request(path, 'owner')).json()).project.name, 'Después del rechazo');
    });
    await t.test('un cambio estructural conserva la pintura pendiente de otro editor', async () => {
      const editorPrevious = editor.observation.room!, ownerPrevious = owner.observation.room!, errors = editor.observation.errors.length;
      editor.project.change(patchProject(editorPrevious, { furniture: [{ ...editorPrevious.levels[0].furniture[0], color: '#884422' }] }), editorPrevious);
      owner.project.change(patchProject(ownerPrevious, { height: 3.1 }), ownerPrevious);
      await Promise.all([owner.wait(() => !owner.observation.pending), editor.wait(() => !editor.observation.pending)]);
      const saved = await (await request(path, 'owner')).json();
      assert.equal(saved.project.levels[0].height, 3.1);
      assert.equal(saved.project.levels[0].furniture[0].color, '#884422');
      assert.equal(editor.observation.errors.length, errors);
      assert.equal(editor.project.recoveryProject, null);
    });
    await t.test('un guardado REST conserva las identidades de cambios colaborativos pendientes', async () => {
      const editorPrevious = editor.observation.room!, snapshot = await (await request(path, 'owner')).json(), errors = editor.observation.errors.length;
      editor.project.change(patchProject(editorPrevious, { furniture: [{ ...editorPrevious.levels[0].furniture[0], color: '#337799' }] }), editorPrevious);
      const put = await request(path, 'owner', 'PUT', { project: patchProject(snapshot.project, { height: 3.2 }), revision: snapshot.revision, operationId: randomUUID() });
      assert.equal(put.status, 200);
      await editor.wait(() => !editor.observation.pending);
      const saved = await (await request(path, 'owner')).json();
      assert.equal(saved.project.levels[0].height, 3.2);
      assert.equal(saved.project.levels[0].furniture[0].color, '#337799');
      assert.equal(editor.observation.errors.length, errors);
    });
    await t.test('eliminar un nivel conserva los cambios pendientes de ese nivel para recuperarlos', async () => {
      const before = owner.observation.room!;
      owner.project.change(addLevel(before, { copy: true }), before);
      await Promise.all([owner.wait(() => !owner.observation.pending), editor.wait(() => editor.observation.room?.levels.length === 2)]);
      const previous = editor.observation.room!, removedId = previous.levels[1].id;
      editor.project.change({ ...previous, levels: previous.levels.map(level => level.id === removedId ? { ...level, name: 'Trabajo en nivel eliminado' } : level) }, previous);
      const ownerPrevious = owner.observation.room!;
      owner.project.change(removeLevel(ownerPrevious, removedId), ownerPrevious);
      await Promise.all([owner.wait(() => !owner.observation.pending), editor.wait(() => !editor.observation.pending && editor.observation.room?.levels.length === 1)]);
      assert.equal(editor.project.recoveryProject?.levels.find(level => level.id === removedId)?.name, 'Trabajo en nivel eliminado');
      assert.equal((await (await request(path, 'owner')).json()).project.levels.length, 1);
      editor.project.clearRecovery();
    });
    await t.test('perder una confirmación después del commit no pierde cambios de otro usuario al reconectar', async () => {
      interrupted = observedProject(base.replace('http:', 'ws:') + path + '/live', cookies.owner, base, true);
      interrupted.project.connect(); await interrupted.wait(() => interrupted!.observation.connected);
      const previous = interrupted.observation.room!;
      interrupted.project.change(patchProject(previous, { floorColor: '#445566' }), previous);
      await interrupted.wait(() => interrupted!.observation.discardedAcks === 1 && !interrupted!.observation.connected);
      assert.equal(interrupted.project.hasPending, true);
      interrupted.project.offline(); interrupted.project.connect();
      assert.equal(interrupted.observation.connections, 1, 'paused clients do not start another connection');
      await editor.wait(() => Boolean(editor.observation.room) && projectToRoom(editor.observation.room!).floorColor === '#445566');
      const otherPrevious = editor.observation.room!;
      editor.project.change({ ...otherPrevious, name: 'Cambio durante la desconexión' }, otherPrevious);
      await editor.wait(() => !editor.observation.pending);
      interrupted.project.retry();
      await interrupted.wait(() => interrupted!.observation.connected && !interrupted!.observation.pending);
      assert.equal(interrupted.observation.room && projectToRoom(interrupted.observation.room).floorColor, '#445566');
      assert.equal(interrupted.observation.room?.name, 'Cambio durante la desconexión');
      assert.equal(interrupted.observation.connections, 2);
      const saved = await (await request(path, 'owner')).json(); assert.deepEqual(interrupted.observation.room, saved.project);
      assert.equal(interrupted.observation.metadata?.revision, saved.revision, 'a retried older receipt cannot roll back the current revision');
      assert.equal(interrupted.observation.operationIds.length, 2); assert.equal(interrupted.observation.operationIds[0], interrupted.observation.operationIds[1], 'offline resumption retries the original durable operation identity');
      interrupted.destroy(); interrupted = undefined;
    });
    await t.test('pausar antes del primer envío conserva el borrador y no permite editar ni conectar hasta reanudar', async () => {
      const previous = owner.observation.room!, connections = owner.observation.connections, sends = owner.observation.sends;
      owner.project.change({ ...previous, name: 'Conservado durante desconexión' }, previous); owner.project.offline(); owner.project.connect();
      assert.equal(owner.project.hasPending, true); assert.equal(owner.observation.connected, false); assert.equal(owner.observation.connections, connections);
      assert.throws(() => owner.project.change({ ...previous, name: 'No permitido' }, previous));
      await new Promise<void>(accept => setTimeout(accept, 120)); assert.equal(owner.observation.sends, sends);
      owner.project.retry(); await owner.wait(() => owner.observation.connected && !owner.observation.pending);
      assert.equal((await (await request(path, 'owner')).json()).project.name, 'Conservado durante desconexión');
      assert.equal(owner.observation.sends, sends + 1);
      await editor.wait(() => editor.observation.room?.name === 'Conservado durante desconexión');
    });
    await t.test('ediciones compatibles por separado que chocan juntas no dejan un bucle de reconexión', async () => {
      const first = owner.observation.room!, second = editor.observation.room!;
      owner.project.change(patchProject(first, { height: 2.2, lights: first.levels[0].lights.map(light => ({ ...light, y: Math.min(light.y, 2.2) })) }), first);
      editor.project.change(patchProject(second, { furniture: [{ ...second.levels[0].furniture[0], height: 2.5 }] }), second);
      await Promise.all([
        owner.wait(() => owner.observation.connected && !owner.observation.pending),
        editor.wait(() => editor.observation.connected && !editor.observation.pending),
      ]);
      const saved = await (await request(path, 'owner')).json();
      assert.ok(saved.project.levels[0].furniture[0].height <= saved.project.levels[0].height);
      await owner.wait(() => sameData(owner.observation.room, saved.project));
      await editor.wait(() => sameData(editor.observation.room, saved.project));
      assert.ok(owner.observation.connections <= 2); assert.ok(editor.observation.connections <= 2);
      owner.project.clearRecovery(); editor.project.clearRecovery();
    });
    await t.test('el cambio a lector descarta lo que aún no se envió y conserva la vista guardada', async () => {
      const previous = editor.observation.room!;
      editor.project.change({ ...previous, name: 'Cambio sin permiso' }, previous);
      await request(path + '/members/' + invitation, 'owner', 'PATCH', { role: 'reader' });
      await editor.wait(() => editor.observation.metadata?.role === 'reader' && !editor.observation.pending && editor.observation.room?.name === previous.name);
      assert.equal(editor.project.hasPending, false);
      assert.equal(editor.project.recoveryProject?.name, 'Cambio sin permiso');
      assert.throws(() => editor.project.change({ ...previous, name: 'No autorizado' }, previous));
      assert.equal((await (await request(path, 'owner')).json()).project.name, previous.name);
    });
  } finally {
    owner.destroy(); editor.destroy(); interrupted?.destroy(); await close(server);
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('virtual-space-live-client-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
