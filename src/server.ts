import { createServer as httpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { validateRoom } from './model.js';
import type { Room } from './types.js';
import { checkOrigin, createAuth, HttpError, ipRateIdentity, proxyTrust, type User } from './auth.js';
import { deleteInactiveAccounts } from './retention.js';
import { applyErasures, initializeErasures, recordErasure, wasErased } from './erasures.js';
import { createMaintenance } from './maintenanceService.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
type Row = { id: string; owner_id: string; room: string; revision: number; has_sketch: number; sketch_version: number; shared: number; updated_at: number };

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(JSON.stringify(body));
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

async function readJson(request: IncomingMessage, limit = 1024 * 1024): Promise<Record<string, unknown>> {
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

function roomValue(value: unknown): Room {
  try { return validateRoom(value); }
  catch (error) { throw new HttpError(400, error instanceof Error ? error.message : 'El proyecto no es válido.'); }
}

function imageMatches(data: Buffer, mime: string) {
  if (mime === 'image/png') return data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === 'image/jpeg') return data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255;
  if (mime === 'image/webp') return data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

export function createServer({ dataDir = process.env.DATA_DIR ?? './data', staticDir = './dist', now = Date.now, trustedProxies, appOrigin, secureCookie, maintenance = true }: { dataDir?: string; staticDir?: string; now?: () => number; trustedProxies?: string; appOrigin?: string; secureCookie?: boolean; maintenance?: boolean } = {}) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  chmodSync(dataDir, 0o700);
  const database = new DatabaseSync(resolve(dataDir, 'accounts.sqlite'));
  chmodSync(resolve(dataDir, 'accounts.sqlite'), 0o600);
  database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;');
  const auth = createAuth(database, { now, secureCookie });
  const identify = proxyTrust(trustedProxies);
  database.exec('CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, room TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, shared INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, sketch BLOB, sketch_mime TEXT, sketch_version INTEGER NOT NULL DEFAULT 0); CREATE INDEX IF NOT EXISTS rooms_owner_updated ON rooms(owner_id, updated_at DESC)');
  const ledgerPath = initializeErasures(dataDir, database);
  applyErasures(database, ledgerPath, { now: now(), includeExpired: true });
  deleteInactiveAccounts(database, now());
  const maintenanceTasks = createMaintenance(database, dataDir, ledgerPath, { now });
  const find = database.prepare('SELECT id, owner_id, room, revision, shared, updated_at, sketch_version, (sketch IS NOT NULL) AS has_sketch FROM rooms WHERE id = ?');
  const root = resolve(staticDir);
  const snapshot = (row: Row, user: User | null) => ({ id: row.id, room: JSON.parse(row.room) as Room, revision: row.revision, hasSketch: row.has_sketch === 1, sketchVersion: row.sketch_version, canEdit: user?.id === row.owner_id, shared: row.shared === 1, updatedAt: new Date(row.updated_at).toISOString() });
  const rowFor = (id: string, user: User | null) => {
    const row = find.get(id) as Row | undefined;
    if (!row || (!row.shared && row.owner_id !== user?.id)) throw new HttpError(404, 'Este proyecto no existe.');
    return row;
  };
  const requireEditor = (request: IncomingMessage, row: Row) => {
    if (auth.requireUser(request).id !== row.owner_id) throw new HttpError(403, 'Este proyecto solo permite ver.');
  };
  const server = httpServer(async (request, response) => {
    try {
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('X-Frame-Options', 'DENY');
      if (!request.url || request.url.length > 4096) throw new HttpError(400, 'La dirección no es válida.');
      let pathname: string;
      try { pathname = decodeURIComponent(request.url.split('?')[0]); }
      catch { throw new HttpError(400, 'La dirección no es válida.'); }
      if (pathname.includes('\0') || pathname.includes('\\')) throw new HttpError(400, 'La dirección no es válida.');
      const method = request.method ?? 'GET';
      response.once('finish', () => {
        try { if (response.statusCode < 400 && pathname.startsWith('/api/')) auth.touchSuccessfulRequest(request); }
        catch { console.error('Could not record authenticated activity.'); }
      });
      const { ip: clientIP, fromProxy } = identify(request), ip = ipRateIdentity(clientIP);
      if (pathname.startsWith('/api/')) { auth.checkBlocked(ip); auth.limit('api', ip, 600, 60_000); checkOrigin(request, fromProxy, appOrigin); }
      if (pathname === '/api/auth/session' && method === 'GET') { sendJson(response, 200, { user: auth.session(request) }); return; }
      if (pathname === '/api/auth/register' && method === 'POST') { sendJson(response, 201, { user: await auth.register(request, response, await readJson(request, 8192), ip) }); return; }
      if (pathname === '/api/auth/login' && method === 'POST') { sendJson(response, 200, { user: await auth.login(request, response, await readJson(request, 8192), ip) }); return; }
      if (pathname === '/api/auth/logout' && method === 'POST') { auth.logout(request, response); sendJson(response, 200, { user: null }); return; }
      if (pathname === '/api/rooms' && method === 'GET') {
        const user = auth.requireUser(request);
        const rooms = database.prepare('SELECT id, json_extract(room, \'$.name\') AS name, json_extract(room, \'$.setupStep\') AS setup_step, shared, updated_at FROM rooms WHERE owner_id = ? ORDER BY updated_at DESC, id').all(user.id) as { id: string; name: string; setup_step: Room['setupStep'] | null; shared: number; updated_at: number }[];
        sendJson(response, 200, { rooms: rooms.map(row => ({ id: row.id, name: row.name, setupStep: row.setup_step ?? undefined, shared: row.shared === 1, updatedAt: new Date(row.updated_at).toISOString() })) }); return;
      }
      if (pathname === '/api/rooms' && method === 'POST') {
        let user = auth.requireUser(request);
        const body = await readJson(request);
        user = auth.requireUser(request);
        if (typeof body.id !== 'string' || !UUID.test(body.id)) throw new HttpError(400, 'La identidad del proyecto no es válida.');
        const room = roomValue(body.room);
        const existing = find.get(body.id) as Row | undefined;
        if (existing) {
          if (user.id !== existing.owner_id) throw new HttpError(409, 'El proyecto ya existe.');
          sendJson(response, 200, snapshot(existing, user));
        } else {
          if (wasErased(ledgerPath, 'room', body.id)) throw new HttpError(409, 'Crea un proyecto nuevo para continuar.');
          auth.limit('create-ip', ip, 60, 3_600_000); auth.limit('create-user', user.id, 60, 3_600_000);
          database.prepare('INSERT INTO rooms (id, owner_id, room, updated_at) VALUES (?, ?, ?, ?)').run(body.id, user.id, JSON.stringify(room), now());
          sendJson(response, 201, snapshot(rowFor(body.id, user), user));
        }
        return;
      }
      const api = pathname.match(/^\/api\/rooms\/([^/]+)(\/(?:sketch|share))?$/);
      if (api) {
        const id = api[1];
        if (!UUID.test(id)) throw new HttpError(400, 'La dirección del proyecto no es válida.');
        const user = auth.session(request);
        const row = rowFor(id, user);
        if (api[2] === '/share') {
          if (method !== 'POST') throw new HttpError(405, 'Este método no está permitido.');
          requireEditor(request, row);
          const body = await readJson(request);
          requireEditor(request, row);
          if (typeof body.enabled !== 'boolean') throw new HttpError(400, 'El permiso no es válido.');
          const updateShare = () => { database.prepare('UPDATE rooms SET shared = ?, updated_at = ? WHERE id = ?').run(body.enabled ? 1 : 0, now(), id); };
          if (body.enabled) updateShare();
          else recordErasure(database, ledgerPath, { kind: 'share', id, at: now() }, updateShare);
          sendJson(response, 200, { shared: body.enabled });
        } else if (api[2] === '/sketch') {
          if (method === 'GET' || method === 'HEAD') {
            if (!row.has_sketch) throw new HttpError(404, 'Este proyecto no tiene croquis.');
            const sketch = database.prepare('SELECT sketch, sketch_mime FROM rooms WHERE id = ?').get(id) as { sketch: Uint8Array; sketch_mime: string };
            const etag = '"' + id + '-' + row.sketch_version + '"';
            if (request.headers['if-none-match'] === etag) { response.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); response.end(); return; }
            response.writeHead(200, { 'Content-Type': sketch.sketch_mime, 'Content-Length': sketch.sketch.length, ETag: etag, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
            response.end(method === 'HEAD' ? undefined : Buffer.from(sketch.sketch));
          } else if (method === 'PUT') {
            requireEditor(request, row);
            auth.limit('upload', ip, 20, 60_000);
            const mime = request.headers['content-type']?.split(';')[0].trim().toLowerCase() ?? '';
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new HttpError(415, 'Usa una imagen PNG, JPG o WebP.');
            const data = await readBody(request, 10 * 1024 * 1024);
            requireEditor(request, row);
            if (!imageMatches(data, mime)) throw new HttpError(400, 'El contenido no coincide con el tipo de imagen.');
            const changed = database.prepare('UPDATE rooms SET sketch = ?, sketch_mime = ?, sketch_version = sketch_version + 1, updated_at = ? WHERE id = ? RETURNING sketch_version').get(data, mime, now(), id) as { sketch_version: number };
            sendJson(response, 200, { hasSketch: true, sketchVersion: changed.sketch_version });
          } else if (method === 'DELETE') {
            requireEditor(request, row);
            let changed!: { sketch_version: number };
            recordErasure(database, ledgerPath, { kind: 'sketch', id, at: now(), version: row.sketch_version + 1 }, () => {
              changed = database.prepare('UPDATE rooms SET sketch = NULL, sketch_mime = NULL, sketch_version = sketch_version + 1, updated_at = ? WHERE id = ? RETURNING sketch_version').get(now(), id) as { sketch_version: number };
            });
            sendJson(response, 200, { hasSketch: false, sketchVersion: changed.sketch_version });
          } else throw new HttpError(405, 'Este método no está permitido.');
        } else if (method === 'GET') sendJson(response, 200, snapshot(row, user));
        else if (method === 'DELETE') {
          requireEditor(request, row);
          recordErasure(database, ledgerPath, { kind: 'room', id, at: now() }, () => { database.prepare('DELETE FROM rooms WHERE id = ?').run(id); });
          sendJson(response, 200, { deleted: true });
        }
        else if (method === 'PUT') {
          requireEditor(request, row);
          const body = await readJson(request);
          requireEditor(request, row);
          if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 1) throw new HttpError(400, 'La versión del proyecto no es válida.');
          const room = roomValue(body.room);
          const changed = database.prepare('UPDATE rooms SET room = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ? RETURNING revision').get(JSON.stringify(room), now(), id, body.revision as number) as { revision: number } | undefined;
          if (!changed) {
            const latest = rowFor(id, user);
            if (latest.room === JSON.stringify(room)) { sendJson(response, 200, { id, room, revision: latest.revision }); return; }
            throw new HttpError(409, 'Otra sesión guardó cambios. Descarga tus cambios y abre el proyecto de nuevo para revisar esa versión.');
          }
          sendJson(response, 200, { id, room, revision: changed.revision });
        } else throw new HttpError(405, 'Este método no está permitido.');
        return;
      }
      if (pathname === '/api' || pathname.startsWith('/api/')) throw new HttpError(404, 'Esta ruta no existe.');
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Este método no está permitido.');
      if (pathname.split('/').includes('..')) throw new HttpError(403, 'La dirección no está permitida.');
      const candidate = resolve(root, '.' + pathname);
      const inside = (path: string) => { const part = relative(root, path); return !isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep); };
      if (!inside(candidate)) throw new HttpError(403, 'La dirección no está permitida.');
      let file = candidate;
      try { if (!statSync(file).isFile()) file = resolve(root, 'index.html'); }
      catch { if (extname(pathname)) throw new HttpError(404, 'Este archivo no existe.'); file = resolve(root, 'index.html'); }
      try {
        if (!inside(realpathSync(file))) throw new HttpError(403, 'La dirección no está permitida.');
        let data = readFileSync(file);
        const mime = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
        const cacheControl = relative(root, file).startsWith('assets' + sep) ? 'public, max-age=31536000, immutable' : 'no-cache';
        const etag = 'W/"' + createHash('sha256').update(data).digest('hex') + '"';
        if (request.headers['if-none-match'] === etag) {
          response.writeHead(304, { ETag: etag, 'Cache-Control': cacheControl, Vary: 'Accept-Encoding' }); response.end(); return;
        }
        const acceptsGzip = request.headers['accept-encoding']?.split(',').some(value => /^gzip(?:;|$)/i.test(value.trim()) && !/;\s*q=0(?:\.0*)?(?:;|$)/i.test(value)) ?? false;
        const compress = data.length > 1024 && acceptsGzip && (mime.startsWith('text/') || mime === 'image/svg+xml' || mime.startsWith('application/json'));
        if (compress) data = gzipSync(data);
        response.writeHead(200, { 'Content-Type': mime, 'Content-Length': data.length, ...(compress ? { 'Content-Encoding': 'gzip' } : {}), ETag: etag, Vary: 'Accept-Encoding', 'Cache-Control': cacheControl, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
        response.end(method === 'HEAD' ? undefined : data);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(404, 'La aplicación todavía no está disponible.');
      }
    } catch (error) {
      request.resume();
      if (response.headersSent) { response.destroy(); return; }
      if (!(error instanceof HttpError)) console.error('Room server:', error);
      if (error instanceof HttpError && error.retryAfter) response.setHeader('Retry-After', String(error.retryAfter));
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'No se pudo guardar el proyecto. Inténtalo de nuevo.' });
    }
  });
  if (maintenance) server.once('listening', () => maintenanceTasks.start());
  const close = server.close.bind(server);
  let databaseClosed = false;
  server.close = callback => {
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
