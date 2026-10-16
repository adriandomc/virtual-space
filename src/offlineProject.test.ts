import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProject } from './projectDocument';
import { AccountRequestError } from './accountApi';
import { SoloProject, validateOfflineProject, type OfflineProjectRecord, type SoloStatus } from './offlineProject';
import type { ProjectSnapshot } from './liveProject';

const delay = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(start?: OfflineProjectRecord) {
  let server: ProjectSnapshot = { id: 'room', accountId: 'owner', offlineAllowed: true, role: 'owner', canEdit: true, canManage: true, shared: false, revision: 1, structureRevision: 1, structureRevisions: { 'level-ground': 1 }, sketches: { 'level-ground': { hasSketch: false, version: 0, mutationId: null } }, project: createDefaultProject(undefined, undefined, 'room') };
  server.structureRevisions = { [server.project.activeLevelId]: 1 }; server.sketches = { [server.project.activeLevelId]: { hasSketch: false, version: 0, mutationId: null } };
  const state = { connected: true, status: 'saved' as SoloStatus, message: '', persisted: undefined as OfflineProjectRecord | undefined, puts: 0, assets: 0, sketches: 0, collaborative: false, failAfterPut: false, failAfterSketch: false, denied: 0, beforePut: undefined as (() => Promise<void>) | undefined, beforeSketch: undefined as (() => Promise<void>) | undefined };
  const initial = start ?? { id: 'room', accountId: 'owner', snapshot: structuredClone(server), draft: null, authorized: true, updatedAt: Date.now() };
  if (start) server = structuredClone(start.snapshot);
  const deps = {
    persist: async (record: OfflineProjectRecord) => { state.persisted = structuredClone(record); },
    get: async () => {
      if (state.denied) throw new AccountRequestError('Sin acceso', state.denied);
      if (!state.connected) throw new AccountRequestError('Sin conexión');
      return structuredClone(server);
    },
    assets: async (room: ProjectSnapshot['project']) => { state.assets++; return room; },
    put: async (room: ProjectSnapshot['project'], revision: number) => {
      state.puts++; await state.beforePut?.();
      assert.equal(revision, server.revision);
      server = { ...server, project: structuredClone(room), revision: server.revision + 1 };
      if (state.failAfterPut) { state.failAfterPut = false; state.connected = false; throw new AccountRequestError('Confirmación perdida'); }
      return structuredClone(server);
    },
    sketch: async (draft: { id: string; blob: Blob | null }) => {
      state.sketches++; await state.beforeSketch?.();
      server = { ...server, sketches: { ...server.sketches, [server.project.activeLevelId]: { version: server.sketches[server.project.activeLevelId].version + 1, hasSketch: Boolean(draft.blob), mutationId: draft.id } } };
      if (state.failAfterSketch) { state.failAfterSketch = false; state.connected = false; throw new AccountRequestError('Confirmación perdida'); }
      return server.sketches[server.project.activeLevelId];
    },
    changed: (_record: OfflineProjectRecord, status: SoloStatus, message: string) => { state.status = status; state.message = message; },
    collaborative: () => { state.collaborative = true; },
  };
  const project = new SoloProject(structuredClone(initial), deps);
  return { state, project, deps, get server() { return server; }, set server(value) { server = value; } };
}

test('offline draft coalesces, survives restart, then saves the final state once', async () => {
  const f = fixture(); await f.project.initialize(true); f.state.connected = false;
  f.project.change({ ...f.server.project, name: 'A' }); f.project.change({ ...f.server.project, name: 'Final' });
  await f.project.retry();
  assert.equal(f.state.status, 'offline'); assert.equal(f.state.persisted!.draft!.name, 'Final'); assert.equal(f.project.durable, true); assert.equal(f.state.puts, 0);
  f.project.destroy();
  const next = fixture(f.state.persisted!); await next.project.initialize(true); await next.project.retry();
  assert.equal(next.server.project.name, 'Final'); assert.equal(next.state.puts, 1); assert.equal(next.project.hasPending, false); assert.equal(next.state.status, 'saved'); next.project.destroy();
});

test('edits while a PUT is in flight are retained and sent after its acknowledgement', async () => {
  const f = fixture(); await f.project.initialize(true);
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.state.beforePut = () => new Promise<void>(resolve => { release = resolve; entered(); });
  f.project.change({ ...f.server.project, name: 'Primero' }); const sync = f.project.retry(); await started;
  f.project.change({ ...f.server.project, name: 'Segundo' }); f.state.beforePut = undefined; release(); await sync;
  assert.equal(f.server.project.name, 'Segundo'); assert.equal(f.state.puts, 2); assert.equal(f.project.hasPending, false); f.project.destroy();
});

test('lost acknowledgement is reconciled after reload without overwriting a newer local draft', async () => {
  const f = fixture(); await f.project.initialize(true); f.state.failAfterPut = true;
  f.project.change({ ...f.server.project, name: 'Aplicado' }); await f.project.retry();
  assert.equal(f.state.status, 'offline'); assert.ok(f.state.persisted!.inflight);
  f.project.change({ ...f.server.project, name: 'Nuevo borrador' }); await f.project.settled(); f.project.destroy();
  const next = fixture(f.state.persisted!); next.server = structuredClone(f.server); await next.project.initialize(true); await next.project.retry();
  assert.equal(next.server.project.name, 'Nuevo borrador'); assert.equal(next.state.puts, 1); assert.equal(next.server.revision, 3); next.project.destroy();
});

test('another device revision blocks uploads and retains a downloadable draft', async () => {
  const f = fixture(); await f.project.initialize(true); f.project.change({ ...f.server.project, name: 'Local' });
  f.server = { ...f.server, revision: 2, project: { ...f.server.project, name: 'Remoto' } }; await f.project.retry();
  assert.equal(f.state.status, 'conflict'); assert.equal(f.state.assets, 0); assert.equal(f.state.puts, 0); assert.equal(f.project.record.draft?.name, 'Local'); assert.equal(f.project.editable, false);
  await f.project.discard(); assert.equal(f.project.record.snapshot.project.name, 'Remoto'); assert.equal(f.project.hasPending, false); f.project.destroy();
});

test('authoritative access rejection never falls back to cached permission', async () => {
  for (const status of [403, 404]) {
    const f = fixture(); await f.project.initialize(true); f.project.change({ ...f.server.project, name: 'Privado' }); f.state.denied = status;
    await f.project.retry(); assert.equal(f.project.record.authorized, false); assert.equal(f.project.editable, false); assert.equal(f.state.persisted!.draft!.name, 'Privado'); assert.equal(f.state.puts, 0); f.project.destroy();
  }
});

test('pending deletion tombstones cannot accept new edits or upload a draft', async () => {
  const f = fixture(); f.project.record.deleted = true; f.project.record.draft = { ...f.server.project, name: 'Do not upload' };
  await f.project.initialize(true);
  assert.equal(f.project.editable, false);
  assert.throws(() => f.project.change({ ...f.server.project, name: 'No' }));
  await assert.rejects(f.project.changeSketch(new Blob(['image']), f.server.project.activeLevelId));
  await f.project.retry();
  assert.equal(f.state.puts, 0); assert.equal(f.state.assets, 0); assert.equal(f.state.sketches, 0);
  assert.match(f.state.message, /eliminarse/); assert.equal(f.project.record.deleted, true); f.project.destroy();
});
test('expired sessions preserve editable local work and require authentication only for synchronization', async () => {
  const f = fixture(); await f.project.initialize(true); f.project.change({ ...f.server.project, name: 'Privado' }); f.state.denied = 401;
  await f.project.retry(); assert.equal(f.project.record.authorized, true); assert.equal(f.project.editable, true); assert.equal(f.state.status, 'offline'); assert.equal(f.state.puts, 0);
  f.project.change({ ...f.server.project, name: 'Continúo aquí' }); await f.project.settled(); assert.equal(f.state.persisted?.draft?.name, 'Continúo aquí'); f.project.destroy();
});

test('pending invites and public sharing prevent offline mutations before even uploading assets', async () => {
  for (const shared of [false, true]) {
    const f = fixture(); await f.project.initialize(true); f.project.change({ ...f.server.project, name: 'Local' });
    f.server = { ...f.server, shared, offlineAllowed: false }; await f.project.retry();
    assert.equal(f.state.status, 'conflict'); assert.equal(f.state.assets, 0); assert.equal(f.state.puts, 0); assert.equal(f.project.record.draft!.name, 'Local'); f.project.destroy();
  }
});

test('sketch changes coalesce offline, including removal, without losing a later edit after a lost acknowledgement', async () => {
  const f = fixture(); await f.project.initialize(true);
  const image = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4n8AAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }); await f.project.changeSketch(image, f.server.project.activeLevelId);
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  f.state.beforeSketch = () => new Promise<void>(resolve => { release = resolve; entered(); }); f.state.failAfterSketch = true;
  const sync = f.project.retry(); await started; await f.project.changeSketch(null, f.server.project.activeLevelId); f.state.beforeSketch = undefined; release(); await sync;
  assert.equal(f.project.record.sketchDrafts![f.server.project.activeLevelId].blob, null); assert.ok(Object.keys(f.project.record.inflightSketches ?? {}).length); assert.equal(f.state.status, 'offline'); f.project.destroy();
  const next = fixture(f.state.persisted!); next.server = structuredClone(f.server); await next.project.initialize(true); await next.project.retry();
  assert.equal(next.server.sketches[next.server.project.activeLevelId].hasSketch, false); assert.equal(next.server.sketches[next.server.project.activeLevelId].version, 2); assert.equal(next.state.sketches, 1); assert.equal(next.state.status, 'saved'); assert.equal(next.project.hasPending, false); next.project.destroy();
});

test('remote sketch revision conflicts rather than replacing another device image', async () => {
  const f = fixture(); await f.project.initialize(true); await f.project.changeSketch(new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4n8AAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), f.server.project.activeLevelId);
  f.server = { ...f.server, sketches: { [f.server.project.activeLevelId]: { version: 1, hasSketch: true, mutationId: 'remote' } } }; await f.project.retry();
  assert.equal(f.state.status, 'conflict'); assert.equal(f.state.sketches, 0); assert.ok(Object.keys(f.project.record.sketchDrafts ?? {}).length); f.project.destroy();
});

test('cache validation rejects a different account, shared snapshots and malformed room data', () => {
  const f = fixture(), record = f.project.record;
  assert.ok(validateOfflineProject(record, 'owner', 'room'));
  assert.equal(validateOfflineProject(record, 'other', 'room'), null);
  assert.equal(validateOfflineProject({ ...record, snapshot: { ...record.snapshot, shared: true } }, 'owner', 'room'), null);
  assert.equal(validateOfflineProject({ ...record, draft: { height: -1 } }, 'owner', 'room'), null); f.project.destroy();
});

test('storage failure never pretends the local draft is durable or sends it to the server', async () => {
  const f = fixture(); await f.project.initialize(true); const persist = f.deps.persist; f.deps.persist = async () => { throw new Error('Sin espacio'); };
  f.project.change({ ...f.server.project, name: 'No perder' }); await delay(); await f.project.retry();
  assert.equal(f.project.durable, false); assert.equal(f.state.status, 'error'); assert.equal(f.state.puts, 0); assert.equal(f.project.record.draft?.name, 'No perder');
  f.deps.persist = persist; await f.project.retry();
  assert.equal(f.state.status, 'saved'); assert.equal(f.server.project.name, 'No perder'); assert.equal(f.project.durable, true); f.project.destroy();
});

test('closing or changing account while inflight intent is being persisted does not send after destruction', async () => {
  for (const sketch of [false, true]) {
    const f = fixture(); await f.project.initialize(true);
    let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const original = f.deps.persist;
    f.deps.persist = async record => {
      if (record.inflight || Object.keys(record.inflightSketches ?? {}).length) await new Promise<void>(resolve => { release = resolve; entered(); });
      await original(record);
    };
    if (sketch) await f.project.changeSketch(new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4n8AAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), f.server.project.activeLevelId);
    else f.project.change({ ...f.server.project, name: 'Pending' });
    const syncing = f.project.retry(); await started; f.project.destroy(); release(); await syncing;
    assert.equal(f.state.puts, 0); assert.equal(f.state.sketches, 0);
  }
});
