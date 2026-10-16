import { randomUUID, createHash } from 'node:crypto';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { checkOrigin, HttpError, ipRateIdentity, usernameValue, type createAuth, type User } from '../auth/auth.js';
import { validateProjectDocument, validateProjectChange, type ProjectDocument } from '../../domain/project/projectDocument.js';
import { readProject, confirmProject, stringifyProjectPayload, clearProjectCache } from '../projects/projectRepository.js';
import { assembleProject, projectScopes } from '../../domain/collaboration/collaborativeProject.js';
import { mergeStructure, structureCommand, type StructureCommand } from '../../domain/project/projectProtocol.js';
import type { createProjectCommands } from '../projects/projectCommandService.js';

export type RoomRole = 'owner' | 'editor' | 'reader' | 'public';
export type RoomRow = { id: string; owner_id: string; room: string; revision: number; structure_revision: number; shared: number; updated_at: number };

type MemberRow = { id: string; room_id: string; user_id: string; role: 'editor' | 'reader'; accepted_at: number | null; created_at: number };
type LiveClient = { socket: WebSocket; request: IncomingMessage; id: string; userId: string | null; ip: string; role: RoomRole; lastPong: number };
type NotificationStream = { request: IncomingMessage; response: ServerResponse; userId: string; ip: string };
type Dependencies = {
  database: DatabaseSync;
  commands: ReturnType<typeof createProjectCommands>;
  auth: ReturnType<typeof createAuth>;
  identify: (request: IncomingMessage) => { ip: string; fromProxy: boolean };
  appOrigin?: string;
  now: () => number;
  find: (id: string) => RoomRow | undefined;
  snapshot: (row: RoomRow, user: User | null) => Record<string, unknown>;
  readJson: (request: IncomingMessage, limit?: number) => Promise<Record<string, unknown>>;
  sendJson: (response: ServerResponse, status: number, body: unknown) => void;
  eraseMember: (id: string, erase: () => void) => void;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_UPDATE = 512 * 1024, MAX_STATE = 4 * 1024 * 1024;

export function roomRole(database: DatabaseSync, row: RoomRow, user: User | null): RoomRole | null {
  if (row.owner_id === user?.id) return 'owner';
  if (user) {
    const member = database.prepare('SELECT role FROM room_members WHERE room_id = ? AND user_id = ? AND accepted_at IS NOT NULL').get(row.id, user.id) as { role: 'reader' | 'editor' } | undefined;
    if (member) return member.role;
  }
  return row.shared ? 'public' : null;
}

export function createLiveCollaboration(deps: Dependencies) {
  const { database, auth, identify, appOrigin, now, find, snapshot, readJson, sendJson } = deps;
  const clients = new Set<LiveClient>();
  const streams = new Set<NotificationStream>();
  const { docs, docFor, states, changedScopes, structureChanged, destroyDocs, commit, receipt, validScope, transaction } = deps.commands;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 6 * 1024 * 1024, perMessageDeflate: false });
  const send = (client: LiveClient, message: unknown) => {
    if (client.socket.readyState !== WebSocket.OPEN) return;
    if (client.socket.bufferedAmount > 2 * MAX_STATE) { client.socket.terminate(); return; }
    client.socket.send(stringifyProjectPayload(message));
  };
  const notificationList = (userId: string) => database.prepare('SELECT room_members.id, room_members.room_id AS roomId, json_extract(rooms.room, \'$.name\') AS roomName, room_members.role, users.username AS fromUsername, room_members.created_at AS createdAt FROM room_members JOIN rooms ON rooms.id = room_members.room_id JOIN users ON users.id = room_members.inviter_id WHERE room_members.user_id = ? AND accepted_at IS NULL ORDER BY room_members.created_at DESC LIMIT 100').all(userId);
  const notify = (userId?: string) => {
    for (const stream of streams) {
      if (userId && stream.userId !== userId) continue;
      if (auth.session(stream.request)?.id !== stream.userId) { stream.response.end(); streams.delete(stream); continue; }
      if (stream.response.writableLength > 64 * 1024) { stream.response.destroy(); streams.delete(stream); continue; }
      stream.response.write('data: ' + JSON.stringify({ notifications: notificationList(stream.userId) }) + '\n\n');
    }
  };
  const authorize = (client: LiveClient) => {
    const user = auth.session(client.request);
    // A revoked authenticated session may not continue by falling back to public access.
    if (client.userId && user?.id !== client.userId) throw new HttpError(401, 'Tu sesión terminó.');
    const row = find(client.id);
    const role = row ? roomRole(database, row, user) : null;
    if (!row || !role) throw new HttpError(403, 'Ya no tienes acceso a este diseño.');
    client.role = role;
    return { user, row, role };
  };
  const refresh = (id?: string) => {
    // Refresh also closes streams whose authenticated session was just revoked.
    for (const stream of streams) if (auth.session(stream.request)?.id !== stream.userId) { stream.response.end(); streams.delete(stream); }
    notify();
    for (const client of clients) {
      if (id && client.id !== id) continue;
      try {
        const { row, user } = authorize(client);
        const { project: _project, ...metadata } = snapshot(row, user);
        send(client, { type: 'metadata', ...metadata });
      } catch {
        send(client, { type: 'access', error: 'Ya no tienes acceso a este diseño.' });
        client.socket.close(4003, 'Access revoked');
      }
    }
    for (const roomId of docs.keys()) if (![...clients].some(client => client.id === roomId)) destroyDocs(roomId);
  };
  const broadcast = (id: string, message: unknown, except?: LiveClient) => {
    for (const client of clients) if (client.id === id && client !== except) {
      try { authorize(client); send(client, message); }
      catch { client.socket.close(4003, 'Access revoked'); }
    }
  };
  const initialSync = (client: LiveClient) => {
    const { row, user } = authorize(client);
    send(client, { type: 'sync', states: states(client.id), ...snapshot(row, user) });
  };
  const syncClients = (id: string) => {
    for (const client of clients) if (client.id === id) {
      try { initialSync(client); }
      catch { client.socket.close(4003, 'Access revoked'); }
    }
  };
  const onMessage = (client: LiveClient, data: Buffer, isBinary: boolean) => {
    let messageId: string | undefined, next: Y.Doc | undefined;
    let uncommitted: Map<string, Y.Doc> | undefined;
    try {
      auth.checkBlocked(client.ip); auth.limit('live-message-user', client.userId ?? client.ip, 1200, 60000); auth.limit('live-message-ip', client.ip, 2400, 60000);
      const { user, role, row } = authorize(client);
      if (isBinary) throw new HttpError(400, 'El mensaje no es válido.');
      const value = JSON.parse(data.toString('utf8')) as Record<string, unknown>;
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'El mensaje no es válido.');
      if (value.type === 'sync') { auth.limit('live-sync-user', client.userId ?? client.ip, 60, 60000); initialSync(client); return; }
      if (!['update', 'replace-structure'].includes(String(value.type)) || typeof value.id !== 'string' || !/^[a-zA-Z0-9_:-]{1,80}$/.test(value.id)) throw new HttpError(400, 'El mensaje no es válido.');
      const allowed = value.type === 'update' ? ['type', 'id', 'scope', 'update'] : ['type', 'id', 'project', 'expected', 'expectedStructureRevision', 'stairIds', 'roofIds', 'openingRemaps'];
      if (Object.keys(value).some(key => !allowed.includes(key))) throw new HttpError(400, 'El mensaje no es válido.');
      messageId = value.id;
      if (!user || role !== 'owner' && role !== 'editor') throw new HttpError(403, 'Este diseño solo permite ver.');
      const hash = createHash('sha256').update(JSON.stringify(value)).digest('hex');
      const old = receipt(client.id, messageId, user.id, hash);
      if (old) { send(client, { type: 'ack', id: messageId, ...old }); return; }
      const current = readProject(database, client.id);
      let project: ProjectDocument, changed = new Map<string, Y.Doc>(), affected: string[] = [];
      if (value.type === 'replace-structure') {
        const command = value as unknown as StructureCommand;
        validateProjectDocument(command.project);
        if (command.project.id !== client.id || !command.expected || typeof command.expected !== 'object' || Array.isArray(command.expected) || Object.keys(command.expected).length > 12) throw new HttpError(400, 'Los cambios no son válidos.');
        if (command.expectedStructureRevision !== undefined && command.expectedStructureRevision !== row.structure_revision) throw new HttpError(409, 'La estructura cambió en otra sesión. Revisa el diseño.');
        const revisions = Object.fromEntries(database.prepare('SELECT id,structure_revision FROM project_levels WHERE room_id=?').all(client.id).map(level => [String(level.id), Number(level.structure_revision)]));
        for (const [id, revision] of Object.entries(command.expected)) if (!Number.isSafeInteger(revision) || (revisions[id] ?? 0) !== revision) throw new HttpError(409, 'La estructura cambió en otra sesión. Revisa el diseño.');
        project = validateProjectDocument(mergeStructure(current, command));
        const required = structureCommand(current, project, revisions, row.structure_revision);
        if (required && Object.keys(required.expected).some(id => !Object.hasOwn(command.expected, id))) throw new HttpError(409, 'Confirma todos los niveles afectados por este cambio.');
        changed = changedScopes(client.id, current, project); uncommitted = changed;
        affected = Object.keys(command.expected);
      } else {
        if (typeof value.scope !== 'string' || !docFor(client.id).has(value.scope) || typeof value.update !== 'string' || value.update.length > Math.ceil(MAX_UPDATE / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.update)) throw new HttpError(400, 'Los cambios no son válidos.');
        const update = Buffer.from(value.update, 'base64');
        if (!update.length || update.length > MAX_UPDATE || Y.decodeUpdate(update).structs.length > 10000) throw new HttpError(413, 'Los cambios superan el tamaño permitido.');
        next = new Y.Doc(); Y.applyUpdate(next, Y.encodeStateAsUpdate(docFor(client.id).get(value.scope)!)); Y.applyUpdate(next, update);
        const scopes = projectScopes(current); scopes[value.scope] = validScope(next);
        project = validateProjectChange(current, assembleProject(scopes));
        if (structureChanged(current, project, new Set([value.scope]))) throw new HttpError(409, 'Los cambios de estructura requieren una operación confirmada.');
        changed.set(value.scope, next);
      }
      if (project.id !== client.id) throw new HttpError(400, 'La identidad del proyecto no es válida.');
      let saved!: ReturnType<typeof commit>;
      try { saved = transaction(client.id, project, user.id, messageId!, hash, () => commit(client.id, project, changed, value.type === 'replace-structure', affected)); }
      catch (cause) { for (const doc of changed.values()) doc.destroy(); next = undefined; uncommitted = undefined; throw cause; }
      confirmProject(database, project, saved.revision, new Set(changed.keys()));
      const cached = docs.get(client.id)!;
      for (const [scope, doc] of changed) { cached.get(scope)?.destroy(); cached.set(scope, doc); }
      for (const scope of cached.keys()) if (scope !== 'meta' && !project.levels.some(level => level.id === scope)) { cached.get(scope)!.destroy(); cached.delete(scope); }
      next = undefined; uncommitted = undefined; auth.touchSuccessfulRequest(client.request);
      if (value.type === 'replace-structure') syncClients(client.id);
      else broadcast(client.id, { type: 'update', scope: value.scope, update: value.update, ...saved }, client);
      send(client, { type: 'ack', id: messageId, ...saved });
    } catch (error) {
      next?.destroy();
      for (const doc of uncommitted?.values() ?? []) doc.destroy();
      const httpError = error instanceof HttpError ? error : new HttpError(400, error instanceof Error ? error.message : 'Los cambios no son válidos.');
      if (httpError.status === 401 || httpError.status === 404) { send(client, { type: 'access', error: httpError.message }); client.socket.close(4003, 'Access revoked'); return; }
      try { const { row, user } = authorize(client); send(client, { type: 'error', error: httpError.message, status: httpError.status, ...(httpError.retryAfter ? { retryAfter: httpError.retryAfter } : {}), states: states(client.id), ...snapshot(row, user), requestId: messageId }); }
      catch { client.socket.close(4003, 'Access revoked'); }
      if (httpError.status === 429) client.socket.close(4008, 'Rate limit');
    }
  };
  const rejectUpgrade = (socket: Duplex, status: number) => { socket.end('HTTP/1.1 ' + status + ' Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); };
  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    try {
      const match = request.url?.match(/^\/api\/rooms\/([^/?]+)\/live$/);
      if (!match || !UUID.test(match[1])) throw new HttpError(404, 'Esta ruta no existe.');
      const { ip, fromProxy } = identify(request);
      // checkOrigin normally exempts GET; an upgrade must always check Origin.
      const originalMethod = request.method;
      try { request.method = 'POST'; checkOrigin(request, fromProxy, appOrigin); }
      finally { request.method = originalMethod; }
      const identity = ipRateIdentity(ip);
      auth.checkBlocked(identity); auth.limit('live-connect', identity, 60, 60_000);
      const user = auth.session(request), row = find(match[1]);
      const role = row ? roomRole(database, row, user) : null;
      if (!row || !role) throw new HttpError(404, 'Este proyecto no existe.');
      if (clients.size >= 1000 || [...clients].filter(client => client.id === row.id).length >= 50 || [...clients].filter(client => client.ip === identity).length >= 30 || user && [...clients].filter(client => client.userId === user.id).length >= 10) throw new HttpError(429, 'Demasiadas conexiones.');
      docFor(row.id);
      wss.handleUpgrade(request, socket, head, ws => {
        const client: LiveClient = { socket: ws, request, id: row.id, userId: user?.id ?? null, ip: identity, role, lastPong: now() };
        clients.add(client);
        ws.on('message', (data, binary) => onMessage(client, Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer), binary));
        ws.on('pong', () => { client.lastPong = now(); });
        ws.on('error', () => {});
        ws.on('close', () => {
          clients.delete(client);
          if (![...clients].some(other => other.id === client.id)) destroyDocs(client.id);
        });
        initialSync(client);
      });
    } catch (error) { rejectUpgrade(socket, error instanceof HttpError ? error.status : 500); }
  };
  const timer = setInterval(() => {
    for (const client of clients) {
      try { authorize(client); if (now() - client.lastPong > 90_000) client.socket.terminate(); else client.socket.ping(); }
      catch { send(client, { type: 'access', error: 'Ya no tienes acceso a este diseño.' }); client.socket.close(4003, 'Access revoked'); }
    }
    for (const stream of streams) {
      if (auth.session(stream.request)?.id !== stream.userId) { stream.response.end(); streams.delete(stream); }
      else if (stream.response.writableLength > 64 * 1024) { stream.response.destroy(); streams.delete(stream); }
      else stream.response.write(': keepalive\n\n');
    }
  }, 30_000);
  timer.unref();
  const ownedRoom = (request: IncomingMessage, id: string) => {
    const user = auth.requireUser(request), row = find(id);
    if (!row || !roomRole(database, row, user)) throw new HttpError(404, 'Este proyecto no existe.');
    if (row.owner_id !== user.id) throw new HttpError(403, 'Solo el propietario puede cambiar los accesos.');
    return { user, row };
  };
  const memberList = (id: string) => database.prepare('SELECT room_members.id, users.username, room_members.role, room_members.accepted_at AS acceptedAt FROM room_members JOIN users ON users.id = room_members.user_id WHERE room_id = ? ORDER BY room_members.created_at, room_members.id').all(id).map(row => ({ ...row, status: row.acceptedAt === null ? 'pending' : 'accepted' }));
  return {
    attach(server: Server) { server.on('upgrade', upgrade); },
    refresh,
    publishProject(id: string) { syncClients(id); if (![...clients].some(client => client.id === id)) destroyDocs(id); },
    async handle(request: IncomingMessage, response: ServerResponse, pathname: string, method: string, ip: string) {
      if (pathname === '/api/notifications/events') {
        if (method !== 'GET') throw new HttpError(405, 'Este método no está permitido.');
        const user = auth.requireUser(request);
        if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'La solicitud no está permitida.');
        if (request.headers.origin) {
          const originalMethod = request.method;
          try { request.method = 'POST'; checkOrigin(request, identify(request).fromProxy, appOrigin); }
          finally { request.method = originalMethod; }
        }
        if (streams.size >= 200 || [...streams].filter(stream => stream.userId === user.id).length >= 2 || [...streams].filter(stream => stream.ip === ip).length >= 10) throw new HttpError(429, 'Demasiadas conexiones.');
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        const stream: NotificationStream = { request, response, userId: user.id, ip };
        streams.add(stream);
        response.once('close', () => streams.delete(stream));
        auth.touchSuccessfulRequest(request);
        notify(user.id);
        return true;
      }
      if (pathname === '/api/notifications' && method === 'GET') {
        const user = auth.requireUser(request);
        const notifications = notificationList(user.id);
        sendJson(response, 200, { notifications }); return true;
      }
      const notification = pathname.match(/^\/api\/notifications\/([^/]+)\/(accept|decline)$/);
      if (notification) {
        if (method !== 'POST') throw new HttpError(405, 'Este método no está permitido.');
        const user = auth.requireUser(request);
        if (!UUID.test(notification[1])) throw new HttpError(400, 'La invitación no es válida.');
        const member = database.prepare('SELECT * FROM room_members WHERE id = ? AND user_id = ? AND accepted_at IS NULL').get(notification[1], user.id) as MemberRow | undefined;
        if (!member) throw new HttpError(404, 'Esta invitación ya no está disponible.');
        if (notification[2] === 'accept') database.prepare('UPDATE room_members SET accepted_at = ? WHERE id = ?').run(now(), member.id);
        else deps.eraseMember(member.id, () => { database.prepare('DELETE FROM room_members WHERE id = ?').run(member.id); });
        notify(user.id);
        refresh(member.room_id);
        sendJson(response, 200, { roomId: member.room_id, accepted: notification[2] === 'accept' }); return true;
      }
      const members = pathname.match(/^\/api\/rooms\/([^/]+)\/members(?:\/([^/]+))?$/);
      if (!members) return false;
      const id = members[1];
      if (!UUID.test(id) || members[2] && !UUID.test(members[2])) throw new HttpError(400, 'El acceso no es válido.');
      const { user } = ownedRoom(request, id);
      if (!members[2] && method === 'GET') { sendJson(response, 200, { members: memberList(id) }); return true; }
      if (!members[2] && method === 'POST') {
        auth.limit('invite-user', user.id, 30, 3_600_000); auth.limit('invite-ip', ip, 60, 3_600_000);
        const body = await readJson(request, 8192);
        ownedRoom(request, id);
        const username = usernameValue(body.username);
        if (body.role !== 'reader' && body.role !== 'editor') throw new HttpError(400, 'Selecciona lector o editor.');
        const target = database.prepare('SELECT id FROM users WHERE username = ? AND inactive_after > ?').get(username, now()) as { id: string } | undefined;
        if (!target) throw new HttpError(404, 'Ese usuario no existe.');
        if (target.id === user.id) throw new HttpError(400, 'Ya eres el propietario de este diseño.');
        if (database.prepare('SELECT id FROM room_members WHERE room_id = ? AND user_id = ?').get(id, target.id)) throw new HttpError(409, 'Ese usuario ya tiene una invitación o acceso.');
        if (Number(database.prepare('SELECT COUNT(*) AS count FROM room_members WHERE room_id = ?').get(id)?.count) >= 50) throw new HttpError(400, 'Este diseño admite hasta 50 invitados.');
        database.prepare('INSERT INTO room_members (id, room_id, user_id, inviter_id, role, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), id, target.id, user.id, body.role, now());
        notify(target.id);
        refresh(id);
        sendJson(response, 201, { members: memberList(id) }); return true;
      }
      if (members[2] && (method === 'PATCH' || method === 'DELETE')) {
        const body = method === 'PATCH' ? await readJson(request, 8192) : null;
        ownedRoom(request, id);
        const member = database.prepare('SELECT * FROM room_members WHERE id = ? AND room_id = ?').get(members[2], id) as MemberRow | undefined;
        if (!member) throw new HttpError(404, 'Este acceso ya no está disponible.');
        if (body && body.role !== 'reader' && body.role !== 'editor') throw new HttpError(400, 'Selecciona lector o editor.');
        deps.eraseMember(member.id, () => {
          database.prepare('DELETE FROM room_members WHERE id = ?').run(member.id);
          if (body) database.prepare('INSERT INTO room_members (id, room_id, user_id, inviter_id, role, accepted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), id, member.user_id, user.id, body.role as string, member.accepted_at, now());
        });
        notify(member.user_id);
        if (!body) for (const client of clients) if (client.id === id && client.userId === member.user_id) {
          send(client, { type: 'access', error: 'Tu acceso a este diseño fue retirado.' });
          client.socket.close(4003, 'Access revoked');
        }
        refresh(id);
        sendJson(response, 200, { members: memberList(id) }); return true;
      }
      throw new HttpError(405, 'Este método no está permitido.');
    },
    close() {
      clearInterval(timer);
      for (const stream of streams) stream.response.end();
      streams.clear();
      for (const client of clients) client.socket.terminate();
      clients.clear();
      for (const id of docs.keys()) destroyDocs(id);
      clearProjectCache(database);
      wss.close();
    },
  };
}
