import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { BlockList, isIP } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { TERMS_VERSION } from './legalPolicy.js';
import { inactivityDeadline, initializeAccountPolicy, touchAccount } from './retention.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public retryAfter?: number) { super(message); }
}
export type User = { id: string; username: string };
type UserRow = User & { salt: string; password_hash: string; inactive_after: number };
type LimitRow = { count: number; window_start: number; blocked_until: number; strikes: number };
const MINUTE = 60_000, SESSION_TIME = 30 * 24 * 60 * MINUTE;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const normalizedIP = (value: string) => {
  value = value.split('%')[0];
  if (isIP(value) !== 6) return value;
  const canonical = new URL('http://[' + value + ']/').hostname.slice(1, -1);
  if (!canonical.startsWith('::ffff:')) return canonical;
  const words = canonical.slice(7).split(':');
  const high = parseInt(words[0], 16), low = parseInt(words[1], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
};
export function ipRateIdentity(address: string) {
  const value = normalizedIP(address);
  if (isIP(value) !== 6) return value;
  const [left, right] = value.split('::');
  const beginning = left ? left.split(':') : [], ending = right ? right.split(':') : [];
  const words = right === undefined ? beginning : [...beginning, ...Array(8 - beginning.length - ending.length).fill('0'), ...ending];
  return words.slice(0, 4).map(word => word.padStart(4, '0')).join(':') + '::/64';
}

export function proxyTrust(source = process.env.TRUSTED_PROXIES ?? '127.0.0.0/8,::1/128,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16') {
  const list = new BlockList();
  for (const entry of source.split(',').map(value => value.trim()).filter(Boolean)) {
    const [address, bits, extra] = entry.split('/');
    const type = isIP(address);
    const prefix = bits === undefined ? (type === 4 ? 32 : 128) : Number(bits);
    if (!type || extra || !Number.isInteger(prefix) || prefix < 0 || prefix > (type === 4 ? 32 : 128)) throw new Error('TRUSTED_PROXIES contains an invalid address or CIDR.');
    list.addSubnet(address, prefix, type === 4 ? 'ipv4' : 'ipv6');
  }
  const trusted = (value: string) => {
    const address = normalizedIP(value), type = isIP(address);
    return Boolean(type && list.check(address, type === 4 ? 'ipv4' : 'ipv6'));
  };
  return (request: IncomingMessage) => {
    const peer = normalizedIP(request.socket.remoteAddress ?? 'unknown');
    const fromProxy = trusted(peer);
    const forwarded = request.headers['x-forwarded-for'];
    if (!fromProxy || typeof forwarded !== 'string') return { ip: peer, fromProxy };
    const chain = forwarded.split(',');
    let current = peer, index = chain.length - 1, hops = 0;
    while (index >= 0 && trusted(current)) {
      if (hops++ >= 20) return { ip: peer, fromProxy };
      const next = chain[index--].trim();
      if (!isIP(next)) return { ip: peer, fromProxy };
      current = normalizedIP(next);
    }
    return { ip: current, fromProxy };
  };
}

export function checkOrigin(request: IncomingMessage, fromProxy: boolean, appOrigin = process.env.APP_ORIGIN) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? 'GET')) return;
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'La solicitud no está permitida.');
  const origin = request.headers.origin;
  if (!origin) throw new HttpError(403, 'La solicitud no está permitida.');
  const forwardedProto = request.headers['x-forwarded-proto'];
  const protocol = fromProxy && typeof forwardedProto === 'string' && forwardedProto.split(',').at(-1)?.trim() === 'https' ? 'https' : 'http';
  const expected = appOrigin ?? protocol + '://' + request.headers.host;
  try {
    if (origin === 'null' || new URL(origin).origin !== new URL(expected).origin || origin !== new URL(origin).origin) throw new Error();
  } catch { throw new HttpError(403, 'La solicitud no está permitida.'); }
}

export function usernameValue(value: unknown) {
  if (typeof value !== 'string') throw new HttpError(400, 'Ingresa un usuario válido.');
  const username = value.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,32}$/.test(username)) throw new HttpError(400, 'El usuario debe tener de 3 a 32 letras, números o guiones bajos.');
  return username;
}
function passwordValue(value: unknown) {
  if (typeof value !== 'string' || [...value].length < 8 || [...value].length > 128) throw new HttpError(400, 'La contraseña debe tener de 8 a 128 caracteres.');
  return value;
}
function rememberSessionValue(value: unknown) {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new HttpError(400, 'La opción de recordar sesión no es válida.');
  return value;
}

export function createAuth(database: DatabaseSync, { now = Date.now, secureCookie = process.env.NODE_ENV === 'production' }: { now?: () => number; secureCookie?: boolean } = {}) {
  const cookieName = secureCookie ? '__Host-vs_session' : 'vs_session';
  const sessionToken = (request: IncomingMessage) => request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1) ?? '';
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS request_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0, strikes INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
  `);
  initializeAccountPolicy(database, now());
  const authenticated = new WeakMap<IncomingMessage, User>();
  let activeHashes = 0;
  const hash = (password: string, salt: string): Promise<Buffer> => {
    // Bound scrypt memory and its queue before consuming the shared worker pool.
    if (activeHashes >= 2) throw new HttpError(429, 'Inténtalo de nuevo en unos segundos.', 2);
    activeHashes++;
    return new Promise((accept, reject) => scrypt(password, salt, 64, { N: 32768, r: 8, p: 3, maxmem: 48 * 1024 * 1024 }, (error, key) => {
      activeHashes--; if (error) reject(error); else accept(key);
    }));
  };
  const getLimit = database.prepare('SELECT count, window_start, blocked_until, strikes FROM request_limits WHERE key = ?');
  const setLimit = database.prepare('INSERT INTO request_limits (key, count, window_start, blocked_until, strikes, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET count=excluded.count, window_start=excluded.window_start, blocked_until=excluded.blocked_until, strikes=excluded.strikes, updated_at=excluded.updated_at');
  const keyFor = (kind: string, identity: string) => kind + ':' + digest(identity);
  const rejectLimit = (until: number) => { throw new HttpError(429, 'Demasiados intentos. Inténtalo más tarde.', Math.max(1, Math.ceil((until - now()) / 1000))); };
  let lastCleanup = 0;
  const limit = (kind: string, identity: string, maximum: number, duration: number) => {
    const time = now(), key = keyFor(kind, identity), previous = getLimit.get(key) as LimitRow | undefined;
    if (previous && previous.blocked_until > time) rejectLimit(previous.blocked_until);
    const fresh = !previous || time - previous.window_start >= duration;
    const count = fresh ? 1 : previous.count + 1, start = fresh ? time : previous.window_start;
    setLimit.run(key, count, start, 0, 0, time);
    if (time - lastCleanup > 60 * MINUTE) {
      database.prepare('DELETE FROM request_limits WHERE updated_at < ? AND blocked_until < ?').run(time - 48 * 60 * MINUTE, time);
      database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(time); lastCleanup = time;
    }
    if (count > maximum) rejectLimit(start + duration);
  };
  const checkBlocked = (ip: string) => {
    const row = getLimit.get(keyFor('failed-ip', ip)) as LimitRow | undefined;
    if (row && row.blocked_until > now()) rejectLimit(row.blocked_until);
  };
  const failed = (ip: string) => {
    const time = now(), key = keyFor('failed-ip', ip), previous = getLimit.get(key) as LimitRow | undefined;
    const fresh = !previous || time - previous.window_start >= 15 * MINUTE;
    const count = fresh ? 1 : previous.count + 1;
    const strikes = (previous?.strikes ?? 0) + (count >= 10 ? 1 : 0);
    const block = count >= 10 ? time + Math.min(24 * 60 * MINUTE, 15 * MINUTE * 2 ** Math.min(strikes - 1, 7)) : 0;
    setLimit.run(key, count, fresh ? time : previous.window_start, block, strikes, time);
    if (block) rejectLimit(block);
  };
  const findUser = database.prepare('SELECT id, username, salt, password_hash, inactive_after FROM users WHERE username = ?');
  const session = (request: IncomingMessage): User | null => {
    const token = sessionToken(request);
    if (!/^[0-9a-f]{64}$/.test(token)) return null;
    const time = now();
    const user = database.prepare('SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ? AND inactive_after > ?').get(digest(token), time, time) as User | undefined;
    if (user) authenticated.set(request, user);
    return user ?? null;
  };
  const revoke = (request: IncomingMessage) => { const token = sessionToken(request); if (/^[0-9a-f]{64}$/.test(token)) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(digest(token)); };
  const cookie = (response: ServerResponse, value: string, age?: number) => response.setHeader('Set-Cookie', cookieName + '=' + value + '; Path=/; HttpOnly; SameSite=Lax' + (age === undefined ? '' : '; Max-Age=' + age) + (secureCookie ? '; Secure' : ''));
  const startSession = (request: IncomingMessage, response: ServerResponse, user: User, rememberSession: boolean) => {
    const token = randomBytes(32).toString('hex'), time = now();
    if (!database.prepare('SELECT id FROM users WHERE id = ? AND inactive_after > ?').get(user.id, time)) throw new HttpError(401, 'Usuario o contraseña incorrectos.');
    touchAccount(database, user.id, time);
    revoke(request);
    database.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 9)').run(user.id, user.id);
    database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(digest(token), user.id, time + SESSION_TIME, time);
    cookie(response, token, rememberSession ? SESSION_TIME / 1000 : undefined);
    return { id: user.id, username: user.username };
  };
  return {
    limit, checkBlocked, session,
    touchSuccessfulRequest(request: IncomingMessage) { const user = authenticated.get(request); if (user) touchAccount(database, user.id, now()); },
    requireUser(request: IncomingMessage) { const user = session(request); if (!user) throw new HttpError(401, 'Inicia sesión para continuar.'); return user; },
    async register(request: IncomingMessage, response: ServerResponse, body: Record<string, unknown>, ip: string) {
      limit('register-attempt', ip, 20, 15 * MINUTE);
      const username = usernameValue(body.username), password = passwordValue(body.password), rememberSession = rememberSessionValue(body.rememberSession);
      if (body.confirmPassword !== password) throw new HttpError(400, 'Las contraseñas no coinciden.');
      if (body.termsVersion !== TERMS_VERSION) throw new HttpError(400, 'Acepta las condiciones de uso para crear tu cuenta.');
      limit('register', ip, 5, 60 * MINUTE);
      const salt = randomBytes(16).toString('hex'), passwordHash = (await hash(password, salt)).toString('hex');
      if (findUser.get(username)) throw new HttpError(409, 'Ese usuario no está disponible.');
      const user = { id: randomUUID(), username };
      const time = now();
      database.prepare('INSERT INTO users (id, username, salt, password_hash, created_at, last_active_at, inactive_after, terms_version, terms_accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(user.id, username, salt, passwordHash, time, time, inactivityDeadline(time), TERMS_VERSION, time);
      return startSession(request, response, user, rememberSession);
    },
    async login(request: IncomingMessage, response: ServerResponse, body: Record<string, unknown>, ip: string) {
      limit('login-attempt', ip, 30, 15 * MINUTE);
      const username = usernameValue(body.username), password = passwordValue(body.password), rememberSession = rememberSessionValue(body.rememberSession);
      // Pair-specific throttling avoids letting attackers lock an account for other IPs.
      limit('login-pair', ip + '\0' + username, 5, 15 * MINUTE);
      const found = findUser.get(username) as UserRow | undefined;
      const user = found && found.inactive_after > now() ? found : undefined;
      const candidate = await hash(password, user?.salt ?? '1'.repeat(32));
      const expected = user ? Buffer.from(user.password_hash, 'hex') : Buffer.alloc(64);
      if (!timingSafeEqual(candidate, expected) || !user) { failed(ip); throw new HttpError(401, 'Usuario o contraseña incorrectos.'); }
      const current = findUser.get(username) as UserRow | undefined;
      if (!current || current.id !== user.id || current.inactive_after <= now()) throw new HttpError(401, 'Usuario o contraseña incorrectos.');
      database.prepare('DELETE FROM request_limits WHERE key = ?').run(keyFor('login-pair', ip + '\0' + username));
      return startSession(request, response, user, rememberSession);
    },
    logout(request: IncomingMessage, response: ServerResponse) { revoke(request); cookie(response, '', 0); },
  };
}
