import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { createAuth } from './auth';
import { createLiveCollaboration, type RoomRow } from './collaborationServer';
import { createDefaultProject, validateProjectDocument, type ProjectDocument } from './projectDocument';
import { addLevel } from './projectOperations';
import { clearProjectCache, confirmProject, projectCacheStats, projectMutationHashPayload, readProject, seedProjectStates, stringifyProjectPayload, writeProject } from './projectRepository';
import { initializeTestDatabase, insertTestRoom, insertTestSession, insertTestUser } from './serverTestFixtures';
import { readProjectScope, writeProjectScope } from './collaborativeProject';
import { deleteInactiveAccounts, inactivityDeadline } from './retention';
import { initializeErasures, recordErasure } from './erasures';

function fixture() {
  const database = new DatabaseSync(':memory:'); initializeTestDatabase(database);
  const owner = randomUUID(), now = Date.now(); insertTestUser(database, owner, 'repository_owner', now);
  let project = createDefaultProject(); for (let i = 1; i < 12; i++) project = addLevel(project, { copy: true });
  insertTestRoom(database, project.id, owner, { room: JSON.stringify(project) });
  database.exec('BEGIN IMMEDIATE'); seedProjectStates(database, project); database.exec('COMMIT');
  const live = createLiveCollaboration({ database, auth: createAuth(database, { secureCookie: false }), now: () => now, identify: () => ({ ip: '127.0.0.1', fromProxy: false }),
    find: id => database.prepare('SELECT * FROM rooms WHERE id=?').get(id) as RoomRow | undefined,
    snapshot: row => ({ id: row.id, revision: row.revision, project: readProject(database, row.id) }), readJson: async () => ({}), sendJson: () => {}, eraseMember: (_id, erase) => erase(), eraseSketches: (_id, _entries, erase) => erase(), validateReferences: () => {},
  });
  return { database, owner, project, now, live, close() { live.close(); database.close(); } };
}

test('a warm twelve-level REST save reads, writes and encodes only the changed level', context => {
  const sample = fixture(), { database, project, live, owner } = sample;
  try {
    const current = readProject(database, project.id), levelId = current.levels[5].id;
    const next = structuredClone(current); next.levels[5].walls[0].left.color = '#112233';
    const validated = validateProjectDocument(next);
    const queries: { sql: string; args: unknown[]; method: string }[] = [], prepare = database.prepare.bind(database);
    context.mock.method(database, 'prepare', (sql: string) => {
      const statement = prepare(sql);
      for (const method of ['get', 'all', 'run'] as const) {
        const execute = statement[method];
        Object.defineProperty(statement, method, { value: (...args: unknown[]) => { queries.push({ sql, args, method }); return Reflect.apply(execute, statement, args); } });
      }
      return statement;
    });
    const stringify = JSON.stringify, encodedUntouched: string[] = [], untouched = new Set(current.levels.filter(level => level.id !== levelId).map(level => level.id));
    context.mock.method(JSON, 'stringify', ((value: unknown, ...args: unknown[]) => {
      if (value && typeof value === 'object' && 'points' in value && 'id' in value && untouched.has(String(value.id))) encodedUntouched.push(String(value.id));
      return Reflect.apply(stringify, JSON, [value, ...args]);
    }) as typeof JSON.stringify);
    const saved = live.putProject(project.id, validated, 1, owner, randomUUID());
    assert.equal(saved.revision, 2);
    const stored = readProject(database, project.id);
    assert.equal(stored.levels[5].walls[0].left.color, '#112233');
    assert.deepEqual(JSON.parse(stringifyProjectPayload({ project: stored })).project, next);
    assert.deepEqual(encodedUntouched, []);
    assert.equal(queries.filter(query => /SELECT\s+document\b/i.test(query.sql)).length, 0, 'cached reads must not fetch all twelve level documents');
    const stateReads = queries.filter(query => /SELECT\s+y_state\b/i.test(query.sql));
    assert.equal(stateReads.length, 1); assert.deepEqual(stateReads[0].args, [project.id, levelId]);
    const documentWrites = queries.filter(query => /UPDATE project_levels SET ordinal=\?,document=/i.test(query.sql));
    assert.equal(documentWrites.length, 1); assert.equal(documentWrites[0].args.at(-1), levelId);
    for (const [index, level] of stored.levels.entries()) if (index !== 5) assert.equal(level, current.levels[index], 'unchanged immutable levels retain their identity');
    assert.throws(() => { stored.levels[0].name = 'corrupted'; }, TypeError);
  } finally { sample.close(); }
});

test('a warm twelve-level collaborative update never loads untouched canonical or Y-state documents', async context => {
  const sample = fixture(), { database, project, live, owner, now } = sample, server = createServer();
  const token = 'c'.repeat(64); insertTestSession(database, createHash('sha256').update(token).digest('hex'), owner, now + 86400000);
  live.attach(server); await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); assert.ok(address && typeof address !== 'string'); const base = 'http://127.0.0.1:' + address.port;
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/api/rooms/' + project.id + '/live', { headers: { Cookie: 'vs_session=' + token, Origin: base } });
  const message = () => new Promise<Record<string, any>>((accept, reject) => {
    const timer = setTimeout(() => reject(new Error('Missing live cache test message.')), 5000);
    socket.once('message', data => { clearTimeout(timer); accept(JSON.parse(data.toString())); });
  });
  const doc = new Y.Doc();
  try {
    const initial = await message(); assert.equal(initial.type, 'sync');
    const levelId = project.levels[5].id; Y.applyUpdate(doc, Buffer.from(initial.states[levelId], 'base64'));
    const previous = readProjectScope(doc), vector = Y.encodeStateVector(doc), next = structuredClone(previous);
    next.name = 'Live floor'; writeProjectScope(doc, next, previous);
    const queries: string[] = [], prepare = database.prepare.bind(database);
    context.mock.method(database, 'prepare', (sql: string) => { queries.push(sql); return prepare(sql); });
    const response = message();
    socket.send(JSON.stringify({ type: 'update', id: randomUUID(), scope: levelId, update: Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString('base64') }));
    const ack = await response; assert.equal(ack.type, 'ack', String(ack.error)); assert.equal(ack.revision, 2);
    assert.equal(readProject(database, project.id).levels[5].name, 'Live floor');
    assert.deepEqual(queries.filter(sql => /SELECT\s+(?:document|y_state)\b/i.test(sql)), []);
    assert.equal(queries.filter(sql => /UPDATE project_levels SET ordinal=\?,document=/i.test(sql)).length, 1);
  } finally { socket.terminate(); doc.destroy(); live.close(); await new Promise<void>(accept => server.close(() => accept())); database.close(); }
});

test('failed scoped commits cannot poison canonical cache, receipts or later retries', () => {
  const sample = fixture(), { database, project, live, owner } = sample;
  try {
    const previous = readProject(database, project.id), next = structuredClone(previous), operationId = randomUUID(); next.levels[5].name = 'Changed floor';
    database.exec("CREATE TRIGGER reject_receipt BEFORE INSERT ON mutation_receipts BEGIN SELECT RAISE(ABORT, 'isolated rollback'); END;");
    assert.throws(() => live.putProject(project.id, next, 1, owner, operationId), /isolated rollback/);
    assert.equal(readProject(database, project.id), previous);
    assert.equal(database.prepare('SELECT revision FROM rooms WHERE id=?').get(project.id)!.revision, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM mutation_receipts').get()!.count, 0);
    database.exec('DROP TRIGGER reject_receipt;');
    assert.equal(live.putProject(project.id, next, 1, owner, operationId).revision, 2);
    assert.equal(readProject(database, project.id).levels[5].name, 'Changed floor');
    assert.equal(live.putProject(project.id, next, 1, owner, operationId).revision, 2, 'lost acknowledgements remain idempotent');
    database.exec('BEGIN IMMEDIATE');
    const pending = structuredClone(readProject(database, project.id)); pending.name = 'Uncommitted'; writeProject(database, pending, new Set(['meta']));
    assert.equal(readProject(database, project.id).name, 'Uncommitted');
    assert.throws(() => confirmProject(database, pending, 3), /uncommitted/);
    database.exec('ROLLBACK');
    assert.equal(readProject(database, project.id).name, previous.name);
  } finally { sample.close(); }
});

test('receipt hashes are independent of property order, warm cache, eviction and later revisions', () => {
  const sample = fixture(), { database, project } = sample;
  const reorder = (value: unknown): unknown => Array.isArray(value) ? value.map(reorder) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reorder(child)])) : value;
  try {
    const hash = projectMutationHashPayload(database, project, 1); readProject(database, project.id);
    assert.equal(projectMutationHashPayload(database, reorder(project) as ProjectDocument, 1), hash);
    clearProjectCache(database); assert.equal(projectMutationHashPayload(database, project, 1), hash);
    const later = structuredClone(project); later.name = 'Later'; confirmProject(database, later, 2);
    assert.equal(projectMutationHashPayload(database, project, 1), hash);
  } finally { sample.close(); }
});

test('canonical cache is bounded, revision-checked and removed only after committed erasure', () => {
  const sample = fixture(), { database, project, owner, now } = sample, directory = mkdtempSync(join(tmpdir(), '3d-space-cache-'));
  try {
    const original = readProject(database, project.id);
    database.prepare('UPDATE rooms SET revision=revision+1 WHERE id=?').run(project.id);
    assert.notEqual(readProject(database, project.id), original);
    for (let i = 0; i < 40; i++) { const value = createDefaultProject(); insertTestRoom(database, value.id, owner, { room: JSON.stringify(value) }); readProject(database, value.id); }
    let stats = projectCacheStats(database); assert.ok(stats.entries <= stats.limits.entries); assert.ok(stats.bytes <= stats.limits.bytes);
    const huge = structuredClone(project); huge.id = randomUUID(); huge.name = 'x'.repeat(stats.limits.bytes); confirmProject(database, huge, 1);
    stats = projectCacheStats(database); assert.ok(stats.entries <= stats.limits.entries); assert.ok(stats.bytes <= stats.limits.bytes);
    readProject(database, project.id);
    const ledger = initializeErasures(directory);
    assert.throws(() => recordErasure(database, ledger, { kind: 'room', id: project.id, at: now }, () => { database.prepare('DELETE FROM rooms WHERE id=?').run(project.id); throw new Error('abort erase'); }), /abort erase/);
    assert.ok(projectCacheStats(database).entries > 0);
    recordErasure(database, ledger, { kind: 'room', id: project.id, at: now }, () => { database.prepare('DELETE FROM rooms WHERE id=?').run(project.id); });
    assert.equal(projectCacheStats(database).entries, 0);
    const retained = createDefaultProject(); insertTestRoom(database, retained.id, owner, { room: JSON.stringify(retained) }); readProject(database, retained.id);
    assert.equal(deleteInactiveAccounts(database, inactivityDeadline(now)), 1); assert.equal(projectCacheStats(database).entries, 0);
  } finally { sample.close(); rmSync(directory, { recursive: true, force: true }); }
});
