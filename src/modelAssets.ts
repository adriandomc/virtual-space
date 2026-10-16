import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from './auth.js';
import type { ProjectDocument } from './projectDocument.js';
import { readProject } from './projectRepository.js';
import { validateModelBudget } from './modelBudget.js';
import { accountUsage, checkAccountQuota, quotaMutation, accountQuotaConfig, type AccountQuota } from './accountQuota.js';
import { validateGlbBytes, MODEL_MAX_BYTES, type ModelAsset } from './glbValidation.js';
export { MODEL_MAX_BYTES, type ModelAsset, type ModelNode } from './glbValidation.js';

export const MODEL_ACCOUNT_BYTES = 100 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateGlb(bytes: Uint8Array) {
  try { return validateGlbBytes(bytes); }
  catch (cause) { throw new HttpError(bytes.byteLength > MODEL_MAX_BYTES ? 413 : 400, cause instanceof Error ? cause.message : 'El modelo GLB no es válido.'); }
}

type AssetRow = { id: string; owner_id: string; room_id: string; name: string; size: number; created_at: number; metadata: string; data?: Uint8Array };
export function createModelAssets(database: DatabaseSync, { now = Date.now, canViewRoom, canEditRoom, recordAssetErasure, quotas = accountQuotaConfig() }: {
  now?: () => number;
  canViewRoom: (roomId: string, userId: string | null) => boolean;
  canEditRoom: (roomId: string, userId: string) => boolean;
  recordAssetErasure?: (id: string, erase: () => void) => void;
  quotas?: AccountQuota;
}) {
  const find = database.prepare('SELECT id, owner_id, room_id, name, size, created_at, metadata FROM model_assets WHERE id = ?');
  const describe = (row: AssetRow): ModelAsset => ({ id: row.id, roomId: row.room_id, name: row.name, size: row.size, createdAt: new Date(row.created_at).toISOString(), ...JSON.parse(row.metadata) });
  const roomAssets = (roomId: string): Set<string> => {
    if (!UUID.test(roomId)) throw new HttpError(400, 'El proyecto no es válido.');
    const row = database.prepare('SELECT room FROM rooms WHERE id = ?').get(roomId) as { room: string } | undefined;
    return new Set(row ? readProject(database, roomId).levels.flatMap(level => level.furniture).filter(item => item.type === 'custom').map(item => item.assetId!) : []);
  };
  const permitted = (id: string, userId: string | null, roomId?: string): AssetRow => {
    if (!UUID.test(id)) throw new HttpError(404, 'Este modelo no existe.');
    const row = find.get(id) as AssetRow | undefined;
    if (!row || row.owner_id !== userId && (!roomId || row.room_id !== roomId || !canViewRoom(roomId, userId) || !roomAssets(roomId).has(id) && (!userId || !canEditRoom(roomId, userId)))) throw new HttpError(404, 'Este modelo no existe.');
    return row;
  };
  return {
    checkUploadCapacity(ownerId: string, size: number, requestedId?: string) {
      if (requestedId && find.get(requestedId)) return;
      const used = database.prepare('SELECT COALESCE(SUM(size), 0) AS total, COUNT(*) AS count FROM model_assets WHERE owner_id=?').get(ownerId) as { total: number; count: number };
      if (used.total + size > MODEL_ACCOUNT_BYTES || used.count >= 100) throw new HttpError(413, 'Tu biblioteca admite hasta 100 MB y 100 modelos.');
      const usage = accountUsage(database, ownerId);
      checkAccountQuota(usage, { ...usage, bytes: usage.bytes + size }, quotas);
    },
    upload(ownerId: string, data: Buffer, name: string, roomId: string, requestedId?: string): ModelAsset {
      const room = UUID.test(roomId) ? database.prepare('SELECT owner_id FROM rooms WHERE id = ?').get(roomId) as { owner_id: string } | undefined : undefined;
      if (!room || room.owner_id !== ownerId) throw new HttpError(404, 'Este proyecto no existe.');
      const metadata = validateGlb(data);
      const cleanName = typeof name === 'string' ? name.trim().replace(/[\x00-\x1f\x7f]/g, '').replace(/\.glb$/i, '').slice(0, 80) : '';
      if (!cleanName) throw new HttpError(400, 'Escribe un nombre para el modelo.');
      if (requestedId !== undefined && !UUID.test(requestedId)) throw new HttpError(400, 'La identidad del modelo no es válida.');
      database.exec('BEGIN IMMEDIATE');
      try {
        if (requestedId) {
          const existing = find.get(requestedId) as AssetRow | undefined;
          if (existing) {
            const stored = database.prepare('SELECT data FROM model_assets WHERE id = ?').get(requestedId) as { data: Uint8Array };
            if (existing.owner_id !== ownerId || existing.room_id !== roomId || existing.name !== cleanName || !Buffer.from(stored.data).equals(data)) throw new HttpError(409, 'La identidad del modelo ya está en uso.');
            database.exec('COMMIT'); return describe(existing);
          }
        }
        const used = database.prepare('SELECT COALESCE(SUM(size), 0) AS total, COUNT(*) AS count FROM model_assets WHERE owner_id = ?').get(ownerId) as { total: number; count: number };
        if (used.total + data.length > MODEL_ACCOUNT_BYTES || used.count >= 100) throw new HttpError(413, 'Tu biblioteca admite hasta 100 MB y 100 modelos.');
        const id = requestedId ?? randomUUID(), createdAt = now();
        quotaMutation(database, ownerId, quotas, () => database.prepare('INSERT INTO model_assets (id, owner_id, room_id, name, size, created_at, metadata, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, ownerId, roomId, cleanName, data.length, createdAt, JSON.stringify(metadata), data));
        database.exec('COMMIT');
        return { id, roomId, name: cleanName, size: data.length, createdAt: new Date(createdAt).toISOString(), ...metadata };
      } catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    list(ownerId: string, roomId?: string, own = false): ModelAsset[] {
      if (own && !roomId) return (database.prepare('SELECT id, owner_id, room_id, name, size, created_at, metadata FROM model_assets WHERE owner_id = ? ORDER BY created_at DESC, id').all(ownerId) as AssetRow[]).map(describe);
      if (!roomId || !UUID.test(roomId)) throw new HttpError(400, 'Selecciona un diseño para ver sus modelos.');
      if (!canViewRoom(roomId, ownerId)) throw new HttpError(404, 'Este proyecto no existe.');
      if (own) return (database.prepare('SELECT id, owner_id, room_id, name, size, created_at, metadata FROM model_assets WHERE owner_id = ? ORDER BY created_at DESC, id').all(ownerId) as AssetRow[]).map(describe);
      const rows = database.prepare('SELECT id, owner_id, room_id, name, size, created_at, metadata FROM model_assets WHERE room_id = ? ORDER BY created_at DESC, id').all(roomId) as AssetRow[];
      const visible = canEditRoom(roomId, ownerId) ? rows : rows.filter(row => roomAssets(roomId).has(row.id));
      return visible.map(describe);
    },
    metadata(id: string, userId: string | null, roomId?: string) { return describe(permitted(id, userId, roomId)); },
    read(id: string, userId: string | null, roomId?: string): Buffer {
      permitted(id, userId, roomId);
      return Buffer.from((database.prepare('SELECT data FROM model_assets WHERE id = ?').get(id) as { data: Uint8Array }).data);
    },
    remove(id: string, ownerId: string, roomId?: string) {
      const row = permitted(id, ownerId);
      if (row.owner_id !== ownerId) throw new HttpError(403, 'Solo puedes eliminar tus modelos.');
      if (roomId && row.room_id !== roomId) throw new HttpError(409, 'El modelo pertenece a otro diseño.');
      const used = database.prepare("SELECT rooms.id FROM project_levels levels, rooms, json_each(levels.document, '$.furniture') item WHERE levels.room_id=rooms.id AND json_extract(item.value, '$.assetId') = ? LIMIT 1").get(id);
      if (used) throw new HttpError(409, 'El modelo está en un diseño. Retíralo antes de eliminarlo.');
      const erase = () => { database.prepare('DELETE FROM model_assets WHERE id = ?').run(id); };
      if (recordAssetErasure) recordAssetErasure(id, erase); else erase();
    },
    validateProjectReferences(project: ProjectDocument, userId: string, roomId?: string) {
      const items = project.levels.flatMap(level => level.furniture);
      if (items.some(item => item.type === 'custom') && (!roomId || !canEditRoom(roomId, userId))) throw new HttpError(400, 'El modelo no está disponible en este diseño.');
      const models = new Map<string, ModelAsset>();
      for (const item of items) if (item.type === 'custom') {
        const row = find.get(item.assetId!) as AssetRow | undefined;
        if (!row || row.room_id !== roomId) throw new HttpError(400, 'El modelo no está disponible en este diseño.');
        models.set(row.id, describe(row));
      }
      try { validateModelBudget(items, models); } catch (cause) { throw new HttpError(400, cause instanceof Error ? cause.message : 'El modelo no es válido.'); }
    },
  };
}
