import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { languages, translationCatalogs, type Locale } from './src/translations';

async function localizedManifest(locale: Locale) {
  const template = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
  const strings = translationCatalogs[locale];
  return JSON.stringify({ ...template, name: strings['3D Space'], short_name: strings['3D Space'], lang: locale, description: strings['Creador de espacios 3D gratuito y de código abierto'] });
}

function appOffline(): Plugin {
  return {
    name: 'app-offline', apply: 'build', enforce: 'post',
    async generateBundle(_, bundle) {
      const files = new Map<string, Uint8Array | string>();
      for (const { code } of languages) {
        const source = await localizedManifest(code), fileName = `manifest.${code}.webmanifest`;
        this.emitFile({ type: 'asset', fileName, source });
        files.set('/' + fileName, source);
      }
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
      const source = `const CACHE = '3d-space-v2-static-${hash.digest('hex').slice(0, 20)}';
const FILES = ${JSON.stringify([...files.keys()])};
const ALLOWED = new Set(FILES);
const PAGES = new Set(['/', '/editor', '/designs', '/login', '/privacy', '/terms', '/help']);
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
  for (const key of await caches.keys()) if ((key.startsWith('3d-space-static-') || key.startsWith('3d-space-v2-static-')) && key !== CACHE) await caches.delete(key);
  await self.clients.claim();
})()));
async function saveClients(clients, type, id) {
  await Promise.all(clients.map(client => new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {channel.port1.close(); reject(new Error('Cierra las otras pestañas antes de continuar.'));}, 20000);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close();
      event.data?.ready ? resolve() : reject(new Error('Guarda los cambios de las otras pestañas antes de continuar.'));
    };
    client.postMessage({type, id}, [channel.port2]);
  })));
}
function releaseClients(clients, type, id) {
  for (const client of clients) { try { client.postMessage({type, id}); } catch {} }
}
self.addEventListener('message', event => {
  const port = event.ports[0], id = event.data?.id;
  if (event.data?.type === 'SPACE_STATUS') event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const complete = await Promise.all(FILES.map(path => cache.match(path)));
    port?.postMessage({ready: complete.every(Boolean)});
  })());
  if (event.data?.type === 'SPACE_RELEASE_SAVED' && typeof id === 'string') event.waitUntil((async () => {
    releaseClients(await self.clients.matchAll({type: 'window', includeUncontrolled: true}), 'SPACE_RELEASE_MODE', id);
    port?.postMessage({ready: true});
  })());
  if (event.data?.type === 'SPACE_SAVE_ALL' && typeof id === 'string') event.waitUntil((async () => {
    let clients = [];
    try {
      clients = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
      await saveClients(clients, 'SPACE_SAVE_MODE', id);
      port?.postMessage({ready: true});
    } catch (error) {
      releaseClients(clients, 'SPACE_RELEASE_MODE', id);
      port?.postMessage({error: error.message});
    }
  })());
  if (event.data?.type === 'SPACE_UPDATE' && typeof id === 'string') event.waitUntil((async () => {
    let clients = [];
    try {
      const cache = await caches.open(CACHE);
      if (!(await Promise.all(FILES.map(path => cache.match(path)))).every(Boolean)) throw new Error('La actualización está incompleta. Descárgala de nuevo antes de actualizar.');
      clients = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
      await saveClients(clients, 'SPACE_SAVE_UPDATE', id);
      port?.postMessage({ready: true}); await self.skipWaiting();
    } catch (error) {
      releaseClients(clients, 'SPACE_CANCEL_UPDATE', id);
      port?.postMessage({error: error.message});
    }
  })());
});
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

const devManifests: Plugin = {
  name: 'localized-manifests',
  async configureServer(server) {
    const manifests = new Map<string, string>(await Promise.all(languages.map(async ({ code }) => [`/manifest.${code}.webmanifest`, await localizedManifest(code)] as const)));
    server.middlewares.use((request, response, next) => {
      const body = manifests.get((request.url ?? '').split('?')[0]);
      if (!body) return next();
      response.setHeader('Content-Type', 'application/manifest+json'); response.end(body);
    });
  },
};
export default defineConfig({ plugins: [react(), devManifests, appOffline()], resolve: { alias: [{ find: /^three$/, replacement: 'three/webgpu' }] }, server: { proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false, ws: true } } } });
