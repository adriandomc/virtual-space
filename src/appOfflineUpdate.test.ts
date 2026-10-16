import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { planUpdateActivityReason } from './planDraft';

const source = readFile(new URL('./appOffline.ts', import.meta.url), 'utf8').then(text => ts.transpileModule(text.replaceAll('import.meta.env?.PROD', 'true').replaceAll('import.meta.env?.VITE_BUILD_ID', '"test-build"'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText);

async function app(options: { activeBuild?: string; waiting?: boolean; statusGate?: Promise<void>; versions?: string[]; uncontrolled?: boolean; legacy?: boolean; forced?: boolean; missingRegistration?: boolean } = {}) {
  const listeners = new Map<string, Function>(), pending: { message: { type: string; id: string }; reply: (value: unknown) => void }[] = [];
  const exports: Record<string, any> = {};
  let forced = !!options.forced, reloads = 0, idle = false, storedPending = false, activity = '', version = 'current';
  let startupListener: (() => void) | undefined;
  const registration = {
    active: { postMessage: (message: { type: string }, ports: { postMessage(value: unknown): void }[]) => { const reply = () => ports[0].postMessage({ ready: true, build: options.legacy ? undefined : options.activeBuild ?? 'test-build' }); if (message.type === 'SPACE_STATUS' && options.statusGate) void options.statusGate.then(reply); else reply(); } },
    waiting: options.waiting === false ? null : { postMessage: (message: { type: string; id: string }, ports: { postMessage(value: unknown): void }[]) => pending.push({ message, reply: value => ports[0].postMessage(value) }) } as object | null,
    addEventListener() {},
  };
  vm.runInNewContext(await source, {
    exports, module: { exports }, Error, crypto, setTimeout, clearTimeout,
    require: (name: string) => {
      if (name === './offlineMode') return { offlineForced: () => forced, refreshOfflineMode: async () => {}, offlineFetch: async () => ({ ok: false }) };
      if (name === './appActivity') return { setAppVersion: (value: string) => { version = value; options.versions?.push(value); }, appActivityReason: () => activity, appStartupIdle: () => idle && !activity, subscribeAppStartup: (callback: () => void) => { startupListener = callback; } };
      if (name === './offlinePending') return { hasStoredOfflineChanges: async () => storedPending };
      if (name === './retiredStorage') return { retireTestStorage: async () => {} };
      throw new Error('Unexpected test dependency: ' + name);
    },
    MessageChannel: class {
      port1: { onmessage?: (event: { data: unknown }) => void; close(): void } = { close() {} };
      port2 = { postMessage: (data: unknown) => this.port1.onmessage?.({ data }) };
    },
    navigator: { onLine: true, serviceWorker: { get controller() { return options.uncontrolled ? null : registration.active; }, getRegistration: async () => options.missingRegistration ? undefined : registration, register: async () => registration, addEventListener: (type: string, callback: Function) => listeners.set(type, callback) } },
    window: { matchMedia: () => ({ matches: false }), addEventListener() {}, location: { reload: () => { reloads++; } } },
  });
  await exports.registerAppOffline();
  return {
    api: exports, pending, registration, version: () => version, idle: (value: boolean) => { idle = value; startupListener?.(); }, stored: (value: boolean) => { storedPending = value; }, editing: (value: string) => { activity = value; }, reloads: () => reloads, force: () => { forced = true; },
    message(type: string, id: string, automatic = false) { const replies: any[] = []; listeners.get('message')!({ data: { type, id, automatic }, ports: [{ postMessage(value: unknown) { replies.push(value); } }] }); return replies; },
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


test('a clean cold startup requests one automatic update, but stored changes and interaction prevent it', async () => {
  const clean = await app(); clean.idle(true); await new Promise(resolve => setImmediate(resolve));
  assert.equal(clean.pending.length, 1); assert.equal((clean.pending[0].message as any).automatic, true);
  clean.pending[0].reply({ ready: true });
  const pending = await app(); pending.stored(true); pending.idle(true); await new Promise(resolve => setImmediate(resolve)); assert.equal(pending.pending.length, 0);
  const working = await app(); working.idle(false); await new Promise(resolve => setImmediate(resolve)); assert.equal(working.pending.length, 0);
});

test('activity that starts while downloading refuses the automatic save handshake without losing drafts', async () => {
  const value = await app(); value.idle(true); await new Promise(resolve => setImmediate(resolve)); assert.equal(value.pending.length, 1);
  value.idle(false); const replies = value.message('SPACE_SAVE_UPDATE', value.pending[0].message.id, true);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(replies[0].ready, false); assert.equal(value.api.getAppOfflineState().updating, false);
  value.pending[0].reply({ error: 'Continue working' });
});

test('an incomplete field blocks manual update before durable guards run', async () => {
  const value = await app(); value.editing('Finish this field'); let checked = false;
  const unregister = value.api.registerBeforeAppUpdate(async () => { checked = true; }, 'durable');
  try { await assert.rejects(value.api.confirmLocalSaved(), /Finish this field/); assert.equal(checked, false); }
  finally { unregister(); }
});

test('an operation started during flush prevents confirming an obsolete durable checkpoint', async () => {
  const value = await app(); let durable = false;
  const flush = value.api.registerBeforeAppUpdate(async () => { value.editing('An operation started while saving'); });
  const save = value.api.registerBeforeAppUpdate(async () => { durable = true; }, 'durable');
  try { await assert.rejects(value.api.confirmLocalSaved(), /An operation started while saving/); assert.equal(durable, false); }
  finally { flush(); save(); }
});

test('the initiating tab refuses a mode change before its modal can blur an unfinished field', async () => {
  const value = await app(); value.editing('Finish the current field');
  await assert.rejects(value.api.confirmAllLocalSaved(), /Finish the current field/);
  assert.equal(value.api.getAppOfflineState().updating, false);
});

test('an unfinished field refuses save handshakes before a modal freeze can blur or reset it', async () => {
  for (const kind of ['UPDATE', 'MODE']) {
    const value = await app(); value.editing('Finish this field');
    const states: boolean[] = []; const unsubscribe = value.api.subscribeAppOffline(() => states.push(value.api.getAppOfflineState().updating));
    try {
      const replies = value.message('SPACE_SAVE_' + kind, 'incomplete-field');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(replies.length, 1); assert.equal(replies[0].ready, false);
      assert.equal(value.api.getAppOfflineState().error, 'Finish this field');
      assert.ok(states.every(updating => !updating), 'the unfinished field must never become inert or lose focus');
      await assert.rejects(value.api.confirmAllLocalSaved(), /Finish this field/);
      assert.ok(states.every(updating => !updating), 'changing offline mode must use the same preflight');
    } finally { unsubscribe(); }
  }
});

test('plan drafts and active object tools refuse an update without freezing or changing their state', async () => {
  const base = { points: 0, uploading: false, archived: 0, pointers: 0, dragging: false, pending: false, blocked: false };
  for (const activity of [{ points: 2 }, { uploading: true }, { archived: 1 }, { pointers: 1 }, { dragging: true }, { pending: true, blocked: true }]) {
    const value = await app(), draft = { ...base, ...activity }, previous = structuredClone(draft), states: boolean[] = [];
    value.editing(planUpdateActivityReason(draft)); const unsubscribe = value.api.subscribeAppOffline(() => states.push(value.api.getAppOfflineState().updating));
    try {
      const replies = value.message('SPACE_SAVE_UPDATE', 'active-tool'); await new Promise(resolve => setImmediate(resolve));
      assert.equal(replies[0]?.ready, false); assert.ok(states.every(updating => !updating)); assert.deepEqual(draft, previous);
    } finally { unsubscribe(); }
  }
});

test('a build mismatch cannot blur an unfinished field when reloading without a waiting worker', async () => {
  const value = await app({ activeBuild: 'new-build', waiting: false }); value.editing('Finish this field');
  const states: boolean[] = []; const unsubscribe = value.api.subscribeAppOffline(() => states.push(value.api.getAppOfflineState().updating));
  try {
    assert.equal(value.api.getAppOfflineState().update, true);
    await value.api.updateAppOffline();
    assert.equal(value.reloads(), 0); assert.equal(value.api.getAppOfflineState().error, 'Finish this field');
    assert.ok(states.every(updating => !updating));
  } finally { unsubscribe(); }
});

test('a controlled startup checks its worker version before allowing new edits', async () => {
  let release!: () => void; const versions: string[] = [], gate = new Promise<void>(resolve => { release = resolve; });
  const starting = app({ statusGate: gate, versions }); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(versions, ['checking']); release(); const value = await starting; assert.equal(value.version(), 'current');
  const stale = await app({ activeBuild: 'different-build', waiting: false }); assert.equal(stale.version(), 'outdated'); assert.equal(stale.reloads(), 0); assert.equal(stale.api.getAppOfflineState().updating, false);
  const legacy = await app({ legacy: true }); assert.equal(legacy.version(), 'outdated');
});

test('a first visit without a controller remains editable while initial preparation runs', async () => {
  let release!: () => void; const versions: string[] = [], gate = new Promise<void>(resolve => { release = resolve; });
  const starting = app({ uncontrolled: true, statusGate: gate, versions }); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(versions, ['current']); release(); assert.equal((await starting).version(), 'current');
});

test('a controller change blocks new edits synchronously while verifying without freezing existing drafts', async () => {
  const options: { statusGate?: Promise<void>; activeBuild?: string } = {}, value = await app(options);
  let release!: () => void; options.statusGate = new Promise<void>(resolve => { release = resolve; }); options.activeBuild = 'changed-build';
  value.editing('Existing unfinished draft'); value.activate();
  assert.equal(value.version(), 'checking'); assert.equal(value.api.getAppOfflineState().updating, false); assert.equal(value.reloads(), 0);
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(value.version(), 'outdated'); await assert.rejects(value.api.confirmLocalSaved(), /Existing unfinished draft/);
  assert.equal(value.api.getAppOfflineState().updating, false); assert.equal(value.reloads(), 0);
});

test('a missing forced-mode registration never leaves a controlled page checking indefinitely', async () => {
  const value = await app({ forced: true, missingRegistration: true });
  assert.equal(value.version(), 'outdated'); assert.equal(value.api.getAppOfflineState().update, true); assert.equal(value.reloads(), 0);
});
