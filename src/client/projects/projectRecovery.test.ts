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
