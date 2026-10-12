import { createServer as httpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { validateRoom } from './model.js';
import type { Room } from './types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EDIT_KEY = /^[0-9a-f]{64}$/i;
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
type Row = { id: string; room: string; revision: number; edit_hash: string; has_sketch: number; sketch_version: number };
class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
const keyMatches = (key: string, hash: string) => EDIT_KEY.test(key) && timingSafeEqual(Buffer.from(hashKey(key), 'hex'), Buffer.from(hash, 'hex'));
const bearer = (request: IncomingMessage) => request.headers.authorization?.match(/^Bearer ([0-9a-f]{64})$/i)?.[1] ?? '';

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

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new HttpError(415, 'Envía un proyecto válido.');
  try {
    const value: unknown = JSON.parse((await readBody(request, 1024 * 1024)).toString('utf8'));
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

export function createServer({ dataDir = process.env.DATA_DIR ?? './data', staticDir = './dist' }: { dataDir?: string; staticDir?: string } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const database = new DatabaseSync(resolve(dataDir, 'rooms.sqlite'));
  database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS rooms (id TEXT PRIMARY KEY, room TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, edit_hash TEXT NOT NULL, sketch BLOB, sketch_mime TEXT, sketch_version INTEGER NOT NULL DEFAULT 0)');
  const find = database.prepare('SELECT id, room, revision, edit_hash, sketch_version, (sketch IS NOT NULL) AS has_sketch FROM rooms WHERE id = ?');
  const root = resolve(staticDir);
  const snapshot = (row: Row, key = '') => ({ id: row.id, room: JSON.parse(row.room) as Room, revision: row.revision, hasSketch: row.has_sketch === 1, sketchVersion: row.sketch_version, canEdit: keyMatches(key, row.edit_hash) });
  const rowFor = (id: string) => {
    const row = find.get(id) as Row | undefined;
    if (!row) throw new HttpError(404, 'Este proyecto no existe.');
    return row;
  };
  const requireEditor = (request: IncomingMessage, row: Row) => {
    if (!keyMatches(bearer(request), row.edit_hash)) throw new HttpError(403, 'Este enlace solo permite ver el proyecto.');
  };
  const server = httpServer(async (request, response) => {
    try {
      if (!request.url || request.url.length > 4096) throw new HttpError(400, 'La dirección no es válida.');
      let pathname: string;
      try { pathname = decodeURIComponent(request.url.split('?')[0]); }
      catch { throw new HttpError(400, 'La dirección no es válida.'); }
      if (pathname.includes('\0') || pathname.includes('\\')) throw new HttpError(400, 'La dirección no es válida.');
      const method = request.method ?? 'GET';
      if (pathname === '/api/rooms' && method === 'POST') {
        const body = await readJson(request);
        if (typeof body.id !== 'string' || !UUID.test(body.id) || typeof body.editKey !== 'string' || !EDIT_KEY.test(body.editKey)) throw new HttpError(400, 'La identidad del proyecto no es válida.');
        const room = roomValue(body.room);
        const existing = find.get(body.id) as Row | undefined;
        if (existing) {
          if (!keyMatches(body.editKey, existing.edit_hash)) throw new HttpError(409, 'El proyecto ya existe con otro permiso de edición.');
          sendJson(response, 200, { ...snapshot(existing, body.editKey), editKey: body.editKey });
        } else {
          database.prepare('INSERT INTO rooms (id, room, edit_hash) VALUES (?, ?, ?)').run(body.id, JSON.stringify(room), hashKey(body.editKey));
          sendJson(response, 201, { ...snapshot(rowFor(body.id), body.editKey), editKey: body.editKey });
        }
        return;
      }
      const api = pathname.match(/^\/api\/rooms\/([^/]+)(\/sketch)?$/);
      if (api) {
        const id = api[1];
        if (!UUID.test(id)) throw new HttpError(400, 'La dirección del proyecto no es válida.');
        const row = rowFor(id);
        if (api[2]) {
          if (method === 'GET' || method === 'HEAD') {
            if (!row.has_sketch) throw new HttpError(404, 'Este proyecto no tiene croquis.');
            const sketch = database.prepare('SELECT sketch, sketch_mime FROM rooms WHERE id = ?').get(id) as { sketch: Uint8Array; sketch_mime: string };
            const etag = '"' + id + '-' + row.sketch_version + '"';
            if (request.headers['if-none-match'] === etag) { response.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' }); response.end(); return; }
            response.writeHead(200, { 'Content-Type': sketch.sketch_mime, 'Content-Length': sketch.sketch.length, ETag: etag, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
            response.end(method === 'HEAD' ? undefined : Buffer.from(sketch.sketch));
          } else if (method === 'PUT') {
            requireEditor(request, row);
            const mime = request.headers['content-type']?.split(';')[0].trim().toLowerCase() ?? '';
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new HttpError(415, 'Usa una imagen PNG, JPG o WebP.');
            const data = await readBody(request, 10 * 1024 * 1024);
            if (!imageMatches(data, mime)) throw new HttpError(400, 'El contenido no coincide con el tipo de imagen.');
            const changed = database.prepare('UPDATE rooms SET sketch = ?, sketch_mime = ?, sketch_version = sketch_version + 1 WHERE id = ? RETURNING sketch_version').get(data, mime, id) as { sketch_version: number };
            sendJson(response, 200, { hasSketch: true, sketchVersion: changed.sketch_version });
          } else if (method === 'DELETE') {
            requireEditor(request, row);
            const changed = database.prepare('UPDATE rooms SET sketch = NULL, sketch_mime = NULL, sketch_version = sketch_version + 1 WHERE id = ? RETURNING sketch_version').get(id) as { sketch_version: number };
            sendJson(response, 200, { hasSketch: false, sketchVersion: changed.sketch_version });
          } else throw new HttpError(405, 'Este método no está permitido.');
        } else if (method === 'GET') sendJson(response, 200, snapshot(row, bearer(request)));
        else if (method === 'PUT') {
          requireEditor(request, row);
          const body = await readJson(request);
          if (!Number.isSafeInteger(body.revision) || (body.revision as number) < 1) throw new HttpError(400, 'La versión del proyecto no es válida.');
          const room = roomValue(body.room);
          const changed = database.prepare('UPDATE rooms SET room = ?, revision = revision + 1 WHERE id = ? AND revision = ? RETURNING revision').get(JSON.stringify(room), id, body.revision as number) as { revision: number } | undefined;
          if (!changed) {
            const latest = rowFor(id);
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
        const acceptsGzip = request.headers['accept-encoding']?.split(',').some(value => /^gzip(?:;|$)/i.test(value.trim()) && !/;\s*q=0(?:\.0*)?(?:;|$)/i.test(value)) ?? false;
        const compress = data.length > 1024 && acceptsGzip && (mime.startsWith('text/') || mime === 'image/svg+xml' || mime.startsWith('application/json'));
        if (compress) data = gzipSync(data);
        response.writeHead(200, { 'Content-Type': mime, 'Content-Length': data.length, ...(compress ? { 'Content-Encoding': 'gzip' } : {}), Vary: 'Accept-Encoding', 'Cache-Control': relative(root, file).startsWith('assets' + sep) ? 'public, max-age=31536000, immutable' : 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
        response.end(method === 'HEAD' ? undefined : data);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(404, 'La aplicación todavía no está disponible.');
      }
    } catch (error) {
      request.resume();
      if (response.headersSent) { response.destroy(); return; }
      if (!(error instanceof HttpError)) console.error('Room server:', error);
      sendJson(response, error instanceof HttpError ? error.status : 500, { error: error instanceof HttpError ? error.message : 'No se pudo guardar el proyecto. Inténtalo de nuevo.' });
    }
  });
  server.once('close', () => database.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535.');
  const server = createServer();
  server.listen(port, '0.0.0.0', () => console.log('Room server listening on port ' + port));
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close());
}
