import { accountRequest, AccountRequestError, isNetworkError } from './accountApi';
import { waitForAppOffline } from './appOffline';
import { createBlankProject } from './onboardingModel';
import { validateProjectDocument, projectAssetIds, type ProjectDocument } from './projectDocument';
import type { ProjectSnapshot } from './liveProject';
import type { ModelAsset } from './modelAssets';
import { validateProjectBackupResources, type ProjectBackup } from './projectBackup';
import { offlineIdentity } from './offlineIdentity';
import { atomicOffline, cacheOfflineAsset, clearOfflineAccount as clearAccountStorage, listOffline, listOfflineMetadata, listOfflineKeys, readOffline, removeOffline, setOfflineAccess, updateOffline, writeOffline, type OfflineWrite } from './offlineStorage';
import { hydrateOfflineProject, listOfflineDesigns, pendingSketches, projectWithoutModels, offlineProjectKey, readOfflineProject, SoloProject, validateOfflineProject, type OfflineProjectRecord, type SoloStatus } from './offlineProject';
import { flushOfflineAssets, type OfflineAssetRecord } from './offlineAssets';
import { offlineModelMetadata } from './offlineModelValidation';
import { validateModelBudget } from './modelBudget';
import { sameData } from './sameData';
import { offlineFetch, offlineForced, subscribeOfflineMode } from './offlineMode';

export type OfflineProgress = { done: number; total: number; label: string; labelIsKey: boolean };
export type OfflineSummary = { accountId: string | null; forced: boolean; prepared: boolean; preparing: boolean; pending: number; syncing: boolean; error: string; progress: OfflineProgress | null; bytes: number; quota: number | null };
let preparing = false, syncing = false, error = '';
let progress: OfflineProgress | null = null;
const signal = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('space-offline-data')); };
const hasPending = (record: OfflineProjectRecord) => Boolean(record.localOnly || record.deleted || record.draft || pendingSketches(record) || record.inflight);
const assetKey = (accountId: string, roomId: string, id: string) => `${accountId}:${roomId}:${id}`;
async function identity() {
  const value = await offlineIdentity();
  if (!value) throw new Error('Entra con tu cuenta para continuar.');
  return value;
}
async function verifyAccount(accountId: string) {
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
  return { accountId: user?.id ?? null, forced: offlineForced(), prepared: prepared?.complete === true, preparing, pending: user ? await pendingOfflineCount(user.id) : 0, syncing, error, progress, bytes: estimate.usage ?? 0, quota: estimate.quota ?? null };
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
export async function createDesignLocal(project = createBlankProject(), designId?: string) {
  const user = await identity(), id = designId ?? crypto.randomUUID();
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
export async function deleteDesign(id: string) {
  const user = await identity();
  await projectLock(user.id, id, () => deleteDesignLocked(id));
  if (!offlineForced()) await syncOfflineAccount();
}
async function projectLock<T>(accountId: string, id: string, operation: () => Promise<T>) {
  if (typeof navigator === 'undefined' || !navigator.locks) return operation();
  return navigator.locks.request('3d-space-project:' + offlineProjectKey(accountId, id), { ifAvailable: true }, async lock => {
    if (!lock) throw new Error('Cierra este diseño en las otras pestañas antes de continuar.');
    return operation();
  });
}
async function deleteDesignLocked(id: string) {
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
async function removeProject(record: OfflineProjectRecord) {
  const writes: OfflineWrite[] = [{ store: 'projects', key: offlineProjectKey(record.accountId, record.id), remove: true }];
  for (const asset of await listOfflineMetadata<OfflineAssetRecord>('assets')) if (asset.accountId === record.accountId && asset.roomId === record.id) writes.push({ store: 'assets', key: assetKey(record.accountId, record.id, asset.asset.id), remove: true });
  for (const level of await listOfflineMetadata<{ accountId: string; roomId: string; key: string }>('levels')) if (level.accountId === record.accountId && level.roomId === record.id) writes.push({ store: 'levels', key: level.key, remove: true });
  // All private blobs are room-scoped, including abandoned sketch mutations.
  for (const blob of await listOfflineMetadata<{ accountId: string; roomId: string; key?: string }>('blobs')) {
    if (blob.accountId === record.accountId && blob.roomId === record.id && blob.key) writes.push({ store: 'blobs', key: blob.key, remove: true });
  }
  await atomicOffline(record.accountId, writes); setOfflineAccess(record.id, null);
}
async function removeCleanProject(accountId: string, id: string, locked = false) {
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
export async function createRemoteProject(record: OfflineProjectRecord) {
  await verifyAccount(record.accountId);
  return accountRequest<ProjectSnapshot>('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Offline-Write': '1', 'X-Account-Id': record.accountId }, body: JSON.stringify({ id: record.id, project: projectWithoutModels(record.snapshot.project) }) });
}
export function soloNetworkDependencies(record: OfflineProjectRecord) {
  const path = '/api/rooms/' + record.id;
  return {
    persist: persistOfflineProject,
    create: createRemoteProject,
    get: () => accountRequest<ProjectSnapshot>(path),
    assets: (project: ProjectDocument) => flushOfflineAssets(record.id, project),
    finalize: () => flushDeletedModels(record),
    put: (project: ProjectDocument, revision: number, operationId: string) => accountRequest<ProjectSnapshot>(path, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Offline-Write': '1', 'X-Account-Id': record.accountId }, body: JSON.stringify({ project, revision, operationId }) }),
    sketch: (draft: { id: string; blob: Blob | null }, snapshot: ProjectSnapshot, levelId: string) => accountRequest<{ hasSketch: boolean; version: number }>(path + '/levels/' + encodeURIComponent(levelId) + '/sketch', { method: draft.blob ? 'PUT' : 'DELETE', headers: { ...(draft.blob ? { 'Content-Type': draft.blob.type } : {}), 'X-Offline-Write': '1', 'X-Account-Id': record.accountId, 'X-Sketch-Request-Id': draft.id, 'X-Sketch-Version': String(snapshot.sketches[levelId]?.version ?? 0), 'X-Room-Revision': String(snapshot.revision) }, body: draft.blob ?? undefined }),
  };
}
let syncPromise: Promise<void> | undefined;
export async function syncOfflineAccount() {
  if (offlineForced()) return;
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const user = await identity(); syncing = true; error = ''; signal();
    try {
      await verifyAccount(user.id);
      const records = (await listOffline<OfflineProjectRecord>('projects')).filter(value => value.accountId === user.id);
      for (const value of records) {
        if (offlineForced()) return;
        const work = async () => {
          const current = await readOffline('projects', offlineProjectKey(user.id, value.id));
          if (!current) return;
          const record = validateOfflineProject(current, user.id, value.id);
          if (!record) throw new Error('Hay un diseño dañado. Descarga una copia antes de limpiar los datos.');
          await hydrateOfflineProject(record);
          setOfflineAccess(record.id, { accountId: user.id, allowed: true });
          if (record.deleted) {
            if (!record.localOnly || record.creating) try {
              let expected = record.snapshot;
              if (record.localOnly) {
                expected = await accountRequest<ProjectSnapshot>('/api/rooms/' + record.id);
                if (expected.accountId !== user.id || !expected.offlineAllowed || expected.revision !== 1 || !sameData(expected.project, projectWithoutModels(record.snapshot.project))) throw new AccountRequestError('El diseño cambió antes de eliminarlo. Revisa su versión guardada.', 409);
              }
              await accountRequest('/api/rooms/' + record.id, { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Offline-Write': '1', 'X-Account-Id': user.id }, body: JSON.stringify({ revision: expected.revision, sketches: expected.sketches }) });
            } catch (cause) {
              if (cause instanceof AccountRequestError && cause.status === 409) {
                record.deleted = false; record.error = 'El diseño cambió. Se canceló su eliminación; revisa la versión guardada.';
                await persistOfflineProject(record); throw new AccountRequestError(record.error, 409);
              }
              if (!(cause instanceof AccountRequestError && cause.status === 404)) throw cause;
            }
            await removeProject(record); return;
          }
          let failure = '', missing = false;
          const dependencies = soloNetworkDependencies(record);
          const get = async () => { try { return await dependencies.get(); } catch (cause) { missing = cause instanceof AccountRequestError && cause.status === 404; throw cause; } };
          const project = new SoloProject(record, { ...dependencies, get, changed: (_next, status: SoloStatus, message) => { if (status === 'conflict' || status === 'error') failure = message || 'Revisa los cambios pendientes.'; }, collaborative: () => {} });
          try { await project.initialize(true); await project.retry(); }
          finally { project.destroy(); await project.settled(); }
          if (missing) { await removeCleanProject(user.id, record.id, true); return; }
          if (failure) { record.error = failure; await persistOfflineProject(record); error = failure; }
        };
        if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request('3d-space-project:' + offlineProjectKey(user.id, value.id), { ifAvailable: true }, async lock => { if (lock) await work(); });
        else await work();
      }
    } catch (cause) { error = cause instanceof Error ? cause.message : 'No se pudo sincronizar.'; throw cause; }
    finally { syncing = false; signal(); }
  })().finally(() => { syncPromise = undefined; });
  return syncPromise;
}

async function fetchSketch(snapshot: ProjectSnapshot, levelId: string) {
  const state = snapshot.sketches[levelId]; if (!state?.hasSketch) return undefined;
  const response = await offlineFetch('/api/rooms/' + snapshot.id + '/levels/' + encodeURIComponent(levelId) + '/sketch?v=' + state.version, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new AccountRequestError('No se pudo descargar el croquis.', response.status);
  if (response.headers.get('ETag') !== '"' + snapshot.id + '-' + levelId + '-' + state.version + '"') throw new Error('El croquis cambió durante la descarga.');
  const blob = await response.blob(); if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type) || blob.size > 10 * 1024 * 1024) throw new Error('El croquis no es válido.'); return blob;
}
async function fetchSketches(snapshot: ProjectSnapshot) {
  const values: Record<string, { blob: Blob; version: number }> = {};
  for (const [levelId, state] of Object.entries(snapshot.sketches)) { const blob = await fetchSketch(snapshot, levelId); if (blob) values[levelId] = { blob, version: state.version }; }
  return values;
}
async function cacheAsset(accountId: string, asset: ModelAsset, destinationRoom = asset.roomId!) {
  if (!asset.roomId) throw new Error('El modelo no tiene un diseño de origen.');
  const cached = await readOffline<OfflineAssetRecord>('assets', assetKey(accountId, destinationRoom, asset.id));
  if (cached && (cached.pending || cached.deleted || cached.blob.size === asset.size)) return;
  const response = await offlineFetch('/api/models/' + asset.id + '?room=' + asset.roomId, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new AccountRequestError('No se pudo descargar ' + asset.name + '.', response.status);
  const blob = await response.blob();
  if (blob.size !== asset.size || blob.size > 20 * 1024 * 1024) throw new Error('El modelo descargado está incompleto.');
  const verified = await offlineModelMetadata(blob, asset.id, destinationRoom, asset.name);
  await cacheOfflineAsset(assetKey(accountId, destinationRoom, asset.id), { accountId, roomId: destinationRoom, asset: verified, blob, pending: false });
}
export async function prepareOffline(onProgress?: (progress: OfflineProgress) => void): Promise<OfflineSummary> {
  if (preparing) throw new Error('La preparación ya está en curso.');
  if (offlineForced()) throw new Error('Desactiva el modo sin conexión para preparar tus diseños.');
  const user = await identity(); preparing = true; error = ''; signal();
  try {
    await verifyAccount(user.id); await waitForAppOffline();
    if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
    const { rooms } = await accountRequest<{ rooms: { id: string; role: string; offlineAllowed: boolean }[] }>('/api/rooms');
    const { models } = await accountRequest<{ models: ModelAsset[] }>('/api/models?scope=mine');
    const privateRooms = rooms.filter(room => room.role === 'owner' && room.offlineAllowed);
    for (const record of await listOffline<OfflineProjectRecord>('projects')) {
      if (record.accountId !== user.id || record.localOnly) continue;
      if (!rooms.some(room => room.id === record.id && room.role === 'owner' && room.offlineAllowed)) {
        await projectLock(user.id, record.id, () => removeCleanProject(user.id, record.id, true));
      }
    }
    let done = 0; const total = models.length + privateRooms.length;
    const report = (label: string, labelIsKey = false) => { progress = { done, total, label, labelIsKey }; onProgress?.(progress); signal(); };
    for (const asset of models) { report(asset.name); await cacheAsset(user.id, asset); done++; }
    for (const room of privateRooms) {
      report('Preparando diseño', true);
      await projectLock(user.id, room.id, async () => {
      let complete = false;
      for (let attempt = 0; attempt < 3 && !complete; attempt++) {
        const snapshot = await accountRequest<ProjectSnapshot>('/api/rooms/' + room.id);
        if (!snapshot.offlineAllowed || snapshot.accountId !== user.id) throw new Error('Los permisos de un diseño cambiaron. Vuelve a preparar tus diseños.');
        const previous = await readOfflineProject(room.id);
        if (previous && hasPending(previous)) { if (!previous.prepared) throw new Error('Sincroniza los cambios pendientes antes de preparar todos los diseños.'); complete = true; break; }
        const assets = (await accountRequest<{ models: ModelAsset[] }>('/api/models?room=' + room.id)).models;
        const available = await listOfflineMetadata<OfflineAssetRecord>('assets');
        for (const asset of assets) if (!available.some(entry => entry.accountId === user.id && entry.roomId === room.id && entry.asset.id === asset.id && !entry.pending)) await cacheAsset(user.id, asset, room.id);
        for (const item of snapshot.project.levels.flatMap(level => level.furniture)) if (item.type === 'custom' && !assets.some(asset => asset.id === item.assetId)) throw new Error('Falta un modelo del diseño.');
        validateModelBudget(snapshot.project.levels.flatMap(level => level.furniture), new Map(assets.map(asset => [asset.id, asset])));
        const sketchBlobs = await fetchSketches(snapshot);
        const latest = await accountRequest<ProjectSnapshot>('/api/rooms/' + room.id);
        if (latest.revision !== snapshot.revision || JSON.stringify(latest.sketches) !== JSON.stringify(snapshot.sketches) || !latest.offlineAllowed) continue;
        await persistOfflineProject({ id: room.id, accountId: user.id, snapshot, draft: null, authorized: true, prepared: true, updatedAt: Date.now(), sketchBlobs });
        complete = true;
      }
      if (!complete) throw new Error('Un diseño siguió cambiando. Vuelve a intentarlo.');
      });
      done++;
    }
    // A remote deletion cannot resurrect an old, clean local design.
    for (const record of await listOffline<OfflineProjectRecord>('projects')) if (record.accountId === user.id && !record.localOnly && !rooms.some(room => room.id === record.id)) await removeCleanProject(user.id, record.id);
    await writeOffline('meta', 'prepared:' + user.id, { accountId: user.id, complete: true, roomIds: privateRooms.map(room => room.id), at: Date.now() });
    report('Listo', true);
  } catch (cause) { error = cause instanceof Error ? cause.message : 'No se pudo preparar.'; throw cause; }
  finally { preparing = false; signal(); }
  return offlineSummary();
}
async function exportRemoteProject(id: string): Promise<ProjectBackup> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const snapshot = await accountRequest<ProjectSnapshot>('/api/rooms/' + id);
    const assets: ProjectBackup['assets'] = [];
    for (const item of snapshot.project.levels.flatMap(level => level.furniture)) if (item.type === 'custom' && !assets.some(asset => asset.id === item.assetId)) {
      const { model } = await accountRequest<{ model: ModelAsset }>('/api/models/' + item.assetId + '?room=' + id + '&metadata=1');
      const response = await offlineFetch('/api/models/' + item.assetId + '?room=' + id, { credentials: 'same-origin' });
      if (!response.ok) throw new AccountRequestError('No se pudo descargar el modelo.', response.status);
      assets.push({ id: model.id, name: model.name, blob: await response.blob() });
    }
    const sketchBlobs = await fetchSketches(snapshot);
    const latest = await accountRequest<ProjectSnapshot>('/api/rooms/' + id);
    if (latest.revision === snapshot.revision && JSON.stringify(latest.sketches) === JSON.stringify(snapshot.sketches)) return { project: snapshot.project, assets, sketches: Object.entries(sketchBlobs).map(([levelId, value]) => ({ levelId, blob: value.blob })) };
  }
  throw new Error('El diseño siguió cambiando. Vuelve a descargarlo.');
}
export async function exportOfflineProject(id: string, localOnly = false): Promise<ProjectBackup> {
  const record = await readOfflineProject(id);
  if (!offlineForced() && !localOnly && (!record || record.authorized && !hasPending(record))) {
    try { return await exportRemoteProject(id); }
    catch (cause) { if (!record || !(isNetworkError(cause) || cause instanceof AccountRequestError && cause.status === 401)) throw cause; }
  }
  if (!record) throw new Error('Este diseño no está guardado en este dispositivo.');
  const project = record.draft ?? record.snapshot.project;
  const required = new Set(projectAssetIds(project));
  const records = (await listOffline<OfflineAssetRecord>('assets')).filter(asset => asset.accountId === record.accountId && asset.roomId === id && required.has(asset.asset.id));
  for (const assetId of required) if (!records.some(asset => asset.asset.id === assetId) && !offlineForced() && !localOnly) {
    const { model } = await accountRequest<{ model: ModelAsset }>('/api/models/' + assetId + '?room=' + id + '&metadata=1');
    await cacheAsset(record.accountId, model, id);
    const saved = await readOffline<OfflineAssetRecord>('assets', assetKey(record.accountId, id, model.id));
    if (saved) records.push(saved);
  }
  if ([...required].some(id => !records.some(asset => asset.asset.id === id))) throw new Error('Faltan modelos. Prepara el diseño antes de descargarlo.');
  const sketches: ProjectBackup['sketches'] = [];
  for (const level of project.levels) {
    const draft = record.sketchDrafts?.[level.id], state = record.snapshot.sketches[level.id];
    let blob = draft ? draft.blob : record.sketchBlobs?.[level.id]?.blob;
    if (!draft && state?.hasSketch && !blob && !offlineForced() && !localOnly) blob = await fetchSketch(record.snapshot, level.id);
    if (!draft && state?.hasSketch && !blob) throw new Error('Falta el croquis. Prepara el diseño antes de descargarlo.');
    if (blob) sketches.push({ levelId: level.id, blob });
  }
  return { project, sketches, assets: records.map(asset => ({ id: asset.asset.id, name: asset.asset.name, blob: asset.blob })) };
}
export async function importOfflineProject(id: string, backup: ProjectBackup) {
  const record = await readOfflineProject(id);
  if (!record || record.deleted || !record.authorized) throw new Error('Abre un diseño privado para importar la copia.');
  await validateProjectBackupResources(backup);
  const project = validateProjectDocument({ ...backup.project, id }), writes: OfflineWrite[] = [], ids = new Map<string, string>();
  for (const asset of backup.assets) {
    const next = crypto.randomUUID(), metadata = await offlineModelMetadata(asset.blob, next, id, asset.name); ids.set(asset.id, next);
    writes.push({ store: 'assets', key: assetKey(record.accountId, id, next), value: { accountId: record.accountId, roomId: id, asset: metadata, blob: asset.blob, pending: true } satisfies OfflineAssetRecord });
  }
  record.draft = validateProjectDocument({ ...project, levels: project.levels.map(level => ({ ...level, furniture: level.furniture.map(item => { if (item.type !== 'custom') return item; const assetId = ids.get(item.assetId!); if (!assetId) throw new Error('Falta un modelo en la copia.'); return { ...item, assetId }; }) })) });
  record.sketchDrafts = Object.fromEntries(project.levels.map(level => [level.id, { id: crypto.randomUUID(), blob: backup.sketches.find(sketch => sketch.levelId === level.id)?.blob ?? null }])); record.updatedAt = Date.now();
  writes.push(...await projectWrites(record));
  await atomicOffline(record.accountId, writes);
}
export async function copyDesign(id: string, suffix = ' (copia)') {
  const user = await identity();
  let backup: ProjectBackup;
  try { backup = await exportOfflineProject(id); }
  catch (cause) {
    if (!(cause instanceof AccountRequestError && [403, 404].includes(cause.status)) || !await readOfflineProject(id)) throw cause;
    backup = await exportOfflineProject(id, true);
  }
  const copy = { ...backup, project: { ...backup.project, name: backup.project.name.slice(0, 100 - suffix.length) + suffix } };
  const result = await createDesignLocal(projectWithoutModels(copy.project));
  try { await importOfflineProject(result.id, copy); }
  catch (cause) { await removeOffline('projects', offlineProjectKey(user.id, result.id)); throw cause; }
  return result;
}
export async function deleteOfflineModel(id: string) {
  const user = await identity();
  const record = (await listOfflineMetadata<OfflineAssetRecord>('assets')).find(asset => asset.accountId === user.id && asset.asset.id === id);
  if (!record) { await accountRequest('/api/models/' + id, { method: 'DELETE' }); return; }
  const project = await readOfflineProject(record.roomId);
  if (!project) {
    if (offlineForced()) throw new Error('Prepara una copia privada antes de modificar esta biblioteca sin conexión.');
    await accountRequest('/api/models/' + id, { method: 'DELETE' }); await removeOffline('assets', assetKey(user.id, record.roomId, id)); signal(); return;
  }
  for (const project of await listOffline<OfflineProjectRecord>('projects')) if (project.accountId === user.id && !project.deleted && (project.draft ?? project.snapshot.project).levels.flatMap(level => level.furniture).some(item => item.assetId === id)) throw new Error('Quita el modelo de tus diseños antes de eliminarlo.');
  await updateOffline<OfflineAssetRecord>('assets', assetKey(user.id, record.roomId, id), user.id, current => current ? { ...current, deleted: true } : undefined);
  signal();
  if (!offlineForced()) await syncOfflineAccount();
}
async function flushDeletedModels(record: OfflineProjectRecord) {
  for (const asset of await listOfflineMetadata<OfflineAssetRecord>('assets')) {
    if (asset.accountId !== record.accountId || asset.roomId !== record.id || !asset.deleted) continue;
    try { await accountRequest('/api/models/' + asset.asset.id + '?room=' + record.id, { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Offline-Write': '1', 'X-Account-Id': record.accountId }, body: JSON.stringify({ revision: record.snapshot.revision }) }); }
    catch (cause) { if (!(cause instanceof AccountRequestError && cause.status === 404)) throw cause; }
    await removeOffline('assets', assetKey(record.accountId, record.id, asset.asset.id));
  }
}
if (typeof window !== 'undefined') {
  subscribeOfflineMode(() => { if (!offlineForced()) void syncOfflineAccount().catch(() => {}); });
  window.addEventListener('online', () => { if (!offlineForced()) void syncOfflineAccount().catch(() => {}); });
}
