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
import { createDefaultRoom } from './model';
import { LiveProject, type ProjectSnapshot } from './liveProject';
import type { Room } from './types';

const close = (server: Server) => new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
async function listen(server: Server) {
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return 'http://127.0.0.1:' + address.port;
}
function observedProject(url: string, cookie: string, origin: string, loseFirstAck = false) {
  const observation = { room: null as Room | null, metadata: null as Omit<ProjectSnapshot, 'room'> | null, connected: false, pending: false, errors: [] as { message: string; denied?: boolean }[], sends: 0, connections: 0, discardedAcks: 0 };
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
      send(data: string) { if (JSON.parse(data).type === 'update') observation.sends++; underlying.send(data); },
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
    room(room) { observation.room = room; publish(); },
    metadata(metadata) { observation.metadata = metadata; publish(); },
    state(connected, pending) { observation.connected = connected; observation.pending = pending; publish(); },
    error(message, denied) { observation.errors.push({ message, denied }); publish(); },
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
  const id = randomUUID(), path = '/api/rooms/' + id, room = createDefaultRoom();
  room.furniture = [{ id: 'ropero', type: 'wardrobe', variant: 'wardrobe-classic', material: 'wood', color: '#b8a084', width: 1, height: 2, depth: 0.6, x: 0, z: 0, rotation: 0 }];
  await request('/api/rooms', 'owner', 'POST', { id, room });
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
      owner.project.change({ ...previousOwner, furniture: [{ ...previousOwner.furniture[0], x: 1 }] }, previousOwner);
      const intermediate = owner.observation.room!;
      owner.project.change({ ...intermediate, ceilingColor: '#112233' }, intermediate);
      editor.project.change({ ...previousEditor, furniture: [{ ...previousEditor.furniture[0], color: '#aabbcc' }] }, previousEditor);
      assert.equal(owner.project.hasPending, true); assert.equal(editor.project.hasPending, true);
      await Promise.all([
        owner.wait(() => !owner.observation.pending && owner.observation.room?.furniture[0].color === '#aabbcc'),
        editor.wait(() => !editor.observation.pending && editor.observation.room?.furniture[0].x === 1),
      ]);
      assert.equal(owner.observation.sends, ownerSends + 1); assert.equal(editor.observation.sends, editorSends + 1);
      const saved = await (await request(path, 'owner')).json();
      assert.deepEqual(owner.observation.room, saved.room); assert.deepEqual(editor.observation.room, saved.room);
      assert.equal(saved.room.ceilingColor, '#112233'); assert.equal(owner.observation.errors.length, 0);
    });
    await t.test('el croquis subido en otra sesión actualiza los metadatos en vivo', async () => {
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X9S8AAAAASUVORK5CYII=', 'base64');
      const upload = await fetch(base + path + '/sketch', { method: 'PUT', headers: { Cookie: cookies.owner, Origin: base, 'Content-Type': 'image/png' }, body: png });
      assert.equal(upload.status, 200);
      await editor.wait(() => editor.observation.metadata?.hasSketch === true && editor.observation.metadata.sketchVersion === 1);
      await request(path + '/sketch', 'owner', 'DELETE');
      await editor.wait(() => editor.observation.metadata?.hasSketch === false && editor.observation.metadata.sketchVersion === 2);
    });
    await t.test('un lote rechazado se descarta por requestId y no entra en una repetición infinita', async () => {
      const previous = owner.observation.room!, beforeSends = owner.observation.sends;
      owner.project.change({ ...previous, furniture: [...previous.furniture, { id: 'wrong-asset', type: 'custom', material: null, color: null, assetId: randomUUID(), name: 'Modelo ajeno', width: 1, height: 1, depth: 1, x: 0, z: 0, rotation: 0 }] }, previous);
      await owner.wait(() => owner.observation.errors.length > 0 && !owner.observation.pending);
      assert.equal(owner.project.hasPending, false);
      assert.deepEqual(owner.observation.room, previous);
      await new Promise<void>(accept => setTimeout(accept, 180));
      assert.equal(owner.observation.sends, beforeSends + 1);
      const restored = owner.observation.room!;
      owner.project.change({ ...restored, name: 'Después del rechazo' }, restored);
      await owner.wait(() => !owner.observation.pending && owner.observation.room?.name === 'Después del rechazo');
      await editor.wait(() => editor.observation.room?.name === 'Después del rechazo');
      assert.equal((await (await request(path, 'owner')).json()).room.name, 'Después del rechazo');
    });
    await t.test('perder una confirmación después del commit no pierde cambios de otro usuario al reconectar', async () => {
      interrupted = observedProject(base.replace('http:', 'ws:') + path + '/live', cookies.owner, base, true);
      interrupted.project.connect(); await interrupted.wait(() => interrupted!.observation.connected);
      const previous = interrupted.observation.room!;
      interrupted.project.change({ ...previous, floorColor: '#445566' }, previous);
      await interrupted.wait(() => interrupted!.observation.discardedAcks === 1 && !interrupted!.observation.connected);
      assert.equal(interrupted.project.hasPending, true);
      await editor.wait(() => editor.observation.room?.floorColor === '#445566');
      const otherPrevious = editor.observation.room!;
      editor.project.change({ ...otherPrevious, name: 'Cambio durante la desconexión' }, otherPrevious);
      await editor.wait(() => !editor.observation.pending);
      interrupted.project.retry();
      await interrupted.wait(() => interrupted!.observation.connected && !interrupted!.observation.pending);
      assert.equal(interrupted.observation.room?.floorColor, '#445566');
      assert.equal(interrupted.observation.room?.name, 'Cambio durante la desconexión');
      assert.equal(interrupted.observation.connections, 2);
      const saved = await (await request(path, 'owner')).json(); assert.deepEqual(interrupted.observation.room, saved.room);
      interrupted.destroy(); interrupted = undefined;
    });
    await t.test('ediciones compatibles por separado que chocan juntas no dejan un bucle de reconexión', async () => {
      const first = owner.observation.room!, second = editor.observation.room!;
      owner.project.change({ ...first, height: 2.2, lights: first.lights.map(light => ({ ...light, y: Math.min(light.y, 2.2) })) }, first);
      editor.project.change({ ...second, furniture: [{ ...second.furniture[0], height: 2.5 }] }, second);
      await Promise.all([
        owner.wait(() => owner.observation.connected && !owner.observation.pending),
        editor.wait(() => editor.observation.connected && !editor.observation.pending),
      ]);
      const saved = await (await request(path, 'owner')).json();
      assert.ok(saved.room.furniture[0].height <= saved.room.height);
      await owner.wait(() => JSON.stringify(owner.observation.room) === JSON.stringify(saved.room));
      await editor.wait(() => JSON.stringify(editor.observation.room) === JSON.stringify(saved.room));
      assert.ok(owner.observation.connections <= 2); assert.ok(editor.observation.connections <= 2);
    });
    await t.test('el cambio a lector descarta lo que aún no se envió y conserva la vista guardada', async () => {
      const previous = editor.observation.room!;
      editor.project.change({ ...previous, name: 'Cambio sin permiso' }, previous);
      await request(path + '/members/' + invitation, 'owner', 'PATCH', { role: 'reader' });
      await editor.wait(() => editor.observation.metadata?.role === 'reader' && !editor.observation.pending && editor.observation.room?.name === previous.name);
      assert.equal(editor.project.hasPending, false);
      assert.throws(() => editor.project.change({ ...previous, name: 'No autorizado' }, previous));
      assert.equal((await (await request(path, 'owner')).json()).room.name, previous.name);
    });
  } finally {
    owner.destroy(); editor.destroy(); interrupted?.destroy(); await close(server);
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('virtual-space-live-client-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
