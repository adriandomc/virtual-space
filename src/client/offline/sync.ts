import { accountRequest, AccountRequestError } from '../api/accountApi';
import type { ProjectDocument } from '../../domain/project/projectDocument';
import type { ProjectSnapshot } from '../projects/liveProject';
import { listOffline, listOfflineMetadata, readOffline, removeOffline, setOfflineAccess } from './offlineStorage';
import { hydrateOfflineProject, projectWithoutModels, offlineProjectKey, readOfflineProject, SoloProject, validateOfflineProject, type OfflineProjectRecord, type SoloStatus } from './offlineProject';
import { flushOfflineAssets, type OfflineAssetRecord } from './offlineAssets';
import { sameData } from '../../shared/sameData';
import { offlineForced } from './offlineMode';
import { assetKey, identity, persistOfflineProject, removeCleanProject, removeProject, verifyAccount } from './repository';
import { offlineActivity, signal } from './state';

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
    const user = await identity(); offlineActivity.syncing = true; offlineActivity.error = ''; signal();
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
          if (failure) { record.error = failure; await persistOfflineProject(record); offlineActivity.error = failure; }
        };
        if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request('3d-space-project:' + offlineProjectKey(user.id, value.id), { ifAvailable: true }, async lock => { if (lock) await work(); });
        else await work();
      }
    } catch (cause) { offlineActivity.error = cause instanceof Error ? cause.message : 'No se pudo sincronizar.'; throw cause; }
    finally { offlineActivity.syncing = false; signal(); }
  })().finally(() => { syncPromise = undefined; });
  return syncPromise;
}
async function flushDeletedModels(record: OfflineProjectRecord) {
  for (const asset of await listOfflineMetadata<OfflineAssetRecord>('assets')) {
    if (asset.accountId !== record.accountId || asset.roomId !== record.id || !asset.deleted) continue;
    try { await accountRequest('/api/models/' + asset.asset.id + '?room=' + record.id, { method: 'DELETE', headers: { 'Content-Type': 'application/json', 'X-Offline-Write': '1', 'X-Account-Id': record.accountId }, body: JSON.stringify({ revision: record.snapshot.revision }) }); }
    catch (cause) { if (!(cause instanceof AccountRequestError && cause.status === 404)) throw cause; }
    await removeOffline('assets', assetKey(record.accountId, record.id, asset.asset.id));
  }
}
