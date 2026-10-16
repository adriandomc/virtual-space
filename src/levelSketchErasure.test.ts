import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from './server';
import { createDefaultProject, type ProjectDocument } from './projectDocument';
import { addLevel, removeLevel } from './projectOperations';
import { restoreBackup, runBackup } from './backups';
import { TERMS_VERSION } from './legalPolicy';

test('level deletion erases its sketch across restores and re-adding the level preserves monotonic versions', async () => {
  const directory = mkdtempSync(join(tmpdir(), '3d-space-level-erasure-')), dataDir = join(directory, 'data');
  let now = Date.now(); const server = createServer({ dataDir, now: () => now, maintenance: false });
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = 'http://127.0.0.1:' + address.port;
  let cookie = '';
  const request = (path: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers: { Cookie: cookie, Origin: base, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const database = new DatabaseSync(join(dataDir, 'accounts.sqlite')); database.exec('PRAGMA foreign_keys=ON;');
  try {
    const registration = await request('/api/auth/register', 'POST', { username: 'level_erasure', password: 'Testing-password', confirmPassword: 'Testing-password', termsVersion: TERMS_VERSION });
    assert.equal(registration.status, 201); cookie = registration.headers.get('set-cookie')!.split(';')[0];
    const id = randomUUID(), project = addLevel(createDefaultProject(undefined, undefined, id), { copy: true }), levelId = project.levels[1].id, path = '/api/rooms/' + id;
    assert.equal((await request('/api/rooms', 'POST', { id, project })).status, 201);
    const upload = (data: Buffer, version: number, revision: number) => fetch(base + path + '/levels/' + levelId + '/sketch', { method: 'PUT', headers: { Cookie: cookie, Origin: base, 'Content-Type': 'image/png', 'X-Sketch-Request-Id': randomUUID(), 'X-Sketch-Version': String(version), 'X-Room-Revision': String(revision) }, body: new Uint8Array(data) });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X9S8AAAAASUVORK5CYII=', 'base64');
    assert.equal((await upload(png, 0, 1)).status, 200);
    const oldBackup = await runBackup(database, dataDir, { now, force: true }); now++;
    const save = (project: ProjectDocument, revision: number, operationId = randomUUID()) => request(path, 'PUT', { project, revision, operationId });
    const deleted = removeLevel(project, levelId), failedOperation = randomUUID();
    database.exec("CREATE TRIGGER fail_level_delete BEFORE DELETE ON project_levels BEGIN SELECT RAISE(ABORT, 'isolated transaction failure'); END;");
    assert.equal((await save(deleted, 1, failedOperation)).status, 500);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM project_levels WHERE room_id=?').get(id)!.count, 2);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM mutation_receipts WHERE id=?').get(failedOperation)!.count, 0);
    assert.deepEqual(JSON.parse(readFileSync(join(dataDir, 'erasures.json'), 'utf8')).entries, []);
    database.exec('DROP TRIGGER fail_level_delete;');
    assert.equal((await save(deleted, 1)).status, 200);
    const saved = await (await request(path)).json(); assert.equal(saved.sketches[levelId], undefined);
    assert.equal((await request(path + '/levels/' + levelId + '/sketch')).status, 404);
    const tombstone = database.prepare('SELECT data,mime,version FROM project_sketches WHERE room_id=? AND level_id=?').get(id, levelId)!;
    assert.equal(tombstone.data, null); assert.equal(tombstone.mime, null); assert.equal(tombstone.version, 2);
    const restored = restoreBackup(oldBackup.path, join(directory, 'restored-before-delete'), { now, erasureFile: join(dataDir, 'erasures.json') });
    const restoredDb = new DatabaseSync(restored.path);
    try { const row = restoredDb.prepare('SELECT data,mime,version FROM project_sketches WHERE room_id=? AND level_id=?').get(id, levelId)!; assert.equal(row.data, null); assert.equal(row.mime, null); assert.equal(row.version, 2); }
    finally { restoredDb.close(); }
    now++;
    assert.equal((await save(project, 2)).status, 200);
    const undone = await (await request(path)).json(); assert.equal(undone.sketches[levelId].version, 2); assert.equal(undone.sketches[levelId].hasSketch, false);
    const replacement = Buffer.concat([png, Buffer.from([0])]); const response = await upload(replacement, 2, 3); assert.equal(response.status, 200); assert.equal((await response.json()).version, 3);
    const newBackup = await runBackup(database, dataDir, { now, force: true }); now++;
    const newRestore = restoreBackup(newBackup.path, join(directory, 'restored-after-reupload'), { now, erasureFile: join(dataDir, 'erasures.json') }), recovered = new DatabaseSync(newRestore.path);
    try { const row = recovered.prepare('SELECT data,version FROM project_sketches WHERE room_id=? AND level_id=?').get(id, levelId)!; assert.deepEqual(row.data, new Uint8Array(replacement)); assert.equal(row.version, 3); }
    finally { recovered.close(); }
  } finally {
    database.close(); await new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('3d-space-level-erasure-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
