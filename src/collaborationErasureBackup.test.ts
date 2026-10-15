import { initializeTestDatabase, insertTestUser, insertTestSession, insertTestRoom } from './serverTestFixtures';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import * as Y from 'yjs';
import { restoreBackup, runBackup, verifyBackup } from './backups';
import { applyErasures, initializeErasures, recordErasure, wasErased } from './erasures';
import { roomRole } from './collaborationServer';
import { createDefaultRoom } from './model';
import { seedYRoom } from './collaborativeRoom';
import type { Room } from './types';

const time = Date.parse('2026-10-13T19:00:00Z');

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), '3d-space-collaboration-recovery-')), database = new DatabaseSync(join(directory, 'accounts.sqlite'));
  initializeTestDatabase(database);
  database.exec('PRAGMA journal_mode=WAL');
  const owner = randomUUID(), editor = randomUUID(), room = randomUUID(), otherRoom = randomUUID(), member = randomUUID(), asset = randomUUID(), retainedAsset = randomUUID();
  for (const [id, username] of [[owner, 'fixture_owner'], [editor, 'fixture_editor']]) insertTestUser(database, id, username, time);
  insertTestSession(database, 'old-session', editor, time + 30 * 24 * 60 * 60_000);
  const sharedRoom: Room = { ...createDefaultRoom(), furniture: [{ id: randomUUID(), type: 'custom', material: null, color: null, assetId: asset, name: 'Modelo eliminado', x: 0, z: 0, width: 1, height: 1, depth: 1, rotation: 0 }, { id: randomUUID(), type: 'custom', material: null, color: null, assetId: retainedAsset, name: 'Modelo conservado', x: 1.5, z: 0, width: .5, height: .5, depth: .5, rotation: 0 }] };
  const doc = new Y.Doc(); seedYRoom(doc, sharedRoom); const state = Y.encodeStateAsUpdate(doc); doc.destroy();
  for (const id of [room, otherRoom]) insertTestRoom(database, id, owner, { room: JSON.stringify(sharedRoom), revision: 8, sketch: Buffer.from([137, 80, 0, 255]), sketch_mime: 'image/png', sketch_version: 1, updated_at: time, y_state: state });
  database.prepare('INSERT INTO room_members VALUES (?, ?, ?, ?, ?, ?, ?)').run(member, room, editor, owner, 'editor', time, time);
  for (const [id, name] of [[asset, 'erased.glb'], [retainedAsset, 'retained.glb']]) database.prepare('INSERT INTO model_assets (id, owner_id, room_id, name, metadata, data, size, created_at) VALUES (?, ?, ?, ?, ?, ?, 6, 0)').run(id, owner, room, name, JSON.stringify({ width: 1, height: 1, depth: 1 }), Buffer.from([103, 108, 84, 70, 0, 255]));
  const ledger = initializeErasures(directory);
  return { directory, database, owner, editor, room, otherRoom, member, asset, retainedAsset, ledger, dispose() {
    database.close();
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('3d-space-collaboration-recovery-'));
    rmSync(directory, { recursive: true, force: true });
  } };
}

test('restoring an older backup does not revive revoked collaboration or deleted model BLOBs and Yjs references', async () => {
  const sample = fixture();
  try {
    const snapshot = await runBackup(sample.database, sample.directory, { now: time });
    recordErasure(sample.database, sample.ledger, { kind: 'member', id: sample.member, at: time + 1 }, () => { sample.database.prepare('DELETE FROM room_members WHERE id = ?').run(sample.member); });
    recordErasure(sample.database, sample.ledger, { kind: 'asset', id: sample.asset, at: time + 1 }, () => { sample.database.prepare('DELETE FROM model_assets WHERE id = ?').run(sample.asset); });
    const restored = restoreBackup(snapshot.path, join(sample.directory, 'restored'), { now: time + 2, erasureFile: sample.ledger });
    assert.equal(restored.recovered.digest, snapshot.verified.digest); assert.equal(verifyBackup(snapshot.path).digest, snapshot.verified.digest);
    const recovered = new DatabaseSync(restored.path, { readOnly: true });
    try {
      assert.equal(recovered.prepare('SELECT COUNT(*) AS total FROM room_members WHERE id = ?').get(sample.member)!.total, 0);
      assert.equal(recovered.prepare('SELECT COUNT(*) AS total FROM model_assets WHERE id = ?').get(sample.asset)!.total, 0);
      assert.deepEqual(recovered.prepare('SELECT data FROM model_assets WHERE id = ?').get(sample.retainedAsset)!.data, new Uint8Array([103, 108, 84, 70, 0, 255]));
      for (const row of recovered.prepare('SELECT room, y_state FROM rooms').all()) {
        const room = JSON.parse(String(row.room));
        assert.deepEqual(room.furniture.map((item: { assetId: string }) => item.assetId), [sample.retainedAsset]);
        assert.equal(row.y_state, null, 'old collaborative state cannot reintroduce deleted model references');
      }
      const row = recovered.prepare('SELECT *, 1 AS has_sketch FROM rooms WHERE id = ?').get(sample.room) as any;
      assert.equal(roomRole(recovered, row, { id: sample.editor, username: 'fixture_editor' }), null);
      assert.equal(roomRole(recovered, row, { id: sample.owner, username: 'fixture_owner' }), 'owner');
      assert.equal(recovered.prepare('SELECT COUNT(*) AS total FROM sessions').get()!.total, 0);
      assert.equal(recovered.prepare('PRAGMA foreign_key_check').all().length, 0);
    } finally { recovered.close(); }
    assert.equal(wasErased(sample.ledger, 'member', sample.member), true); assert.equal(wasErased(sample.ledger, 'asset', sample.asset), true);
    assert.deepEqual(JSON.parse(readFileSync(join(sample.directory, 'restored', 'erasures.json'), 'utf8')), JSON.parse(readFileSync(sample.ledger, 'utf8')));
  } finally { sample.dispose(); }
});

test('new explicit membership identities survive while a revoked old membership stays erased', async () => {
  const sample = fixture();
  try {
    recordErasure(sample.database, sample.ledger, { kind: 'member', id: sample.member, at: time + 1 }, () => sample.database.prepare('DELETE FROM room_members WHERE id = ?').run(sample.member));
    const replacement = randomUUID();
    sample.database.prepare('INSERT INTO room_members VALUES (?, ?, ?, ?, ?, ?, ?)').run(replacement, sample.room, sample.editor, sample.owner, 'reader', time + 2, time + 2);
    const snapshot = await runBackup(sample.database, sample.directory, { now: time + 3 });
    const restored = restoreBackup(snapshot.path, join(sample.directory, 'restored-new-access'), { now: time + 4, erasureFile: sample.ledger });
    const database = new DatabaseSync(restored.path);
    try {
      assert.equal(database.prepare('SELECT id, role FROM room_members').get()!.id, replacement);
      assert.equal(database.prepare('SELECT id, role FROM room_members').get()!.role, 'reader');
      const row = database.prepare('SELECT *, 1 AS has_sketch FROM rooms WHERE id = ?').get(sample.room) as any;
      assert.equal(roomRole(database, row, { id: sample.editor, username: 'fixture_editor' }), 'reader');
      assert.equal(applyErasures(database, sample.ledger, { now: time + 5 }), 0);
    } finally { database.close(); }
  } finally { sample.dispose(); }
});

test('deleting an account cascades collaborative access and uploaded model files in a restored snapshot', async () => {
  const sample = fixture();
  try {
    const snapshot = await runBackup(sample.database, sample.directory, { now: time });
    recordErasure(sample.database, sample.ledger, { kind: 'user', id: sample.owner, at: time + 1 }, () => sample.database.prepare('DELETE FROM users WHERE id = ?').run(sample.owner));
    const restored = restoreBackup(snapshot.path, join(sample.directory, 'restored-owner-erasure'), { now: time + 2, erasureFile: sample.ledger });
    const database = new DatabaseSync(restored.path, { readOnly: true });
    try {
      for (const table of ['rooms', 'room_members', 'model_assets', 'sessions']) assert.equal(database.prepare('SELECT COUNT(*) AS total FROM ' + table).get()!.total, 0);
      assert.equal(database.prepare('SELECT id FROM users').get()!.id, sample.editor);
      assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0);
    } finally { database.close(); }
  } finally { sample.dispose(); }
});
