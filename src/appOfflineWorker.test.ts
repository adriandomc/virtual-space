import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import type { Plugin, UserConfig } from 'vite';
import config from '../vite.config';

async function workerSource() {
  const plugin = ((config as UserConfig).plugins?.flat().find(value => value && typeof value === 'object' && 'name' in value && value.name === 'app-offline')) as Plugin;
  assert.ok(plugin?.generateBundle);
  const hook = typeof plugin.generateBundle === 'function' ? plugin.generateBundle : plugin.generateBundle.handler;
  let source = '';
  const emitFile = (value: { fileName?: string; source?: unknown }) => { if (value.fileName === 'service-worker.js') source = String(value.source); return 'worker'; };
  await (hook as Function).call({ emitFile }, {}, {
    'index.html': { type: 'asset', source: '<html>3D Space</html>' },
    'assets/main.js': { type: 'chunk', code: 'main();' },
    'assets/ModelWorkshop.js': { type: 'chunk', code: 'workshop();' },
    'assets/boolean.worker.js': { type: 'chunk', code: 'boolean();' },
    'assets/main.css': { type: 'asset', source: 'body{}' },
  });
  assert.ok(source); return source;
}
const source = workerSource();

async function worker(options: { badScript?: boolean; offline?: boolean } = {}) {
  const listeners = new Map<string, Function>(), entries = new Map<string, Map<string, Response>>(), calls: string[] = [];
  entries.set('unrelated-app', new Map()); entries.set('3d-space-static-old', new Map());
  const caches = {
    async open(name: string) {
      let cache = entries.get(name); if (!cache) { cache = new Map(); entries.set(name, cache); }
      return { put: async (path: string, response: Response) => { cache!.set(path, response.clone()); }, match: async (path: string) => cache!.get(path)?.clone() };
    },
    async keys() { return [...entries.keys()]; },
    async delete(name: string) { return entries.delete(name); },
  };
  let offline = options.offline ?? false;
  let unavailable = false;
  vm.runInNewContext(await source, {
    URL, Response, caches,
    fetch: async (path: string, init?: RequestInit) => {
      calls.push(path); assert.equal(init?.credentials, 'omit');
      if (offline) throw new TypeError('offline');
      if (unavailable) return new Response('Temporary outage', { status: 503, headers: { 'content-type': 'text/html' } });
      const mime = path.endsWith('.js') ? options.badScript && path.endsWith('main.js') ? 'text/html' : 'application/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.html') ? 'text/html' : 'application/octet-stream';
      return new Response(path.endsWith('.html') ? '<html>3D Space</html>' : path, { headers: { 'content-type': mime } });
    },
    self: { location: { origin: 'https://space.test' }, clients: { claim: async () => {} }, addEventListener: (name: string, listener: Function) => listeners.set(name, listener) },
  });
  return {
    entries, calls, setOffline: (value: boolean) => { offline = value; }, setUnavailable: (value: boolean) => { unavailable = value; },
    async event(name: string) { let pending: Promise<unknown> | undefined; listeners.get(name)!({ waitUntil: (value: Promise<unknown>) => { pending = value; } }); await pending; },
    request(path: string, mode = 'cors', method = 'GET'): Promise<Response> | undefined {
      let response: Promise<Response> | undefined;
      listeners.get('fetch')!({ request: { url: new URL(path, 'https://space.test').href, mode, method }, respondWith: (value: Promise<Response>) => { response = value; } });
      return response;
    },
  };
}

test('service worker precaches the shell, all lazy and worker chunks, and public assets', async () => {
  const app = await worker(); await app.event('install');
  for (const path of ['/index.html', '/assets/main.js', '/assets/ModelWorkshop.js', '/assets/boolean.worker.js', '/assets/main.css', '/favicon.svg', '/environments/sunset-fairway-1k.hdr']) assert.ok(app.calls.includes(path), path);
  assert.ok(!app.calls.some(path => path.endsWith('.md') || path.startsWith('/api/')));
  await app.event('activate'); assert.ok(!app.entries.has('3d-space-static-old')); assert.ok(app.entries.has('unrelated-app'));
});

test('service worker never intercepts API, external, mutations, or unknown paths', async () => {
  const app = await worker();
  for (const path of ['/api', '/api/auth/session', '/api/rooms/room?secret=1', '/api/models/private', 'https://another.test/assets/main.js', '/unknown.js']) assert.equal(app.request(path), undefined);
  assert.equal(app.request('/assets/main.js', 'cors', 'POST'), undefined);
  assert.equal(app.calls.length, 0);
});

test('offline navigation returns the cached shell and lazy editor modules without fetching', async () => {
  const app = await worker(); await app.event('install'); const before = app.calls.length; app.setOffline(true);
  for (const path of ['/', '/editor?room=id&setup=1', '/designs', '/login', '/privacy', '/terms']) {
    const response = await app.request(path, 'navigate'); assert.equal(response?.status, 200); assert.equal(await response?.text(), '<html>3D Space</html>');
  }
  assert.equal((await app.request('/assets/ModelWorkshop.js'))?.status, 200); assert.equal(app.calls.length, before);
});

test('HTML responses for script resources never enter a successful cache', async () => {
  const failed = await worker({ badScript: true }); await assert.rejects(failed.event('install'), /Static resource unavailable/);
  assert.ok(![...failed.entries.keys()].some(key => key.startsWith('3d-space-static-') && key !== '3d-space-static-old'));
  const app = await worker({ badScript: true }), response = await app.request('/assets/main.js');
  assert.equal(response?.status, 503);
  assert.ok([...app.entries.values()].every(cache => !cache.has('/assets/main.js')));
});

test('temporary server errors cannot replace the cached application shell or lazy modules', async () => {
  const app = await worker(); await app.event('install'); const before = app.calls.length; app.setUnavailable(true);
  assert.equal(await (await app.request('/editor/?room=id', 'navigate'))?.text(), '<html>3D Space</html>');
  assert.equal((await app.request('/assets/ModelWorkshop.js'))?.status, 200);
  assert.equal(app.calls.length, before);
});
