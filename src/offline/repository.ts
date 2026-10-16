import { accountRequest, AccountRequestError, isNetworkError } from '../accountApi';
import { createBlankProject } from '../onboardingModel';
import { validateProjectDocument } from '../projectDocument';
import type { ProjectSnapshot } from '../liveProject';
import { offlineIdentity } from '../offlineIdentity';
import { atomicOffline, clearOfflineAccount as clearAccountStorage, listOffline, listOfflineMetadata, listOfflineKeys, readOffline, setOfflineAccess, writeOffline, type OfflineWrite } from '../offlineStorage';
import { listOfflineDesigns, pendingSketches, offlineProjectKey, readOfflineProject, validateOfflineProject, type OfflineProjectRecord } from '../offlineProject';
import type { OfflineAssetRecord } from '../offlineAssets';
import { offlineForced } from '../offlineMode';
import { offlineActivity, signal, type OfflineSummary } from './state';

export const hasPending = (record: OfflineProjectRecord) => Boolean(record.localOnly || record.deleted || record.draft || pendingSketches(record) || record.inflight);
export const assetKey = (accountId: string, roomId: string, id: string) => `${accountId}:${roomId}:${id}`;

export async function identity() {
  const value = await offlineIdentity();
  if (!value) throw new Error('Entra con tu cuenta para continuar.');
  return value;
}
export async function verifyAccount(accountId: string) {
  const { user } = await accountRequest<{ user: { id: string } | null }>('/api/auth/session');
  if (user?.id !== accountId) throw new AccountRequestError('Entra con la cuenta de estos diseños para sincronizar.', 401);
}
export async function pendingOfflineCount(accountId?: string) {
  const owner = accountId ?? (await identity()).id;
  const projects = (await listOffline<OfflineProjectRecord>('projects')).filter(value => value.accountId === owner);
  const assets = (await listOfflineMetadata<OfflineAssetRecord>('assets')).filter(value => value.accountId === owner && (value.pending || value.deleted));
  const recoveries = (await listOfflineMetadata<{ accountId?: string; roomId?: string; project?: unknown }>('meta')).filter(value => value.accountId === owner && value.project && typeof value.roomId === 'string');
  const pendingIds = new Set([...projects.filter(hasPending).map(project => project.id), ...recoveries.map(value => value.roomId!)]);
  return pendingIds.size + assets.filter(asset => !pendingIds.has(asset.roomId)).length;
}
export async function roomHasOfflineChanges(id: string): Promise<boolean> {
  const user = await offlineIdentity();
  if (!user) return false;
  const project = await readOffline<OfflineProjectRecord>('projects', offlineProjectKey(user.id, id));
  if (project && hasPending(project)) return true;
  if (await readOffline('meta', 'recovery:' + user.id + ':' + id)) return true;
  return (await listOfflineMetadata<OfflineAssetRecord>('assets')).some(asset => asset.accountId === user.id && asset.roomId === id && (asset.pending || asset.deleted || asset.uploading));
}
export async function assertRoomReadyToShare(id: string): Promise<void> {
  if (offlineForced()) throw new Error('Desactiva el modo sin conexión para compartir.');
  if (await roomHasOfflineChanges(id)) throw new Error('Espera a que se sincronicen los cambios y modelos antes de compartir.');
}
export async function offlineSummary(): Promise<OfflineSummary> {
  const user = await offlineIdentity();
  const prepared = user ? await readOffline<{ complete: boolean }>('meta', 'prepared:' + user.id) : null;
  const estimate = typeof navigator !== 'undefined' && navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => ({} as StorageEstimate)) : {};
  return { accountId: user?.id ?? null, forced: offlineForced(), prepared: prepared?.complete === true, preparing: offlineActivity.preparing, pending: user ? await pendingOfflineCount(user.id) : 0, syncing: offlineActivity.syncing, error: offlineActivity.error, progress: offlineActivity.progress, bytes: estimate.usage ?? 0, quota: estimate.quota ?? null };
}
/** Blob values are immutable and live outside the frequently edited project record. */
export async function projectWrites(record: OfflineProjectRecord): Promise<OfflineWrite[]> {
  const key = offlineProjectKey(record.accountId, record.id), writes: OfflineWrite[] = [];
  const previous = await readOffline<OfflineProjectRecord & { levelRefs?: Record<string, string[]> }>('projects', key);
  const copy = { ...record, snapshot: { ...record.snapshot }, sketchDrafts: structuredClone(record.sketchDrafts ?? {}), inflightSketches: structuredClone(record.inflightSketches ?? {}) } as OfflineProjectRecord & { levelRefs: Record<string, string[]> };
  copy.levelRefs = {};
  for (const slot of ['snapshot', 'draft', 'inflight'] as const) {
    const project = slot === 'snapshot' ? record.snapshot.project : slot === 'draft' ? record.draft : record.inflight?.project;
    if (!project) continue;
    const old = slot === 'snapshot' ? previous?.snapshot.project : slot === 'draft' ? previous?.draft : previous?.inflight?.project;
    copy.levelRefs[slot] = project.levels.map(level => {
      const oldIndex = old?.levels.findIndex(value => value.id === level.id) ?? -1;
      if (oldIndex >= 0 && JSON.stringify(old!.levels[oldIndex]) === JSON.stringify(level)) return previous!.levelRefs?.[slot]?.[oldIndex] ?? key + ':level:' + slot + ':' + level.id;
      const ref = key + ':level:' + slot + ':' + level.id;
      writes.push({ store: 'levels', key: ref, value: { accountId: record.accountId, roomId: record.id, key: ref, level } }); return ref;
    });
    const metadata = { ...project, levels: [] };
    if (slot === 'snapshot') copy.snapshot.project = metadata; else if (slot === 'draft') copy.draft = metadata; else copy.inflight = { ...record.inflight!, project: metadata };
  }
  const available = new Set((await listOfflineKeys('blobs')).filter((ref): ref is string => typeof ref === 'string' && ref.startsWith(key + ':sketch:')));
  const required = new Set<string>();
  for (const [levelId, value] of Object.entries(record.snapshot.sketches)) if (value.hasSketch) required.add(key + ':sketch:' + levelId + ':' + value.version);
  for (const [levelId, value] of Object.entries(record.sketchBlobs ?? {})) if (record.snapshot.sketches[levelId]?.hasSketch && value.version === record.snapshot.sketches[levelId].version) {
    const ref = key + ':sketch:' + levelId + ':' + value.version; required.add(ref);
    if (!available.has(ref)) writes.push({ store: 'blobs', key: ref, value: { accountId: record.accountId, roomId: record.id, key: ref, blob: value.blob } });
  }
  delete copy.sketchBlobs;
  for (const property of ['sketchDrafts', 'inflightSketches'] as const) for (const [levelId, value] of Object.entries(copy[property] ?? {})) {
    const ref = key + ':sketch:' + levelId + ':' + value.id; required.add(ref);
    if (!available.has(ref)) writes.push({ store: 'blobs', key: ref, value: { accountId: record.accountId, roomId: record.id, key: ref, blob: value.blob } });
    delete (value as { blob?: Blob | null }).blob;
  }
  for (const ref of available) if (ref.startsWith(key + ':sketch:') && !required.has(ref)) writes.push({ store: 'blobs', key: ref, remove: true });
  for (const refs of Object.values(previous?.levelRefs ?? {})) for (const ref of refs) if (!Object.values(copy.levelRefs).some(values => values.includes(ref))) writes.push({ store: 'levels', key: ref, remove: true });
  writes.push({ store: 'projects', key, value: copy }); return writes;
}
export async function persistOfflineProject(record: OfflineProjectRecord) {
  const checked = validateOfflineProject(record, record.accountId, record.id);
  if (!checked) throw new Error('No se pudo guardar un diseño inválido.');
  await atomicOffline(record.accountId, await projectWrites(checked));
}
export async function createDesignLocal(project = createBlankProject(), designId?: string, expectedAccountId?: string) {
  const user = await identity(), id = designId ?? crypto.randomUUID();
  if (expectedAccountId && user.id !== expectedAccountId) throw new Error('La cuenta activa cambió.');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error('La identidad del diseño no es válida.');
  const existing = await readOfflineProject(id);
  if (existing) return { id };
  const initial = validateProjectDocument({ ...project, id });
  const snapshot: ProjectSnapshot = { id, accountId: user.id, project: initial, revision: 0, structureRevision: 0, structureRevisions: Object.fromEntries(initial.levels.map(level => [level.id, 0])), sketches: Object.fromEntries(initial.levels.map(level => [level.id, { hasSketch: false, version: 0, mutationId: null }])), role: 'owner', canManage: true, canEdit: true, shared: false, offlineAllowed: true };
  await persistOfflineProject({ id, accountId: user.id, snapshot, draft: initial, localOnly: true, creating: Boolean(designId), authorized: true, prepared: true, updatedAt: Date.now() });
  setOfflineAccess(id, { accountId: user.id, allowed: true });
  return { id };
}
export type OfflineDesign = { id: string; name: string; setupStep?: 0 | 1 | 2 | 3; role: 'owner' | 'editor' | 'reader'; canManage: boolean; canEdit?: boolean; shared?: boolean; offlineAllowed?: boolean; updatedAt: string; offline?: boolean };
export async function listDesigns(): Promise<OfflineDesign[]> {
  const user = await identity();
  const local = await listOfflineDesigns(user.id);
  if (offlineForced()) return local;
  try {
    const { rooms } = await accountRequest<{ rooms: OfflineDesign[] }>('/api/rooms');
    const prepared = await readOffline<{ accountId: string; complete: boolean; roomIds?: string[] }>('meta', 'prepared:' + user.id);
    if (prepared?.complete && prepared.roomIds?.some(id => !rooms.some(room => room.id === id && room.offlineAllowed))) await writeOffline('meta', 'prepared:' + user.id, { ...prepared, complete: false });
    const records = (await listOffline<OfflineProjectRecord>('projects')).filter(record => record.accountId === user.id);
    const deleted = new Set(records.filter(record => record.deleted).map(record => record.id));
    for (const record of records) if (!record.localOnly && !rooms.some(room => room.id === record.id)) await removeCleanProject(user.id, record.id);
    const result = rooms.filter(room => !deleted.has(room.id));
    for (const design of local) {
      const record = records.find(record => record.id === design.id);
      if (!record || !hasPending(record)) continue;
      const index = result.findIndex(room => room.id === design.id);
      if (index < 0) result.push(design); else result[index] = { ...result[index], ...design };
    }
    return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } catch (cause) { if (isNetworkError(cause) || cause instanceof AccountRequestError && cause.status === 401) return local; throw cause; }
}
export async function clearOfflineAccount(accountId: string, options: { discard?: boolean } = {}) {
  if (typeof navigator !== 'undefined' && navigator.locks?.query) {
    const locks = await navigator.locks.query();
    if ([...(locks.held ?? []), ...(locks.pending ?? [])].some(lock => lock.name?.startsWith('3d-space-project:' + accountId + ':') || lock.name?.startsWith('3d-space-live:' + accountId + ':'))) throw new Error('Cierra los diseños abiertos en otras pestañas antes de cerrar sesión.');
  }
  if (!options.discard && await pendingOfflineCount(accountId)) throw new Error('Hay cambios pendientes. Sincronízalos o descarga una copia antes de cerrar sesión.');
  await clearAccountStorage(accountId); signal();
}

export async function projectLock<T>(accountId: string, id: string, operation: () => Promise<T>) {
  if (typeof navigator === 'undefined' || !navigator.locks) return operation();
  return navigator.locks.request('3d-space-project:' + offlineProjectKey(accountId, id), { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('Cierra este diseño en las otras pestañas antes de continuar.');
    return operation();
  });
}
export async function deleteDesignLocked(id: string) {
  const user = await identity();
  let record = await readOfflineProject(id);
  if (!record) {
    const snapshot = await accountRequest<ProjectSnapshot>('/api/rooms/' + id);
    if (snapshot.accountId !== user.id || !snapshot.offlineAllowed) {
      if (offlineForced()) throw new Error('Este diseño compartido necesita conexión.');
      await accountRequest('/api/rooms/' + id, { method: 'DELETE' }); return;
    }
    record = { id, accountId: user.id, snapshot, draft: null, authorized: true, updatedAt: Date.now() };
  }
  record.deleted = true; record.updatedAt = Date.now();
  await persistOfflineProject(record);
}
export async function removeProject(record: OfflineProjectRecord) {
  const writes: OfflineWrite[] = [{ store: 'projects', key: offlineProjectKey(record.accountId, record.id), remove: true }];
  for (const asset of await listOfflineMetadata<OfflineAssetRecord>('assets')) if (asset.accountId === record.accountId && asset.roomId === record.id) writes.push({ store: 'assets', key: assetKey(record.accountId, record.id, asset.asset.id), remove: true });
  for (const level of await listOfflineMetadata<{ accountId: string; roomId: string; key: string }>('levels')) if (level.accountId === record.accountId && level.roomId === record.id) writes.push({ store: 'levels', key: level.key, remove: true });
  // All private blobs are room-scoped, including abandoned sketch mutations.
  for (const blob of await listOfflineMetadata<{ accountId: string; roomId: string; key?: string }>('blobs')) {
    if (blob.accountId === record.accountId && blob.roomId === record.id && blob.key) writes.push({ store: 'blobs', key: blob.key, remove: true });
  }
  await atomicOffline(record.accountId, writes); setOfflineAccess(record.id, null);
}
export async function removeCleanProject(accountId: string, id: string, locked = false) {
  const work = async () => {
    const current = await readOfflineProject(id);
    if (!current || current.accountId !== accountId || current.localOnly) return;
    const assets = await listOfflineMetadata<OfflineAssetRecord>('assets');
    if (hasPending(current) || assets.some(asset => asset.accountId === accountId && asset.roomId === id && (asset.pending || asset.deleted))) {
      current.authorized = false; current.error = 'El diseño ya no está disponible. Tu trabajo se conserva; crea una copia independiente para recuperarlo.';
      await persistOfflineProject(current); return;
    }
    await removeProject(current);
  };
  if (locked || typeof navigator === 'undefined' || !navigator.locks) { await work(); return; }
  await navigator.locks.request('3d-space-project:' + offlineProjectKey(accountId, id), { ifAvailable: true }, async lock => { if (lock) await work(); });
}
