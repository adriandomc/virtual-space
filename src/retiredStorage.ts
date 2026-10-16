import { hasTestStorageRetirement } from './releasePolicy';

export async function retireTestStorage(release: unknown, factory: IDBFactory = indexedDB) {
  if (!hasTestStorageRetirement(release)) return;
  // Never infer deletion from an unknown schema, and never accept names from a response.
  for (const name of ['3d-space-offline', '3d-space-v2']) await new Promise<void>((accept, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => accept();
    request.onerror = () => reject(new Error('No se pudieron retirar los datos de prueba antiguos.'));
    request.onblocked = () => reject(new Error('Cierra las pestañas antiguas de 3D Space para retirar sus datos de prueba.'));
  });
}
