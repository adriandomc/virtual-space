import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

function appOffline(): Plugin {
  return {
    name: 'app-offline', apply: 'build', enforce: 'post',
    async generateBundle(_, bundle) {
      const files = new Map<string, Uint8Array | string>();
      for (const [name, output] of Object.entries(bundle)) files.set('/' + name, output.type === 'chunk' ? output.code : output.source);
      const visit = async (directory: string, prefix = '') => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (entry.isDirectory()) await visit(join(directory, entry.name), prefix + entry.name + '/');
          else if (!entry.name.endsWith('.md')) files.set('/' + prefix + entry.name, await readFile(join(directory, entry.name)));
        }
      };
      await visit('public');
      const hash = createHash('sha256');
      for (const [name, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) hash.update(name).update(content);
      const source = `const CACHE = '3d-space-static-${hash.digest('hex').slice(0, 20)}';
const FILES = ${JSON.stringify([...files.keys()])};
const ALLOWED = new Set(FILES);
const PAGES = new Set(['/', '/editor', '/designs', '/login', '/privacy', '/terms']);
function valid(response, path) {
  if (!response.ok) return false;
  const type = response.headers.get('content-type') || '';
  if (path.endsWith('.js')) return /javascript/.test(type);
  if (path.endsWith('.css')) return /text\\/css/.test(type);
  if (path.endsWith('.html')) return /text\\/html/.test(type);
  return !/text\\/html/.test(type);
}
self.addEventListener('install', event => event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  try {
    await Promise.all(FILES.map(async path => {
      const response = await fetch(path, {cache: 'reload', credentials: 'omit'});
      if (!valid(response, path)) throw new Error('Static resource unavailable: ' + path);
      await cache.put(path, response);
    }));
  } catch (error) { await caches.delete(CACHE); throw error; }
})()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const key of await caches.keys()) if (key.startsWith('3d-space-static-') && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  const page = url.pathname.replace(/\\/+$/, '') || '/';
  const path = request.mode === 'navigate' && PAGES.has(page) ? '/index.html' : url.pathname;
  if (!ALLOWED.has(path)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), cached = await cache.match(path);
    if (cached) return cached;
    const response = await fetch(path, {credentials: 'omit'});
    if (!valid(response, path)) return new Response('Recurso no disponible.', {status: 503});
    await cache.put(path, response.clone());
    return response;
  })());
});`;
      this.emitFile({ type: 'asset', fileName: 'service-worker.js', source });
    },
  };
}

export default defineConfig({ plugins: [react(), appOffline()], resolve: { alias: [{ find: /^three$/, replacement: 'three/webgpu' }] }, server: { proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false, ws: true } } } });
