import { TERMS_VERSION } from './legalPolicy';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { Server } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { createServer } from './server';
import { createDefaultProject, type ProjectDocument, type ProjectLevel } from './projectDocument';
import { readProject } from './projectRepository';
import { addLevel, addWall } from './projectOperations';
import { structureCommand } from './projectProtocol';
import { readProjectScope, writeProjectScope } from './collaborativeProject';
const readYRoom = (doc: Y.Doc) => readProjectScope(doc) as ProjectLevel;
const writeYRoom = (doc: Y.Doc, next: ProjectLevel, previous: ProjectLevel) => writeProjectScope(doc, next, previous);

type Message = { type: string; update: string; id?: string; revision?: number; status?: number; role?: string; canEdit?: boolean; canManage?: boolean; project?: ProjectDocument; states: Record<string,string>; [key: string]: unknown };
const close = (server: Server) => new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
async function listen(server: Server) {
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return 'http://127.0.0.1:' + address.port;
}
function live(base: string, id: string, cookie?: string, origin: string | undefined = base) {
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/rooms/' + id + '/live', { headers: { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) } });
  let scope = '';
  const messages: Message[] = [], pending: { type: string; accept: (value: Message) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  socket.on('message', data => {
    const message = JSON.parse(data.toString()) as Message; if (message.project) scope = message.project.activeLevelId;
    const waiter = pending.find(value => value.type === message.type);
    if (waiter) { pending.splice(pending.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.accept(message); }
    else messages.push(message);
  });
  socket.on('error', () => {});
  return {
    socket,
    next(type: string) {
      const index = messages.findIndex(value => value.type === type);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
      return new Promise<Message>((accept, reject) => {
        const waiter = { type, accept, reject, timer: setTimeout(() => { pending.splice(pending.indexOf(waiter), 1); reject(new Error('Expected live message: ' + type)); }, 5000) };
        pending.push(waiter);
      });
    },
    send(update: Uint8Array, id = randomUUID()) { socket.send(JSON.stringify({ type: 'update', scope, update: Buffer.from(update).toString('base64'), id })); return id; },
  };
}
function edit(doc: Y.Doc, callback: (room: ProjectLevel) => ProjectLevel) {
  const previous = readYRoom(doc), vector = Y.encodeStateVector(doc);
  writeYRoom(doc, callback(previous), previous);
  return Y.encodeStateAsUpdate(doc, vector);
}
function document(message: Message) { const doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from(message.states[message.project!.activeLevelId], 'base64')); return doc; }
async function rejectedConnection(base: string, id: string, cookie?: string, origin: string | undefined = base) {
  const client = live(base, id, cookie, origin);
  return new Promise<number>((accept, reject) => {
    client.socket.once('unexpected-response', (_request, response) => { response.resume(); client.socket.terminate(); accept(response.statusCode!); });
    client.socket.once('open', () => { client.socket.terminate(); reject(new Error('The connection should have been rejected.')); });
  });
}

test('invitaciones, permisos y colaboración durable sin sobrescribir cambios ajenos', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'virtual-space-collaboration-')), dataDir = join(directory, 'data');
  let clock = Date.now(), server = createServer({ dataDir, now: () => clock, maintenance: false }), base = await listen(server);
  const cookies: Record<string, string> = {};
  const request = (path: string, user?: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', Origin: base, ...(user ? { Cookie: cookies[user] } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const username of ['owner', 'editor', 'reader', 'other']) {
    const response = await request('/api/auth/register', undefined, 'POST', { username, password: 'Testing-password', confirmPassword: 'Testing-password', termsVersion: TERMS_VERSION });
    assert.equal(response.status, 201); cookies[username] = response.headers.get('set-cookie')!.split(';')[0];
  }
  const id = randomUUID(), path = '/api/rooms/' + id, room = createDefaultProject(undefined, undefined, id);
  room.levels[0].furniture = [{ id: 'wardrobe', levelId: room.activeLevelId, type: 'wardrobe', variant: 'wardrobe-classic', material: 'wood', color: '#b8a084', width: 1, depth: 0.6, height: 2, x: 0, z: 0, rotation: 0 }];
  assert.equal((await request('/api/rooms', 'owner', 'POST', { id, project: room })).status, 201);
  let editorMemberId = '', readerMemberId = '';
  let ownerLive: ReturnType<typeof live>, editorLive: ReturnType<typeof live>, readerLive: ReturnType<typeof live>;
  let ownerDoc!: Y.Doc, editorDoc!: Y.Doc;
  try {
    await t.test('las invitaciones son privadas, normalizan el usuario y requieren aceptación', async () => {
      const invite = await request(path + '/members', 'owner', 'POST', { username: 'EDITOR', role: 'editor' });
      assert.equal(invite.status, 201);
      editorMemberId = (await invite.json()).members[0].id;
      assert.equal((await request(path, 'editor')).status, 404);
      assert.equal((await request('/api/notifications', 'other')).status, 200);
      assert.deepEqual((await (await request('/api/notifications', 'other')).json()).notifications, []);
      const notification = (await (await request('/api/notifications', 'editor')).json()).notifications[0];
      assert.equal(notification.id, editorMemberId); assert.equal(notification.fromUsername, 'owner'); assert.equal(notification.role, 'editor');
      assert.equal((await request('/api/notifications/' + editorMemberId + '/accept', 'other', 'POST', {})).status, 404);
      assert.equal((await request('/api/notifications/' + editorMemberId + '/accept', 'editor', 'POST', {})).status, 200);
      const accepted = await (await request(path, 'editor')).json();
      assert.equal(accepted.role, 'editor'); assert.equal(accepted.canEdit, true); assert.equal(accepted.canManage, false);
      assert.equal((await (await request('/api/rooms', 'editor')).json()).rooms[0].role, 'editor');
      const readerInvite = await request(path + '/members', 'owner', 'POST', { username: 'reader', role: 'reader' });
      readerMemberId = (await readerInvite.json()).members.find((member: { username: string }) => member.username === 'reader').id;
      await request('/api/notifications/' + readerMemberId + '/accept', 'reader', 'POST', {});
      assert.equal((await (await request(path, 'reader')).json()).role, 'reader');
      assert.equal((await request(path + '/members', 'editor')).status, 403);
      assert.equal((await request(path + '/share', 'editor', 'POST', { enabled: true })).status, 403);
      assert.equal((await request(path, 'editor', 'DELETE')).status, 403);
      assert.equal((await request(path + '/members', 'owner', 'POST', { username: 'missing', role: 'editor' })).status, 404);
      assert.equal((await request(path + '/members', 'owner', 'POST', { username: 'other', role: 'owner' })).status, 400);
      const declined = await request(path + '/members', 'owner', 'POST', { username: 'other', role: 'reader' });
      const declinedId = (await declined.json()).members.find((member: { username: string }) => member.username === 'other').id;
      assert.equal((await request('/api/notifications/' + declinedId + '/decline', 'other', 'POST', {})).status, 200);
      assert.deepEqual((await (await request('/api/notifications', 'other')).json()).notifications, []);
      assert.equal((await request(path, 'other')).status, 404);
    });
    await t.test('WebSocket autentica sesión, origen y permisos de proyectos privados', async () => {
      assert.equal(await rejectedConnection(base, id), 404);
      assert.equal(await rejectedConnection(base, id, cookies.other), 404);
      assert.equal(await rejectedConnection(base, id, cookies.owner, 'https://attacker.invalid'), 403);
      assert.equal(await rejectedConnection(base, id, cookies.owner, ''), 403);
      ownerLive = live(base, id, cookies.owner); editorLive = live(base, id, cookies.editor); readerLive = live(base, id, cookies.reader);
      const [one, two, three] = await Promise.all([ownerLive.next('sync'), editorLive.next('sync'), readerLive.next('sync')]);
      assert.equal(one.role, 'owner'); assert.equal(two.role, 'editor'); assert.equal(three.role, 'reader'); assert.equal(three.canEdit, false);
      ownerDoc = document(one); editorDoc = document(two);
    });
    await t.test('dos editores modifican campos distintos y reciben confirmación después del guardado', async () => {
      const one = edit(ownerDoc, value => ({ ...value, furniture: [{ ...value.furniture[0], x: 1 }], walls: value.walls.map((wall, index) => index === 0 ? { ...wall, left: { ...wall.left, color: '#112233' } } : wall) }));
      const two = edit(editorDoc, value => ({ ...value, furniture: [{ ...value.furniture[0], color: '#aabbcc' }], walls: value.walls.map((wall, index) => index === 1 ? { ...wall, left: { ...wall.left, color: '#abcdef' } } : wall) }));
      const oneId = ownerLive.send(one), twoId = editorLive.send(two);
      const [oneAck, twoAck, ownerRemote, editorRemote] = await Promise.all([ownerLive.next('ack'), editorLive.next('ack'), ownerLive.next('update'), editorLive.next('update')]);
      assert.equal(oneAck.id, oneId); assert.equal(twoAck.id, twoId);
      Y.applyUpdate(ownerDoc, Buffer.from(ownerRemote.update, 'base64')); Y.applyUpdate(editorDoc, Buffer.from(editorRemote.update, 'base64'));
      assert.deepEqual(readYRoom(ownerDoc), readYRoom(editorDoc));
      const stored = await (await request(path, 'owner')).json();
      assert.equal(stored.revision, 3); assert.equal(stored.project.levels[0].furniture[0].x, 1); assert.equal(stored.project.levels[0].furniture[0].color, '#aabbcc');
      assert.deepEqual(stored.project.levels[0].walls.slice(0, 2).map((wall: any) => wall.left.color), ['#112233', '#abcdef']);
      const database = new DatabaseSync(join(dataDir, 'accounts.sqlite'));
      const row = database.prepare('SELECT document,y_state FROM project_levels WHERE room_id=? AND id=?').get(id, room.activeLevelId)!;
      assert.deepEqual(readProject(database, id), stored.project);
      const restored = new Y.Doc(); Y.applyUpdate(restored, row.y_state as Uint8Array);
      assert.deepEqual(readYRoom(restored), stored.project.levels[0]); restored.destroy(); database.close();
    });
    await t.test('lectores no escriben y un cambio inválido no corrompe ni bloquea el resto', async () => {
      readerLive.send(edit(editorDoc, value => ({ ...value, name: 'No autorizado' })));
      const denied = await readerLive.next('error'); assert.equal(denied.status, 403);
      // Reset this editor's optimistic document after the intentionally unsent reader edit.
      editorDoc.destroy(); editorDoc = document(denied);
      const update = edit(ownerDoc, value => ({ ...value, height: -1 }));
      ownerLive.send(update);
      const invalid = await ownerLive.next('error'); assert.equal(invalid.status, 400);
      ownerDoc.destroy(); ownerDoc = document(invalid);
      assert.equal((await (await request(path, 'owner')).json()).revision, 3);
      const hidden = new Y.Doc(); hidden.getArray('room').push(['Contenido oculto']);
      const hiddenId = ownerLive.send(Y.encodeStateAsUpdate(hidden)); hidden.destroy();
      const hiddenRejected = await ownerLive.next('error');
      assert.equal(hiddenRejected.status, 400); assert.equal(hiddenRejected.requestId, hiddenId);
      assert.equal((await (await request(path, 'owner')).json()).revision, 3);
      for (const key of ['furniture', 'openings', 'lights', 'walls', 'surfaces', 'points', 'stairs', 'roofs']) {
        const scope = ['stairs', 'roofs'].includes(key) ? 'meta' : room.activeLevelId, malformed = new Y.Doc();
        try {
          Y.applyUpdate(malformed, Buffer.from(hiddenRejected.states[scope], 'base64'));
          const before = readProjectScope(malformed), vector = Y.encodeStateVector(malformed), operationId = randomUUID();
          malformed.getMap('data').set(key, structuredClone(before[key]));
          ownerLive.socket.send(JSON.stringify({ type: 'update', id: operationId, scope, update: Buffer.from(Y.encodeStateAsUpdate(malformed, vector)).toString('base64') }));
          const rejected = await ownerLive.next('error'); assert.equal(rejected.status, 400, key); assert.equal(rejected.requestId, operationId);
          const unchanged = await (await request(path, 'owner')).json(); assert.equal(unchanged.revision, 3, key);
          assert.deepEqual(unchanged.project, hiddenRejected.project, 'a malformed collection cannot partially change ' + key);
        } finally { malformed.destroy(); }
      }
      ownerLive.send(edit(ownerDoc, value => ({ ...value, name: 'Diseño colaborativo' })));
      const ack = await ownerLive.next('ack'); assert.equal(ack.revision, 4);
      const remote = await editorLive.next('update'); Y.applyUpdate(editorDoc, Buffer.from(remote.update, 'base64'));
      assert.equal(readYRoom(editorDoc).name, 'Diseño colaborativo');
    });
    await t.test('HTTP sigue controlando revisiones y publica sus cambios al canal en vivo', async () => {
      const current = await (await request(path, 'owner')).json();
      assert.equal((await request(path, 'editor', 'PUT', { revision: 1, project: { ...current.project, name: 'Versión vieja' }, operationId: randomUUID() })).status, 409);
      const changed = { ...current.project, levels: current.project.levels.map((level: ProjectLevel) => ({ ...level, name: 'HTTP level' })) };
      assert.equal((await request(path, 'editor', 'PUT', { revision: current.revision, project: changed, operationId: randomUUID() })).status, 200);
      const remote = await ownerLive.next('sync'); ownerDoc.destroy(); ownerDoc = document(remote);
      assert.equal(readYRoom(ownerDoc).name, 'HTTP level');
    });
    await t.test('el acceso público recibe cambios sin poder escribir y se corta al revocarlo', async () => {
      await request(path + '/share', 'owner', 'POST', { enabled: true });
      const publicLive = live(base, id), sync = await publicLive.next('sync');
      assert.equal(sync.role, 'public'); assert.equal(sync.canEdit, false); assert.equal(sync.canManage, false);
      assert.equal('username' in sync, false); assert.equal('owner_id' in sync, false);
      const publicDoc = document(sync);
      publicLive.send(edit(publicDoc, value => ({ ...value, name: 'Un invitado' })));
      assert.equal((await publicLive.next('error')).status, 403);
      const closed = new Promise<number>(accept => publicLive.socket.once('close', code => accept(code)));
      await request(path + '/share', 'owner', 'POST', { enabled: false });
      assert.equal(await closed, 4003); publicDoc.destroy();
    });
    await t.test('un cambio de rol limita inmediatamente y la revocación corta conexiones', async () => {
      const changed = await request(path + '/members/' + editorMemberId, 'owner', 'PATCH', { role: 'reader' });
      assert.equal(changed.status, 200);
      editorMemberId = (await changed.json()).members.find((member: { username: string }) => member.username === 'editor').id;
      assert.equal((await (await request(path, 'editor')).json()).canEdit, false);
      editorLive.send(edit(editorDoc, value => ({ ...value, name: 'Permiso anterior' })));
      assert.equal((await editorLive.next('error')).status, 403);
      const closed = new Promise<number>(accept => editorLive.socket.once('close', code => accept(code)));
      await request(path + '/members/' + editorMemberId, 'owner', 'DELETE');
      assert.equal(await closed, 4003);
      assert.equal((await request(path, 'editor')).status, 404);
      assert.deepEqual((await (await request('/api/rooms', 'editor')).json()).rooms, []);
    });
    await t.test('cerrar sesión termina el canal aunque el enlace sea público', async () => {
      const closed = new Promise<number>(accept => readerLive.socket.once('close', code => accept(code)));
      assert.equal((await request('/api/auth/logout', 'reader', 'POST', {})).status, 200);
      assert.equal(await closed, 4003);
    });
    await t.test('reiniciar restaura documento, credenciales, invitaciones aceptadas y permisos', async () => {
      const before = await (await request(path, 'owner')).json();
      await close(server); server = createServer({ dataDir, now: () => clock, maintenance: false }); base = await listen(server);
      const after = await (await request(path, 'owner')).json(); assert.deepEqual(after, before);
      const reconnect = live(base, id, cookies.owner), sync = await reconnect.next('sync'), restored = document(sync);
      assert.deepEqual(readYRoom(restored), before.project.levels[0]);
      assert.equal((await request(path, 'editor')).status, 404);
      reconnect.socket.terminate(); restored.destroy();
    });
    await t.test('caducidad de sesión se comprueba de nuevo en cada mensaje', async () => {
      const client = live(base, id, cookies.owner); await client.next('sync');
      clock += 31 * 24 * 60 * 60_000;
      const closed = new Promise<number>(accept => client.socket.once('close', code => accept(code)));
      client.socket.send(JSON.stringify({ type: 'sync' }));
      assert.equal(await closed, 4003);
    });
  } finally {
    ownerDoc?.destroy(); editorDoc?.destroy();
    await close(server);
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('virtual-space-collaboration-'));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('el canal limita conexiones, tamaño de mensajes y frecuencia sin alterar el diseño', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'virtual-space-collaboration-limits-'));
  const server = createServer({ dataDir: join(directory, 'data'), maintenance: false }), base = await listen(server);
  const registration = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ username: 'owner', password: 'Testing-password', confirmPassword: 'Testing-password', termsVersion: TERMS_VERSION }) });
  const cookie = registration.headers.get('set-cookie')!.split(';')[0], headers = { 'Content-Type': 'application/json', Origin: base, Cookie: cookie };
  const id = randomUUID(), room = createDefaultProject(undefined, undefined, id), sockets: WebSocket[] = [];
  await fetch(base + '/api/rooms', { method: 'POST', headers, body: JSON.stringify({ id, project: room }) });
  try {
    for (let index = 0; index < 10; index++) { const client = live(base, id, cookie); await client.next('sync'); sockets.push(client.socket); }
    assert.equal(await rejectedConnection(base, id, cookie), 429);
    for (const socket of sockets) { const closed = new Promise<void>(accept => socket.once('close', () => accept())); socket.close(); await closed; }
    const huge = live(base, id, cookie); await huge.next('sync');
    const oversizedClose = new Promise<number>(accept => huge.socket.once('close', code => accept(code)));
    huge.socket.send('x'.repeat(6 * 1024 * 1024 + 1)); assert.equal(await oversizedClose, 1009);
    const rapid = live(base, id, cookie); await rapid.next('sync');
    const rateClose = new Promise<number>(accept => rapid.socket.once('close', code => accept(code)));
    for (let index = 0; index < 1201; index++) rapid.socket.send(JSON.stringify({ type: 'sync' }));
    assert.equal((await rapid.next('error')).status, 429); assert.equal(await rateClose, 4008);
    const unchanged = await (await fetch(base + '/api/rooms/' + id, { headers })).json();
    assert.equal(unchanged.revision, 1); assert.deepEqual(unchanged.project, room);
    const deleted = live(base, id, cookie); await deleted.next('sync');
    const deletedClose = new Promise<number>(accept => deleted.socket.once('close', code => accept(code)));
    assert.equal((await fetch(base + '/api/rooms/' + id, { method: 'DELETE', headers })).status, 200);
    assert.equal(await deletedClose, 4003);
  } finally {
    for (const socket of sockets) socket.terminate();
    await close(server);
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('virtual-space-collaboration-limits-'));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('las notificaciones llegan por SSE, son privadas y terminan al cerrar sesión', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'virtual-space-notifications-')), server = createServer({ dataDir: join(directory, 'data'), maintenance: false }), base = await listen(server);
  const cookies: Record<string, string> = {};
  const request = (path: string, user?: string, method = 'GET', body?: unknown, origin = base) => fetch(base + path, { method, headers: { ...(user ? { Cookie: cookies[user] } : {}), Origin: origin, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const username of ['owner', 'guest', 'other']) {
    const response = await request('/api/auth/register', undefined, 'POST', { username, password: 'Testing-password', confirmPassword: 'Testing-password', termsVersion: TERMS_VERSION });
    assert.equal(response.status, 201); cookies[username] = response.headers.get('set-cookie')!.split(';')[0];
  }
  const id = randomUUID(), path = '/api/rooms/' + id;
  await request('/api/rooms', 'owner', 'POST', { id, project: createDefaultProject(undefined, undefined, id) });
  const controller = new AbortController();
  let extra: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    assert.equal((await request('/api/notifications/events')).status, 401);
    assert.equal((await request('/api/notifications/events', 'guest', 'GET', undefined, 'https://attacker.invalid')).status, 403);
    const response = await fetch(base + '/api/notifications/events', { headers: { Cookie: cookies.guest, Origin: base }, signal: controller.signal });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type')!, /text\/event-stream/);
    const reader = response.body!.getReader(), messages: { notifications: { id: string; role: string; fromUsername: string }[] }[] = [];
    const waiters = new Set<() => void>();
    let ended = false, buffer = '';
    const reading = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += new TextDecoder().decode(value);
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            const data = frame.split('\n').find(line => line.startsWith('data: '));
            if (data) messages.push(JSON.parse(data.slice(6)));
          }
          for (const waiter of waiters) waiter();
        }
      } finally { ended = true; for (const waiter of waiters) waiter(); }
    })();
    const wait = (predicate: () => boolean) => predicate() ? Promise.resolve() : new Promise<void>((accept, reject) => {
      const check = () => { if (predicate()) { clearTimeout(timer); waiters.delete(check); accept(); } };
      const timer = setTimeout(() => { waiters.delete(check); reject(new Error('Expected SSE notification.')); }, 5000);
      waiters.add(check);
    });
    await wait(() => messages.length > 0); assert.deepEqual(messages[0], { notifications: [] });
    const second = await request('/api/notifications/events', 'guest'); extra = second.body!.getReader(); assert.equal(second.status, 200);
    assert.equal((await request('/api/notifications/events', 'guest')).status, 429);
    const invited = await request(path + '/members', 'owner', 'POST', { username: 'guest', role: 'editor' });
    const memberId = (await invited.json()).members[0].id;
    await wait(() => messages.some(message => message.notifications.some(value => value.id === memberId)));
    const arrival = messages.find(message => message.notifications.some(value => value.id === memberId))!;
    assert.equal(arrival.notifications[0].fromUsername, 'owner'); assert.equal(arrival.notifications[0].role, 'editor');
    assert.deepEqual((await (await request('/api/notifications', 'other')).json()).notifications, []);
    messages.length = 0;
    await request('/api/notifications/' + memberId + '/accept', 'guest', 'POST', {});
    await wait(() => messages.some(message => message.notifications.length === 0));
    await request('/api/auth/logout', 'guest', 'POST', {});
    await wait(() => ended); await reading;
    assert.equal((await request('/api/notifications/events', 'guest')).status, 401);
  } finally {
    controller.abort(); await extra?.cancel(); await close(server);
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('virtual-space-notifications-'));
    rmSync(directory, { recursive: true, force: true });
  }
});


test('structural commands use affected-level CAS, durable receipts and atomic canonical/Y-state commits', async () => {
  const directory = mkdtempSync(join(tmpdir(), '3d-space-v3-structural-')), dataDir = join(directory, 'data');
  const server = createServer({ dataDir, maintenance: false }), base = await listen(server), id = randomUUID();
  const registration = await fetch(base + '/api/auth/register', { method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'structural_owner', password: 'Testing-password', confirmPassword: 'Testing-password', termsVersion: TERMS_VERSION }) });
  const cookie = registration.headers.get('set-cookie')!.split(';')[0], headers = { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' };
  const project = addLevel(createDefaultProject(undefined, undefined, id), { copy: true });
  assert.equal((await fetch(base + '/api/rooms', { method: 'POST', headers, body: JSON.stringify({ id, project }) })).status, 201);
  const first = live(base, id, cookie), second = live(base, id, cookie);
  const database = new DatabaseSync(join(dataDir, 'accounts.sqlite'));
  try {
    const one = await first.next('sync'), two = await second.next('sync');
    const lower = project.levels[0].id, upper = project.levels[1].id;
    const commandA = structureCommand(project, addWall(project, lower, { x: -2.5, z: 0 }, { x: 2.5, z: 0 }), one.structureRevisions as Record<string, number>, Number(one.structureRevision))!;
    const commandB = structureCommand(project, addWall(project, upper, { x: 0, z: -2 }, { x: 0, z: 2 }), two.structureRevisions as Record<string, number>, Number(two.structureRevision))!;
    assert.equal(commandA.expectedStructureRevision, undefined); assert.deepEqual(Object.keys(commandA.expected), [lower]); assert.deepEqual(Object.keys(commandB.expected), [upper]);
    const operationId = randomUUID(); first.socket.send(JSON.stringify({ ...commandA, id: operationId }));
    assert.equal((await first.next('ack')).revision, 2); await first.next('sync'); await second.next('sync');
    second.socket.send(JSON.stringify({ ...commandB, id: randomUUID() }));
    assert.equal((await second.next('ack')).revision, 3); const authoritative = await first.next('sync'); await second.next('sync');
    const saved = readProject(database, id); assert.equal(saved.levels[0].walls.length, 7); assert.equal(saved.levels[1].walls.length, 7);
    first.socket.send(JSON.stringify({ ...commandA, id: operationId })); assert.equal((await first.next('ack')).revision, 2);
    assert.equal(database.prepare('SELECT revision FROM rooms WHERE id=?').get(id)!.revision, 3);
    first.socket.send(JSON.stringify({ ...commandB, id: operationId })); assert.equal((await first.next('error')).status, 409);
    second.socket.send(JSON.stringify({ ...commandB, id: randomUUID() })); assert.equal((await second.next('error')).status, 409);
    const doc = document(authoritative), currentLevel = readYRoom(doc), vector = Y.encodeStateVector(doc);
    writeProjectScope(doc, { ...currentLevel, points: currentLevel.points.map((point, index) => index ? point : { ...point, x: point.x - .1 }) }, currentLevel);
    first.send(Y.encodeStateAsUpdate(doc, vector)); assert.equal((await first.next('error')).status, 409); doc.destroy();
    const before = JSON.stringify(readProject(database, id));
    const current = authoritative.project!, change = structureCommand(current, addWall(current, lower, { x: 0, z: -2 }, { x: 0, z: 0 }), authoritative.structureRevisions as Record<string, number>, Number(authoritative.structureRevision))!;
    database.exec("CREATE TRIGGER fail_commit BEFORE UPDATE ON rooms BEGIN SELECT RAISE(ABORT,'simulated storage failure'); END");
    first.socket.send(JSON.stringify({ ...change, id: randomUUID() })); assert.equal((await first.next('error')).status, 400); database.exec('DROP TRIGGER fail_commit');
    assert.equal(JSON.stringify(readProject(database, id)), before); assert.equal(database.prepare('SELECT revision FROM rooms WHERE id=?').get(id)!.revision, 3);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM mutation_receipts WHERE room_id=?').get(id)!.count, 2);
    assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0);
  } finally { first.socket.terminate(); second.socket.terminate(); database.close(); await close(server); rmSync(directory, { recursive: true, force: true }); }
});
