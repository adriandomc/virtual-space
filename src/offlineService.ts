// Stable entry point; internal modules depend on repositories, never on this facade.
export { pendingOfflineCount, roomHasOfflineChanges, assertRoomReadyToShare, offlineSummary, projectWrites, persistOfflineProject, createDesignLocal, listDesigns, clearOfflineAccount, type OfflineDesign } from './offline/repository';
export { createRemoteProject, soloNetworkDependencies, syncOfflineAccount } from './offline/sync';
export { prepareOffline } from './offline/preparation';
export { exportOfflineProject, importOfflineProject, copyDesign } from './offline/packages';
export type { OfflineProgress, OfflineSummary } from './offline/state';

import { accountRequest } from './accountApi';
import { listOffline, listOfflineMetadata, removeOffline, updateOffline } from './offlineStorage';
import { readOfflineProject, type OfflineProjectRecord } from './offlineProject';
import type { OfflineAssetRecord } from './offlineAssets';
import { offlineForced, subscribeOfflineMode } from './offlineMode';
import { assetKey, deleteDesignLocked, identity, projectLock } from './offline/repository';
import { syncOfflineAccount } from './offline/sync';
import { signal } from './offline/state';
import { assertCurrentAppVersion } from './appActivity';

export async function deleteDesign(id: string) {
  assertCurrentAppVersion();
  const user = await identity();
  await projectLock(user.id, id, () => deleteDesignLocked(id));
  if (!offlineForced()) await syncOfflineAccount();
}

export async function deleteOfflineModel(id: string) {
  assertCurrentAppVersion();
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

if (typeof window !== 'undefined') {
  subscribeOfflineMode(() => { if (!offlineForced()) void syncOfflineAccount().catch(() => {}); });
  window.addEventListener('online', () => { if (!offlineForced()) void syncOfflineAccount().catch(() => {}); });
}
