import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountRequestError } from '../api/accountApi';
import { clearOffline, setOfflineAccess, writeOffline } from '../offline/offlineStorage';
import type { OfflineAssetRecord } from '../offline/offlineAssets';
import type { ModelAsset } from '../../domain/models/glbValidation';
import { deleteModel, listModels, onModelDeleted } from './modelRepository';

const user = { id: '031f3902-316e-4233-931b-6e3776ba8ae6', username: 'owner', verifiedAt: 1700000000000 };
const asset = (id: string): ModelAsset => ({ id, roomId: 'room', name: id, size: 1, createdAt: '2026-01-01T00:00:00.000Z', width: 1, height: 1, depth: 1, triangles: 1, texturePixels: 0, meshInstances: 1, materials: 1, nodes: [] });
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
async function setup() {
  await clearOffline();
  await writeOffline('meta', 'identity', user);
  setOfflineAccess('room', { accountId: user.id, allowed: true });
}

test('model repository merges pending local models and preserves account-scoped fallback without hiding denials', async () => {
  await setup();
  const original = globalThis.fetch;
  const local = asset('local');
  await writeOffline('assets', `${user.id}:room:local`, { accountId: user.id, roomId: 'room', asset: local, blob: new Blob(['x']), pending: true } satisfies OfflineAssetRecord);
  try {
    globalThis.fetch = async () => json({ models: [asset('remote')] });
    assert.deepEqual((await listModels('room')).map(model => model.id), ['remote', 'local']);
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    assert.deepEqual(await listModels('room'), [local]);
    globalThis.fetch = async () => json({ error: 'Denied' }, 403);
    await assert.rejects(listModels('room'), error => error instanceof AccountRequestError && error.status === 403);
    await writeOffline('meta', 'identity', { ...user, id: 'other' });
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    assert.deepEqual(await listModels('room'), []);
  } finally { globalThis.fetch = original; await clearOffline(); }
});

test('model deletion invalidates subscribers only after success and supports unsubscribe', async () => {
  await setup();
  const original = globalThis.fetch;
  let invalidations = 0;
  const unsubscribe = onModelDeleted(() => invalidations++);
  try {
    let complete!: (response: Response) => void;
    let started!: () => void;
    const requestStarted = new Promise<void>(resolve => { started = resolve; });
    globalThis.fetch = async () => { started(); return new Promise<Response>(resolve => { complete = resolve; }); };
    const deletion = deleteModel('model');
    await requestStarted;
    assert.equal(invalidations, 0);
    complete(json({ ok: true }));
    await deletion;
    assert.equal(invalidations, 1);
    globalThis.fetch = async () => json({ error: 'In use' }, 409);
    await assert.rejects(deleteModel('model'), error => error instanceof AccountRequestError && error.status === 409);
    assert.equal(invalidations, 1);
    unsubscribe();
    globalThis.fetch = async () => json({ ok: true });
    await deleteModel('model');
    assert.equal(invalidations, 1);
  } finally { unsubscribe(); globalThis.fetch = original; await clearOffline(); }
});
