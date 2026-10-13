import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { checkOrigin, createAuth, HttpError, ipRateIdentity, proxyTrust, usernameValue } from './auth';

const request = (headers: IncomingMessage['headers'] = {}, method = 'GET', peer = '127.0.0.1') => ({ headers, method, socket: { remoteAddress: peer } }) as IncomingMessage;
const response = () => {
  let cookie = '';
  return { value: { setHeader(name: string, value: string) { if (name === 'Set-Cookie') cookie = value; } } as unknown as ServerResponse, cookie: () => cookie };
};
const status = (code: number) => (error: unknown) => error instanceof HttpError && error.status === code;
const credentials = { username: 'Test_User', password: '  contraseña 🔑  ', confirmPassword: '  contraseña 🔑  ' };

test('solo confía en la cadena de proxies desde la derecha y descarta IPs falsificadas', () => {
  const trust = proxyTrust('10.0.0.0/8,127.0.0.1/32,::1/128');
  assert.deepEqual(trust(request({ 'x-forwarded-for': '1.2.3.4' }, 'GET', '198.51.100.11')), { ip: '198.51.100.11', fromProxy: false });
  assert.deepEqual(trust(request({ 'x-forwarded-for': '1.2.3.4, 198.51.100.5, 10.0.1.3' }, 'GET', '10.0.1.2')), { ip: '198.51.100.5', fromProxy: true });
  assert.equal(trust(request({ 'x-forwarded-for': 'unknown, 198.51.100.5' }, 'GET', '10.0.1.2')).ip, '198.51.100.5');
  assert.equal(trust(request({ 'x-forwarded-for': [...Array(25).fill('unknown'), '198.51.100.5'].join(',') }, 'GET', '10.0.1.2')).ip, '198.51.100.5');
  assert.equal(trust(request({ 'x-forwarded-for': '198.51.100.5, unknown' }, 'GET', '10.0.1.2')).ip, '10.0.1.2');
  assert.equal(trust(request({ 'x-forwarded-for': ['198.51.100.5', ...Array(21).fill('10.0.1.3')].join(',') }, 'GET', '10.0.1.2')).ip, '10.0.1.2');
  assert.deepEqual(proxyTrust('')(request({ 'x-forwarded-for': '1.2.3.4' })), { ip: '127.0.0.1', fromProxy: false });
  for (const cidr of ['not-an-ip', '10.0.0.1/33', '::1/129', '10.0.0.1/-1', '10.0.0.1/8/1']) assert.throws(() => proxyTrust(cidr));
});

test('representaciones equivalentes de IPv6 y IPv4 mapeada conservan la misma identidad', () => {
  const trust = proxyTrust('');
  const short = trust(request({}, 'GET', '2001:db8::dead:beef')).ip;
  const long = trust(request({}, 'GET', '2001:0DB8:0000:0000:0000:0000:DEAD:BEEF')).ip;
  assert.equal(short, long);
  assert.equal(isIP(short), 6);
  assert.equal(trust(request({}, 'GET', '::FFFF:c000:209')).ip, '192.0.2.9');
  assert.equal(trust(request({}, 'GET', '::ffff:192.0.2.9')).ip, '192.0.2.9');
  assert.equal(ipRateIdentity('2001:db8:ab:cd::1'), ipRateIdentity('2001:db8:ab:cd::dead:beef'));
  assert.notEqual(ipRateIdentity('2001:db8:ab:cd::1'), ipRateIdentity('2001:db8:ab:ce::1'));
  assert.equal(ipRateIdentity('::FFFF:c000:209'), '192.0.2.9');
});

test('las mutaciones necesitan origen exacto y no aceptan esquema reenviado por un cliente directo', () => {
  const local = { host: 'localhost:5173', origin: 'http://localhost:5173' };
  assert.doesNotThrow(() => checkOrigin(request(local, 'POST'), false, undefined));
  const https = { host: 'example.com', origin: 'https://example.com', 'x-forwarded-proto': 'https' };
  assert.doesNotThrow(() => checkOrigin(request(https, 'PUT'), true, undefined));
  assert.throws(() => checkOrigin(request(https, 'POST'), false, undefined), status(403));
  assert.doesNotThrow(() => checkOrigin(request({ ...https, host: 'app:8080' }, 'POST'), true, 'https://example.com'));
  for (const origin of ['null', 'https://attacker.example', 'https://example.com.attacker.example', 'https://example.com/path', 'https://user:password@example.com']) {
    assert.throws(() => checkOrigin(request({ ...https, origin }, 'POST'), true, 'https://example.com'), status(403));
  }
  assert.throws(() => checkOrigin(request({ host: 'example.com' }, 'POST'), true, 'https://example.com'), status(403));
  assert.throws(() => checkOrigin(request({ ...https, 'sec-fetch-site': 'cross-site' }, 'DELETE'), true), status(403));
  assert.doesNotThrow(() => checkOrigin(request({}, 'GET'), false));
});

test('normaliza usuarios sin cambiar contraseñas y rechaza formatos o confirmaciones inválidas', async () => {
  assert.equal(usernameValue('  TeSt_User  '), 'test_user');
  for (const username of [null, [], 'ab', 'a'.repeat(33), 'user name', 'user@email', '<script>']) assert.throws(() => usernameValue(username), status(400));
  const database = new DatabaseSync(':memory:');
  const auth = createAuth(database, { secureCookie: false });
  try {
    for (const body of [{ ...credentials, password: 'short', confirmPassword: 'short' }, { ...credentials, password: 'a'.repeat(129), confirmPassword: 'a'.repeat(129) }, { ...credentials, confirmPassword: 'different' }]) {
      await assert.rejects(() => auth.register(request(), response().value, body, '192.0.2.10'), status(400));
    }
    const created = response();
    const user = await auth.register(request(), created.value, credentials, '192.0.2.10');
    assert.equal(user.username, 'test_user');
    const stored = database.prepare('SELECT username, salt, password_hash FROM users').get()!;
    assert.equal(stored.username, 'test_user'); assert.match(String(stored.salt), /^[0-9a-f]{32}$/); assert.match(String(stored.password_hash), /^[0-9a-f]{128}$/);
    assert.notEqual(stored.password_hash, credentials.password);
    await assert.rejects(() => auth.login(request(), response().value, { username: 'TEST_USER', password: credentials.password.trim() }, '192.0.2.10'), status(401));
    assert.equal((await auth.login(request(), response().value, { username: 'TEST_USER', password: credentials.password }, '192.0.2.10')).id, user.id);
  } finally { database.close(); }
});

test('sesiones aleatorias protegidas se rotan, vencen y se revocan al salir', async () => {
  const database = new DatabaseSync(':memory:');
  let time = Date.now();
  const auth = createAuth(database, { now: () => time, secureCookie: true });
  try {
    const first = response();
    const user = await auth.register(request(), first.value, credentials, '192.0.2.10');
    const firstCookie = first.cookie().split(';')[0];
    assert.match(first.cookie(), /^__Host-vs_session=[0-9a-f]{64};/);
    assert.match(first.cookie(), /; HttpOnly/); assert.match(first.cookie(), /; Secure/); assert.match(first.cookie(), /; SameSite=Lax/); assert.match(first.cookie(), /; Path=\//);
    assert.doesNotMatch(first.cookie(), /Domain=/);
    assert.deepEqual({ ...auth.session(request({ cookie: firstCookie })) }, user);
    const stored = database.prepare('SELECT token_hash FROM sessions').get()!;
    assert.notEqual(stored.token_hash, firstCookie.split('=')[1]);
    const second = response();
    await auth.login(request({ cookie: firstCookie }), second.value, credentials, '192.0.2.10');
    assert.notEqual(second.cookie().split(';')[0], firstCookie); assert.equal(auth.session(request({ cookie: firstCookie })), null);
    const secondCookie = second.cookie().split(';')[0];
    assert.deepEqual({ ...auth.session(request({ cookie: secondCookie })) }, user);
    auth.logout(request({ cookie: secondCookie }), response().value);
    assert.equal(auth.session(request({ cookie: secondCookie })), null);
    const third = response();
    await auth.login(request(), third.value, credentials, '192.0.2.10');
    time += 31 * 24 * 60 * 60_000;
    assert.equal(auth.session(request({ cookie: third.cookie().split(';')[0] })), null);
    for (const cookie of ['__Host-vs_session=bad', '__Host-vs_session=%00', '__Host-vs_session=' + 'f'.repeat(65)]) assert.equal(auth.session(request({ cookie })), null);
  } finally { database.close(); }
});

test('bloqueos de IP persisten sin bloquear a la cuenta desde otra IP y caducan', async () => {
  const database = new DatabaseSync(':memory:');
  let time = Date.now();
  const auth = createAuth(database, { now: () => time, secureCookie: false });
  try {
    await auth.register(request(), response().value, credentials, '192.0.2.20');
    for (let attempt = 0; attempt < 10; attempt++) {
      await assert.rejects(() => auth.login(request(), response().value, { username: 'unknown_' + attempt, password: 'incorrect' }, '192.0.2.21'), status(attempt === 9 ? 429 : 401));
    }
    assert.throws(() => auth.checkBlocked('192.0.2.21'), status(429));
    const restarted = createAuth(database, { now: () => time, secureCookie: false });
    assert.throws(() => restarted.checkBlocked('192.0.2.21'), status(429));
    assert.equal((await restarted.login(request(), response().value, credentials, '192.0.2.22')).username, 'test_user');
    time += 16 * 60_000;
    assert.doesNotThrow(() => restarted.checkBlocked('192.0.2.21'));
  } finally { database.close(); }
});

test('límites generales persisten, indican tiempo de espera y eliminan registros caducados', () => {
  const database = new DatabaseSync(':memory:');
  let time = Date.now();
  const auth = createAuth(database, { now: () => time, secureCookie: false });
  try {
    auth.limit('api', '192.0.2.30', 2, 60_000);
    auth.limit('api', '192.0.2.30', 2, 60_000);
    const restarted = createAuth(database, { now: () => time, secureCookie: false });
    assert.throws(() => restarted.limit('api', '192.0.2.30', 2, 60_000), (error: unknown) => error instanceof HttpError && error.status === 429 && error.retryAfter === 60);
    auth.limit('api', '192.0.2.31', 2, 60_000);
    time += 60_000;
    assert.doesNotThrow(() => restarted.limit('api', '192.0.2.30', 2, 60_000));
    time += 49 * 60 * 60_000;
    auth.limit('api', '192.0.2.32', 2, 60_000);
    assert.equal(database.prepare('SELECT count(*) AS count FROM request_limits').get()!.count, 1);
  } finally { database.close(); }
});

test('autenticación limita derivaciones concurrentes antes de llenar la cola de scrypt', async () => {
  const database = new DatabaseSync(':memory:');
  const auth = createAuth(database, { secureCookie: false });
  try {
    const first = auth.login(request(), response().value, { username: 'unknown_a', password: 'incorrect' }, '192.0.2.31');
    const second = auth.login(request(), response().value, { username: 'unknown_b', password: 'incorrect' }, '192.0.2.32');
    const third = auth.login(request(), response().value, { username: 'unknown_c', password: 'incorrect' }, '192.0.2.33');
    const settled = await Promise.allSettled([first, second, third]);
    assert.equal(settled[2].status, 'rejected');
    if (settled[2].status === 'rejected') assert.ok(status(429)(settled[2].reason));
    for (const result of settled.slice(0, 2)) { assert.equal(result.status, 'rejected'); if (result.status === 'rejected') assert.ok(status(401)(result.reason)); }
    await assert.rejects(() => auth.login(request(), response().value, { username: 'unknown_d', password: 'incorrect' }, '192.0.2.34'), status(401));
  } finally { database.close(); }
});
