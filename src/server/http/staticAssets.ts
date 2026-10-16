import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { HttpError } from '../auth/auth.js';

const compress = promisify(gzip);
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
type Prepared = { etag: string; size: number; gzip: string | null };
type Cached = { stamp: string; data: Buffer; gzip?: Buffer; etag: string };

export function createStaticAssets(directory: string) {
  let root = resolve(directory);
  const canonicalRoot = realpath(root).then(value => { root = value; }).catch(() => {});
  const entries = new Map<string, Cached>();
  const manifest = readFile(resolve(root, '.http-assets.json'), 'utf8').then(text => {
    const value = JSON.parse(text);
    return value?.version === 1 && value.files && typeof value.files === 'object' ? value.files as Record<string, Prepared> : {};
  }).catch(() => ({} as Record<string, Prepared>));
  const inside = (path: string) => { const part = relative(root, path); return !isAbsolute(part) && part !== '..' && !part.startsWith('..' + sep); };
  const safeFile = async (path: string) => {
    if (!inside(path) || !inside(await realpath(path))) throw new HttpError(403, 'La dirección no está permitida.');
    const info = await stat(path);
    if (!info.isFile()) throw new Error('Not a file.');
    return info;
  };
  return async (request: IncomingMessage, response: ServerResponse, pathname: string) => {
    await canonicalRoot;
    if (pathname.split('/').some(part => part === '..' || part.startsWith('.http-'))) throw new HttpError(403, 'La dirección no está permitida.');
    let file = resolve(root, '.' + pathname), info;
    if (!inside(file)) throw new HttpError(403, 'La dirección no está permitida.');
    try { info = await safeFile(file); }
    catch (cause) {
      if (cause instanceof HttpError) throw cause;
      if (extname(pathname)) throw new HttpError(404, 'Este archivo no existe.');
      file = resolve(root, 'index.html');
      try { info = await safeFile(file); } catch { throw new HttpError(404, 'La aplicación todavía no está disponible.'); }
    }
    const name = relative(root, file).split(sep).join('/'), mime = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
    if (request.url?.split('?')[0] === '/embed' && name === 'index.html') {
      response.removeHeader('X-Frame-Options'); response.setHeader('Content-Security-Policy', 'frame-ancestors *');
    }
    const prepared = (await manifest)[name], stamp = info.mtimeMs + ':' + info.size;
    let cached = entries.get(file), etag = prepared?.etag;
    if (!etag) {
      if (cached?.stamp !== stamp) {
        const data = await readFile(file);
        cached = { stamp, data, etag: 'W/"' + createHash('sha256').update(data).digest('hex') + '"' };
        entries.delete(file);
        if (data.length <= 16 * 1024 * 1024) entries.set(file, cached);
        let bytes = [...entries.values()].reduce((sum, value) => sum + value.data.length + (value.gzip?.length ?? 0), 0);
        while (entries.size > 32 || bytes > 16 * 1024 * 1024) { const first = entries.entries().next().value!; bytes -= first[1].data.length + (first[1].gzip?.length ?? 0); entries.delete(first[0]); }
      }
      etag = cached!.etag;
    }
    const headers = { ETag: etag, Vary: 'Accept-Encoding', 'Cache-Control': name.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' };
    if (request.headers['if-none-match'] === etag) { response.writeHead(304, headers); response.end(); return; }
    const acceptsGzip = request.headers['accept-encoding']?.split(',').some(value => /^gzip(?:;|$)/i.test(value.trim()) && !/;\s*q=0(?:\.0*)?(?:;|$)/i.test(value)) ?? false;
    let data: Buffer | undefined, streamPath = file, size = info.size, encoded = false;
    if (acceptsGzip && prepared?.gzip) {
      streamPath = resolve(root, prepared.gzip); size = (await safeFile(streamPath)).size; encoded = true;
    } else if (cached) {
      data = cached.data;
      if (acceptsGzip && data.length > 1024 && /\.(?:html|js|css|json|webmanifest|svg)$/.test(name)) { data = cached.gzip ??= await compress(data); encoded = true; }
      size = data.length;
    }
    response.writeHead(200, { ...headers, 'Content-Type': mime, 'Content-Length': size, ...(encoded ? { 'Content-Encoding': 'gzip' } : {}) });
    if (request.method === 'HEAD') response.end();
    else if (data) response.end(data);
    else await pipeline(createReadStream(streamPath), response);
  };
}
