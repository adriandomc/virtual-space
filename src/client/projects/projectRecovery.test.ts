import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProject } from '../../domain/project/projectDocument';
import { clearOffline, readOffline, writeOffline } from '../offline/offlineStorage';
import { ProjectRecovery } from './projectRecovery';

const owner = { id: '031f3902-316e-4233-931b-6e3776ba8ae6', username: 'owner', verifiedAt: Date.now() };
const project = createDefaultProject(undefined, undefined, 'design');
const key = 'recovery:' + owner.id + ':' + project.id;
async function reset() { await clearOffline(); await writeOffline('meta', 'identity', owner); }

test('recovery restoration and export stay bound to the original account and design', async () => {
  await reset();
  const first = new ProjectRecovery(project.id);
  await first.capture(project, owner.id);
  const restored = new ProjectRecovery(project.id);
  await restored.restore(() => true);
  assert.deepEqual(restored.project(), project);
  const backup = await restored.applyToBackup({ project, assets: [], sketches: [{ levelId: project.activeLevelId, blob: new Blob(['valid']) }, { levelId: 'deleted-level', blob: new Blob(['old']) }] });
  assert.deepEqual(backup.sketches.map(value => value.levelId), [project.activeLevelId]);
  await writeOffline('meta', 'identity', { ...owner, id: '596872d9-a61a-452c-96b6-98bcc70988e9' });
  await assert.rejects(restored.discard(), /cuenta activa cambió/);
  await assert.rejects(restored.applyToBackup({ project, assets: [], sketches: [] }), /cuenta activa cambió/);
  const otherAccount = new ProjectRecovery(project.id);
  await otherAccount.restore(() => true);
  assert.equal(otherAccount.project(), null);
  assert.ok(await readOffline('meta', key), 'denied discard preserves the original account draft');
});

test('a late restore cannot replace a newly captured recovery or reopen a cleared session', async () => {
  await reset();
  const stored = new ProjectRecovery(project.id); await stored.capture(project, owner.id);
  const current = new ProjectRecovery(project.id), next = { ...project, name: 'Latest recovery' };
  const restoring = current.restore(() => true);
  await current.capture(next, owner.id); await restoring;
  assert.equal(current.project()?.name, next.name);
  const closed = new ProjectRecovery(project.id);
  let active = true;
  const pending = closed.restore(() => active); active = false;
  await pending; assert.equal(closed.project(), null);
  const mismatched = new ProjectRecovery('different-design');
  await writeOffline('meta', 'recovery:' + owner.id + ':different-design', { project });
  await mismatched.restore(() => true); assert.equal(mismatched.project(), null);
});

test('discard and a new rejected edit serialize without deleting the newer durable recovery', async () => {
  await reset();
  const recovery = new ProjectRecovery(project.id);
  await recovery.capture(project, owner.id);
  const discarding = recovery.discard(), next = { ...project, name: 'New rejected edit' };
  await recovery.capture(next, owner.id); await discarding;
  assert.equal(recovery.project()?.name, next.name);
  assert.equal((await readOffline<{ project: typeof project }>('meta', key))?.project.name, next.name);
  await recovery.discard();
  assert.equal(recovery.project(), null); assert.equal(await readOffline('meta', key), undefined);
});


test('gesture checkpoints are durable without replacing the editable project and cleanup serializes with the next gesture', async () => {
  await reset();
  const recovery = new ProjectRecovery(project.id), first = { ...project, name: 'First position' }, last = { ...project, name: 'Latest position' };
  let notifications = 0; recovery.subscribe(() => notifications++);
  const writing = recovery.checkpoint(first, owner.id), clearing = recovery.clearCheckpoint(), next = recovery.checkpoint(last, owner.id);
  await Promise.all([writing, clearing, next]);
  assert.equal(notifications, 0); assert.equal(recovery.project(), null);
  const reopened = new ProjectRecovery(project.id); await reopened.restore(() => true);
  assert.equal(reopened.project()?.name, last.name);
  await recovery.clearCheckpoint(); assert.equal(await readOffline('meta', key), undefined);
});

test('a rejected collaborative edit supersedes a gesture checkpoint and survives queued cleanup', async () => {
  await reset();
  const recovery = new ProjectRecovery(project.id);
  const writing = recovery.checkpoint(project, owner.id), clearing = recovery.clearCheckpoint();
  const rejected = { ...project, name: 'Rejected edit' };
  await recovery.capture(rejected, owner.id); await Promise.all([writing, clearing]);
  assert.equal((await readOffline<{ project: typeof project }>('meta', key))?.project.name, rejected.name);
  assert.equal(recovery.project()?.name, rejected.name);
});

test('failed local commit keeps its checkpoint through later previews and gesture cancellation', async () => {
  await reset();
  const recovery = new ProjectRecovery(project.id), accepted = { ...project, name: 'Accepted before quota failure' };
  await recovery.checkpoint(accepted, owner.id);
  let undurable = true;
  const local = { get hasUndurableWork() { return undurable; }, async assertDurable() { if (undurable) throw new Error('Local quota exceeded'); } };
  assert.equal(await recovery.updateCheckpoint({ ...project, name: 'Later preview' }, owner.id, local, () => true), false);
  assert.equal(await recovery.updateCheckpoint(null, owner.id, local, () => true), false);
  const reopened = new ProjectRecovery(project.id); await reopened.restore(() => true);
  assert.equal(reopened.project()?.name, accepted.name, 'cancelling a later drag cannot discard the accepted edit');
  // Becoming locally durable is enough, even if the saved draft still needs a server upload.
  undurable = false;
  assert.equal(await recovery.updateCheckpoint(null, owner.id, local, () => true), true);
  assert.equal(await readOffline('meta', key), undefined);
});

test('late durability checks cannot write or clear checkpoints from another gesture or session', async () => {
  await reset();
  const recovery = new ProjectRecovery(project.id), saved = { ...project, name: 'Saved gesture' };
  await recovery.checkpoint(saved, owner.id);
  let finish!: () => void, current = true;
  const local = { hasUndurableWork: false, assertDurable: () => new Promise<void>(resolve => { finish = resolve; }) };
  const preview = recovery.updateCheckpoint({ ...project, name: 'Stale preview' }, owner.id, local, () => current);
  current = false; finish(); assert.equal(await preview, false);
  assert.equal((await readOffline<{ project: typeof project }>('meta', key))?.project.name, saved.name);
  current = true;
  const cancellation = recovery.updateCheckpoint(null, owner.id, local, () => current);
  current = false; finish(); assert.equal(await cancellation, false);
  assert.equal((await readOffline<{ project: typeof project }>('meta', key))?.project.name, saved.name);
});

test('queued checkpoint writes recheck local durability and preserve earlier accepted work', async () => {
  await reset();
  const recovery = new ProjectRecovery(project.id), saved = { ...project, name: 'Previous accepted position' };
  await recovery.checkpoint(saved, owner.id);
  let undurable = false;
  const local = { get hasUndurableWork() { return undurable; }, async assertDurable() {} };
  const preview = recovery.updateCheckpoint({ ...project, name: 'Obsolete intermediate pose' }, owner.id, local, () => true);
  await Promise.resolve(); undurable = true;
  assert.equal(await preview, false);
  assert.equal((await readOffline<{ project: typeof project }>('meta', key))?.project.name, saved.name);
});

test('a failed checkpoint cleanup retains ownership for a safe retry', async () => {
  await reset();
  const recovery = new ProjectRecovery(project.id); await recovery.checkpoint(project, owner.id);
  const original = IDBObjectStore.prototype.delete;
  IDBObjectStore.prototype.delete = function (value) { if (value === key) throw new DOMException('Storage unavailable', 'QuotaExceededError'); return original.call(this, value); };
  try { await assert.rejects(recovery.clearCheckpoint(), /No hay espacio suficiente/); }
  finally { IDBObjectStore.prototype.delete = original; }
  assert.ok(await readOffline('meta', key));
  await recovery.clearCheckpoint();
  assert.equal(await readOffline('meta', key), undefined);
});

test('checkpoint cancellation cannot clear another account after a delayed durability check', async () => {
  await reset();
  const recovery = new ProjectRecovery(project.id); await recovery.checkpoint(project, owner.id);
  let finish!: () => void;
  const local = { hasUndurableWork: false, assertDurable: () => new Promise<void>(resolve => { finish = resolve; }) };
  const cancelling = recovery.updateCheckpoint(null, owner.id, local, () => true);
  await writeOffline('meta', 'identity', { ...owner, id: '596872d9-a61a-452c-96b6-98bcc70988e9' });
  finish(); await cancelling;
  assert.ok(await readOffline('meta', key));
});
