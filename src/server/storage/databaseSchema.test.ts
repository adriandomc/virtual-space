import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { DATABASE_APPLICATION_ID, DATABASE_VERSION, assertCurrentDatabase, initializeDatabase } from './databaseSchema';
import { createServer } from '../server';

test('the only schema is atomically initialized with every current table, index, policy and file field', () => {
  const database = new DatabaseSync(':memory:');
  try {
    initializeDatabase(database); assertCurrentDatabase(database);
    assert.equal(database.prepare('PRAGMA user_version').get()!.user_version, DATABASE_VERSION);
    assert.equal(database.prepare('PRAGMA application_id').get()!.application_id, DATABASE_APPLICATION_ID);
    assert.deepEqual(database.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all().map(row => row.name), ['model_assets', 'mutation_receipts', 'project_levels', 'project_sketches', 'request_limits', 'room_members', 'rooms', 'sessions', 'users']);
    assert.ok(database.prepare('PRAGMA table_info(project_sketches)').all().some(row => row.name === 'mutation_id'));
    assert.ok(database.prepare('PRAGMA table_info(rooms)').all().some(row => row.name === 'y_state'));
    assert.equal(database.prepare('PRAGMA table_info(users)').all().filter(row => String(row.name).startsWith('terms_')).every(row => row.notnull === 1), true);
    const before = database.prepare('SELECT * FROM sqlite_schema').all();
    initializeDatabase(database); assert.deepEqual(database.prepare('SELECT * FROM sqlite_schema').all(), before);
    assert.equal(database.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok');
  } finally { database.close(); }
});

test('unknown versions, partial schemas and current versions with altered tables are rejected without mutation', () => {
  for (const schema of ['CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES (\'do-not-erase\')', 'PRAGMA user_version=99', 'PRAGMA application_id=123']) {
    const database = new DatabaseSync(':memory:');
    try {
      database.exec(schema);
      const before = database.prepare('SELECT * FROM sqlite_schema').all();
      assert.throws(() => initializeDatabase(database), /Incompatible/);
      assert.deepEqual(database.prepare('SELECT * FROM sqlite_schema').all(), before);
    } finally { database.close(); }
  }
  const database = new DatabaseSync(':memory:');
  try { initializeDatabase(database); database.exec('DROP INDEX sessions_user'); assert.throws(() => initializeDatabase(database), /Incompatible/); }
  finally { database.close(); }
});

test('server startup refuses a prototype database and does not rewrite its contents or journal mode', () => {
  const directory = mkdtempSync(join(tmpdir(), '3d-space-schema-test-')), path = join(directory, 'accounts.sqlite');
  const database = new DatabaseSync(path);
  database.exec("CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('preserve')"); database.close();
  const before = readFileSync(path);
  try { assert.throws(() => createServer({ dataDir: directory, maintenance: false }), /Incompatible/); assert.deepEqual(readFileSync(path), before); }
  finally { rmSync(directory, { recursive: true, force: true }); }
});
