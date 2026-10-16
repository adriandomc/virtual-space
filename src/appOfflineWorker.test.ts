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

type Tab = { id: string; result: 'ready' | 'unsaved' | 'silent' | 'discarded'; messages: string[]; acknowledge?: () => void };
async function worker(options: { badScript?: boolean; offline?: boolean; tabs?: Tab[] } = {}) {
  const listeners = new Map<string, Function>(), entries = new Map<string, Map<string, Response>>(), calls: string[] = [], matches: string[] = [];
  entries.set('unrelated-app', new Map()); entries.set('3d-space-static-old', new Map()); entries.set('3d-space-v2-static-previous', new Map());
  const timers = new Map<number, () => void>(); let timerId = 0, activated = 0;
  let tabs = options.tabs ?? [];
  const caches = {
    async open(name: string) {
      let cache = entries.get(name); if (!cache) { cache = new Map(); entries.set(name, cache); }
      return { put: async (path: string, response: Response) => { cache!.set(path, response.clone()); }, match: async (path: string) => { matches.push(path); return cache!.get(path)?.clone(); } };
    },
    async keys() { return [...entries.keys()]; },
    async delete(name: string) { return entries.delete(name); },
  };
  let offline = options.offline ?? false;
  let unavailable = false;
  vm.runInNewContext(await source, {
    URL, Response, caches,
    setTimeout: (callback: () => void) => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => timers.delete(id),
    MessageChannel: class {
      port1: { onmessage?: (event: { data: unknown }) => void; close(): void } = { close() {} };
      port2 = { postMessage: (data: unknown) => this.port1.onmessage?.({ data }) };
    },
    fetch: async (path: string, init?: RequestInit) => {
      calls.push(path); assert.equal(init?.credentials, 'omit');
      if (offline) throw new TypeError('offline');
      if (unavailable) return new Response('Temporary outage', { status: 503, headers: { 'content-type': 'text/html' } });
      const mime = path.endsWith('.js') ? options.badScript && path.endsWith('main.js') ? 'text/html' : 'application/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.html') ? 'text/html' : 'application/octet-stream';
      return new Response(path.endsWith('.html') ? '<html>3D Space</html>' : path, { headers: { 'content-type': mime } });
    },
    self: {
      location: { origin: 'https://space.test' },
      skipWaiting: async () => { activated++; },
      clients: {
        claim: async () => {},
        matchAll: async (criteria: unknown) => {
          assert.equal(JSON.stringify(criteria), JSON.stringify({ type: 'window', includeUncontrolled: true }));
          return tabs.map(tab => ({
            id: tab.id,
            postMessage: (message: { type: string }, ports?: { postMessage(data: unknown): void }[]) => {
              tab.messages.push(message.type);
              if (tab.result === 'discarded') throw new Error('The tab was discarded.');
              if (message.type !== 'SPACE_SAVE_UPDATE' && message.type !== 'SPACE_SAVE_MODE') return;
              if (tab.result === 'ready') ports?.[0].postMessage({ ready: true });
              else if (tab.result === 'unsaved') ports?.[0].postMessage({ ready: false });
              else tab.acknowledge = () => ports?.[0].postMessage({ ready: true });
            },
          }));
        },
      },
      addEventListener: (name: string, listener: Function) => listeners.set(name, listener),
    },
  });
  return {
    entries, calls, matches, activated: () => activated, setTabs: (value: Tab[]) => { tabs = value; },
    setOffline: (value: boolean) => { offline = value; }, setUnavailable: (value: boolean) => { unavailable = value; },
    fireTimeouts() { for (const [id, callback] of timers) { timers.delete(id); callback(); } },
    message(type: string, id: string = crypto.randomUUID()) {
      const replies: { ready?: boolean; error?: string }[] = []; let pending: Promise<unknown> | undefined;
      listeners.get('message')!({ data: { type, id }, ports: [{ postMessage: (value: { ready?: boolean; error?: string }) => replies.push({ ...value }) }], waitUntil: (value: Promise<unknown>) => { pending = value; } });
      return { replies, complete: () => pending };
    },
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
  for (const path of ['/index.html', '/assets/main.js', '/assets/ModelWorkshop.js', '/assets/boolean.worker.js', '/assets/main.css', '/favicon.svg', '/environments/sunset-fairway-1k.hdr', '/manifest.es.webmanifest', '/manifest.en.webmanifest']) assert.ok(app.calls.includes(path), path);
  for (const locale of ['es', 'en']) for (const image of ['library', 'setup', 'editor', 'workshop', 'offline', 'sharing']) assert.ok(app.calls.includes(`/help/${locale}/${image}.jpg`));
  assert.ok(!app.calls.some(path => path.endsWith('.md') || path.startsWith('/api/')));
  await app.event('activate'); assert.ok(!app.entries.has('3d-space-static-old')); assert.ok(!app.entries.has('3d-space-v2-static-previous')); assert.ok(app.entries.has('unrelated-app'));
});

test('service worker never intercepts API, external, mutations, or unknown paths', async () => {
  const app = await worker();
  for (const path of ['/api', '/api/auth/session', '/api/rooms/room?secret=1', '/api/models/private', 'https://another.test/assets/main.js', '/unknown.js']) assert.equal(app.request(path), undefined);
  assert.equal(app.request('/embed?room=public-room', 'navigate'), undefined);
  assert.equal(app.request('/assets/main.js', 'cors', 'POST'), undefined);
  assert.equal(app.calls.length, 0);
});

test('offline navigation returns the cached shell and lazy editor modules without fetching', async () => {
  const app = await worker(); await app.event('install'); const before = app.calls.length; app.setOffline(true);
  for (const path of ['/', '/editor?room=id&setup=1', '/designs', '/login', '/privacy', '/terms', '/help']) {
    const response = await app.request(path, 'navigate'); assert.equal(response?.status, 200); assert.equal(await response?.text(), '<html>3D Space</html>');
  }
  assert.equal((await app.request('/assets/ModelWorkshop.js'))?.status, 200); assert.equal(app.calls.length, before);
});

test('HTML responses for script resources never enter a successful cache', async () => {
  const failed = await worker({ badScript: true }); await assert.rejects(failed.event('install'), /Static resource unavailable/);
  assert.ok(![...failed.entries.keys()].some(key => key.startsWith('3d-space-v2-static-') && key !== '3d-space-v2-static-previous'));
  const app = await worker({ badScript: true }), response = await app.request('/assets/main.js');
  assert.equal(response?.status, 503);
  assert.ok([...app.entries.values()].every(cache => !cache.has('/assets/main.js')));
});

test('availability checks every cached dependency, including modules, material assets and shell, without consulting the network', async () => {
  const app = await worker(); await app.event('install'); const requests = app.calls.length;
  const cache = [...app.entries].find(([key]) => key.startsWith('3d-space-v2-static-') && key !== '3d-space-v2-static-previous')![1];
  const status = app.message('SPACE_STATUS'); await status.complete();
  assert.deepEqual(status.replies, [{ ready: true }]);
  assert.deepEqual(new Set(app.matches), new Set(cache.keys()));
  for (const path of ['/index.html', '/assets/ModelWorkshop.js', '/environments/sunset-fairway-1k.hdr']) {
    const saved = cache.get(path)!; cache.delete(path);
    const missing = app.message('SPACE_STATUS'); await missing.complete();
    assert.deepEqual(missing.replies, [{ ready: false }], path); cache.set(path, saved);
  }
  assert.equal(app.calls.length, requests);
});

test('an update activates only after every open tab confirms durable data and activation then retires obsolete caches', async () => {
  const ready: Tab = { id: 'ready', result: 'ready', messages: [] }, delayed: Tab = { id: 'delayed', result: 'silent', messages: [] };
  const app = await worker({ tabs: [ready, delayed] }); await app.event('install');
  const update = app.message('SPACE_UPDATE'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.activated(), 0); assert.deepEqual(update.replies, []);
  assert.deepEqual(ready.messages, ['SPACE_SAVE_UPDATE']); assert.deepEqual(delayed.messages, ['SPACE_SAVE_UPDATE']);
  assert.ok(app.entries.has('3d-space-v2-static-previous'));
  delayed.acknowledge!(); await update.complete();
  assert.equal(app.activated(), 1); assert.deepEqual(update.replies, [{ ready: true }]);
  assert.ok(app.entries.has('3d-space-v2-static-previous'), 'waiting for client durability never prunes the active application');
  await app.event('activate'); assert.ok(!app.entries.has('3d-space-v2-static-previous')); assert.ok(app.entries.has('unrelated-app'));
});

test('unsaved, closed or discarded tabs refuse the update, preserve active resources, and allow retry after closing the blocking tab', async () => {
  for (const result of ['unsaved', 'silent', 'discarded'] as const) {
    const ready: Tab = { id: 'saved', result: 'ready', messages: [] }, blocked: Tab = { id: 'blocking', result, messages: [] };
    const app = await worker({ tabs: [ready, blocked] }); await app.event('install');
    const update = app.message('SPACE_UPDATE'); await new Promise(resolve => setImmediate(resolve));
    if (result === 'silent') app.fireTimeouts();
    await update.complete();
    assert.equal(app.activated(), 0, result); assert.ok(update.replies[0]?.error, result);
    assert.ok(ready.messages.includes('SPACE_CANCEL_UPDATE'), result);
    assert.ok(app.entries.has('3d-space-static-old')); assert.ok(app.entries.has('3d-space-v2-static-previous'));
    blocked.acknowledge?.(); await new Promise(resolve => setImmediate(resolve)); assert.equal(app.activated(), 0, 'a late acknowledgement cannot activate a refused update');
    app.setTabs([ready]); const retry = app.message('SPACE_UPDATE'); await retry.complete();
    assert.equal(app.activated(), 1); assert.deepEqual(retry.replies, [{ ready: true }]);
  }
});

test('an incomplete waiting application refuses activation before requesting client saves', async () => {
  const tab: Tab = { id: 'saved', result: 'ready', messages: [] };
  const app = await worker({ tabs: [tab] }); await app.event('install');
  const cache = [...app.entries].find(([key]) => key.startsWith('3d-space-v2-static-') && key !== '3d-space-v2-static-previous')![1];
  cache.delete('/assets/ModelWorkshop.js');
  const update = app.message('SPACE_UPDATE'); await update.complete();
  assert.equal(app.activated(), 0); assert.ok(update.replies[0]?.error); assert.ok(!tab.messages.includes('SPACE_SAVE_UPDATE'));
  assert.ok(app.entries.has('3d-space-v2-static-previous'));
});

test('temporary server errors cannot replace the cached application shell or lazy modules', async () => {
  const app = await worker(); await app.event('install'); const before = app.calls.length; app.setUnavailable(true);
  assert.equal(await (await app.request('/editor/?room=id', 'navigate'))?.text(), '<html>3D Space</html>');
  assert.equal((await app.request('/assets/ModelWorkshop.js'))?.status, 200);
  assert.equal(app.calls.length, before);
});

test('mode transitions save every tab and keep them frozen until explicitly released without activating a worker', async () => {
  const ready: Tab = { id: 'ready', result: 'ready', messages: [] }, delayed: Tab = { id: 'delayed', result: 'silent', messages: [] };
  const app = await worker({ tabs: [ready, delayed] }); await app.event('install');
  const saving = app.message('SPACE_SAVE_ALL', 'mode-transition'); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(saving.replies, []); assert.deepEqual(ready.messages, ['SPACE_SAVE_MODE']);
  assert.deepEqual(delayed.messages, ['SPACE_SAVE_MODE']); assert.equal(app.activated(), 0);
  delayed.acknowledge!(); await saving.complete();
  assert.deepEqual(saving.replies, [{ ready: true }]);
  assert.deepEqual(ready.messages, ['SPACE_SAVE_MODE'], 'a successful preflight keeps every tab frozen until mode publication');
  const release = app.message('SPACE_RELEASE_SAVED', 'mode-transition'); await release.complete();
  assert.deepEqual(release.replies, [{ ready: true }]);
  assert.deepEqual(ready.messages, ['SPACE_SAVE_MODE', 'SPACE_RELEASE_MODE']);
  assert.deepEqual(delayed.messages, ['SPACE_SAVE_MODE', 'SPACE_RELEASE_MODE']);
  assert.equal(app.activated(), 0); assert.ok(app.entries.has('3d-space-v2-static-previous'));
});

test('unsaved geometry, unacknowledged edits and discarded tabs refuse mode changes and release all freezes', async () => {
  for (const result of ['unsaved', 'silent', 'discarded'] as const) {
    const saved: Tab = { id: 'saved', result: 'ready', messages: [] }, blocked: Tab = { id: 'blocked', result, messages: [] };
    const app = await worker({ tabs: [saved, blocked] }); await app.event('install');
    const mode = app.message('SPACE_SAVE_ALL', 'rejected-mode'); await new Promise(resolve => setImmediate(resolve));
    if (result === 'silent') app.fireTimeouts();
    await mode.complete();
    assert.ok(mode.replies[0]?.error, result); assert.notEqual(mode.replies[0]?.ready, true);
    assert.ok(saved.messages.includes('SPACE_RELEASE_MODE'), result);
    assert.ok(blocked.messages.includes('SPACE_RELEASE_MODE'), result);
    blocked.acknowledge?.(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.activated(), 0); assert.equal(mode.replies.length, 1);
    assert.ok(app.entries.has('3d-space-v2-static-previous'));
  }
});
