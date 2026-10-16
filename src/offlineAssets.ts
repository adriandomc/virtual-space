import type { ModelAsset } from './modelAssets';
import type { ProjectDocument } from './projectDocument';
import { AccountRequestError, accountRequest, isNetworkError } from './accountApi';
import { cacheOfflineAsset, getOfflineAccess, listOffline, listOfflineMetadata, readOffline, removeOffline, setOfflineAccess, updateOffline, writeOffline } from './offlineStorage';
import { offlineModelMetadata } from './offlineModelValidation';
import { offlineFetch, offlineForced } from './offlineMode';

export type OfflineAssetRecord = { accountId: string; roomId: string; asset: ModelAsset; blob: Blob; pending: boolean; uploading?: boolean; deleted?: boolean; denied?: boolean };
const key = (accountId: string, roomId: string, id: string) => `${accountId}:${roomId}:${id}`;
const changed = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('space-offline-assets')); };
const url = (id: string, roomId?: string, publicOnly = false) => `/api/models/${encodeURIComponent(id)}${roomId ? '?room=' + encodeURIComponent(roomId) : ''}${publicOnly ? (roomId ? '&' : '?') + 'public=1' : ''}`;
async function onlineCache(operation: () => Promise<void>) {
  try { await operation(); }
  catch (error) {
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('space-offline-error', { detail: error instanceof Error ? error.message : 'No se pudo guardar la copia sin conexión.' }));
  }
}
function access(roomId?: string) {
  const value = roomId ? getOfflineAccess(roomId) : undefined;
  return value?.allowed ? value : undefined;
}
function stillAllowed(roomId: string, accountId: string) { return access(roomId)?.accountId === accountId; }

async function localAsset(id: string, roomId?: string): Promise<OfflineAssetRecord | undefined> {
  const allowed = access(roomId);
  if (!allowed || !roomId) return undefined;
  let record: OfflineAssetRecord | undefined;
  await onlineCache(async () => { record = await readOffline<OfflineAssetRecord>('assets', key(allowed.accountId, roomId, id)); });
  return stillAllowed(roomId, allowed.accountId) ? record : undefined;
}

/** HTTP denials must never be hidden by an older local model. */
async function fetchBlob(id: string, roomId?: string, publicOnly = false): Promise<Blob> {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await (publicOnly ? fetch : offlineFetch)(url(id, roomId, publicOnly), { credentials: publicOnly ? 'omit' : 'same-origin', cache: 'no-store', signal: controller.signal });
    if (!response.ok) {
      if (!publicOnly && roomId && [403, 404].includes(response.status)) setOfflineAccess(roomId, null);
      throw new AccountRequestError('Este modelo no está disponible.', response.status);
    }
    const blob = await response.blob();
    if (blob.size > 20 * 1024 * 1024) throw new Error('El modelo debe pesar como máximo 20 MB.');
    return blob;
  } finally { clearTimeout(timeout); }
}

const transportFailure = (error: unknown) => isNetworkError(error) || error instanceof TypeError || error instanceof DOMException && ['AbortError', 'TimeoutError'].includes(error.name);

export async function loadModelBlob(id: string, roomId?: string, publicOnly = false): Promise<Blob> {
  if (publicOnly) return fetchBlob(id, roomId, true);
  const cached = await localAsset(id, roomId);
  if (cached?.deleted) throw new Error('Este modelo fue eliminado.');
  if (cached && !cached.denied && (cached.pending || offlineForced())) return cached.blob;
  try {
    const blob = await fetchBlob(id, roomId), allowed = access(roomId);
    if (allowed && roomId) {
      await onlineCache(async () => {
        const asset = cached?.asset ?? await offlineModelMetadata(blob, id, roomId, 'Modelo');
        if (stillAllowed(roomId, allowed.accountId)) await cacheOfflineAsset(key(allowed.accountId, roomId, id), { accountId: allowed.accountId, roomId, asset, blob, pending: false });
      });
    }
    return blob;
  } catch (error) {
    if (!(transportFailure(error) || error instanceof AccountRequestError && error.status === 401)) throw error;
    if (cached && !cached.denied && roomId && stillAllowed(roomId, cached.accountId)) return cached.blob;
    throw new Error('Este modelo aún no está disponible sin conexión.');
  }
}

export async function uploadOfflineModel(file: File, roomId: string): Promise<ModelAsset> {
  if (!/\.glb$/i.test(file.name)) throw new Error('Selecciona un modelo GLB.');
  if (file.size > 20 * 1024 * 1024) throw new Error('El modelo debe pesar como máximo 20 MB.');
  const allowed = access(roomId), id = crypto.randomUUID();
  const headers: Record<string, string> = { 'Content-Type': 'model/gltf-binary', 'X-Model-Name': encodeURIComponent(file.name) };
  if (allowed) Object.assign(headers, { 'X-Model-Id': id, 'X-Offline-Write': '1', 'X-Account-Id': allowed.accountId });
  try {
    if (allowed && (await readOffline<{ localOnly?: boolean }>('projects', `${allowed.accountId}:${roomId}`))?.localOnly) throw new AccountRequestError('El modelo se guardará en este dispositivo.');
    const { model } = await accountRequest<{ model: ModelAsset }>('/api/models?room=' + encodeURIComponent(roomId), { method: 'POST', headers, body: file });
    if (allowed && stillAllowed(roomId, allowed.accountId)) await onlineCache(() => writeOffline('assets', key(allowed.accountId, roomId, model.id), { accountId: allowed.accountId, roomId, asset: model, blob: file, pending: false } satisfies OfflineAssetRecord));
    changed();
    return model;
  } catch (error) {
    if (!(isNetworkError(error) || error instanceof AccountRequestError && error.status === 401) || !allowed || !stillAllowed(roomId, allowed.accountId)) throw error;
    const asset = await offlineModelMetadata(file, id, roomId, file.name);
    if (!stillAllowed(roomId, allowed.accountId)) throw new Error('Vuelve a abrir tu diseño para guardar este modelo.');
    const records = await listOfflineMetadata<OfflineAssetRecord>('assets');
    if (records.filter(record => record.accountId === allowed.accountId).reduce((total, record) => total + record.asset.size, 0) + file.size > 100 * 1024 * 1024) throw new Error('Tus modelos sin conexión pueden ocupar como máximo 100 MB.');
    await writeOffline('assets', key(allowed.accountId, roomId, id), { accountId: allowed.accountId, roomId, asset, blob: file, pending: true } satisfies OfflineAssetRecord);
    changed();
    return asset;
  }
}

export async function listOfflineModels(roomId: string, scope: 'room' | 'mine', pendingOnly = false): Promise<ModelAsset[]> {
  const allowed = access(roomId);
  if (!allowed) return [];
  let records: OfflineAssetRecord[] = [];
  if (pendingOnly) await onlineCache(async () => { records = await listOfflineMetadata<OfflineAssetRecord>('assets'); });
  else records = await listOfflineMetadata<OfflineAssetRecord>('assets');
  if (!stillAllowed(roomId, allowed.accountId)) return [];
  return records.filter(record => !record.deleted && record.accountId === allowed.accountId && (!pendingOnly || record.pending) && (scope === 'mine' || record.roomId === roomId)).map(record => record.asset);
}

export async function loadLibraryModelBlob(asset: ModelAsset, roomId: string): Promise<Blob> {
  if (!asset.roomId || asset.roomId === roomId) return loadModelBlob(asset.id, roomId);
  const allowed = access(roomId);
  let cached: OfflineAssetRecord | undefined;
  if (allowed) await onlineCache(async () => {
    cached = await readOffline<OfflineAssetRecord>('assets', key(allowed.accountId, asset.roomId!, asset.id));
  });
  if (cached?.deleted) throw new Error('Este modelo fue eliminado.');
  if (cached && !cached.denied && (cached.pending || offlineForced()) && stillAllowed(roomId, cached.accountId)) return cached.blob;
  try {
    const blob = await fetchBlob(asset.id, asset.roomId);
    if (allowed && !stillAllowed(roomId, allowed.accountId)) throw new Error('El acceso al diseño cambió.');
    if (allowed) await onlineCache(() => cacheOfflineAsset(key(allowed.accountId, asset.roomId!, asset.id), { accountId: allowed.accountId, roomId: asset.roomId!, asset, blob, pending: false }));
    return blob;
  } catch (error) {
    if ((transportFailure(error) || error instanceof AccountRequestError && error.status === 401) && cached && !cached.denied && stillAllowed(roomId, cached.accountId)) return cached.blob;
    if (error instanceof AccountRequestError && [403, 404].includes(error.status) && cached) await onlineCache(() => updateOffline<OfflineAssetRecord>('assets', key(cached!.accountId, cached!.roomId, cached!.asset.id), cached!.accountId, current => current ? { ...current, denied: true } : undefined));
    if (transportFailure(error)) throw new Error('Este modelo aún no está disponible sin conexión.');
    throw error;
  }
}

export async function forgetOfflineModel(id: string) {
  const identity = await readOffline<{ id: string }>('meta', 'identity');
  for (const record of await listOffline<OfflineAssetRecord>('assets')) if (record.accountId === identity?.id && record.asset.id === id) await removeOffline('assets', key(record.accountId, record.roomId, id));
  changed();
}

export async function reconcileOfflineModels(roomId: string, assets: ModelAsset[], scope: 'room' | 'mine') {
  const allowed = access(roomId);
  if (!allowed) return;
  const ids = new Set(assets.map(asset => asset.id));
  const projects = await listOffline<{ accountId: string; draft?: ProjectDocument | null; snapshot: { project: ProjectDocument }; sketchDrafts?: unknown; inflight?: unknown; inflightSketches?: unknown }>('projects');
  const needed = new Set(projects.filter(project => project.accountId === allowed.accountId && (project.draft || Object.keys(project.sketchDrafts ?? {}).length || project.inflight || Object.keys(project.inflightSketches ?? {}).length)).flatMap(project => (project.draft ?? project.snapshot.project).levels.flatMap(level => level.furniture).filter(item => item.type === 'custom').map(item => item.assetId)));
  await onlineCache(async () => {
    for (const record of await listOffline<OfflineAssetRecord>('assets')) {
      if (!stillAllowed(roomId, allowed.accountId)) return;
      if (record.accountId === allowed.accountId && !record.pending && !needed.has(record.asset.id) && (scope === 'mine' || record.roomId === roomId) && !ids.has(record.asset.id)) await removeOffline('assets', key(record.accountId, record.roomId, record.asset.id));
    }
  });
}

export async function rememberModelMetadata(roomId: string, assets: ModelAsset[]) {
  const allowed = access(roomId);
  if (!allowed) return;
  for (const asset of assets) {
    const record = await localAsset(asset.id, roomId);
    if (record && stillAllowed(roomId, allowed.accountId)) await onlineCache(() => updateOffline<OfflineAssetRecord>('assets', key(allowed.accountId, roomId, asset.id), allowed.accountId, current => current ? { ...current, asset } : undefined));
  }
}

export async function readModelMetadata(id: string, roomId?: string): Promise<ModelAsset> {
  const cached = await localAsset(id, roomId);
  if (cached?.deleted) throw new Error('Este modelo fue eliminado.');
  if (cached && (cached.pending || offlineForced())) return cached.asset;
  try {
    const { model } = await accountRequest<{ model: ModelAsset }>(url(id, roomId) + (roomId ? '&' : '?') + 'metadata=1');
    if (roomId) await rememberModelMetadata(roomId, [model]);
    return model;
  } catch (error) {
    if ((isNetworkError(error) || error instanceof AccountRequestError && error.status === 401) && cached && roomId && stillAllowed(roomId, cached.accountId)) return cached.asset;
    throw error;
  }
}

export async function copyOfflineModel(asset: ModelAsset, roomId: string): Promise<ModelAsset> {
  const blob = await loadLibraryModelBlob(asset, roomId);
  return uploadOfflineModel(new File([blob], asset.name + '.glb', { type: 'model/gltf-binary' }), roomId);
}

export async function flushOfflineAssets(roomId: string, project: ProjectDocument): Promise<ProjectDocument> {
  const allowed = access(roomId);
  if (!allowed) return project;
  const records = (await listOfflineMetadata<OfflineAssetRecord>('assets')).filter(record => record.accountId === allowed.accountId && record.roomId === roomId && record.pending && !record.deleted);
  for (const metadata of records) {
    const record = await readOffline<OfflineAssetRecord>('assets', key(allowed.accountId, roomId, metadata.asset.id));
    if (!record || !record.pending || record.deleted) continue;
    if (!stillAllowed(roomId, allowed.accountId)) throw new Error('El acceso al diseño cambió. Vuelve a abrirlo.');
    if (record.pending) {
      let uploading = false;
      await updateOffline<OfflineAssetRecord>('assets', key(allowed.accountId, roomId, record.asset.id), allowed.accountId, current => {
        if (!current || current.deleted) return undefined;
        uploading = true; return { ...current, uploading: true };
      });
      if (!uploading) continue;
      const { model } = await accountRequest<{ model: ModelAsset }>('/api/models?room=' + encodeURIComponent(roomId), {
        method: 'POST', headers: { 'Content-Type': 'model/gltf-binary', 'X-Model-Name': encodeURIComponent(record.asset.name + '.glb'), 'X-Model-Id': record.asset.id, 'X-Offline-Write': '1', 'X-Account-Id': allowed.accountId }, body: record.blob,
      });
      if (!stillAllowed(roomId, allowed.accountId)) throw new Error('El acceso al diseño cambió. Vuelve a abrirlo.');
      if (model.id !== record.asset.id) throw new Error('El servidor devolvió otra identidad de modelo. Tu copia se conserva en este dispositivo.');
      await updateOffline<OfflineAssetRecord>('assets', key(allowed.accountId, roomId, record.asset.id), allowed.accountId, current => current ? { ...current, pending: false, uploading: false } : undefined);
      changed();
    }
  }
  return project;
}
