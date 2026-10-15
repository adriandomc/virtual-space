import { TERMS_VERSION } from './legalPolicy';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { createServer } from './server';
import { createDefaultRoom } from './model';
import { writeYRoom, readYRoom } from './collaborativeRoom';
import { runBackup, restoreBackup } from './backups';

function modelData() {
  const document = { asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ name: 'Mueble', mesh: 0 }], scenes: [{ nodes: [0] }] };
  const raw = Buffer.from(JSON.stringify(document)), json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(json);
  const bytes = Buffer.alloc(28 + json.length + 36);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8); bytes.writeUInt32LE(json.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20); bytes.writeUInt32LE(36, 20 + json.length); bytes.writeUInt32LE(0x004e4942, 24 + json.length);
  [0, 0, 0, 1, 0, 0, 0, 1, 1].forEach((value, index) => bytes.writeFloatLE(value, 28 + json.length + index * 4));
  return bytes;
}
function nextMessage(socket: WebSocket, type: string) {
  return new Promise<Record<string, any>>((accept, reject) => {
    const timer = setTimeout(() => { socket.off('message', receive); reject(new Error('Missing WebSocket message ' + type)); }, 3000);
    const receive = (data: Buffer) => { const message = JSON.parse(data.toString()); if (message.type === type) { clearTimeout(timer); socket.off('message', receive); accept(message); } };
    socket.on('message', receive);
  });
}
test('GLB upload HTTP permissions, collaboration updates, erasure and restart retain exact room ownership', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), '3d-space-model-api-'));
  let server = createServer({ dataDir, maintenance: false }), socket: WebSocket | undefined;
  const listen = async () => {
    await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
    const address = server.address(); assert.ok(address && typeof address !== 'string'); return 'http://127.0.0.1:' + address.port;
  };
  let base = await listen();
  const cookies: Record<string, string> = {}, userIds: Record<string, string> = {};
  const request = (path: string, user?: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers: { Origin: base, 'Content-Type': 'application/json', ...(user ? { Cookie: cookies[user] } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const upload = (room: string, user: string) => fetch(base + '/api/models?room=' + room, { method: 'POST', headers: { Origin: base, Cookie: cookies[user], 'Content-Type': 'model/gltf-binary', 'X-Model-Name': encodeURIComponent('Ropero personalizado.glb') }, body: new Uint8Array(modelData()) });
  const close = () => new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept()));
  try {
    for (const username of ['owner', 'editor', 'reader', 'outsider']) {
      const response = await request('/api/auth/register', undefined, 'POST', { username, password: 'Testing-pass-123', confirmPassword: 'Testing-pass-123', termsVersion: TERMS_VERSION });
      assert.equal(response.status, 201); cookies[username] = response.headers.get('set-cookie')!.split(';')[0]; userIds[username] = (await response.json()).user.id;
    }
    const roomId = randomUUID(), secondRoom = randomUUID(), room = createDefaultRoom(), path = '/api/rooms/' + roomId;
    assert.equal((await request('/api/rooms', 'owner', 'POST', { id: roomId, room })).status, 201);
    assert.equal((await request('/api/rooms', 'owner', 'POST', { id: secondRoom, room })).status, 201);
    for (const username of ['editor', 'reader']) {
      const invite = await request(path + '/members', 'owner', 'POST', { username, role: username }); assert.equal(invite.status, 201);
      const notification = (await (await request('/api/notifications', username)).json()).notifications[0];
      assert.equal((await request('/api/notifications/' + notification.id + '/accept', username, 'POST', {})).status, 200);
    }
    assert.equal((await upload(roomId, 'reader')).status, 403);
    assert.equal((await upload(roomId, 'outsider')).status, 404);
    assert.equal((await request('/api/models', 'owner', 'POST', {})).status, 400);
    const uploaded = await upload(roomId, 'editor'); assert.equal(uploaded.status, 201);
    const asset = (await uploaded.json()).model;
    assert.equal(asset.name, 'Ropero personalizado'); assert.equal(asset.width, 1);
    const database = new DatabaseSync(join(dataDir, 'accounts.sqlite'));
    assert.equal(database.prepare('SELECT owner_id FROM model_assets WHERE id=?').get(asset.id)!.owner_id, userIds.owner); database.close();
    assert.equal((await request('/api/models/' + asset.id + '?room=' + roomId, 'editor')).status, 200);
    assert.equal((await request('/api/models/' + asset.id + '?room=' + roomId, 'outsider')).status, 404);
    assert.equal((await request('/api/models?room=' + roomId + '&scope=mine', 'outsider')).status, 404);
    assert.deepEqual((await (await request('/api/models?room=' + roomId + '&scope=mine', 'editor')).json()).models, []);
    assert.equal((await request('/api/models/' + asset.id, 'editor', 'DELETE')).status, 404);
    await request(path + '/share', 'owner', 'POST', { enabled: true });
    assert.equal((await request('/api/models/' + asset.id + '?room=' + roomId)).status, 404, 'unplaced uploads are not exposed by public links');
    const custom = { id: 'model-1', type: 'custom', material: null, color: null, assetId: asset.id, name: asset.name, width: 1, depth: 1, height: 1, x: 0, z: 0, rotation: 0 };
    assert.equal((await request('/api/rooms/' + secondRoom, 'owner', 'PUT', { revision: 1, room: { ...room, furniture: [custom] } })).status, 400);
    assert.equal((await request(path, 'editor', 'PUT', { revision: 1, room: { ...room, furniture: [custom] } })).status, 200);
    const bytes = await request('/api/models/' + asset.id + '?room=' + roomId); assert.equal(bytes.status, 200); assert.equal(bytes.headers.get('cache-control'), 'no-store'); assert.deepEqual(Buffer.from(await bytes.arrayBuffer()), modelData());
    assert.equal((await request('/api/models/' + asset.id + '?room=' + roomId, 'reader')).status, 200);
    assert.equal((await request('/api/models/' + asset.id, 'owner', 'DELETE')).status, 409);
    const ownUpload = await upload(secondRoom, 'owner'); assert.equal(ownUpload.status, 201); const wrongAsset = (await ownUpload.json()).model;
    const mine = (await (await request('/api/models?room=' + roomId + '&scope=mine', 'owner')).json()).models;
    assert.deepEqual(new Set(mine.map((value: { id: string }) => value.id)), new Set([asset.id, wrongAsset.id]));
    assert.equal(mine.find((value: { id: string }) => value.id === wrongAsset.id).roomId, secondRoom);
    const accountLibrary = (await (await request('/api/models?scope=mine', 'owner')).json()).models;
    assert.deepEqual(new Set(accountLibrary.map((value: { id: string }) => value.id)), new Set([asset.id, wrongAsset.id]));
    assert.equal(accountLibrary.find((value: { id: string }) => value.id === wrongAsset.id).roomId, secondRoom);
    assert.deepEqual((await (await request('/api/models?scope=mine', 'outsider')).json()).models, []);
    assert.equal((await request('/api/models?scope=mine')).status, 401);
    assert.equal((await request('/api/models?scope=unknown', 'owner')).status, 400);
    assert.equal((await request('/api/models?scope=mine&room=' + secondRoom, 'outsider')).status, 404);
    socket = new WebSocket(base.replace('http:', 'ws:') + path + '/live', { headers: { Origin: base, Cookie: cookies.editor } });
    socket.on('error', () => {});
    const sync = await nextMessage(socket, 'sync'), doc = new Y.Doc();
    Y.applyUpdate(doc, Buffer.from(sync.update, 'base64'));
    const previous = readYRoom(doc), vector = Y.encodeStateVector(doc);
    writeYRoom(doc, { ...previous, furniture: [{ ...previous.furniture[0], assetId: wrongAsset.id }] }, previous);
    const rejected = nextMessage(socket, 'error');
    socket.send(JSON.stringify({ type: 'update', id: randomUUID(), update: Buffer.from(Y.encodeStateAsUpdate(doc, vector)).toString('base64') }));
    assert.equal((await rejected).status, 400);
    assert.equal((await (await request(path, 'owner')).json()).room.furniture[0].assetId, asset.id);
    doc.destroy(); socket.terminate(); socket = undefined;
    const source = new DatabaseSync(join(dataDir, 'accounts.sqlite'));
    let snapshot: Awaited<ReturnType<typeof runBackup>>;
    try { snapshot = await runBackup(source, dataDir); } finally { source.close(); }
    assert.equal((await request('/api/models/' + wrongAsset.id, 'owner', 'DELETE')).status, 200);
    const ledger = JSON.parse(readFileSync(join(dataDir, 'erasures.json'), 'utf8')); assert.ok(ledger.entries.some((entry: { kind: string; id: string }) => entry.kind === 'asset' && entry.id === wrongAsset.id));
    const recovered = restoreBackup(snapshot.path, join(dataDir, 'restored'), { erasureFile: join(dataDir, 'erasures.json') });
    const restored = new DatabaseSync(recovered.path, { readOnly: true });
    try {
      assert.deepEqual(Buffer.from(restored.prepare('SELECT data FROM model_assets WHERE id=?').get(asset.id)!.data as Uint8Array), modelData());
      assert.equal(restored.prepare('SELECT id FROM model_assets WHERE id=?').get(wrongAsset.id), undefined, 'restoration cannot revive a deleted model');
      assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM sessions').get()!.count, 0);
      assert.equal(restored.prepare('SELECT COUNT(*) AS count FROM room_members WHERE accepted_at IS NOT NULL').get()!.count, 2);
      assert.equal(restored.prepare('PRAGMA foreign_key_check').all().length, 0);
    } finally { restored.close(); }
    await close(); server = createServer({ dataDir, maintenance: false }); base = await listen();
    assert.deepEqual(Buffer.from(await (await request('/api/models/' + asset.id + '?room=' + roomId)).arrayBuffer()), modelData());
    assert.equal((await request('/api/models/' + wrongAsset.id, 'owner')).status, 404);
    await request(path + '/share', 'owner', 'POST', { enabled: false });
    assert.equal((await request('/api/models/' + asset.id + '?room=' + roomId)).status, 404);
    assert.equal((await request(path, 'owner', 'DELETE')).status, 200);
    assert.equal((await request('/api/models/' + asset.id, 'owner')).status, 404);
    const sourceRoom = randomUUID(), destinationRoom = randomUUID();
    for (const id of [sourceRoom, destinationRoom]) assert.equal((await request('/api/rooms', 'owner', 'POST', { id, room })).status, 201);
    const sourceUpload = await upload(sourceRoom, 'owner'); assert.equal(sourceUpload.status, 201); const reusable = (await sourceUpload.json()).model;
    const copy = await fetch(base + '/api/models?room=' + destinationRoom, { method: 'POST', headers: { Origin: base, Cookie: cookies.owner, 'Content-Type': 'model/gltf-binary', 'X-Model-Name': encodeURIComponent(reusable.name) }, body: await (await request('/api/models/' + reusable.id, 'owner')).arrayBuffer() });
    assert.equal(copy.status, 201); const reused = (await copy.json()).model;
    assert.notEqual(reused.id, reusable.id); assert.equal(reused.roomId, destinationRoom);
    await request('/api/rooms/' + sourceRoom, 'owner', 'DELETE');
    assert.equal((await request('/api/models/' + reusable.id, 'owner')).status, 404);
    assert.deepEqual(Buffer.from(await (await request('/api/models/' + reused.id, 'owner')).arrayBuffer()), modelData());
    const offlineDelete = (context: string, revision: number, accountId = userIds.owner) => fetch(base + '/api/models/' + reused.id + '?room=' + context, { method: 'DELETE', headers: { Origin: base, Cookie: cookies.owner, 'Content-Type': 'application/json', 'X-Offline-Write': '1', 'X-Account-Id': accountId }, body: JSON.stringify({ revision }) });
    assert.equal((await offlineDelete(destinationRoom, 1, userIds.editor)).status, 403);
    assert.equal((await offlineDelete(secondRoom, 1)).status, 409, 'an unrelated eligible room cannot authorize model deletion');
    assert.equal((await offlineDelete(destinationRoom, 2)).status, 409, 'stale revisions cannot delete assets');
    const reusedItem = { ...custom, assetId: reused.id };
    assert.equal((await request('/api/rooms/' + destinationRoom, 'owner', 'PUT', { revision: 1, room: { ...room, furniture: [reusedItem] } })).status, 200);
    assert.equal((await offlineDelete(destinationRoom, 2)).status, 409, 'referenced models cannot be deleted');
    assert.equal((await request('/api/rooms/' + destinationRoom, 'owner', 'PUT', { revision: 2, room })).status, 200);
    assert.equal((await offlineDelete(destinationRoom, 3)).status, 200);
    assert.equal((await request('/api/models/' + reused.id, 'owner')).status, 404);
  } finally { socket?.terminate(); await close(); rmSync(dataDir, { recursive: true, force: true }); }
});
