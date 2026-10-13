import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as rawRequest, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createDefaultRoom } from './model';
import { createServer } from './server';

const listen = async (server: Server) => {
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return 'http://127.0.0.1:' + address.port;
};
const close = (server: Server) => new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
const credentials = { username: 'Owner', password: 'test-password', confirmPassword: 'test-password', termsVersion: '2026-10-13' };
const cookieFor = (response: Response) => response.headers.get('set-cookie')!.split(';')[0];

test('cuentas sin correo, sesiones del servidor y aislamiento de diseños', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'virtual-space-accounts-'));
  writeFileSync(join(dataDir, 'rooms.sqlite'), 'legacy untouched');
  let clock = 1_800_000_000_000;
  let server = createServer({ dataDir, now: () => clock, secureCookie: true });
  let base = await listen(server);
  const send = (path: string, method = 'GET', body?: unknown, cookie = '', extra: Record<string, string> = {}) => fetch(base + path, { method, headers: { Origin: base, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.deepEqual(await (await send('/api/auth/session')).json(), { user: null });
    assert.equal((await send('/api/rooms')).status, 401);
    assert.equal((await send('/api/rooms', 'POST', { id: randomUUID(), room: createDefaultRoom() })).status, 401);
    for (const patch of [
      { username: 'ab' }, { username: 'Álex' }, { username: 'a-b' }, { username: 'x'.repeat(33) },
      { password: 'short', confirmPassword: 'short' }, { password: 'x'.repeat(129), confirmPassword: 'x'.repeat(129) }, { confirmPassword: 'other-password' },
    ]) assert.equal((await send('/api/auth/register', 'POST', { ...credentials, ...patch })).status, 400);
    const registered = await send('/api/auth/register', 'POST', { ...credentials, username: ' Owner ' });
    assert.equal(registered.status, 201);
    assert.match(registered.headers.get('set-cookie')!, /^__Host-vs_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Secure$/);
    const user = (await registered.json()).user, originalCookie = cookieFor(registered);
    assert.equal(user.username, 'owner'); assert.deepEqual(Object.keys(user).sort(), ['id', 'username']);
    assert.equal((await send('/api/auth/register', 'POST', { ...credentials, username: 'OWNER' })).status, 409);
    const second = await send('/api/auth/register', 'POST', { ...credentials, username: 'Other' });
    const otherCookie = cookieFor(second);
    const database = new DatabaseSync(join(dataDir, 'accounts.sqlite'));
    const stored = database.prepare('SELECT salt, password_hash FROM users ORDER BY username').all();
    assert.equal(stored.length, 2); assert.notEqual(stored[0].salt, stored[1].salt);
    assert.notEqual(stored[0].password_hash, stored[1].password_hash);
    assert.match(String(stored[0].password_hash), /^[a-f0-9]{128}$/);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM sessions WHERE token_hash = ?').get(originalCookie.split('=')[1])!.count, 0);
    database.close();
    assert.equal(readFileSync(join(dataDir, 'rooms.sqlite'), 'utf8'), 'legacy untouched');

    const id = randomUUID(), room = { ...createDefaultRoom(), name: 'Mi diseño' }, path = '/api/rooms/' + id;
    const created = await send('/api/rooms', 'POST', { id, room }, originalCookie);
    assert.equal(created.status, 201); assert.equal((await created.json()).shared, false);
    assert.equal((await send(path)).status, 404); assert.equal((await send(path, 'GET', undefined, otherCookie)).status, 404);
    assert.equal((await send(path + '/sketch')).status, 404);
    const library = await (await send('/api/rooms', 'GET', undefined, originalCookie)).json();
    assert.deepEqual(library.rooms, [{ id, name: 'Mi diseño', role: 'owner', canManage: true, canEdit: true, shared: false, updatedAt: new Date(clock).toISOString() }]);
    assert.deepEqual((await (await send('/api/rooms', 'GET', undefined, otherCookie)).json()).rooms, []);
    assert.equal((await send(path + '/share', 'POST', { enabled: true }, otherCookie)).status, 404);
    assert.equal((await send(path + '/share', 'POST', { enabled: 'true' }, originalCookie)).status, 400);
    assert.equal((await send(path + '/share', 'POST', { enabled: true }, originalCookie)).status, 200);
    const shared = await (await send(path)).json(); assert.equal(shared.canEdit, false); assert.deepEqual(shared.room, room);
    for (const endpoint of [path, path + '/sketch']) assert.equal((await send(endpoint, 'DELETE', undefined, otherCookie)).status, 403);
    assert.equal((await send(path + '/share', 'POST', { enabled: false }, otherCookie)).status, 403);
    assert.equal((await send(path + '/share', 'POST', { enabled: false }, originalCookie)).status, 200);
    assert.equal((await send(path)).status, 404);

    const login = await send('/api/auth/login', 'POST', { username: 'OwNeR', password: credentials.password }, originalCookie);
    assert.equal(login.status, 200); const rotatedCookie = cookieFor(login); assert.notEqual(rotatedCookie, originalCookie);
    assert.equal((await (await send('/api/auth/session', 'GET', undefined, originalCookie)).json()).user, null);
    assert.equal((await (await send('/api/auth/session', 'GET', undefined, rotatedCookie)).json()).user.username, 'owner');
    await close(server); server = createServer({ dataDir, now: () => clock, secureCookie: true }); base = await listen(server);
    assert.equal((await (await send('/api/auth/session', 'GET', undefined, rotatedCookie)).json()).user.username, 'owner');
    assert.equal((await (await send(path, 'GET', undefined, rotatedCookie)).json()).canEdit, true);
    assert.equal((await send(path, 'DELETE', undefined, rotatedCookie)).status, 200); assert.equal((await send(path, 'GET', undefined, rotatedCookie)).status, 404);
    const logout = await send('/api/auth/logout', 'POST', undefined, rotatedCookie);
    assert.equal(logout.status, 200); assert.match(logout.headers.get('set-cookie')!, /Max-Age=0/);
    assert.equal((await (await send('/api/auth/session', 'GET', undefined, rotatedCookie)).json()).user, null);
    const again = await send('/api/auth/login', 'POST', credentials); const expiredCookie = cookieFor(again);
    clock += 30 * 24 * 60 * 60_000;
    assert.equal((await (await send('/api/auth/session', 'GET', undefined, expiredCookie)).json()).user, null);
  } finally { await close(server); rmSync(dataDir, { recursive: true, force: true }); }
});

test('registro y acceso usan cookies de sesión salvo elección explícita de recordar 30 días', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'virtual-space-session-cookies-'));
  const server = createServer({ dataDir, secureCookie: true }), base = await listen(server);
  const send = (path: string, body?: unknown, cookie = '') => fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Origin: base, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const assertSessionCookie = (response: Response, remembered: boolean) => {
    const header = response.headers.get('set-cookie')!;
    assert.match(header, /^__Host-vs_session=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax;/);
    assert.match(header, /; Secure$/); assert.doesNotMatch(header, /Domain=|Expires=/);
    if (remembered) assert.match(header, /; Max-Age=2592000; Secure$/);
    else assert.doesNotMatch(header, /Max-Age=/);
  };
  try {
    const choices = [{}, { rememberSession: false }, { rememberSession: true }];
    for (const [index, choice] of choices.entries()) {
      const body = { ...credentials, username: 'cookie_owner_' + index, ...choice };
      const registered = await send('/api/auth/register', body);
      assert.equal(registered.status, 201); assertSessionCookie(registered, choice.rememberSession === true);
      const original = cookieFor(registered), session = await send('/api/auth/session', undefined, original);
      assert.equal((await session.json()).user.username, body.username);
      assert.equal(session.headers.get('set-cookie'), null);
      const login = await send('/api/auth/login', body, original);
      assert.equal(login.status, 200); assertSessionCookie(login, choice.rememberSession === true);
      const rotated = cookieFor(login); assert.notEqual(rotated, original);
      assert.equal((await (await send('/api/auth/session', undefined, original)).json()).user, null);
      const logout = await send('/api/auth/logout', {}, rotated);
      assert.equal(logout.status, 200);
      assert.match(logout.headers.get('set-cookie')!, /^__Host-vs_session=; Path=\/; HttpOnly; SameSite=Lax; Max-Age=0; Secure$/);
      assert.equal((await (await send('/api/auth/session', undefined, rotated)).json()).user, null);
    }
    const valid = await send('/api/auth/login', { ...credentials, username: 'cookie_owner_0' });
    assert.equal(valid.status, 200);
    const current = cookieFor(valid);
    for (const rememberSession of [null, 'true', 'false', 0, 1, [], {}]) {
      for (const endpoint of ['register', 'login']) {
        const invalid = await send('/api/auth/' + endpoint, { ...credentials, username: endpoint === 'register' ? 'invalid_choice' : 'cookie_owner_0', rememberSession }, current);
        assert.equal(invalid.status, 400); assert.equal(invalid.headers.get('set-cookie'), null);
      }
    }
    assert.equal((await (await send('/api/auth/session', undefined, current)).json()).user.username, 'cookie_owner_0');
    const database = new DatabaseSync(join(dataDir, 'accounts.sqlite'));
    try { assert.equal(database.prepare('SELECT COUNT(*) AS count FROM users').get()!.count, 3); }
    finally { database.close(); }
  } finally { await close(server); rmSync(dataDir, { recursive: true, force: true }); }
});

test('intentos de fuerza bruta bloquean persistentemente la IP, sin bloquear la cuenta para otros', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'virtual-space-rates-'));
  let clock = 1_800_000_000_000;
  let server = createServer({ dataDir, now: () => clock, trustedProxies: '127.0.0.1/32' }), base = await listen(server);
  const send = (path: string, body?: unknown, ip = '198.51.100.10') => fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: base, 'Content-Type': 'application/json', 'X-Forwarded-For': ip }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.equal((await send('/api/auth/register', credentials)).status, 201);
    for (let index = 0; index < 9; index++) {
      const failure = await send('/api/auth/login', { username: index ? 'missing' + index : 'OWNER', password: 'wrong-password' });
      assert.equal(failure.status, 401); assert.equal((await failure.json()).error, 'Usuario o contraseña incorrectos.');
    }
    const blocked = await send('/api/auth/login', { username: 'missinglast', password: 'wrong-password' });
    assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '900');
    assert.equal((await send('/api/auth/session')).status, 429);
    assert.equal((await send('/api/auth/login', credentials, '198.51.100.11')).status, 200);
    await close(server); server = createServer({ dataDir, now: () => clock, trustedProxies: '127.0.0.1/32' }); base = await listen(server);
    assert.equal((await send('/api/auth/login', credentials)).status, 429);
    clock += 15 * 60_000 + 1;
    assert.equal((await send('/api/auth/login', credentials)).status, 200);
    for (let index = 0; index < 5; index++) assert.equal((await send('/api/auth/login', { username: 'sameusername', password: 'wrong-password' }, '198.51.100.12')).status, 401);
    const pairBlocked = await send('/api/auth/login', { username: 'SameUsername', password: 'wrong-password' }, '198.51.100.12');
    assert.equal(pairBlocked.status, 429); assert.equal(pairBlocked.headers.get('retry-after'), '900');
    // Spoofed leftmost entries cannot bypass the nearest untrusted address.
    const stillBlocked = await send('/api/auth/login', credentials, '203.0.113.5, 198.51.100.10');
    assert.equal(stillBlocked.status, 200);
    const otherIP = '198.51.100.13';
    for (let index = 0; index < 5; index++) assert.equal((await send('/api/auth/register', { ...credentials, username: 'created' + index }, otherIP)).status, 201);
    assert.equal((await send('/api/auth/register', { ...credentials, username: 'createdmore' }, otherIP)).status, 429);
    for (let index = 0; index < 600; index++) assert.equal((await send('/api/auth/session', undefined, '198.51.100.14')).status, 200);
    const overGlobal = await send('/api/auth/session', undefined, '198.51.100.14'); assert.equal(overGlobal.status, 429); assert.equal(overGlobal.headers.get('retry-after'), '60');
    clock += 60_001; assert.equal((await send('/api/auth/session', undefined, '198.51.100.14')).status, 200);
  } finally { await close(server); rmSync(dataDir, { recursive: true, force: true }); }
});

test('solo permite mutaciones del mismo origen y limita cuerpos antes de derivar contraseñas', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'virtual-space-csrf-'));
  const server = createServer({ dataDir, trustedProxies: '' }), base = await listen(server);
  try {
    const body = JSON.stringify(credentials);
    const rejectedHeaders: Record<string, string>[] = [
      { 'Content-Type': 'application/json' }, { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
      { 'Content-Type': 'application/json', Origin: base, 'Sec-Fetch-Site': 'cross-site' }, { 'Content-Type': 'text/plain', Origin: base },
    ];
    for (const headers of rejectedHeaders) assert.equal((await fetch(base + '/api/auth/register', { method: 'POST', headers, body })).status, headers['Content-Type'] === 'text/plain' ? 415 : 403);
    assert.equal((await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: ' '.repeat(8193) })).status, 413);
    const cookie = cookieFor(await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body }));
    const csrfLogout = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://attacker.example' } }); assert.equal(csrfLogout.status, 403);
    assert.equal((await fetch(base + '/api/auth/session', { headers: { Cookie: cookie } }).then(r => r.json())).user.username, 'owner');
    const traversal = await new Promise<number>(accept => { const request = rawRequest(base, { path: '/%2e%2e/accounts.sqlite' }, response => { response.resume(); accept(response.statusCode!); }); request.end(); });
    assert.equal(traversal, 403);
  } finally { await close(server); rmSync(dataDir, { recursive: true, force: true }); }
});
