import { accountRequest, AccountRequestError } from '../accountApi';
import { beginAppActivity } from '../appActivity';
import { waitForAppOffline } from '../appOffline';
import type { ProjectSnapshot } from '../liveProject';
import type { ModelAsset } from '../modelAssets';
import { cacheOfflineAsset, listOffline, listOfflineMetadata, readOffline, writeOffline } from '../offlineStorage';
import { readOfflineProject, type OfflineProjectRecord } from '../offlineProject';
import type { OfflineAssetRecord } from '../offlineAssets';
import { offlineModelMetadata } from '../offlineModelValidation';
import { validateModelBudget } from '../modelBudget';
import { offlineFetch, offlineForced } from '../offlineMode';
import { validateSketchBlob } from '../imageValidation';
import { assetKey, hasPending, identity, offlineSummary, persistOfflineProject, projectLock, removeCleanProject, verifyAccount } from './repository';
import { offlineActivity, signal, type OfflineProgress, type OfflineSummary } from './state';

export async function fetchSketch(snapshot: ProjectSnapshot, levelId: string) {
  const state = snapshot.sketches[levelId]; if (!state?.hasSketch) return undefined;
  const response = await offlineFetch('/api/rooms/' + snapshot.id + '/levels/' + encodeURIComponent(levelId) + '/sketch?v=' + state.version, { credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new AccountRequestError('No se pudo descargar el croquis.', response.status);
  if (response.headers.get('ETag') !== '"' + snapshot.id + '-' + levelId + '-' + state.version + '"') throw new Error('El croquis cambió durante la descarga.');
  const blob = await response.blob(); await validateSketchBlob(blob); return blob;
}
export async function fetchSketches(snapshot: ProjectSnapshot) {
  const values: Record<string, { blob: Blob; version: number }> = {};
  for (const [levelId, state] of Object.entries(snapshot.sketches)) { const blob = await fetchSketch(snapshot, levelId); if (blob) values[levelId] = { blob, version: state.version }; }
  return values;
}
export async function cacheAsset(accountId: string, asset: ModelAsset, destinationRoom = asset.roomId!) {
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
  if (offlineActivity.preparing) throw new Error('La preparación ya está en curso.');
  if (offlineForced()) throw new Error('Desactiva el modo sin conexión para preparar tus diseños.');
  const user = await identity(); offlineActivity.preparing = true; offlineActivity.error = ''; signal();
  let release: (() => void) | undefined;
  try {
    await verifyAccount(user.id); await waitForAppOffline();
    release = beginAppActivity();
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
    const report = (label: string, labelIsKey = false) => { offlineActivity.progress = { done, total, label, labelIsKey }; onProgress?.(offlineActivity.progress); signal(); };
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
  } catch (cause) { offlineActivity.error = cause instanceof Error ? cause.message : 'No se pudo preparar.'; throw cause; }
  finally { release?.(); offlineActivity.preparing = false; signal(); }
  return offlineSummary();
}
