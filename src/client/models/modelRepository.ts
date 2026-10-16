import type { ModelAsset } from '../../domain/models/glbValidation';
import { AccountRequestError, accountRequest, isNetworkError } from '../api/accountApi';
import { copyOfflineModel, listOfflineModels, readModelMetadata, reconcileOfflineModels, rememberModelMetadata, uploadOfflineModel } from '../offline/offlineAssets';
import { deleteOfflineModel } from '../offline/offlineService';

const deletionListeners = new Set<() => void>();
export function onModelDeleted(listener: () => void): () => void {
  deletionListeners.add(listener);
  return () => { deletionListeners.delete(listener); };
}

export async function uploadModel(file: File, roomId: string): Promise<ModelAsset> {
  return uploadOfflineModel(file, roomId);
}

export async function listModels(roomId?: string, scope: 'room' | 'mine' = 'room'): Promise<ModelAsset[]> {
  try {
    const models = (await accountRequest<{ models: ModelAsset[] }>('/api/models' + (roomId ? '?room=' + encodeURIComponent(roomId) + (scope === 'mine' ? '&scope=mine' : '') : ''))).models;
    if (roomId) {
      await reconcileOfflineModels(roomId, models, scope);
      await rememberModelMetadata(roomId, models);
      const cached = await listOfflineModels(roomId, scope, true);
      return [...models, ...cached.filter(asset => !models.some(model => model.id === asset.id))];
    }
    return models;
  } catch (error) {
    if ((isNetworkError(error) || error instanceof AccountRequestError && error.status === 401) && roomId) return listOfflineModels(roomId, scope);
    throw error;
  }
}

export async function copyModel(asset: ModelAsset, roomId: string): Promise<ModelAsset> {
  return copyOfflineModel(asset, roomId);
}

export async function modelMetadata(id: string, roomId?: string): Promise<ModelAsset> {
  return readModelMetadata(id, roomId);
}

export async function deleteModel(id: string): Promise<void> {
  await deleteOfflineModel(id);
  for (const listener of deletionListeners) listener();
}
