import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = readFile(new URL('./appOffline.ts', import.meta.url), 'utf8').then(text => ts.transpileModule(text.replaceAll('import.meta.env?.PROD', 'true'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);

async function app() {
  const listeners = new Map<string, Function>(), pending: { message: { type: string; id: string }; reply: (value: unknown) => void }[] = [];
  const exports: Record<string, any> = {};
  let forced = false, reloads = 0;
  const registration = {
    active: { postMessage: (_message: unknown, ports: { postMessage(value: unknown): void }[]) => ports[0].postMessage({ ready: true }) },
    waiting: { postMessage: (message: { type: string; id: string }, ports: { postMessage(value: unknown): void }[]) => pending.push({ message, reply: value => ports[0].postMessage(value) }) } as object | null,
    addEventListener() {},
  };
  vm.runInNewContext(await source, {
    exports, module: { exports }, Error, crypto, setTimeout, clearTimeout,
    require: (name: string) => {
      if (name === './offlineMode') return { offlineForced: () => forced, refreshOfflineMode: async () => {}, offlineFetch: async () => ({ ok: false }) };
      if (name === './retiredStorage') return { retireTestStorage: async () => {} };
      throw new Error('Unexpected test dependency: ' + name);
    },
    MessageChannel: class {
      port1: { onmessage?: (event: { data: unknown }) => void; close(): void } = { close() {} };
      port2 = { postMessage: (data: unknown) => this.port1.onmessage?.({ data }) };
    },
    navigator: { onLine: true, serviceWorker: { controller: registration.active, register: async () => registration, addEventListener: (type: string, callback: Function) => listeners.set(type, callback) } },
    window: { matchMedia: () => ({ matches: false }), addEventListener() {}, location: { reload: () => { reloads++; } } },
  });
  await exports.registerAppOffline();
  return {
    api: exports, pending, registration, reloads: () => reloads, force: () => { forced = true; },
    message(type: string, id: string) { const replies: any[] = []; listeners.get('message')!({ data: { type, id }, ports: [{ postMessage(value: unknown) { replies.push(value); } }] }); return replies; },
    activate() { registration.waiting = null; listeners.get('controllerchange')!(); },
  };
}

test('update actions share one worker request without freezing editing during downloads', async () => {
  const value = await app();
  const banner = value.api.updateAppOffline(), settings = value.api.updateAppOffline();
  assert.equal(banner, settings);
  assert.equal(value.pending.length, 1);
  assert.equal(value.pending[0].message.type, 'SPACE_UPDATE');
  assert.equal(value.api.getAppOfflineState().updating, false);
  value.pending[0].reply({ error: 'Download failed' }); await Promise.all([banner, settings]);
  assert.equal(value.api.getAppOfflineState().error, 'Download failed');
  const retry = value.api.updateAppOffline(); assert.equal(value.pending.length, 2);
  value.pending[1].reply({ ready: true }); await retry;
});

test('an update failure cannot release another update or mode freeze', async () => {
  for (const kind of ['UPDATE', 'MODE']) {
    const value = await app(), request = value.api.updateAppOffline();
    value.message('SPACE_SAVE_' + kind, 'other-operation');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(value.api.getAppOfflineState().updating, true);
    value.pending[0].reply({ error: 'Another request failed' }); await request;
    assert.equal(value.api.getAppOfflineState().updating, true);
    value.message(kind === 'UPDATE' ? 'SPACE_CANCEL_UPDATE' : 'SPACE_RELEASE_MODE', 'unrelated-operation');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(value.api.getAppOfflineState().updating, true);
    value.message(kind === 'UPDATE' ? 'SPACE_CANCEL_UPDATE' : 'SPACE_RELEASE_MODE', 'other-operation');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(value.api.getAppOfflineState().updating, false);
  }
});

test('first activation clears the transient waiting notice without reloading a saved page', async () => {
  const value = await app(); assert.equal(value.api.getAppOfflineState().update, true);
  value.activate();
  assert.equal(value.api.getAppOfflineState().update, false);
  assert.equal(value.reloads(), 0);
});

test('forced offline mode does not send update requests', async () => {
  const value = await app(); value.force(); await value.api.updateAppOffline();
  assert.equal(value.pending.length, 0);
});

test('entering forced offline during download refuses the later update save handshake', async () => {
  const value = await app(), request = value.api.updateAppOffline();
  assert.equal(value.pending.length, 1);
  value.force();
  const replies = value.message('SPACE_SAVE_UPDATE', value.pending[0].message.id);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(replies.length, 1); assert.equal(replies[0].ready, false);
  assert.equal(value.api.getAppOfflineState().updating, false);
  value.pending[0].reply({ error: 'Update refused' }); await request;
  assert.equal(value.reloads(), 0); assert.equal(value.api.getAppOfflineState().update, true);
});
