import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotFixture } from '../../../tests/fixtures/projectTestFixture';
import type { OfflineProjectRecord } from '../offline/offlineProject';
import { ProjectSketch, sketchAddress } from './projectSketch';

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(version = 1) {
  const snapshot = snapshotFixture(), levelId = snapshot.project.activeLevelId;
  snapshot.sketches[levelId] = { hasSketch: true, version, mutationId: null };
  const record: OfflineProjectRecord = { id: snapshot.id, accountId: snapshot.accountId!, snapshot, draft: null, authorized: true, updatedAt: Date.now() };
  return { snapshot, record, levelId };
}

test('local sketches use one owned URL, deletion clears it, and disposal revokes it', async () => {
  const f = fixture(), original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const created: (Blob | MediaSource)[] = [], revoked: string[] = [], displayed: (string | null)[] = [];
  URL.createObjectURL = blob => { created.push(blob); return 'blob:sketch-' + created.length; };
  URL.revokeObjectURL = url => { revoked.push(url); };
  const view = new ProjectSketch(f.snapshot.id, url => displayed.push(url), async () => { throw new Error('No request allowed'); });
  try {
    const blob = new Blob(['image']); f.record.sketchBlobs = { [f.levelId]: { blob, version: 1 } };
    const selection = { ...f, owner: null, offline: true };
    view.update(selection); view.update(selection);
    assert.equal(created.length, 1); assert.deepEqual(displayed, ['blob:sketch-1']);
    f.record.sketchDrafts = { [f.levelId]: { id: 'deleted', blob: null } }; view.update(selection);
    assert.deepEqual(revoked, ['blob:sketch-1']); assert.equal(displayed.at(-1), null);
    delete f.record.sketchDrafts; view.update(selection); view.dispose();
    assert.deepEqual(revoked, ['blob:sketch-1', 'blob:sketch-2']);
  } finally { URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke; view.dispose(); }
});

test('late sketch responses cannot cache a replaced version, wrong ETag or disposed owner', async () => {
  const f = fixture();
  const responses: ((response: Response) => void)[] = [], saved: number[] = [];
  const owner = { cacheSketch: async (_blob: Blob, version: number) => { saved.push(version); } };
  const view = new ProjectSketch(f.snapshot.id, () => {}, async () => new Promise<Response>(resolve => responses.push(resolve)));
  const selection = { ...f, owner, offline: false };
  view.update(selection); view.update(selection); assert.equal(responses.length, 1, 'same owner/version shares its request');
  f.snapshot.sketches[f.levelId].version = 2; view.update(selection);
  responses[0](new Response('old', { headers: { ETag: '"' + f.snapshot.id + '-' + f.levelId + '-1"' } }));
  responses[1](new Response('wrong', { headers: { ETag: '"wrong"' } }));
  await tick(); assert.deepEqual(saved, []);
  f.snapshot.sketches[f.levelId].version = 3; view.update(selection); view.dispose();
  responses[2](new Response('closed', { headers: { ETag: '"' + f.snapshot.id + '-' + f.levelId + '-3"' } }));
  await tick(); assert.deepEqual(saved, []);
});

test('a replacement editing session can load the same sketch while the old request is pending', async () => {
  const f = fixture(), responses: ((response: Response) => void)[] = [], saved: string[] = [];
  const first = { cacheSketch: async () => { saved.push('first'); } }, second = { cacheSketch: async () => { saved.push('second'); } };
  const view = new ProjectSketch(f.snapshot.id, () => {}, async () => new Promise<Response>(resolve => responses.push(resolve)));
  view.update({ ...f, owner: first, offline: false }); view.update({ ...f, owner: second, offline: false });
  assert.equal(responses.length, 2);
  const response = () => new Response('current', { headers: { ETag: '"' + f.snapshot.id + '-' + f.levelId + '-1"' } });
  responses[0](response()); responses[1](response()); await tick();
  assert.deepEqual(saved, ['second']); view.dispose();
  assert.equal(sketchAddress('room with space', 'level/one', true, 2), '/api/rooms/room%20with%20space/levels/level%2Fone/sketch?v=2');
});
