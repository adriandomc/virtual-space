import { DatabaseSync } from 'node:sqlite';

export const DATABASE_VERSION = 3;
export const DATABASE_APPLICATION_ID = 0x33445350;

const schema = `
CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL, last_active_at INTEGER NOT NULL, inactive_after INTEGER NOT NULL, terms_version TEXT NOT NULL, terms_accepted_at INTEGER NOT NULL);
CREATE INDEX users_inactive_after ON users(inactive_after);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE request_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL, blocked_until INTEGER NOT NULL DEFAULT 0, strikes INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
CREATE TABLE rooms (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, room TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, structure_revision INTEGER NOT NULL DEFAULT 1, shared INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, y_state BLOB);
CREATE INDEX rooms_owner_updated ON rooms(owner_id, updated_at DESC);
CREATE TABLE project_levels (room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, id TEXT NOT NULL, ordinal INTEGER NOT NULL, document TEXT NOT NULL, structure_revision INTEGER NOT NULL DEFAULT 1, y_state BLOB, PRIMARY KEY(room_id, id), UNIQUE(room_id, ordinal));
CREATE TABLE project_sketches (room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, level_id TEXT NOT NULL, data BLOB, mime TEXT, version INTEGER NOT NULL DEFAULT 0, mutation_id TEXT, PRIMARY KEY(room_id, level_id));
CREATE TABLE mutation_receipts (room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, hash TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(room_id, id));
CREATE INDEX mutation_receipts_time ON mutation_receipts(created_at);
CREATE TABLE room_members (id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, inviter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('reader', 'editor')), accepted_at INTEGER, created_at INTEGER NOT NULL, UNIQUE(room_id, user_id));
CREATE INDEX room_members_user ON room_members(user_id, accepted_at);
CREATE TABLE model_assets (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE, name TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL, metadata TEXT NOT NULL, data BLOB NOT NULL);
CREATE INDEX model_assets_owner ON model_assets(owner_id);
CREATE INDEX model_assets_room ON model_assets(room_id);
`;
const readSchema = (database: DatabaseSync) => JSON.stringify(database.prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type, name").all());
let expectedSchema: string | undefined;
function currentSchema() {
  if (expectedSchema) return expectedSchema;
  const reference = new DatabaseSync(':memory:');
  try { reference.exec(schema); expectedSchema = readSchema(reference); return expectedSchema; }
  finally { reference.close(); }
}

export function assertCurrentDatabase(database: DatabaseSync) {
  if (database.prepare('PRAGMA user_version').get()!.user_version !== DATABASE_VERSION || database.prepare('PRAGMA application_id').get()!.application_id !== DATABASE_APPLICATION_ID || readSchema(database) !== currentSchema()) {
    throw new Error('Incompatible 3D Space database. Stop the service and use the explicit prelaunch reset operation; existing data was not modified.');
  }
}

/** Only a completely empty database may be initialized; an unknown schema is never erased. */
export function initializeDatabase(database: DatabaseSync) {
  const empty = !database.prepare('SELECT 1 FROM sqlite_schema LIMIT 1').get();
  if (!empty || database.prepare('PRAGMA user_version').get()!.user_version !== 0 || database.prepare('PRAGMA application_id').get()!.application_id !== 0) { assertCurrentDatabase(database); return; }
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(schema + 'PRAGMA user_version=' + DATABASE_VERSION + '; PRAGMA application_id=' + DATABASE_APPLICATION_ID + '; COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}
