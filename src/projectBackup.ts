import { validateRoom } from './model';
import type { Room } from './types';
import { offlineModelMetadata } from './offlineModelValidation';
import type { ModelAsset } from './customModel';

type BackupBlob = { type: string; base64: string; bytes: number };
export type ProjectBackup = { room: Room; assets: { id: string; name: string; blob: Blob }[]; sketch: Blob | null };
const MB = 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const invalid = (message: string): never => { throw new Error(`El respaldo no es válido: ${message}`); };

function describeBlob(value: unknown, limit: number, label: string, types: string[]): BackupBlob {
  const data = object(value);
  if (!data || typeof data.type !== 'string' || !types.includes(data.type) || typeof data.base64 !== 'string' || !data.base64.length) return invalid(`${label} tiene un formato incorrecto.`);
  const encoded = data.base64;
  if (encoded.length > Math.ceil(limit / 3) * 4) return invalid(`${label} supera ${limit / MB} MB.`);
  if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return invalid(`${label} contiene datos dañados.`);
  const bytes = encoded.length / 4 * 3 - (encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0);
  if (!bytes || bytes > limit) return invalid(`${label} supera ${limit / MB} MB.`);
  return { type: data.type, base64: encoded, bytes };
}

function decodeBlob(data: BackupBlob, label: string, type = data.type): Blob {
  let binary: string;
  try { binary = atob(data.base64); }
  catch { return invalid(`${label} contiene datos dañados.`); }
  if (binary.length !== data.bytes || btoa(binary) !== data.base64) return invalid(`${label} contiene datos dañados.`);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type });
}

export function parseProjectBackup(value: unknown): ProjectBackup {
  const document = object(value);
  if (!document || document.format !== '3d-space-project' || document.version !== 2) return invalid('usa una copia actual de 3D Space.');
  let room: Room;
  try { room = validateRoom(document.room); }
  catch (cause) { return invalid(cause instanceof Error ? cause.message : 'revisa el diseño.'); }
  if (!Array.isArray(document.assets) || document.assets.length > 100) return invalid('admite hasta 100 modelos.');
  const required = new Set(room.furniture.filter(piece => piece.type === 'custom').map(piece => piece.assetId!));
  const ids = new Set<string>();
  let total = 0;
  const assets = document.assets.map(value => {
    const entry = object(value), asset = object(entry?.asset);
    if (!entry || !asset || typeof asset.id !== 'string' || !UUID.test(asset.id) || ids.has(asset.id)) return invalid('hay identificadores de modelo incorrectos o repetidos.');
    ids.add(asset.id);
    if (typeof asset.name !== 'string' || !asset.name.trim() || asset.name.length > 80 || /[\u0000-\u001f\u007f]/.test(asset.name)) return invalid('revisa el nombre de un modelo.');
    const data = describeBlob(entry.data, 20 * MB, 'Un modelo', ['model/gltf-binary']);
    total += data.bytes;
    if (total > 100 * MB) return invalid('los modelos superan 100 MB en total.');
    return { id: asset.id, name: asset.name.trim(), data };
  });
  for (const id of required) if (!ids.has(id)) return invalid('falta un modelo utilizado por el diseño.');
  const sketch = document.sketch === null ? null : describeBlob(document.sketch, 10 * MB, 'El croquis', ['image/png', 'image/jpeg', 'image/webp']);
  // Keep every supplied resource so validation cannot skip a corrupt unused file.
  const decoded: ProjectBackup['assets'] = [];
  for (const asset of assets) {
    const blob = decodeBlob(asset.data, 'Un modelo', 'model/gltf-binary');
    decoded.push({ id: asset.id, name: asset.name, blob });
  }
  return { room, assets: decoded, sketch: sketch ? decodeBlob(sketch, 'El croquis') : null };
}

export async function validateProjectBackupResources(backup: ProjectBackup): Promise<void> {
  validateRoom(backup.room);
  if (!Array.isArray(backup.assets) || backup.assets.length > 100) invalid('admite hasta 100 modelos.');
  const models = new Map<string, ModelAsset>();
  let total = 0;
  for (const asset of backup.assets) {
    if (models.has(asset.id) || !UUID.test(asset.id)) invalid('hay modelos repetidos o incorrectos.');
    if (typeof asset.name !== 'string' || !asset.name.trim() || asset.name.length > 80 || /[\u0000-\u001f\u007f]/.test(asset.name)) invalid('revisa el nombre de un modelo.');
    if (!(asset.blob instanceof Blob) || asset.blob.type !== 'model/gltf-binary' || !asset.blob.size || asset.blob.size > 20 * MB) invalid('un modelo tiene un formato o tamaño incorrecto.');
    total += asset.blob.size;
    if (total > 100 * MB) invalid('los modelos superan 100 MB en total.');
    models.set(asset.id, await offlineModelMetadata(asset.blob, asset.id, '', asset.name));
  }
  let triangles = 0, bytes = 0, pixels = 0;
  const used = new Set<string>();
  for (const item of backup.room.furniture.filter(item => item.type === 'custom')) {
    const model = models.get(item.assetId!) ?? invalid('falta un modelo utilizado por el diseño.');
    if (Object.keys(item.parts ?? {}).some(key => !model.nodes.some(node => node.key === key))) invalid('hay una pieza de modelo incorrecta.');
    triangles += model.triangles; bytes += model.size;
    if (!used.has(model.id)) { used.add(model.id); pixels += model.texturePixels; }
  }
  if (used.size > 30 || triangles > 1000000 || bytes > 100 * MB || pixels > 16 * MB) invalid('el diseño supera los límites de modelos.');
  if (backup.sketch) {
    const blob = backup.sketch;
    if (blob.size > 10 * MB) invalid('el croquis supera 10 MB.');
    const data = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    const signature = blob.type === 'image/png' ? [137,80,78,71,13,10,26,10].every((byte, i) => data[i] === byte)
      : blob.type === 'image/jpeg' ? data[0] === 255 && data[1] === 216 && data[2] === 255
      : blob.type === 'image/webp' && new TextDecoder().decode(data.slice(0, 4)) === 'RIFF' && new TextDecoder().decode(data.slice(8, 12)) === 'WEBP';
    if (!signature) invalid('el contenido del croquis no corresponde a su formato.');
  }
}

export async function serializeProjectBackup(backup: ProjectBackup): Promise<string> {
  await validateProjectBackupResources(backup);
  const encode = async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
    for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    return { type: blob.type, base64: btoa(binary) };
  };
  return JSON.stringify({ format: '3d-space-project', version: 2, room: backup.room, sketch: backup.sketch ? await encode(backup.sketch) : null,
    assets: await Promise.all(backup.assets.map(async asset => ({ asset: { id: asset.id, name: asset.name }, data: await encode(asset.blob) }))),
  });
}
