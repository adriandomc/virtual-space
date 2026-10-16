import { inspectGlb, type ModelAsset } from '../../domain/models/glbValidation';

export function inspectOfflineGlb(bytes: ArrayBuffer) {
  const { metadata, document } = inspectGlb(new Uint8Array(bytes));
  return { document, ...metadata };
}

export async function offlineModelMetadata(file: Blob, id: string, roomId: string, name: string): Promise<ModelAsset> {
  const { metadata } = inspectGlb(new Uint8Array(await file.arrayBuffer()));
  const cleanName = name.trim().replace(/[\x00-\x1f\x7f]/g, '').replace(/\.glb$/i, '').slice(0, 80);
  if (!cleanName) throw new Error('Escribe un nombre para el modelo.');
  return { id, roomId, name: cleanName, size: file.size, createdAt: new Date().toISOString(), ...metadata };
}
