import { accountRequest, AccountRequestError, isNetworkError } from '../accountApi';
import { beginAppActivity } from '../appActivity';
import { validateProjectDocument, projectAssetIds } from '../projectDocument';
import type { ProjectSnapshot } from '../liveProject';
import type { ModelAsset } from '../modelAssets';
import { validateProjectBackupResources, type ProjectBackup } from '../projectBackup';
import { atomicOffline, listOffline, readOffline, type OfflineWrite } from '../offlineStorage';
import { projectWithoutModels, readOfflineProject } from '../offlineProject';
import type { OfflineAssetRecord } from '../offlineAssets';
import { offlineModelMetadata } from '../offlineModelValidation';
import { offlineFetch, offlineForced } from '../offlineMode';
import { assetKey, createDesignLocal, hasPending, identity, projectWrites, removeProject } from './repository';
import { cacheAsset, fetchSketch, fetchSketches } from './preparation';

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
  const release = beginAppActivity();
  try {
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
  return { project, sketches, assets: records.map(asset => ({ id: asset.asset.id, name: asset.asset.name, blob: asset.blob.slice(0, asset.blob.size, 'model/gltf-binary') })) };
  } finally { release(); }
}
export async function importOfflineProject(id: string, backup: ProjectBackup) {
  const release = beginAppActivity();
  try {
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
  } finally { release(); }
}
export async function copyDesign(id: string, suffix = ' (copia)') {
  const release = beginAppActivity();
  try {
  const user = await identity();
  let backup: ProjectBackup;
  try { backup = await exportOfflineProject(id); }
  catch (cause) {
    if (!(cause instanceof AccountRequestError && [403, 404].includes(cause.status)) || !await readOfflineProject(id)) throw cause;
    backup = await exportOfflineProject(id, true);
  }
  const copy = { ...backup, project: { ...backup.project, name: backup.project.name.slice(0, 100 - suffix.length) + suffix } };
  const result = await createDesignLocal(projectWithoutModels(copy.project), undefined, user.id), created = await readOfflineProject(result.id);
  if (!created || created.accountId !== user.id) throw new Error('La cuenta activa cambió.');
  try { await importOfflineProject(result.id, copy); }
  catch (cause) { await removeProject(created); throw cause; }
  return result;
  } finally { release(); }
}
