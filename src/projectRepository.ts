import type { DatabaseSync } from 'node:sqlite';
import type { ProjectDocument } from './projectDocument.js';
import { projectMetadata } from './projectMetadata.js';
import * as Y from 'yjs';
import { projectScopes, writeProjectScope } from './collaborativeProject.js';
import { sameData, stableStringify } from './sameData.js';
export { projectMetadata } from './projectMetadata.js';

export type SketchState = { hasSketch: boolean; version: number; mutationId: string | null };
type Encoding = { metadata: string; levels: Map<string, string>; json: string; bytes: number };
type CachedProject = Encoding & { revision: number; project: ProjectDocument };
const cacheLimits = { entries: 32, bytes: 16 * 1024 * 1024 };
const caches = new WeakMap<DatabaseSync, Map<string, CachedProject>>();
const encodedProjects = new WeakMap<ProjectDocument, string>();
const cache = (database: DatabaseSync) => { let value = caches.get(database); if (!value) { value = new Map(); caches.set(database, value); } return value; };
const immutable = <T>(value: T): T => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { for (const child of Object.values(value)) immutable(child); Object.freeze(value); } return value; };
// Deterministic encoding keeps retry hashes independent of JSON object key order.
function encodeProject(project: ProjectDocument, previous?: CachedProject, changed?: ReadonlySet<string>): Encoding {
  const reuseMetadata = previous && (changed ? !changed.has('meta') : sameData(projectMetadata(previous.project), projectMetadata(project)));
  const metadata = reuseMetadata ? previous.metadata : stableStringify(projectMetadata(project));
  const levels = new Map<string, string>();
  project.levels.forEach(level => {
    const old = previous?.project.levels.find(value => value.id === level.id);
    const reuse = previous && old && (changed ? !changed.has(level.id) : sameData(old, level));
    levels.set(level.id, reuse ? previous.levels.get(level.id)! : stableStringify(level));
  });
  const json = metadata.slice(0, -1) + ',"levels":[' + project.levels.map(level => levels.get(level.id)).join(',') + ']}';
  return { metadata, levels, json, bytes: (metadata.length + [...levels.values()].reduce((sum, value) => sum + value.length, 0) + json.length) * 2 };
}
export function invalidateProjectCache(database: DatabaseSync, id: string) { cache(database).delete(id); }
export function clearProjectCache(database: DatabaseSync) { caches.delete(database); }
export function projectCacheStats(database: DatabaseSync) { const entries = cache(database); return { entries: entries.size, bytes: [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0), limits: cacheLimits }; }
/** Only call after COMMIT; callers cannot mutate shared cached canonical values. */
export function confirmProject(database: DatabaseSync, project: ProjectDocument, revision: number, changed?: ReadonlySet<string>): ProjectDocument {
  if (database.isTransaction) throw new Error('Cannot cache an uncommitted project.');
  const entries = cache(database), previous = entries.get(project.id), encoding = encodeProject(project, previous, changed);
  const metadata = previous && changed && !changed.has('meta') ? projectMetadata(previous.project) : structuredClone(projectMetadata(project));
  const owned = immutable({ ...metadata, levels: project.levels.map(level => {
    const old = previous?.project.levels.find(value => value.id === level.id);
    return old && changed && !changed.has(level.id) ? old : structuredClone(level);
  }) } as ProjectDocument);
  entries.delete(project.id); entries.set(project.id, { ...encoding, project: owned, revision }); encodedProjects.set(owned, encoding.json);
  let bytes = [...entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  while (entries.size > cacheLimits.entries || bytes > cacheLimits.bytes) { const first = entries.entries().next().value; if (!first) break; entries.delete(first[0]); bytes -= first[1].bytes; }
  return owned;
}
/** Preserve canonical snapshot payloads while avoiding repeated encoding of untouched levels. */
export function stringifyProjectPayload(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const payload = value as Record<string, unknown>, project = payload.project as ProjectDocument | undefined, json = project && encodedProjects.get(project);
    if (json) return '{' + Object.entries(payload).filter(([, field]) => field !== undefined).map(([key, field]) => JSON.stringify(key) + ':' + (key === 'project' ? json : JSON.stringify(field))).join(',') + '}';
  }
  return JSON.stringify(value);
}
export function projectMutationHashPayload(database: DatabaseSync, project: ProjectDocument, revision: number): string {
  const encoded = encodeProject(project, cache(database).get(project.id));
  return '{"project":' + encoded.json + ',"revision":' + revision + '}';
}
export function readProject(database: DatabaseSync, id: string): ProjectDocument {
  const row = database.prepare('SELECT room,revision FROM rooms WHERE id=?').get(id) as { room: string; revision: number } | undefined;
  if (!row) { invalidateProjectCache(database, id); throw new Error('Este proyecto no existe.'); }
  const entries = cache(database), previous = entries.get(id);
  if (!database.isTransaction && previous?.revision === row.revision) { entries.delete(id); entries.set(id, previous); return previous.project; }
  const levels = database.prepare('SELECT document FROM project_levels WHERE room_id=? ORDER BY ordinal').all(id) as { document: string }[];
  const project = { ...JSON.parse(row.room), levels: levels.map(level => JSON.parse(level.document)) } as ProjectDocument;
  return database.isTransaction ? immutable(project) : confirmProject(database, project, row.revision);
}
/** Caller owns the transaction, including canonical JSON, Y states and operation receipt. */
export function writeProject(database: DatabaseSync, project: ProjectDocument, changed?: ReadonlySet<string>) {
  const encoding = encodeProject(project, cache(database).get(project.id), changed);
  if (!changed) invalidateProjectCache(database, project.id);
  const previous = database.prepare('SELECT id,ordinal FROM project_levels WHERE room_id=?').all(project.id) as { id: string; ordinal: number }[];
  for (const level of previous) if (!project.levels.some(next => next.id === level.id)) {
    // Keep the version after removing a level: undo/re-add must not reuse an old
    // sketch version that an erasure ledger has already invalidated.
    database.prepare('UPDATE project_sketches SET data=NULL,mime=NULL,version=version+1,mutation_id=NULL WHERE room_id=? AND level_id=?').run(project.id, level.id);
    database.prepare('DELETE FROM project_levels WHERE room_id=? AND id=?').run(project.id, level.id);
  }
  // Vacate unique ordinal slots before moving existing levels.
  const reordered = previous.some(level => project.levels.findIndex(next => next.id === level.id) !== level.ordinal);
  if (reordered) database.prepare('UPDATE project_levels SET ordinal=-ordinal-1 WHERE room_id=?').run(project.id);
  project.levels.forEach((level, ordinal) => {
    const old = previous.find(value => value.id === level.id);
    if (old) {
      if (changed && !changed.has(level.id)) { if (reordered) database.prepare('UPDATE project_levels SET ordinal=? WHERE room_id=? AND id=?').run(ordinal, project.id, level.id); }
      else database.prepare('UPDATE project_levels SET ordinal=?,document=? WHERE room_id=? AND id=?').run(ordinal, encoding.levels.get(level.id)!, project.id, level.id);
    } else database.prepare('INSERT INTO project_levels(room_id,id,ordinal,document) VALUES(?,?,?,?)').run(project.id, level.id, ordinal, encoding.levels.get(level.id)!);
    if (!old) database.prepare('INSERT OR IGNORE INTO project_sketches(room_id,level_id) VALUES(?,?)').run(project.id, level.id);
  });
  if (!changed || changed.has('meta')) database.prepare('UPDATE rooms SET room=? WHERE id=? AND room<>?').run(encoding.metadata, project.id, encoding.metadata);
}
export function readSketchStates(database: DatabaseSync, id: string): Record<string, SketchState> {
  return Object.fromEntries((database.prepare('SELECT level_id,version,mutation_id,data IS NOT NULL AS has_sketch FROM project_sketches sketches JOIN project_levels levels ON levels.room_id=sketches.room_id AND levels.id=sketches.level_id WHERE sketches.room_id=?').all(id) as { level_id: string; version: number; mutation_id: string | null; has_sketch: number }[]).map(row => [row.level_id, { hasSketch: row.has_sketch === 1, version: row.version, mutationId: row.mutation_id }]));
}
export function removedSketchStates(database: DatabaseSync, project: ProjectDocument) {
  return (database.prepare('SELECT sketches.level_id,sketches.version FROM project_sketches sketches JOIN project_levels levels ON levels.room_id=sketches.room_id AND levels.id=sketches.level_id WHERE sketches.room_id=?').all(project.id) as { level_id: string; version: number }[]).filter(row => !project.levels.some(level => level.id === row.level_id)).map(row => ({ levelId: row.level_id, version: row.version + 1 }));
}
/** Persist initial CRDT actors in the caller's transaction, before any client can edit them. */
export function seedProjectStates(database: DatabaseSync, project: ProjectDocument) {
  for (const [scope, value] of Object.entries(projectScopes(project))) {
    const row = scope === 'meta' ? database.prepare('SELECT y_state FROM rooms WHERE id=?').get(project.id) : database.prepare('SELECT y_state FROM project_levels WHERE room_id=? AND id=?').get(project.id, scope);
    if (row?.y_state) continue;
    const doc = new Y.Doc();
    try {
      writeProjectScope(doc, value); const state = Y.encodeStateAsUpdate(doc);
      if (scope === 'meta') database.prepare('UPDATE rooms SET y_state=? WHERE id=?').run(state, project.id);
      else database.prepare('UPDATE project_levels SET y_state=? WHERE room_id=? AND id=?').run(state, project.id, scope);
    } finally { doc.destroy(); }
  }
}
