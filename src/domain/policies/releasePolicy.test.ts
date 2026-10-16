import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { createServer } from '../../server/server';
import { PRELAUNCH_STORAGE_EPOCH } from './releasePolicy';
import { retireTestStorage } from '../../client/offline/retiredStorage';

test('only an explicit valid v3 operator reset publishes the device retirement gate', async () => {
  const directory = mkdtempSync(join(tmpdir(), '3d-space-release-')), server = createServer({ dataDir: directory, maintenance: false });
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const read = async () => (await fetch('http://127.0.0.1:' + address.port + '/api/release')).json();
  try {
    assert.deepEqual(await read(), { version: 3, retireTestStorage: null });
    const marker = join(directory, 'prelaunch-reset-v3.json');
    for (const value of ['invalid json', JSON.stringify({ version: 2, resetAt: Date.now() }), JSON.stringify({ version: 3, resetAt: Date.now() + 3600000 })]) {
      writeFileSync(marker, value); assert.equal((await read()).retireTestStorage, null);
    }
    const resetAt = Date.now(); writeFileSync(marker, JSON.stringify({ version: 3, resetAt }));
    assert.deepEqual(await read(), { version: 3, retireTestStorage: { epoch: PRELAUNCH_STORAGE_EPOCH, resetAt } });
  } finally {
    await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('3d-space-release-'));
    rmSync(directory, { recursive: true, force: true });
  }
});

test('device retirement deletes only allowlisted old test stores after the release gate', async () => {
  const factory = new IDBFactory();
  const names = ['3d-space-offline', '3d-space-v2', '3d-space-v3', 'other-app', 'unknown-space-schema'];
  for (const name of names) await new Promise<void>((accept, reject) => {
    const request = factory.open(name, 1); request.onsuccess = () => { request.result.close(); accept(); }; request.onerror = () => reject(request.error);
  });
  for (const release of [null, {}, { version: 3, retireTestStorage: null }, { version: 3, retireTestStorage: { epoch: 'unknown', resetAt: Date.now() } }]) {
    await retireTestStorage(release, factory); assert.equal((await factory.databases()).length, names.length);
  }
  await retireTestStorage({ version: 3, retireTestStorage: { epoch: PRELAUNCH_STORAGE_EPOCH, resetAt: Date.now(), databases: ['3d-space-v3', 'other-app'] } }, factory);
  assert.deepEqual((await factory.databases()).map(value => value.name).sort(), ['3d-space-v3', 'other-app', 'unknown-space-schema']);
});
