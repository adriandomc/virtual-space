import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as rawRequest, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import test from 'node:test';
import { accountUsage } from '../../src/server/resources/accountQuota';
import { createDefaultProject } from '../../src/domain/project/projectDocument';
import { createServer } from '../../src/server/server';
import { readProjectScope, writeProjectScope } from '../../src/domain/collaboration/collaborativeProject';
import { initializeTestDatabase, insertTestRoom, insertTestSession, insertTestUser } from '../fixtures/serverTestFixtures';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X9S8AAAAASUVORK5CYII=', 'base64');
const stop = (server: Server) => new Promise<void>(accept => server.close(() => accept()));
async function fixture({ designs = 50, bytes = 500 * 1024 * 1024, receipts = 100000, prepared = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), '3d-resource-test-')), dataDir = join(directory, 'data'), staticDir = join(directory, 'dist');
  mkdirSync(dataDir); mkdirSync(join(staticDir, 'assets'), { recursive: true });
  writeFileSync(join(staticDir, 'index.html'), '<html>3D Space</html>');
  writeFileSync(join(staticDir, 'assets', 'sample.js'), 'console.log("ready");'.repeat(prepared ? 150000 : 1000));
  if (prepared) writeFileSync(join(staticDir, 'assets', 'sample.wasm'), readFileSync(resolve('public/decoders/basis/basis_transcoder.wasm')));
  if (prepared) execFileSync(process.execPath, [resolve('scripts/build-static-assets.mjs'), staticDir]);
  const database = new DatabaseSync(join(dataDir, 'accounts.sqlite')); initializeTestDatabase(database);
  const owner = randomUUID(), token = 'c'.repeat(64); insertTestUser(database, owner);
  insertTestSession(database, createHash('sha256').update(token).digest('hex'), owner, Date.now() + 86400000);
  const project = insertTestRoom(database, randomUUID(), owner), effectiveBytes = bytes || accountUsage(database, owner).bytes + png.length; database.close();
  const oldDesigns = process.env.ACCOUNT_MAX_DESIGNS, oldBytes = process.env.ACCOUNT_MAX_BYTES, oldReceipts = process.env.ACCOUNT_MAX_RECEIPTS;
  process.env.ACCOUNT_MAX_DESIGNS = String(designs); process.env.ACCOUNT_MAX_BYTES = String(effectiveBytes); process.env.ACCOUNT_MAX_RECEIPTS = String(receipts);
  let server: Server;
  try { server = createServer({ dataDir, staticDir, maintenance: false, secureCookie: false }); }
  finally {
    if (oldDesigns === undefined) delete process.env.ACCOUNT_MAX_DESIGNS; else process.env.ACCOUNT_MAX_DESIGNS = oldDesigns;
    if (oldBytes === undefined) delete process.env.ACCOUNT_MAX_BYTES; else process.env.ACCOUNT_MAX_BYTES = oldBytes;
    if (oldReceipts === undefined) delete process.env.ACCOUNT_MAX_RECEIPTS; else process.env.ACCOUNT_MAX_RECEIPTS = oldReceipts;
  }
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port, headers = { Cookie: 'vs_session=' + token, Origin: base };
  return { directory, dataDir, staticDir, server, owner, project, base, headers,
    async dispose() { await stop(server); rmSync(directory, { recursive: true, force: true }); } };
}

test('HTTP creation is quota-limited while retry, read, export source and deletion stay usable', async () => {
  const f = await fixture({ designs: 1 });
  try {
    const post = (project = f.project) => fetch(f.base + '/api/rooms', { method: 'POST', headers: { ...f.headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: project.id, project }) });
    assert.equal((await post()).status, 200, 'a lost creation confirmation must not consume another slot');
    assert.equal((await post(createDefaultProject())).status, 413);
    assert.equal((await fetch(f.base + '/api/rooms/' + f.project.id, { headers: f.headers })).status, 200);
    assert.equal((await fetch(f.base + '/api/rooms/' + f.project.id, { method: 'DELETE', headers: f.headers })).status, 200);
    assert.equal((await post(createDefaultProject())).status, 201, 'deletion releases capacity');
  } finally { await f.dispose(); }
});

test('HTTP and WebSocket receipt limits return retry guidance without changing saved content', async () => {
  const f = await fixture({ receipts: 1 }); let socket: WebSocket | undefined;
  try {
    const path = '/api/rooms/' + f.project.id, headers = { ...f.headers, 'Content-Type': 'application/json' }, operationId = randomUUID();
    const body = JSON.stringify({ project: f.project, revision: 1, operationId });
    assert.equal((await fetch(f.base + path, { method: 'PUT', headers, body })).status, 200);
    const blocked = await fetch(f.base + path, { method: 'PUT', headers, body: JSON.stringify({ project: f.project, revision: 2, operationId: randomUUID() }) });
    assert.equal(blocked.status, 429); assert.ok(Number(blocked.headers.get('retry-after')) > 0);
    assert.equal((await fetch(f.base + path, { method: 'PUT', headers, body })).status, 200, 'an existing receipt still acknowledges a lost confirmation');
    socket = new WebSocket(f.base.replace('http:', 'ws:') + path + '/live', { headers: f.headers });
    const message = () => new Promise<Record<string, any>>((accept, reject) => {
      const timeout = setTimeout(() => reject(new Error('Missing receipt test message.')), 5000);
      socket!.once('message', data => { clearTimeout(timeout); accept(JSON.parse(data.toString())); });
    });
    const initial = await message(); assert.equal(initial.type, 'sync');
    const doc = new Y.Doc();
    try {
      Y.applyUpdate(doc, Buffer.from(initial.states.meta, 'base64'));
      const previous = readProjectScope(doc), vector = Y.encodeStateVector(doc);
      writeProjectScope(doc, { ...previous, name: 'A larger project name' }, previous);
      const response = message(); socket.send(JSON.stringify({ type: 'update', id: randomUUID(), scope: 'meta', update: Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString('base64') }));
      const rejected = await response; assert.equal(rejected.type, 'error'); assert.equal(rejected.status, 429); assert.ok(rejected.retryAfter > 0); assert.equal(rejected.revision, 2); assert.equal(rejected.project.name, f.project.name);
    } finally { doc.destroy(); socket.terminate(); }
    const reduced = await fetch(f.base + path, { method: 'PUT', headers, body: JSON.stringify({ project: { ...f.project, name: 'A' }, revision: 2, operationId: randomUUID() }) });
    assert.equal(reduced.status, 200); assert.equal((await reduced.json()).revision, 3);
    assert.equal((await fetch(f.base + path, { method: 'DELETE', headers })).status, 200);
  } finally { socket?.terminate(); await f.dispose(); }
});

test('HTTP sketches reject decoded size bombs and atomically keep the previous image over quota', async () => {
  const f = await fixture({ bytes: 0 });
  try {
    const path = '/api/rooms/' + f.project.id + '/levels/' + f.project.activeLevelId + '/sketch';
    const put = (bytes: Buffer, version = 0) => fetch(f.base + path, { method: 'PUT', headers: { ...f.headers, 'Content-Type': 'image/png', 'X-Sketch-Version': String(version), 'X-Room-Revision': '1', 'X-Sketch-Request-Id': randomUUID() }, body: new Uint8Array(bytes) });
    const huge = Buffer.from(png); huge.writeUInt32BE(8192, 16); huge.writeUInt32BE(8192, 20);
    assert.equal((await put(huge)).status, 400);
    assert.equal((await put(png)).status, 200);
    assert.equal((await put(Buffer.concat([png, Buffer.alloc(1)]), 1)).status, 413);
    const saved = await fetch(f.base + path, { headers: f.headers });
    assert.deepEqual(Buffer.from(await saved.arrayBuffer()), png);
    assert.equal((await fetch(f.base + path, { method: 'DELETE', headers: { ...f.headers, 'X-Sketch-Version': '1', 'X-Room-Revision': '1', 'X-Sketch-Request-Id': randomUUID() } })).status, 200);
  } finally { await f.dispose(); }
});

test('unfinished uploads reject a second body early and abort releases the account reservation', async () => {
  const f = await fixture(), path = '/api/rooms/' + f.project.id + '/levels/' + f.project.activeLevelId + '/sketch';
  const headers = { ...f.headers, 'Content-Type': 'image/png', 'X-Sketch-Version': '0', 'X-Room-Revision': '1', 'X-Sketch-Request-Id': randomUUID() };
  const pending = rawRequest(f.base + path, { method: 'PUT', headers });
  pending.on('error', () => {}); pending.write(png.subarray(0, 4));
  try {
    await new Promise(accept => setTimeout(accept, 30));
    const blocked = await fetch(f.base + path, { method: 'PUT', headers, body: new Uint8Array(png) });
    assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '5');
    pending.destroy(); await new Promise(accept => setTimeout(accept, 30));
    const next = await fetch(f.base + path, { method: 'PUT', headers, body: new Uint8Array(png) }); assert.equal(next.status, 200);
  } finally { pending.destroy(); await f.dispose(); }
});

test('slow project JSON bodies have a separate bounded allowance and abort releases it', async () => {
  const f = await fixture(), path = '/api/rooms/' + f.project.id;
  const headers = { ...f.headers, 'Content-Type': 'application/json' };
  const pending = Array.from({ length: 2 }, () => { const request = rawRequest(f.base + path, { method: 'PUT', headers }); request.on('error', () => {}); request.write('{'); return request; });
  try {
    await new Promise(accept => setTimeout(accept, 30));
    const blocked = await fetch(f.base + path, { method: 'PUT', headers, body: JSON.stringify({ project: f.project, revision: 1, operationId: randomUUID() }) });
    assert.equal(blocked.status, 429); assert.equal(blocked.headers.get('retry-after'), '5');
    pending.forEach(request => request.destroy()); await new Promise(accept => setTimeout(accept, 30));
    const saved = await fetch(f.base + path, { method: 'PUT', headers, body: JSON.stringify({ project: f.project, revision: 1, operationId: randomUUID() }) }); assert.equal(saved.status, 200);
  } finally { pending.forEach(request => request.destroy()); await f.dispose(); }
});

test('production static metadata supplies compression and conditional responses without blocking API routes', async context => {
  const f = await fixture({ prepared: true });
  try {
    const manifest = JSON.parse(readFileSync(join(f.staticDir, '.http-assets.json'), 'utf8'));
    const response = await fetch(f.base + '/assets/sample.js', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-encoding'), 'gzip');
    assert.equal(response.headers.get('etag'), manifest.files['assets/sample.js'].etag);
    assert.match(await response.text(), /console.log/);
    const decoder = await fetch(f.base + '/assets/sample.wasm', { headers: { 'Accept-Encoding': 'gzip' } });
    assert.equal(decoder.headers.get('content-type'), 'application/wasm'); assert.equal(decoder.headers.get('content-encoding'), 'gzip');
    assert.deepEqual(Buffer.from(await decoder.arrayBuffer()), readFileSync(resolve('public/decoders/basis/basis_transcoder.wasm')));
    const cached = await fetch(f.base + '/assets/sample.js', { headers: { 'If-None-Match': response.headers.get('etag')! } }); assert.equal(cached.status, 304);
    const downloads = Promise.all(Array.from({ length: 12 }, async () => {
      const started = performance.now(), item = await fetch(f.base + '/assets/sample.js');
      assert.ok(item.ok); await item.arrayBuffer(); return performance.now() - started;
    }));
    const apiStarted = performance.now();
    assert.equal((await fetch(f.base + '/api/auth/session', { headers: f.headers })).status, 200);
    const apiMs = performance.now() - apiStarted, timings = (await downloads).sort((a,b) => a-b);
    context.diagnostic(JSON.stringify({ parallelLoads: 12, assetMiB: 3, apiMs: Math.round(apiMs), downloadP95Ms: Math.round(timings[Math.floor(timings.length * .95)]) }));
    assert.equal((await fetch(f.base + '/service-worker.js')).status, 404);
    assert.equal((await fetch(f.base + '/.http-assets.json')).status, 403);
    assert.equal((await fetch(f.base + '/')).headers.get('cache-control'), 'no-cache');
  } finally { await f.dispose(); }
});
