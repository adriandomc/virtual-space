import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { accountUsage, checkAccountQuota, quotaMutation } from './accountQuota';
import { createUploadAdmission } from './uploadAdmission';
import { inspectImage, validateSketchBlob } from './imageValidation';
import { initializeTestDatabase, insertTestRoom, insertTestUser } from './serverTestFixtures';
import { createProjectCommands } from './projectCommandService';
import { readProject } from './projectRepository';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X9S8AAAAASUVORK5CYII=', 'base64');
function webp(kind: 'VP8X' | 'VP8 ' | 'VP8L', width: number, height: number) {
  const length = kind === 'VP8L' ? 5 : 10, bytes = Buffer.alloc(20 + length + length % 2);
  bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WEBP', 8); bytes.write(kind, 12); bytes.writeUInt32LE(length, 16);
  if (kind === 'VP8X') { bytes.writeUIntLE(width - 1, 24, 3); bytes.writeUIntLE(height - 1, 27, 3); }
  else if (kind === 'VP8 ') { bytes.set([157, 1, 42], 23); bytes.writeUInt16LE(width, 26); bytes.writeUInt16LE(height, 28); }
  else { bytes[20] = 47; bytes.writeUInt32LE((width - 1) | ((height - 1) << 14), 21); }
  return bytes;
}

test('sketch headers bound decoded pixels before decoding PNG, JPEG and all WebP encodings', async () => {
  assert.deepEqual(inspectImage(png, 'image/png'), { width: 1, height: 1 });
  const jpeg = Buffer.from([255,216,255,192,0,8,8,0,20,0,30,1]);
  assert.deepEqual(inspectImage(jpeg, 'image/jpeg'), { width: 30, height: 20 });
  for (const kind of ['VP8X', 'VP8 ', 'VP8L'] as const) assert.deepEqual(inspectImage(webp(kind, 640, 480), 'image/webp'), { width: 640, height: 480 });
  for (const [width, height] of [[8193,1], [8192,8192], [0,100]]) {
    const huge = Buffer.from(png); huge.writeUInt32BE(width, 16); huge.writeUInt32BE(height, 20);
    assert.throws(() => inspectImage(huge, 'image/png'));
    await assert.rejects(validateSketchBlob(new Blob([huge], { type: 'image/png' })));
  }
  const exact = Buffer.from(png); exact.writeUInt32BE(4096, 16); exact.writeUInt32BE(4096, 20);
  assert.equal(inspectImage(exact, 'image/png').width, 4096);
  for (const bytes of [png.subarray(0,32), Buffer.from('not png')]) assert.throws(() => inspectImage(bytes, 'image/png'));
  assert.throws(() => inspectImage(jpeg.subarray(0,9), 'image/jpeg'));
  assert.throws(() => inspectImage(webp('VP8X', 1, 1).subarray(0,25), 'image/webp'));
  assert.throws(() => inspectImage(png, 'image/jpeg'));
  const mismatched = Buffer.concat([webp('VP8X', 1, 1), webp('VP8 ', 8192, 8192).subarray(12)]); mismatched.writeUInt32LE(mismatched.length - 8, 4);
  assert.throws(() => inspectImage(mismatched, 'image/webp'), /contenido/);
  const animated = webp('VP8X', 1, 1); animated[20] = 2;
  assert.throws(() => inspectImage(animated, 'image/webp'));
});

test('upload admission bounds active bodies per process/account and releases every reservation once', () => {
  const admission = createUploadAdmission(), max = 20 * 1024 * 1024;
  const first = admission.acquire('first', max);
  assert.throws(() => admission.acquire('first', max), { status: 429, retryAfter: 5 });
  const second = admission.acquire('second', max);
  assert.throws(() => admission.acquire('third', 1), { status: 429 });
  first(); first();
  const third = admission.acquire('third', max); second(); third();
  assert.throws(() => admission.validate(() => admission.validate(() => true)), { status: 429 });
  assert.throws(() => admission.validate(() => { throw new Error('parse failure'); }));
  assert.equal(admission.validate(() => 'released'), 'released');
  assert.throws(() => admission.acquire('overflow', 41 * 1024 * 1024), { status: 429 });
  admission.acquire('last', max)();
  const json = Array.from({ length: 8 }, (_, index) => admission.acquire('json-' + index, 4 * 1024 * 1024, 'json'));
  assert.throws(() => admission.acquire('ninth', 1, 'json'), { status: 429 });
  assert.throws(() => admission.acquire('large', max), { status: 429 });
  json.forEach(release => release());
  const sameAccount = [admission.acquire('same', 4 * 1024 * 1024, 'json'), admission.acquire('same', 4 * 1024 * 1024, 'json')];
  assert.throws(() => admission.acquire('same', 1, 'json'), { status: 429 }); sameAccount.forEach(release => release());
  admission.acquire('same', 4 * 1024 * 1024, 'json')();
});

test('quotas count stored content once and permit reductions while already above quota', () => {
  const database = new DatabaseSync(':memory:'); initializeTestDatabase(database);
  const owner = randomUUID(), editor = randomUUID(); insertTestUser(database, owner); insertTestUser(database, editor);
  const project = insertTestRoom(database, randomUUID(), owner);
  try {
    const before = accountUsage(database, owner), bytes = Buffer.byteLength(JSON.stringify(project));
    assert.equal(before.designs, 1); assert.ok(before.bytes > 0 && before.bytes < bytes);
    database.exec('BEGIN IMMEDIATE');
    assert.throws(() => quotaMutation(database, owner, { designs: 1, bytes: before.bytes }, () => {
      database.prepare('UPDATE project_sketches SET data=? WHERE room_id=?').run(png, project.id);
    }), { status: 413 }); database.exec('ROLLBACK');
    assert.deepEqual(accountUsage(database, owner), before);
    database.prepare('UPDATE project_sketches SET data=? WHERE room_id=?').run(png, project.id);
    const grown = accountUsage(database, owner); assert.equal(grown.bytes, before.bytes + png.length);
    database.exec('BEGIN IMMEDIATE');
    quotaMutation(database, owner, { designs: 1, bytes: 1 }, () => database.prepare('UPDATE project_sketches SET data=NULL WHERE room_id=?').run(project.id));
    database.exec('COMMIT'); assert.deepEqual(accountUsage(database, owner), before);
    assert.deepEqual({ ...accountUsage(database, editor) }, { designs: 0, bytes: 0 });
    assert.throws(() => checkAccountQuota(before, { ...before, designs: 2 }, { designs: 1, bytes: 1e9 }), { status: 413 });
    assert.doesNotThrow(() => checkAccountQuota({ designs: 51, bytes: 600 }, { designs: 50, bytes: 500 }, { designs: 49, bytes: 400 }));
    assert.throws(() => quotaMutation(database, owner, { designs: 1, bytes: 1 }, () => {}), /transaction/);
  } finally { database.close(); }
});

test('shared project commands charge guest edits to the owner, roll back limits, and preserve receipts', () => {
  const database = new DatabaseSync(':memory:'); initializeTestDatabase(database);
  const owner = randomUUID(), guest = randomUUID(); insertTestUser(database, owner); insertTestUser(database, guest);
  const project = insertTestRoom(database, randomUUID(), owner); project.name = 'A';
  database.prepare('UPDATE rooms SET room=json_set(room,\'$.name\',\'A\') WHERE id=?').run(project.id);
  const usage = accountUsage(database, owner);
  const commands = createProjectCommands({ database, now: Date.now, quotas: { designs: 50, bytes: usage.bytes + 1 },
    find: id => database.prepare('SELECT owner_id,revision FROM rooms WHERE id=?').get(id) as { owner_id: string; revision: number } | undefined,
    canEdit: (_id, userId) => userId === owner || userId === guest, validateReferences: () => {}, eraseSketches: () => { throw new Error('Unexpected sketch erasure.'); } });
  try {
    assert.throws(() => commands.putProject(project.id, { ...project, name: 'far too large' }, 1, guest, randomUUID()), { status: 413 });
    assert.equal(readProject(database, project.id).name, 'A');
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM mutation_receipts').get()!.n, 0);
    const id = randomUUID(), change = { ...project, name: 'AB' };
    const saved = commands.putProject(project.id, change, 1, guest, id);
    assert.deepEqual(commands.putProject(project.id, change, 1, guest, id), saved);
    assert.equal(readProject(database, project.id).name, 'AB');
    assert.deepEqual({ ...accountUsage(database, guest) }, { designs: 0, bytes: 0 });
    assert.throws(() => commands.putProject(project.id, change, 1, randomUUID(), id), { status: 403 });
    assert.equal(database.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
  } finally { for (const id of commands.docs.keys()) commands.destroyDocs(id); database.close(); }
});

test('rolling receipt budget is owner-scoped, preserves retries and reductions, and rolls back rejected no-ops', () => {
  const database = new DatabaseSync(':memory:'); initializeTestDatabase(database);
  const owner = randomUUID(), guest = randomUUID(); insertTestUser(database, owner); insertTestUser(database, guest);
  const project = insertTestRoom(database, randomUUID(), owner), other = insertTestRoom(database, randomUUID(), owner), guestProject = insertTestRoom(database, randomUUID(), guest);
  let now = Date.now();
  const commands = createProjectCommands({ database, now: () => now, quotas: { designs: 50, bytes: 500 * 1024 * 1024, receipts: 1 },
    find: id => database.prepare('SELECT owner_id,revision FROM rooms WHERE id=?').get(id) as { owner_id: string; revision: number } | undefined,
    canEdit: (_id, userId) => userId === owner || userId === guest, validateReferences: () => {}, eraseSketches: () => { throw new Error('Unexpected erasure.'); } });
  try {
    const changed = { ...project, name: 'Longer project name' }, operation = randomUUID();
    const saved = commands.putProject(project.id, changed, 1, guest, operation);
    const before = database.prepare('SELECT revision,room,y_state FROM rooms WHERE id=?').get(project.id);
    assert.throws(() => commands.putProject(project.id, changed, 2, guest, randomUUID()), error => {
      assert.equal((error as { status: number }).status, 429); assert.ok((error as { retryAfter: number }).retryAfter > 0); return true;
    });
    assert.deepEqual(database.prepare('SELECT revision,room,y_state FROM rooms WHERE id=?').get(project.id), before);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM mutation_receipts').get()!.n, 1);
    assert.deepEqual(commands.putProject(project.id, changed, 1, guest, operation), saved);
    assert.throws(() => commands.putProject(other.id, other, 1, owner, randomUUID()), { status: 429 }, 'the owner budget spans all of their designs');
    assert.equal(commands.putProject(guestProject.id, guestProject, 1, guest, randomUUID()).revision, 2, 'guest edits did not consume the guest owner budget');
    const reduction = { ...changed, name: 'A' }, reductionId = randomUUID();
    const reduced = commands.putProject(project.id, reduction, 2, guest, reductionId);
    assert.equal(reduced.revision, 3); assert.deepEqual(commands.putProject(project.id, reduction, 2, guest, reductionId), reduced);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM mutation_receipts WHERE room_id=?').get(project.id)!.n, 2, 'reductions retain their own durable receipts');
    assert.throws(() => commands.putProject(project.id, reduction, 3, owner, randomUUID()), { status: 429 });
    now += 31 * 86400000;
    assert.equal(commands.putProject(other.id, other, 1, owner, randomUUID()).revision, 2);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM mutation_receipts').get()!.n, 1, 'only the existing 30-day expiry retires old receipts');
  } finally { for (const id of commands.docs.keys()) commands.destroyDocs(id); database.close(); }
});
