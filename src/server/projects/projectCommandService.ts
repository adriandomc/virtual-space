import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import * as Y from 'yjs';
import { HttpError } from '../auth/auth.js';
import { projectStructure, validateProjectDocument, type ProjectDocument } from '../../domain/project/projectDocument.js';
import { readProject, writeProject, seedProjectStates, removedSketchStates, confirmProject, projectMutationHashPayload } from './projectRepository.js';
import { projectScopes, readProjectScope, writeProjectScope } from '../../domain/collaboration/collaborativeProject.js';
import { sameData } from '../../shared/sameData.js';
import { accountUsage, quotaMutation, type AccountQuota } from '../resources/accountQuota.js';
const MAX_STATE = 4 * 1024 * 1024;
const RECEIPT_WINDOW = 30 * 86400000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Dependencies = { database: DatabaseSync; now: () => number; find: (id: string) => { owner_id: string; revision: number } | undefined; canEdit: (id: string, userId: string) => boolean; validateReferences: (project: ProjectDocument, userId: string, roomId: string) => void; eraseSketches: (id: string, entries: { levelId: string; version: number }[], apply: () => void) => void; quotas: AccountQuota };

/** The HTTP and WebSocket transports share one canonical transaction and receipt store. */
export function createProjectCommands(deps: Dependencies) {
  const { database, now, find } = deps;
  const docs = new Map<string, Map<string, Y.Doc>>();
  const docFor = (id: string) => {
    const cached = docs.get(id); if (cached) return cached;
    const project = readProject(database, id), values = projectScopes(project), result = new Map<string, Y.Doc>();
    database.exec('BEGIN IMMEDIATE');
    try { seedProjectStates(database, project); database.exec('COMMIT'); }
    catch (cause) { database.exec('ROLLBACK'); throw cause; }
    for (const [scope, value] of Object.entries(values)) {
      const doc = new Y.Doc();
      const row = scope === 'meta' ? database.prepare('SELECT y_state FROM rooms WHERE id=?').get(id) : database.prepare('SELECT y_state FROM project_levels WHERE room_id=? AND id=?').get(id, scope);
      if (row?.y_state) Y.applyUpdate(doc, row.y_state as Uint8Array); else writeProjectScope(doc, value);
      result.set(scope, doc);
    }
    docs.set(id, result); return result;
  };
  const states = (id: string) => Object.fromEntries([...docFor(id)].map(([scope, doc]) => [scope, Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')]));
  const changedScopes = (id: string, previous: ProjectDocument, project: ProjectDocument) => {
    const before = projectScopes(previous), changed = new Map<string, Y.Doc>(), existing = docs.get(id);
    try {
      for (const [scope, value] of Object.entries(projectScopes(project))) {
        if (sameData(before[scope], value)) continue;
        const doc = new Y.Doc(), source = existing?.get(scope);
        changed.set(scope, doc);
        if (source) {
          Y.applyUpdate(doc, Y.encodeStateAsUpdate(source));
          // Mutations are serialized by this server. Preserve its actor and all client
          // history so unacknowledged client updates still refer to existing items.
          doc.clientID = source.clientID;
        } else {
          const row = scope === 'meta' ? database.prepare('SELECT y_state FROM rooms WHERE id=?').get(id) : database.prepare('SELECT y_state FROM project_levels WHERE room_id=? AND id=?').get(id, scope);
          if (row?.y_state) Y.applyUpdate(doc, row.y_state as Uint8Array);
          else if (before[scope]) writeProjectScope(doc, before[scope]);
        }
        writeProjectScope(doc, value, before[scope] ?? {});
        if (!sameData(readProjectScope(doc), value)) throw new HttpError(409, 'Los cambios requieren sincronizar el diseño.');
      }
      return changed;
    } catch (cause) { for (const doc of changed.values()) doc.destroy(); throw cause; }
  };
  const structureChanged = (previous: ProjectDocument, project: ProjectDocument, scopes: ReadonlySet<string>) => {
    if (!sameData(previous.levels.map(level => level.id), project.levels.map(level => level.id))) return true;
    const subset = (value: ProjectDocument) => ({ ...value, levels: value.levels.filter(level => scopes.has(level.id)), stairs: scopes.has('meta') ? value.stairs : [], roofs: scopes.has('meta') ? value.roofs : [] });
    return projectStructure(subset(previous)) !== projectStructure(subset(project));
  };
  const destroyDocs = (id: string) => { for (const doc of docs.get(id)?.values() ?? []) doc.destroy(); docs.delete(id); };
  const commit = (id: string, project: ProjectDocument, changed: Map<string, Y.Doc>, structural = false, affected: string[] = []) => {
    const owner = find(id); if (!owner) throw new HttpError(404, 'Este proyecto no existe.');
    return quotaMutation(database, owner.owner_id, deps.quotas, () => {
      writeProject(database, project, new Set(changed.keys()));
      for (const [scope, doc] of changed) {
        const state = Y.encodeStateAsUpdate(doc);
        if (state.length > MAX_STATE) throw new HttpError(413, 'El diseño supera el tamaño permitido.');
        if (scope === 'meta') database.prepare('UPDATE rooms SET y_state=? WHERE id=?').run(state, id);
        else database.prepare('UPDATE project_levels SET y_state=? WHERE room_id=? AND id=?').run(state, id, scope);
      }
      const totalState = database.prepare('SELECT COALESCE((SELECT length(y_state) FROM rooms WHERE id=?),0)+COALESCE((SELECT SUM(length(y_state)) FROM project_levels WHERE room_id=?),0) AS bytes').get(id, id) as { bytes: number };
      if (totalState.bytes > MAX_STATE) throw new HttpError(413, 'El diseño supera el tamaño permitido.');
      for (const levelId of affected) database.prepare('UPDATE project_levels SET structure_revision=structure_revision+1 WHERE room_id=? AND id=?').run(id, levelId);
      const row = database.prepare('UPDATE rooms SET revision=revision+1,structure_revision=structure_revision+?,updated_at=? WHERE id=? RETURNING revision,structure_revision').get(structural ? 1 : 0, now(), id) as { revision: number; structure_revision: number };
      return { revision: row.revision, structureRevision: row.structure_revision, updatedAt: new Date(now()).toISOString() };
    });
  };
  const saveReceipt = (id: string, operationId: string, userId: string, hash: string, result: unknown, reducing: boolean) => {
    if (!reducing) {
      const owner = find(id); if (!owner) throw new HttpError(404, 'Este proyecto no existe.');
      const usage = database.prepare('SELECT COUNT(*) AS count, MIN(receipts.created_at) AS oldest FROM mutation_receipts receipts JOIN rooms ON rooms.id=receipts.room_id WHERE rooms.owner_id=? AND receipts.created_at>=?').get(owner.owner_id, now() - RECEIPT_WINDOW) as { count: number; oldest: number | null };
      if (usage.count >= (deps.quotas.receipts ?? 100000)) throw new HttpError(429, 'Hay demasiados cambios recientes. Tu trabajo se conserva; vuelve a intentarlo más tarde.', Math.max(1, Math.ceil(((usage.oldest ?? now()) + RECEIPT_WINDOW - now()) / 1000)));
    }
    database.prepare('INSERT INTO mutation_receipts(room_id,id,user_id,hash,result,created_at) VALUES(?,?,?,?,?,?)').run(id, operationId, userId, hash, JSON.stringify(result), now());
    database.prepare('DELETE FROM mutation_receipts WHERE created_at<?').run(now() - RECEIPT_WINDOW);
  };
  const receipt = (id: string, operationId: string, userId: string, hash: string) => {
    const row = database.prepare('SELECT user_id,hash,result FROM mutation_receipts WHERE room_id=? AND id=?').get(id, operationId);
    if (!row) return null;
    if (row.user_id !== userId || row.hash !== hash) throw new HttpError(409, 'La identidad del cambio ya está en uso.');
    return JSON.parse(String(row.result));
  };
  const validScope = (doc: Y.Doc) => {
    if (doc.share.size !== 1 || !doc.share.has('data') || doc.store.pendingStructs || doc.store.pendingDs) throw new HttpError(400, 'Los cambios requieren sincronizar el diseño.');
    return readProjectScope(doc);
  };
  const transaction = (id: string, project: ProjectDocument, userId: string, operationId: string, hash: string, apply: () => ReturnType<typeof commit>) => {
    if (!deps.canEdit(id, userId)) throw new HttpError(403, 'Este diseño solo permite ver.');
    validateProjectDocument(project);
    deps.validateReferences(project, userId, id);
    const owner = find(id); if (!owner) throw new HttpError(404, 'Este proyecto no existe.');
    let saved!: ReturnType<typeof commit>;
    const change = () => {
      const before = accountUsage(database, owner.owner_id).bytes;
      saved = apply();
      saveReceipt(id, operationId, userId, hash, saved, accountUsage(database, owner.owner_id).bytes < before);
    };
    const removed = removedSketchStates(database, project);
    if (removed.length) { deps.eraseSketches(id, removed, change); return saved; }
    database.exec('BEGIN IMMEDIATE');
    try { change(); database.exec('COMMIT'); return saved; }
    catch (cause) { database.exec('ROLLBACK'); throw cause; }
  };
  const putProject = (id: string, project: ProjectDocument, revision: number, userId: string, operationId: string) => {
    if (!deps.canEdit(id, userId)) throw new HttpError(403, 'Este diseño solo permite ver.');
    validateProjectDocument(project);
    const row = find(id); if (!row) throw new HttpError(404, 'Este proyecto no existe.');
    if (project.id !== id || !UUID.test(operationId)) throw new HttpError(400, 'La identidad del proyecto no es válida.');
    const current = readProject(database, id);
    const hash = createHash('sha256').update(projectMutationHashPayload(database, project, revision)).digest('hex');
    const old = receipt(id, operationId, userId, hash); if (old) return old;
    if (row.revision !== revision) throw new HttpError(409, 'Otra sesión guardó cambios. Abre el proyecto de nuevo para revisar esa versión.');
    const changed = changedScopes(id, current, project), structural = structureChanged(current, project, new Set(changed.keys()));
    let saved!: ReturnType<typeof commit>;
    try { saved = transaction(id, project, userId, operationId, hash, () => commit(id, project, changed, structural, structural ? [...changed.keys()].filter(scope => scope !== 'meta') : [])); }
    catch (cause) { for (const doc of changed.values()) doc.destroy(); throw cause; }
    confirmProject(database, project, saved.revision, new Set(changed.keys()));
    const cached = docs.get(id);
    if (cached) {
      for (const [scope, doc] of changed) { cached.get(scope)?.destroy(); cached.set(scope, doc); }
      for (const scope of cached.keys()) if (scope !== 'meta' && !project.levels.some(level => level.id === scope)) { cached.get(scope)!.destroy(); cached.delete(scope); }
    } else for (const doc of changed.values()) doc.destroy();
    return saved;
  };
  return { docs, docFor, states, changedScopes, structureChanged, destroyDocs, commit, receipt, validScope, transaction, putProject };
}
