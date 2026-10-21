export function createServiceWorkerSource(cacheName: string, paths: string[], buildId: string, identities: Record<string, string>) {
  return `const CACHE = ${JSON.stringify(cacheName)};
const BUILD = ${JSON.stringify(buildId)};
const PREPARED = '/__3d-space-prepared__';
const PREVIOUS = '/__3d-space-previous__';
const IDENTITY = '/__3d-space-identities__';
const IDENTITIES = ${JSON.stringify(identities)};
const clientBuilds = new Map();
const ownCache = key => key.startsWith('3d-space-static-') || key.startsWith('3d-space-v2-static-') || key.startsWith('3d-space-v3-static-');
const priority = path => path === '/index.html' ? 0 : /\\.(js|css)$/.test(path) && !path.includes('worker') && !path.startsWith('/decoders/') ? 1 : path.startsWith('/icons/') || path.includes('manifest') || path === '/favicon.svg' ? 2 : path.startsWith('/decoders/') ? 3 : path.startsWith('/help/') ? 5 : 4;
const FILES = ${JSON.stringify(paths)}.sort((a, b) => priority(a) - priority(b));
const ALLOWED = new Set(FILES);
const CORE = FILES.filter(path => !path.startsWith('/environments/') && !(path.startsWith('/materials/') && !path.endsWith('.json')));
let preparing;
const PAGES = new Set(['/', '/editor', '/designs', '/login', '/privacy', '/terms', '/help']);
function valid(response, path) {
  if (!response.ok) return false;
  const type = response.headers.get('content-type') || '';
  if (path.endsWith('.js')) return /javascript/.test(type);
  if (path.endsWith('.css')) return /text\\/css/.test(type);
  if (path.endsWith('.html')) return /text\\/html/.test(type);
  return !/text\\/html/.test(type);
}
async function verified(response, path) {
  if (!response || !valid(response, path) || !IDENTITIES[path]) return false;
  const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('') === IDENTITIES[path];
}
async function previousResources() {
  const keys = (await (await caches.open(CACHE)).match(PREVIOUS));
  const resources = [];
  for (const key of keys ? await keys.json() : []) {
    const cache = await caches.open(key), metadata = await cache.match(IDENTITY);
    if (metadata) { try { resources.push({ cache, identities: await metadata.json() }); } catch {} }
  }
  return resources;
}
async function cacheFiles(paths) {
  const cache = await caches.open(CACHE);
  const previous = await previousResources();
  let index = 0;
  await Promise.all(Array.from({length: 4}, async () => {
    while (index < paths.length) {
      const path = paths[index++];
      if (await cache.match(path)) continue;
      let reused = false;
      for (const source of previous) if (source.identities[path] === IDENTITIES[path]) {
        const response = await source.cache.match(path);
        if (await verified(response, path)) { await cache.put(path, response); reused = true; break; }
      }
      if (reused) continue;
      const response = await fetch(path, {cache: 'reload', credentials: 'omit'});
      if (!await verified(response, path)) throw new Error('Static resource unavailable: ' + path);
      await cache.put(path, response);
    }
  }));
  await cache.put(IDENTITY, new Response(JSON.stringify(IDENTITIES)));
}
function prepare() {
  return preparing ??= (async () => { await cacheFiles(FILES); const cache = await caches.open(CACHE); await cache.put(PREPARED, new Response(BUILD)); })().finally(() => {preparing = undefined;});
}
self.addEventListener('install', event => event.waitUntil((async () => {
  try {
    const previous = await caches.keys();
    await (await caches.open(CACHE)).put(PREVIOUS, new Response(JSON.stringify(previous.filter(key => ownCache(key) && key !== CACHE))));
    let prepared = false;
    for (const key of previous) if (ownCache(key) && key !== CACHE) {
      const cache = await caches.open(key);
      if (await cache.match(PREPARED) || await cache.match('/environments/sunset-fairway-1k.hdr')) prepared = true;
    }
    if (prepared) await prepare(); else await cacheFiles(CORE);
  }
  catch (error) { await caches.delete(CACHE); throw error; }
})()));
async function cleanCaches() {
  const clients = await self.clients.matchAll({type: 'window', includeUncontrolled: true});
  if (clients.some(client => clientBuilds.get(client.id) !== BUILD)) return;
  const previous = await (await caches.open(CACHE)).match(PREVIOUS);
  // An active worker may retire only generations that existed at its own install.
  // A newer waiting worker's cache must survive old clients announcing their build.
  for (const key of previous ? await previous.json() : []) if (ownCache(key) && key !== CACHE) await caches.delete(key);
}
self.addEventListener('activate', event => event.waitUntil((async () => {
  await self.clients.claim();
  await cleanCaches();
})()));
async function saveClients(clients, type, id, automatic = false) {
  await Promise.all(clients.map(client => new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {channel.port1.close(); reject(new Error('Cierra las otras pestañas antes de continuar.'));}, 20000);
    channel.port1.onmessage = event => {
      clearTimeout(timer); channel.port1.close();
      event.data?.ready && (!automatic || event.data.automaticSafe === true) ? resolve() : reject(new Error('Guarda los cambios de las otras pestañas antes de continuar.'));
    };
    client.postMessage({type, id, automatic}, [channel.port2]);
  })));
}
async function saveStableClients(clients, type, id, automatic = false) {
      const confirmed = new Set();
      for (let round = 0; round < 8; round++) {
        const current = (await self.clients.matchAll({type: 'window', includeUncontrolled: true})).filter(client => !client.url || PAGES.has(new URL(client.url).pathname.replace(/\\/+$/, '') || '/'));
        const added = current.filter(client => !confirmed.has(client.id));
        if (!added.length) break;
        clients.push(...added);
        await saveClients(added, type, id, automatic);
        added.forEach(client => confirmed.add(client.id));
        if (round === 7) throw new Error('Cierra las otras pestañas antes de continuar.');
      }
}
function releaseClients(clients, type, id) {
  for (const client of clients) { try { client.postMessage({type, id}); } catch {} }
}
self.addEventListener('message', event => {
  const port = event.ports[0], id = event.data?.id;
  if (event.data?.type === 'SPACE_HELLO') event.waitUntil((async () => {
    if (event.source?.id && typeof event.data.build === 'string') clientBuilds.set(event.source.id, event.data.build);
    port?.postMessage({ready: true, build: BUILD}); await cleanCaches();
  })());
  if (event.data?.type === 'SPACE_PREPARE') event.waitUntil((async () => {
    try { await prepare(); port?.postMessage({ready: true}); }
    catch (error) { port?.postMessage({error: error.message}); }
  })());
  if (event.data?.type === 'SPACE_STATUS') event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const complete = await Promise.all(FILES.map(path => cache.match(path)));
    port?.postMessage({ready: complete.every(Boolean), build: BUILD});
  })());
  if (event.data?.type === 'SPACE_RELEASE_SAVED' && typeof id === 'string') event.waitUntil((async () => {
    releaseClients(await self.clients.matchAll({type: 'window', includeUncontrolled: true}), 'SPACE_RELEASE_MODE', id);
    port?.postMessage({ready: true});
  })());
  if (event.data?.type === 'SPACE_SAVE_ALL' && typeof id === 'string') event.waitUntil((async () => {
    let clients = [];
    try {
      await saveStableClients(clients, 'SPACE_SAVE_MODE', id);
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
      if (!(await Promise.all(CORE.map(path => cache.match(path)))).every(Boolean)) throw new Error('La actualización está incompleta. Descárgala de nuevo antes de actualizar.');
      await prepare();
      await saveStableClients(clients, 'SPACE_SAVE_UPDATE', id, event.data.automatic === true);
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
  if (!ALLOWED.has(path)) {
    if (!['/assets/', '/materials/', '/environments/', '/help/', '/decoders/'].some(prefix => path.startsWith(prefix))) return;
    event.respondWith((async () => {
      for (const key of await caches.keys()) if (ownCache(key)) { const cached = await (await caches.open(key)).match(path); if (cached) return cached; }
      return fetch(request);
    })()); return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE), cached = await cache.match(path);
    if (cached) return cached;
    const response = await fetch(path, {credentials: 'omit'});
    if (!await verified(response, path)) return new Response('Recurso no disponible.', {status: 503});
    await cache.put(path, response.clone());
    return response;
  })());
});`;
}
