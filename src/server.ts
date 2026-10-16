import { createServer as httpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStaticAssets } from './staticAssets.js';
import { validateProjectDocument, type ProjectDocument } from './projectDocument.js';
import { readProject, writeProject, projectMetadata, readSketchStates, seedProjectStates, stringifyProjectPayload, invalidateProjectCache } from './projectRepository.js';
import { checkOrigin, createAuth, HttpError, ipRateIdentity, proxyTrust, type User } from './auth.js';
import { deleteInactiveAccounts } from './retention.js';
import { applyErasures, initializeErasures, recordErasure, recordErasures, wasErased } from './erasures.js';
import { createMaintenance } from './maintenanceService.js';
import { createLiveCollaboration, roomRole, type RoomRow as Row } from './collaborationServer.js';
import { createModelAssets, MODEL_MAX_BYTES } from './modelAssets.js';
import { sameData } from './sameData.js';
import { accountQuotaConfig, accountUsage, checkAccountQuota, quotaMutation } from './accountQuota.js';
import { createUploadAdmission } from './uploadAdmission.js';
import { inspectImage, SKETCH_MAX_BYTES } from './imageValidation.js';
import { createProjectCommands } from './projectCommandService.js';
import { PRELAUNCH_STORAGE_EPOCH, hasTestStorageRetirement } from './releasePolicy.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(stringifyProjectPayload(body));
}

function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  if (Number(request.headers['content-length']) > limit) {
    request.resume();
    return Promise.reject(new HttpError(413, 'El archivo supera el tamaño permitido.'));
  }
  return new Promise((accept, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => { request.off('data', data); request.off('end', end); request.off('error', fail); request.off('aborted', aborted); };
    const fail = (error: Error) => { cleanup(); reject(error); };
    const aborted = () => fail(new HttpError(400, 'La carga se interrumpió.'));
    const end = () => { cleanup(); accept(Buffer.concat(chunks)); };
    const data = (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { cleanup(); request.resume(); reject(new HttpError(413, 'El archivo supera el tamaño permitido.')); }
      else chunks.push(chunk);
    };
    request.on('data', data).once('end', end).once('error', fail).once('aborted', aborted);
  });
}

async function readJson(request: IncomingMessage, limit = 4 * 1024 * 1024): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'Envía un proyecto válido.');
  try {
    const value: unknown = JSON.parse((await readBody(request, limit)).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'El proyecto debe ser un objeto.');
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) throw new HttpError(400, 'El proyecto no es válido.');
    throw error;
  }
}

function projectValue(value: unknown): ProjectDocument {
  try { return validateProjectDocument(value); }
  catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'El proyecto no es válido.'); }
}

function requireCurrentClient(body: Record<string, unknown>) {
  const document = body.project === undefined ? body.room : body.project;
  if (document && typeof document === 'object' && !Array.isArray(document) && 'version' in document && document.version === 2) {
    throw new HttpError(426, 'La aplicación está desactualizada. Ve a Ajustes → Actualizar aplicación y vuelve a intentarlo.');
  }
}


export function createServer({ dataDir = process.env.DATA_DIR ?? './data', staticDir = './dist', now = Date.now, trustedProxies, appOrigin, secureCookie, maintenance = true }: { dataDir?: string; staticDir?: string; now?: () => number; trustedProxies?: string; appOrigin?: string; secureCookie?: boolean; maintenance?: boolean } = {}) {
  const quotas = accountQuotaConfig();
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const database = new DatabaseSync(resolve(dataDir, 'accounts.sqlite'));
  chmodSync(resolve(dataDir, 'accounts.sqlite'), 0o600);
  database.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;');
  let auth: ReturnType<typeof createAuth>;
  try { auth = createAuth(database, { now, secureCookie }); } catch (error) { database.close(); throw error; }
  database.exec('PRAGMA journal_mode=WAL;');
  const identify = proxyTrust(trustedProxies), uploads = createUploadAdmission();
  const readProjectJson = async (request: IncomingMessage) => {
    const release = uploads.acquire(auth.requireUser(request).id, 4 * 1024 * 1024, 'json');
    try { return await readJson(request); } finally { release(); }
  };
  const modelAssets = createModelAssets(database, {
    now, quotas,
    canViewRoom: (id, userId) => { const row = find.get(id) as Row | undefined; return Boolean(row && roomRole(database, row, userId ? { id: userId, username: '' } : null)); },
    canEditRoom: (id, userId) => { const row = find.get(id) as Row | undefined; const role = row && roomRole(database, row, { id: userId, username: '' }); return role === 'owner' || role === 'editor'; },
    recordAssetErasure: (id, erase) => recordErasure(database, ledgerPath, { kind: 'asset', id, at: now() }, erase),
  });
  const ledgerPath = initializeErasures(dataDir, database);
  applyErasures(database, ledgerPath, { now: now(), includeExpired: true });
  deleteInactiveAccounts(database, now());
  const maintenanceTasks = createMaintenance(database, dataDir, ledgerPath, { now });
  const find = database.prepare('SELECT id, owner_id, room, revision, structure_revision, shared, updated_at FROM rooms WHERE id = ?');
  const serveStatic = createStaticAssets(staticDir);
  const offlineAllowed = (row: Row, user: User | null) => row.owner_id === user?.id && row.shared === 0 && !database.prepare('SELECT 1 FROM room_members WHERE room_id = ? LIMIT 1').get(row.id);
  const snapshot = (row: Row, user: User | null) => {
    const role = roomRole(database, row, user);
    return { id: row.id, project: readProject(database, row.id), revision: row.revision, structureRevision: row.structure_revision,
      structureRevisions: Object.fromEntries(database.prepare('SELECT id,structure_revision FROM project_levels WHERE room_id=?').all(row.id).map(level => [String(level.id), Number(level.structure_revision)])),
      sketches: readSketchStates(database, row.id), role, canEdit: role === 'owner' || role === 'editor', canManage: role === 'owner', shared: row.shared === 1, accountId: user?.id ?? null, offlineAllowed: offlineAllowed(row, user), updatedAt: new Date(row.updated_at).toISOString() };
  };
  const rowFor = (id: string, user: User | null) => {
    const row = find.get(id) as Row | undefined;
    if (!row || !roomRole(database, row, user)) throw new HttpError(404, 'Este proyecto no existe.');
    return row;
  };
  const requireEditor = (request: IncomingMessage, row: Row) => {
    const role = roomRole(database, rowFor(row.id, auth.requireUser(request)), auth.requireUser(request));
    if (role !== 'owner' && role !== 'editor') throw new HttpError(403, 'Este proyecto solo permite ver.');
  };
  const requireOwner = (request: IncomingMessage, row: Row) => { const user = auth.requireUser(request); if (user.id !== rowFor(row.id, user).owner_id) throw new HttpError(403, 'Solo el propietario puede cambiar este proyecto.'); };
  const requireOffline = (request: IncomingMessage, id: string) => {
    const user = auth.requireUser(request), current = rowFor(id, user);
    if (request.headers['x-account-id'] !== user.id) throw new HttpError(403, 'La cuenta activa cambió. Conserva tu copia y vuelve a iniciar sesión.');
    if (!offlineAllowed(current, user)) throw new HttpError(409, 'El diseño tiene colaboración activa. Conserva tu copia antes de continuar.');
    return current;
  };
  const commands = createProjectCommands({ database, now, quotas, find: id => find.get(id) as Row | undefined,
    canEdit: (id, userId) => { const row = find.get(id) as Row | undefined; const role = row && roomRole(database, row, { id: userId, username: '' }); return role === 'owner' || role === 'editor'; },
    eraseSketches: (id, entries, erase) => recordErasures(database, ledgerPath, entries.map(entry => ({ kind: 'sketch', id, ...entry, at: now() })), erase),
    validateReferences: (project, userId, roomId) => modelAssets.validateProjectReferences(project, userId, roomId),
  });
  const live = createLiveCollaboration({ database, commands, auth, identify, appOrigin, now, find: id => find.get(id) as Row | undefined, snapshot, readJson, sendJson,
    eraseMember: (id, erase) => recordErasure(database, ledgerPath, { kind: 'member', id, at: now() }, erase),
  });
  const server = httpServer(async (request, response) => {
    try {
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-Frame-Options', 'DENY');
      response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
      if (!request.url || request.url.length > 4096) throw new HttpError(400, 'La dirección no es válida.');
      let pathname: string;
      try { pathname = decodeURIComponent(request.url.split('?')[0]); }
      catch { throw new HttpError(400, 'La dirección no es válida.'); }
      if (pathname.includes('\0') || pathname.includes('\\')) throw new HttpError(400, 'La dirección no es válida.');
      const method = request.method ?? 'GET';
      const publicOnly = new URL(request.url, 'http://localhost').searchParams.get('public') === '1';
      response.once('finish', () => {
        try { if (response.statusCode < 400 && pathname.startsWith('/api/') && !publicOnly) auth.touchSuccessfulRequest(request); }
        catch { console.error('Could not record authenticated activity.'); }
      });
      const { ip: clientIP, fromProxy } = identify(request), ip = ipRateIdentity(clientIP);
      if (pathname.startsWith('/api/')) { auth.checkBlocked(ip); auth.limit('api', ip, 600, 60_000); checkOrigin(request, fromProxy, appOrigin); }
      if (pathname === '/api/release' && method === 'GET') {
        const path = resolve(dataDir, 'prelaunch-reset-v3.json');
        let retireTestStorage = null;
        if (existsSync(path)) {
          const info = lstatSync(path);
          if (info.isFile() && !info.isSymbolicLink() && info.size < 4096) {
            try {
              const marker = JSON.parse(readFileSync(path, 'utf8'));
              const release = { version: marker.version, retireTestStorage: { epoch: PRELAUNCH_STORAGE_EPOCH, resetAt: marker.resetAt } };
              if (hasTestStorageRetirement(release, now())) retireTestStorage = release.retireTestStorage;
            } catch { /* Invalid or absent operator markers never authorize local deletion. */ }
          }
        }
        sendJson(response, 200, { version: 3, retireTestStorage }); return;
      }
      if (pathname === '/api/auth/session' && method === 'GET') { sendJson(response, 200, { user: auth.session(request) }); return; }
      if (pathname === '/api/auth/register' && method === 'POST') { sendJson(response, 201, { user: await auth.register(request, response, await readJson(request, 8192), ip) }); return; }
      if (pathname === '/api/auth/login' && method === 'POST') { sendJson(response, 200, { user: await auth.login(request, response, await readJson(request, 8192), ip) }); return; }
      if (pathname === '/api/auth/logout' && method === 'POST') { auth.logout(request, response); live.refresh(); sendJson(response, 200, { user: null }); return; }
      if (await live.handle(request, response, pathname, method, ip)) return;
      if (pathname === '/api/models') {
        let user = auth.requireUser(request);
        const roomId = new URL(request.url!, 'http://localhost').searchParams.get('room') ?? undefined;
        if (method === 'GET') { sendJson(response, 200, { models: modelAssets.list(user.id, roomId, new URL(request.url!, 'http://localhost').searchParams.get('scope') === 'mine') }); return; }
        if (method === 'POST') {
          auth.limit('model-upload-user', user.id, 20, 60_000); auth.limit('model-upload-ip', ip, 40, 60_000);
          if (!roomId || !UUID.test(roomId)) throw new HttpError(400, 'Selecciona un diseño para subir el modelo.');
          requireEditor(request, rowFor(roomId, user));
          if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'model/gltf-binary') throw new HttpError(415, 'Usa un modelo GLB.');
          const originalRoom = rowFor(roomId, user);
          const declared = Number(request.headers['content-length']);
          if (Number.isSafeInteger(declared) && declared >= 0) modelAssets.checkUploadCapacity(originalRoom.owner_id, declared, typeof request.headers['x-model-id'] === 'string' ? request.headers['x-model-id'] : undefined);
          const release = uploads.acquire(user.id, MODEL_MAX_BYTES);
          try {
            const data = await readBody(request, MODEL_MAX_BYTES);
            user = auth.requireUser(request);
            const targetRoom = rowFor(roomId, user);
            requireEditor(request, targetRoom);
            let name: string;
            try { name = decodeURIComponent(String(request.headers['x-model-name'] ?? 'Modelo')); }
            catch { throw new HttpError(400, 'El nombre del modelo no es válido.'); }
            if (request.headers['x-offline-write'] === '1') requireOffline(request, roomId);
            const requestedId = request.headers['x-model-id'];
            if (requestedId !== undefined && typeof requestedId !== 'string') throw new HttpError(400, 'La identidad del modelo no es válida.');
            if (requestedId && wasErased(ledgerPath, 'asset', requestedId)) throw new HttpError(409, 'Este modelo fue eliminado. Crea una copia nueva para guardarlo.');
            modelAssets.checkUploadCapacity(targetRoom.owner_id, data.length, requestedId);
            sendJson(response, 201, { model: uploads.validate(() => modelAssets.upload(targetRoom.owner_id, data, name, roomId, requestedId)) }); return;
          } finally { release(); }
        }
        throw new HttpError(405, 'Este método no está permitido.');
      }
      const modelApi = pathname.match(/^\/api\/models\/([^/]+)$/);
      if (modelApi) {
        const query = new URL(request.url!, 'http://localhost').searchParams, roomId = query.get('room') ?? undefined;
        if (publicOnly && method !== 'GET' && method !== 'HEAD') throw new HttpError(403, 'Este enlace solo permite ver.');
        if (method === 'GET' || method === 'HEAD') {
          const user = publicOnly ? null : auth.session(request);
          if (query.get('metadata') === '1') { sendJson(response, 200, { model: modelAssets.metadata(modelApi[1], user?.id ?? null, roomId) }); return; }
          const data = modelAssets.read(modelApi[1], user?.id ?? null, roomId);
          response.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
          response.end(method === 'HEAD' ? undefined : data); return;
        }
        if (method === 'DELETE') {
          let user = auth.requireUser(request);
          if (request.headers['x-offline-write'] === '1') {
            if (!roomId || !UUID.test(roomId)) throw new HttpError(400, 'Selecciona el diseño del modelo.');
            const body = await readJson(request, 8192);
            const current = requireOffline(request, roomId);
            if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 1) throw new HttpError(400, 'La versión del proyecto no es válida.');
            if (body.revision !== current.revision) throw new HttpError(409, 'El diseño cambió. Conserva tu copia antes de eliminar el modelo.');
            user = auth.requireUser(request);
          }
          modelAssets.remove(modelApi[1], user.id, roomId); sendJson(response, 200, { deleted: true }); return;
        }
        throw new HttpError(405, 'Este método no está permitido.');
      }
      if (pathname === '/api/rooms' && method === 'GET') {
        const user = auth.requireUser(request);
        const rooms = database.prepare('SELECT rooms.id, rooms.owner_id, json_extract(room, \'$.name\') AS name, json_extract(room, \'$.setupStep\') AS setup_step, shared, updated_at, room_members.role AS member_role FROM rooms LEFT JOIN room_members ON room_members.room_id = rooms.id AND room_members.user_id = ? AND room_members.accepted_at IS NOT NULL WHERE owner_id = ? OR room_members.id IS NOT NULL ORDER BY updated_at DESC, rooms.id').all(user.id, user.id) as { id: string; owner_id: string; name: string; setup_step: ProjectDocument['setupStep'] | null; shared: number; updated_at: number; member_role: 'editor' | 'reader' | null }[];
        sendJson(response, 200, { rooms: rooms.map(row => ({ id: row.id, name: row.name, setupStep: row.setup_step ?? undefined, role: row.owner_id === user.id ? 'owner' : row.member_role, canManage: row.owner_id === user.id, canEdit: row.owner_id === user.id || row.member_role === 'editor', shared: row.shared === 1, offlineAllowed: row.owner_id === user.id && row.shared === 0 && !database.prepare('SELECT 1 FROM room_members WHERE room_id = ? LIMIT 1').get(row.id), updatedAt: new Date(row.updated_at).toISOString() })) }); return;
      }
      if (pathname === '/api/rooms' && method === 'POST') {
        let user = auth.requireUser(request);
        const body = await readProjectJson(request);
        user = auth.requireUser(request);
        if (request.headers['x-offline-write'] === '1' && request.headers['x-account-id'] !== user.id) throw new HttpError(403, 'La cuenta activa cambió. Conserva tu copia y vuelve a iniciar sesión.');
        if (typeof body.id !== 'string' || !UUID.test(body.id)) throw new HttpError(400, 'La identidad del proyecto no es válida.');
        requireCurrentClient(body);
        const project = projectValue(body.project);
        if (project.id !== body.id) throw new HttpError(400, 'La identidad del proyecto no es válida.');
        modelAssets.validateProjectReferences(project, user.id, body.id);
        const existing = find.get(body.id) as Row | undefined;
        if (existing) {
          if (user.id !== existing.owner_id) throw new HttpError(409, 'El proyecto ya existe.');
          if (request.headers['x-offline-write'] === '1') requireOffline(request, body.id);
          sendJson(response, 200, snapshot(existing, user));
        } else {
          if (wasErased(ledgerPath, 'room', body.id)) throw new HttpError(409, 'Crea un proyecto nuevo para continuar.');
          auth.limit('create-ip', ip, 60, 3_600_000); auth.limit('create-user', user.id, 60, 3_600_000);
          database.exec('BEGIN IMMEDIATE');
          try { quotaMutation(database, user.id, quotas, () => { database.prepare('INSERT INTO rooms (id, owner_id, room, updated_at) VALUES (?, ?, ?, ?)').run(project.id, user.id, JSON.stringify(projectMetadata(project)), now()); writeProject(database, project); seedProjectStates(database, project); }); database.exec('COMMIT'); }
          catch (cause) { database.exec('ROLLBACK'); throw cause; }
          sendJson(response, 201, snapshot(rowFor(body.id, user), user));
        }
        return;
      }
      const api = pathname.match(/^\/api\/rooms\/([^/]+)(\/share|\/levels\/([^/]+)\/sketch)?$/);
      if (api) {
        const id = api[1];
        if (!UUID.test(id)) throw new HttpError(400, 'La dirección del proyecto no es válida.');
        if (publicOnly && method !== 'GET' && method !== 'HEAD') throw new HttpError(403, 'Este enlace solo permite ver.');
        const user = publicOnly ? null : auth.session(request);
        const row = rowFor(id, user);
        if (api[2] === '/share') {
          if (method !== 'POST') throw new HttpError(405, 'Este método no está permitido.');
          requireOwner(request, row);
          const body = await readJson(request, 8192);
          requireOwner(request, row);
          if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'El permiso no es válido.');
          const updateShare = () => { database.prepare('UPDATE rooms SET shared = ?, updated_at = ? WHERE id = ?').run(body.enabled ? 1 : 0, now(), id); };
          if (body.enabled) updateShare();
          else recordErasure(database, ledgerPath, { kind: 'share', id, at: now() }, updateShare);
          live.refresh(id);
          sendJson(response, 200, { shared: body.enabled });
        } else if (api[3]) {
          const levelId = api[3];
          const sketchState = () => database.prepare('SELECT data,mime,version,mutation_id FROM project_sketches sketches WHERE room_id=? AND level_id=? AND EXISTS(SELECT 1 FROM project_levels levels WHERE levels.room_id=sketches.room_id AND levels.id=sketches.level_id)').get(id, levelId) as { data: Uint8Array | null; mime: string | null; version: number; mutation_id: string | null } | undefined;
          let saved = sketchState(); if (!saved) throw new HttpError(404, 'Este nivel no existe.');
          if (method === 'GET' || method === 'HEAD') {
            if (!saved.data) throw new HttpError(404, 'Este proyecto no tiene croquis.');
            const etag = '"' + id + '-' + levelId + '-' + saved.version + '"';
            if (request.headers['if-none-match'] === etag) { response.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); response.end(); return; }
            response.writeHead(200, { 'Content-Type': saved.mime!, 'Content-Length': saved.data.length, ETag: etag, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
            response.end(method === 'HEAD' ? undefined : Buffer.from(saved.data));
          } else if (method === 'PUT' || method === 'DELETE') {
            requireEditor(request, row); auth.limit('upload', ip, 20, 60000);
            const mime = method === 'PUT' ? request.headers['content-type']?.split(';')[0].trim().toLowerCase() ?? '' : null;
            if (method === 'PUT' && !['image/png', 'image/jpeg', 'image/webp'].includes(mime!)) throw new HttpError(415, 'Usa una imagen PNG, JPG o WebP.');
            const declared = Number(request.headers['content-length']);
            if (method === 'PUT' && Number.isSafeInteger(declared) && declared >= 0 && saved.mutation_id !== request.headers['x-sketch-request-id']) {
              const usage = accountUsage(database, row.owner_id);
              checkAccountQuota(usage, { ...usage, bytes: usage.bytes + declared - (saved.data?.byteLength ?? 0) }, quotas);
            }
            const release = method === 'PUT' ? uploads.acquire(auth.requireUser(request).id, SKETCH_MAX_BYTES) : () => {};
            try {
              const data = method === 'PUT' ? await readBody(request, SKETCH_MAX_BYTES) : null;
              requireEditor(request, rowFor(id, auth.requireUser(request)));
              if (data) { try { inspectImage(data, mime!); } catch (cause) { throw new HttpError(400, cause instanceof Error ? cause.message : 'El croquis no es válido.'); } }
              const mutation = request.headers['x-sketch-request-id'];
              if (typeof mutation !== 'string' || !UUID.test(mutation)) throw new HttpError(400, 'Falta la identidad del croquis.');
              if (request.headers['x-offline-write'] === '1') requireOffline(request, id);
              saved = sketchState(); if (!saved) throw new HttpError(409, 'Este nivel ya no existe.');
              if (saved.mutation_id === mutation) {
                if (saved.mime !== mime || Boolean(saved.data) !== Boolean(data) || data && !Buffer.from(saved.data!).equals(data)) throw new HttpError(409, 'La identidad del croquis ya está en uso.');
                sendJson(response, 200, { hasSketch: Boolean(saved.data), version: saved.version }); return;
              }
              if (Number(request.headers['x-sketch-version']) !== saved.version || Number(request.headers['x-room-revision']) !== (find.get(id) as Row).revision) throw new HttpError(409, 'El diseño cambió en otra sesión. Tu croquis se conserva en este dispositivo.');
              const version = saved.version + 1;
              const change = () => { database.prepare('UPDATE project_sketches SET data=?,mime=?,version=?,mutation_id=? WHERE room_id=? AND level_id=?').run(data, mime, version, mutation, id, levelId); database.prepare('UPDATE rooms SET updated_at=? WHERE id=?').run(now(), id); };
              if (method === 'DELETE') recordErasure(database, ledgerPath, { kind: 'sketch', id, levelId, at: now(), version }, change);
              else { database.exec('BEGIN IMMEDIATE'); try { quotaMutation(database, row.owner_id, quotas, change); database.exec('COMMIT'); } catch (cause) { database.exec('ROLLBACK'); throw cause; } }
              live.refresh(id); sendJson(response, 200, { hasSketch: Boolean(data), version });
            } finally { release(); }
          } else throw new HttpError(405, 'Este método no está permitido.');
        } else if (method === 'GET') sendJson(response, 200, snapshot(row, user));
        else if (method === 'DELETE') {
          requireOwner(request, row);
          if (request.headers['x-offline-write'] === '1') {
            const body = await readJson(request, 8192);
            const current = requireOffline(request, id);
            if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 1) throw new HttpError(400, 'La versión del proyecto no es válida.');
            if (!sameData(body.sketches, readSketchStates(database, id)) || body.revision !== current.revision) throw new HttpError(409, 'El diseño cambió. Conserva tu copia antes de eliminarlo.');
          }
          recordErasure(database, ledgerPath, { kind: 'room', id, at: now() }, () => { database.prepare('DELETE FROM rooms WHERE id = ?').run(id); });
          invalidateProjectCache(database, id);
          live.refresh(id);
          sendJson(response, 200, { deleted: true });
        }
        else if (method === 'PUT') {
          requireEditor(request, row);
          const body = await readProjectJson(request);
          requireEditor(request, row);
          if (request.headers['x-offline-write'] === '1') requireOffline(request, id);
          if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 1) throw new HttpError(400, 'La versión del proyecto no es válida.');
          requireCurrentClient(body);
          const project = projectValue(body.project);
          const changed = commands.putProject(id, project, body.revision as number, auth.requireUser(request).id, String(body.operationId ?? ''));
          live.publishProject(id);
          sendJson(response, 200, { ...snapshot(rowFor(id, auth.requireUser(request)), auth.requireUser(request)), ...changed });
        } else throw new HttpError(405, 'Este método no está permitido.');
        return;
      }
      if (pathname === '/api' || pathname.startsWith('/api/')) throw new HttpError(404, 'Esta ruta no existe.');
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Este método no está permitido.');
      await serveStatic(request, response, pathname);
    } catch (error) {
      request.resume();
      if (response.headersSent) { response.destroy(); return; }
      if (!(error instanceof HttpError)) console.error('Room server:', error);
      if (error instanceof HttpError && error.retryAfter) response.setHeader('Retry-After', String(error.retryAfter));
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'No se pudo guardar el proyecto. Inténtalo de nuevo.' });
    }
  });
  live.attach(server);
  if (maintenance) server.once('listening', () => maintenanceTasks.start());
  const close = server.close.bind(server);
  let databaseClosed = false;
  server.close = callback => {
    live.close();
    const pending = maintenanceTasks.stop();
    close(error => {
      void pending.catch(() => console.error('Maintenance stopped with an error.')).then(() => { if (!databaseClosed) { database.close(); databaseClosed = true; } callback?.(error); });
    });
    return server;
  };
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const server = createServer();
  server.listen(port, '0.0.0.0', () => console.log('Room server listening on port ' + port));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
}
