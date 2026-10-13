import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { TERMS_VERSION } from './legalPolicy';
import { createDefaultRoom } from './model';
import { inactivityDeadline } from './retention';
import { createServer } from './server';

const started = Date.parse('2026-10-13T17:00:00Z');
const day = 24 * 60 * 60_000;
const credentials = { username: 'retention_owner', password: 'private-test-password', confirmPassword: 'private-test-password', termsVersion: TERMS_VERSION };
const cookieFor = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];
const close = (server: Server) => new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
async function fixture(setup?: (dataDir: string) => void) {
  const dataDir = mkdtempSync(join(tmpdir(), '3d-space-account-retention-test-'));
  setup?.(dataDir);
  let clock = started;
  let server: Server;
  let base: string;
  const start = async () => {
    server = createServer({ dataDir, now: () => clock, maintenance: false });
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    base = 'http://127.0.0.1:' + address.port;
  };
  await start();
  return {
    dataDir,
    time(value: number) { clock = value; },
    read(sql: string, ...params: (string | number)[]) {
      const database = new DatabaseSync(join(dataDir, 'accounts.sqlite'), { readOnly: true });
      try { return database.prepare(sql).all(...params); } finally { database.close(); }
    },
    send(path: string, method = 'GET', body?: unknown, cookie = '') {
      return fetch(base + path, { method, headers: { Origin: base, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    },
    sketch(id: string, cookie: string, png: Buffer) {
      return fetch(base + '/api/rooms/' + id + '/sketch', { method: 'PUT', headers: { Origin: base, 'Content-Type': 'image/png', Cookie: cookie }, body: new Uint8Array(png) });
    },
    async restart(afterStop?: () => void) { await close(server); afterStop?.(); await start(); },
    async dispose() {
      await close(server);
      assert.equal(dirname(resolve(dataDir)), resolve(tmpdir()));
      assert.ok(basename(dataDir).startsWith('3d-space-account-retention-test-'));
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

test('registration requires the exact terms version before creating any account and records acceptance', async () => {
  const sample = await fixture();
  try {
    for (const termsVersion of [undefined, null, false, true, 42, {}, [], 'previous-version']) {
      const rejected = await sample.send('/api/auth/register', 'POST', { ...credentials, termsVersion });
      assert.equal(rejected.status, 400);
      assert.equal(rejected.headers.get('set-cookie'), null);
      assert.equal(sample.read('SELECT COUNT(*) AS count FROM users')[0].count, 0);
      assert.equal(sample.read('SELECT COUNT(*) AS count FROM sessions')[0].count, 0);
    }
    const registered = await sample.send('/api/auth/register', 'POST', credentials);
    assert.equal(registered.status, 201);
    const stored = sample.read('SELECT terms_version, terms_accepted_at, last_active_at, inactive_after, password_hash FROM users')[0];
    assert.equal(stored.terms_version, TERMS_VERSION);
    assert.equal(stored.terms_accepted_at, started);
    assert.equal(stored.last_active_at, started);
    assert.equal(stored.inactive_after, inactivityDeadline(started));
    assert.match(String(stored.password_hash), /^[a-f0-9]{128}$/);
    assert.notEqual(stored.password_hash, credentials.password);
  } finally { await sample.dispose(); }
});

test('only successful authenticated use renews activity; public views, invalid mutations and failed login do not', async () => {
  const sample = await fixture();
  try {
    const registered = await sample.send('/api/auth/register', 'POST', credentials);
    assert.equal(registered.status, 201);
    const cookie = cookieFor(registered), id = randomUUID(), path = '/api/rooms/' + id;
    assert.equal((await sample.send('/api/rooms', 'POST', { id, room: createDefaultRoom() }, cookie)).status, 201);
    assert.equal((await sample.send(path + '/share', 'POST', { enabled: true }, cookie)).status, 200);
    const activity = () => sample.read('SELECT last_active_at FROM users')[0].last_active_at;
    sample.time(started + day);
    assert.equal((await sample.send(path)).status, 200);
    assert.equal((await sample.send('/api/auth/session')).status, 200);
    assert.equal((await sample.send('/api/auth/login', 'POST', { ...credentials, password: 'incorrect-password' })).status, 401);
    assert.equal((await sample.send(path, 'PUT', { revision: 1, room: null }, cookie)).status, 400);
    assert.equal(activity(), started);
    sample.time(started + 2 * day);
    assert.equal((await sample.send('/api/rooms', 'GET', undefined, cookie)).status, 200);
    assert.equal(activity(), started + 2 * day);
    assert.equal(sample.read('SELECT inactive_after FROM users')[0].inactive_after, inactivityDeadline(started + 2 * day));
    sample.time(started + 35 * day);
    const login = await sample.send('/api/auth/login', 'POST', credentials);
    assert.equal(login.status, 200);
    assert.equal(activity(), started + 35 * day);
    assert.equal(sample.read('SELECT inactive_after FROM users')[0].inactive_after, inactivityDeadline(started + 35 * day));
  } finally { await sample.dispose(); }
});

test('expiry denies login before hourly purge; restart cascades expired accounts, sketches and sessions and preserves active owners', async () => {
  const sample = await fixture();
  try {
    const owner = await sample.send('/api/auth/register', 'POST', credentials);
    assert.equal(owner.status, 201);
    const cookie = cookieFor(owner), ownerId = (await owner.json()).user.id;
    const activeCredentials = { ...credentials, username: 'active_retention_owner' };
    const active = await sample.send('/api/auth/register', 'POST', activeCredentials);
    assert.equal(active.status, 201);
    const activeCookie = cookieFor(active), activeId = (await active.json()).user.id;
    const id = randomUUID(), activeRoomId = randomUUID();
    for (const [roomId, accountCookie] of [[id, cookie], [activeRoomId, activeCookie]]) {
      assert.equal((await sample.send('/api/rooms', 'POST', { id: roomId, room: createDefaultRoom() }, accountCookie)).status, 201);
    }
    assert.equal((await sample.send('/api/rooms/' + id + '/share', 'POST', { enabled: true }, cookie)).status, 200);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aGz0AAAAASUVORK5CYII=', 'base64');
    assert.equal((await sample.sketch(id, cookie, png)).status, 200);
    sample.time(Date.parse('2026-12-13T17:00:00Z'));
    assert.equal((await sample.send('/api/auth/login', 'POST', activeCredentials)).status, 200);
    sample.time(inactivityDeadline(started));
    const expired = await sample.send('/api/auth/login', 'POST', credentials);
    assert.equal(expired.status, 401);
    assert.equal(expired.headers.get('set-cookie'), null);
    assert.equal(sample.read('SELECT COUNT(*) AS count FROM users WHERE id = ?', ownerId)[0].count, 1);
    await sample.restart();
    assert.equal(sample.read('SELECT COUNT(*) AS count FROM users WHERE id = ?', ownerId)[0].count, 0);
    assert.equal(sample.read('SELECT COUNT(*) AS count FROM rooms WHERE owner_id = ?', ownerId)[0].count, 0);
    assert.equal(sample.read('SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?', ownerId)[0].count, 0);
    assert.equal((await sample.send('/api/rooms/' + id)).status, 404);
    assert.equal((await sample.send('/api/rooms/' + id + '/sketch')).status, 404);
    assert.equal(sample.read('SELECT COUNT(*) AS count FROM users WHERE id = ?', activeId)[0].count, 1);
    assert.equal(sample.read('SELECT COUNT(*) AS count FROM rooms WHERE owner_id = ?', activeId)[0].count, 1);
    assert.equal((await sample.send('/api/auth/login', 'POST', activeCredentials)).status, 200);
  } finally { await sample.dispose(); }
});

test('startup completes durable erasures after an interrupted database commit and prevents deleted UUID reuse', async () => {
  const sample = await fixture();
  try {
    const registered = await sample.send('/api/auth/register', 'POST', credentials);
    assert.equal(registered.status, 201);
    const cookie = cookieFor(registered), deletedId = randomUUID(), sharedId = randomUUID();
    for (const id of [deletedId, sharedId]) assert.equal((await sample.send('/api/rooms', 'POST', { id, room: createDefaultRoom() }, cookie)).status, 201);
    assert.equal((await sample.send('/api/rooms/' + sharedId + '/share', 'POST', { enabled: true }, cookie)).status, 200);
    sample.time(started + 2);
    await sample.restart(() => {
      const ledgerPath = join(sample.dataDir, 'erasures.json');
      const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
      ledger.entries.push({ kind: 'room', id: deletedId, at: started + 1 }, { kind: 'share', id: sharedId, at: started + 1 });
      writeFileSync(ledgerPath, JSON.stringify(ledger));
      assert.equal(sample.read('SELECT COUNT(*) AS count FROM rooms WHERE id = ?', deletedId)[0].count, 1);
      assert.equal(sample.read('SELECT shared FROM rooms WHERE id = ?', sharedId)[0].shared, 1);
    });
    assert.equal((await sample.send('/api/rooms/' + deletedId, 'GET', undefined, cookie)).status, 404);
    assert.equal((await sample.send('/api/rooms/' + sharedId)).status, 404);
    const shared = await sample.send('/api/rooms/' + sharedId, 'GET', undefined, cookie);
    assert.equal(shared.status, 200); assert.equal((await shared.json()).shared, false);
    const reused = await sample.send('/api/rooms', 'POST', { id: deletedId, room: createDefaultRoom() }, cookie);
    assert.equal(reused.status, 409);
    assert.equal(sample.read('SELECT COUNT(*) AS count FROM rooms WHERE id = ?', deletedId)[0].count, 0);
  } finally { await sample.dispose(); }
});

test('an existing pre-policy database gains a full grace period without a restart extending it', async () => {
  const id = randomUUID(), old = Date.parse('2022-01-01T00:00:00Z');
  const sample = await fixture(dataDir => {
    const database = new DatabaseSync(join(dataDir, 'accounts.sqlite'));
    try {
      database.exec('CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)');
      database.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?)').run(id, 'legacy_owner', 'a'.repeat(32), 'b'.repeat(128), old);
    } finally { database.close(); }
  });
  try {
    const before = sample.read('SELECT created_at, last_active_at, inactive_after FROM users WHERE id = ?', id)[0];
    assert.equal(before.created_at, old); assert.equal(before.last_active_at, started); assert.equal(before.inactive_after, inactivityDeadline(started));
    sample.time(started + 30 * day);
    await sample.restart();
    assert.deepEqual(sample.read('SELECT created_at, last_active_at, inactive_after FROM users WHERE id = ?', id)[0], before);
  } finally { await sample.dispose(); }
});

test('a crash followed by downtime longer than backup retention still completes recorded live-data erasures', async () => {
  const sample = await fixture();
  try {
    const registered = await sample.send('/api/auth/register', 'POST', credentials);
    assert.equal(registered.status, 201);
    const cookie = cookieFor(registered), deletedId = randomUUID(), sharedId = randomUUID();
    for (const id of [deletedId, sharedId]) assert.equal((await sample.send('/api/rooms', 'POST', { id, room: createDefaultRoom() }, cookie)).status, 201);
    assert.equal((await sample.send('/api/rooms/' + sharedId + '/share', 'POST', { enabled: true }, cookie)).status, 200);
    sample.time(started + 8 * day);
    await sample.restart(() => {
      writeFileSync(join(sample.dataDir, 'erasures.json'), JSON.stringify({ version: 1, entries: [
        { kind: 'room', id: deletedId, at: started + 1 },
        { kind: 'share', id: sharedId, at: started + 1 },
      ] }));
    });
    assert.equal((await sample.send('/api/rooms/' + deletedId, 'GET', undefined, cookie)).status, 404);
    assert.equal((await sample.send('/api/rooms/' + sharedId)).status, 404);
    const shared = await sample.send('/api/rooms/' + sharedId, 'GET', undefined, cookie);
    assert.equal(shared.status, 200); assert.equal((await shared.json()).shared, false);
  } finally { await sample.dispose(); }
});
