import type { DatabaseSync } from 'node:sqlite';
import { initializeDatabase } from './databaseSchema';
import { TERMS_VERSION } from './legalPolicy';
import { createDefaultRoom } from './model';
import { inactivityDeadline } from './retention';

export function initializeTestDatabase(database: DatabaseSync) {
  database.exec('PRAGMA foreign_keys=ON');
  initializeDatabase(database);
}
export function insertTestUser(database: DatabaseSync, id: string, username = 'user_' + id.replaceAll('-', ''), time = Date.now()) {
  database.prepare('INSERT INTO users (id, username, salt, password_hash, created_at, last_active_at, inactive_after, terms_version, terms_accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, username, 'a'.repeat(32), 'b'.repeat(128), time, time, inactivityDeadline(time), TERMS_VERSION, time);
}
export function insertTestSession(database: DatabaseSync, token: string, userId: string, expiresAt: number, createdAt = expiresAt - 30 * 24 * 60 * 60_000) {
  database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(token, userId, expiresAt, createdAt);
}
export function insertTestRoom(database: DatabaseSync, id: string, ownerId: string, overrides: Record<string, unknown> = {}) {
  const values = { room: JSON.stringify(createDefaultRoom()), revision: 1, shared: 0, updated_at: Date.now(), sketch: null, sketch_mime: null, sketch_version: 0, sketch_mutation_id: null, y_state: null, ...overrides };
  database.prepare('INSERT INTO rooms (id, owner_id, ' + Object.keys(values).join(', ') + ') VALUES (' + Array(Object.keys(values).length + 2).fill('?').join(', ') + ')').run(id, ownerId, ...Object.values(values) as (string | number | null | Uint8Array)[]);
}
