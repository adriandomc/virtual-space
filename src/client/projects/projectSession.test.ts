import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { clearOffline, getOfflineAccess, readOffline, writeOffline } from '../offline/offlineStorage';
import { createDesignLocal, persistOfflineProject } from '../offline/repository';
import { bootstrapOfflineMode, offlineForced, refreshOfflineMode, setOfflineMode } from '../offline/offlineMode';
import { readOfflineProject, type OfflineProjectRecord } from '../offline/offlineProject';
import { ProjectSession, type ProjectSessionState } from './projectSession';
import { syncOfflineAccount } from '../offline/sync';

const owner = { id: '031f3902-316e-4233-931b-6e3776ba8ae6', username: 'owner', verifiedAt: Date.now() };
const target = Object.assign(new EventTarget(), { location: new URL('https://3d.example.test/editor') });
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

class TestLocks {
  held = new Set<string>();
  async request(name: string, _options: LockOptions, work: (lock: Lock | null) => Promise<unknown>) {
    const acquired = !this.held.has(name);
    if (acquired) this.held.add(name);
    try { return await work(acquired ? { name, mode: 'exclusive' } : null); }
    finally { if (acquired) this.held.delete(name); }
  }
}
function session(id: string) {
  const states: ProjectSessionState[] = [], events = { identity: 0, restarts: 0 };
  const value = new ProjectSession(id, { changed: state => states.push(state), recovery: () => {}, identityChanged: () => { events.identity++; }, restart: () => { events.restarts++; } });
  return { value, states, events };
}
async function setup(forced = true) {
  if (offlineForced()) await setOfflineMode(false);
  await clearOffline(); await writeOffline('meta', 'identity', owner); await refreshOfflineMode();
  const { id } = await createDesignLocal();
  await writeOffline('meta', 'prepared:' + owner.id, { accountId: owner.id, complete: true });
  if (forced) await setOfflineMode(true);
  await bootstrapOfflineMode();
  return id;
}

test('project sessions isolate locks, account changes, forced-offline events and stale startup responses', async t => {
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const locksDescriptor = Object.getOwnPropertyDescriptor(navigator, 'locks');
  const fetch = globalThis.fetch, locks = new TestLocks();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks });
  try {
    await t.test('offline edits are durable and online/focus events make zero requests', async () => {
      const id = await setup(); let requests = 0;
      globalThis.fetch = async () => { requests++; throw new Error('No network allowed'); };
      const f = session(id);
      try {
        await f.value.start();
        assert.equal(f.value.state.canEdit, true); assert.equal(f.value.state.status, 'offline');
        assert.equal(f.value.change({ ...f.value.state.project, name: 'Durable offline work' }), true);
        assert.equal(f.value.hasUndurableWork, true);
        await f.value.assertDurable();
        assert.equal(f.value.hasUndurableWork, false);
        let retries = 0;
        const solo = f.value.solo!, retry = solo.retry.bind(solo);
        solo.retry = async () => { retries++; await retry(); };
        target.dispatchEvent(new Event('online')); target.dispatchEvent(new Event('focus')); await tick();
        assert.equal(retries, 0);
        f.value.retry(); await f.value.assertDurable(); assert.equal(retries, 1, 'manual retry still retries local durability while forced offline');
        assert.equal(requests, 0); assert.equal((await readOfflineProject(id))?.draft?.name, 'Durable offline work');
        assert.ok(getOfflineAccess(id)?.allowed);
      } finally { await f.value.destroy(); }
      assert.equal(locks.held.size, 0); assert.equal(getOfflineAccess(id), undefined);
      assert.equal(f.value.change(f.value.state.project), false);
    });

    await t.test('a second tab cannot acquire or release the first tab editing lock', async () => {
      const id = await setup(), first = session(id), second = session(id), third = session(id);
      try {
        await first.value.start(); await second.value.start();
        assert.equal(first.value.state.canEdit, true); assert.equal(second.value.state.canEdit, false);
        assert.match(second.value.state.error, /otra pestaña/);
        await second.value.destroy(); assert.equal(locks.held.size, 1);
        await first.value.destroy(); await third.value.start(); assert.equal(third.value.state.canEdit, true);
      } finally { await Promise.all([first.value.destroy(), second.value.destroy(), third.value.destroy()]); }
      assert.equal(locks.held.size, 0);
    });

    await t.test('changing account revokes the open session without deleting its durable draft', async () => {
      const id = await setup(), f = session(id);
      try {
        await f.value.start(); f.value.change({ ...f.value.state.project, name: 'Owner work' }); await f.value.assertDurable();
        await writeOffline('meta', 'identity', { ...owner, id: '596872d9-a61a-452c-96b6-98bcc70988e9' });
        await tick();
        assert.equal(f.events.identity, 1); assert.equal(f.value.state.canEdit, false); assert.equal(f.value.state.ready, false);
        assert.equal(f.value.solo, null); assert.equal(locks.held.size, 0); assert.equal(getOfflineAccess(id), undefined);
        const stored = await readOffline<OfflineProjectRecord>('projects', owner.id + ':' + id);
        assert.equal(stored?.draft?.name, 'Owner work');
        const updates = f.states.length; target.dispatchEvent(new Event('focus')); await tick(); assert.equal(f.states.length, updates);
      } finally { await f.value.destroy(); }
    });

    await t.test('a mode change releases the session before requesting a restart', async () => {
      const id = await setup(), f = session(id);
      try {
        await f.value.start(); await setOfflineMode(false);
        for (let i = 0; i < 10 && !f.events.restarts; i++) await tick();
        assert.equal(f.events.restarts, 1); assert.equal(locks.held.size, 0); assert.equal(f.value.solo, null);
      } finally { await f.value.destroy(); }
    });

    await t.test('reopening online waits for the running account sync instead of treating its temporary lock as another editor', async () => {
      const id = await setup(false), record = (await readOfflineProject(id))!;
      record.localOnly = false; record.snapshot.revision = 1; record.draft = { ...record.snapshot.project, name: 'Offline painted design' }; await persistOfflineProject(record);
      let remote = structuredClone(record.snapshot), enter!: () => void, release!: () => void, first = true;
      const entered = new Promise<void>(accept => { enter = accept; }), blocked = new Promise<void>(accept => { release = accept; });
      const requests: string[] = [];
      globalThis.fetch = async (input, options) => {
        const path = String(input); requests.push((options?.method ?? 'GET') + ' ' + path);
        if (path === '/api/auth/session') return new Response(JSON.stringify({ user: owner }));
        if (path === '/api/rooms/' + id) {
          if (options?.method === 'PUT') { remote = { ...remote, project: JSON.parse(String(options.body)).project, revision: remote.revision + 1 }; return new Response(JSON.stringify(remote)); }
          if (first) { first = false; enter(); await blocked; }
          return new Response(JSON.stringify(remote));
        }
        throw new Error('Unexpected request: ' + path);
      };
      const syncing = syncOfflineAccount(), f = session(id);
      try {
        await entered; assert.equal(locks.held.size, 1);
        const starting = f.value.start();
        for (let index = 0; index < 5; index++) await tick();
        assert(!f.states.some(state => /otra pestaña/.test(state.error)), 'the ongoing sync is not another editor');
        release(); await syncing; await starting;
        assert.equal(f.value.state.canEdit, true); assert.equal(f.value.state.project.name, 'Offline painted design');
        assert.equal(remote.project.name, 'Offline painted design');
        assert.equal(requests.filter(request => request.startsWith('PUT ')).length, 1);
      } finally { release(); await syncing; await f.value.destroy(); }
    });

    await t.test('a failed background sync keeps the pending local design editable after startup waits', async () => {
      const id = await setup(false), record = (await readOfflineProject(id))!;
      record.localOnly = false; record.snapshot.revision = 1; record.draft = { ...record.snapshot.project, name: 'Preserved offline paint' }; await persistOfflineProject(record);
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>(accept => { enter = accept; }), blocked = new Promise<void>(accept => { release = accept; });
      globalThis.fetch = async () => { enter(); await blocked; throw new TypeError('Network interrupted'); };
      const syncing = syncOfflineAccount(), rejected = assert.rejects(syncing, /No se pudo conectar/), f = session(id);
      try {
        await entered; const starting = f.value.start(); await tick(); release(); await rejected; await starting;
        assert.equal(f.value.state.canEdit, true); assert.equal(f.value.state.status, 'offline');
        assert.equal(f.value.state.project.name, 'Preserved offline paint'); assert.equal((await readOfflineProject(id))?.draft?.name, 'Preserved offline paint');
      } finally { release(); await rejected; await f.value.destroy(); }
    });

    await t.test('an expired online session keeps the prepared draft editable locally', async () => {
      const id = await setup(false), record = (await readOfflineProject(id))!;
      record.localOnly = false; record.snapshot.revision = 1; record.draft = null; await persistOfflineProject(record);
      globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Session expired' }), { status: 401 });
      const f = session(id);
      try {
        await f.value.start(); assert.equal(f.value.state.canEdit, true); assert.equal(f.value.state.status, 'offline');
        assert.match(f.value.state.error, /sesión terminó/);
      } finally { await f.value.destroy(); }
    });

    await t.test('a response arriving after teardown cannot reopen or publish the old session', async () => {
      const id = await setup(false), record = (await readOfflineProject(id))!;
      record.localOnly = false; record.snapshot.revision = 1; record.draft = null; await persistOfflineProject(record);
      let complete!: (response: Response) => void, started!: () => void;
      const requested = new Promise<void>(resolve => { started = resolve; });
      globalThis.fetch = () => { started(); return new Promise<Response>(resolve => { complete = resolve; }); };
      const f = session(id), opening = f.value.start();
      await requested; await f.value.destroy(); const updates = f.states.length;
      complete(new Response(JSON.stringify(record.snapshot))); await opening;
      assert.equal(f.states.length, updates); assert.equal(f.value.live, null); assert.equal(f.value.solo, null); assert.equal(locks.held.size, 0);
    });

    await t.test('an in-flight live sketch blocks the durable PWA update check', async () => {
      const f = session('live-sketch');
      try {
        f.value.setSketchSaving(true);
        assert.equal(f.value.hasUndurableWork, true); await assert.rejects(f.value.assertDurable(), /croquis|guardarse/);
        f.value.setSketchSaving(false); await f.value.assertDurable(); assert.equal(f.value.hasUndurableWork, false);
      } finally { await f.value.destroy(); }
    });
  } finally {
    globalThis.fetch = fetch;
    if (offlineForced()) await setOfflineMode(false);
    await clearOffline();
    if (windowDescriptor) Object.defineProperty(globalThis, 'window', windowDescriptor); else Reflect.deleteProperty(globalThis, 'window');
    if (locksDescriptor) Object.defineProperty(navigator, 'locks', locksDescriptor); else Reflect.deleteProperty(navigator, 'locks');
  }
});
