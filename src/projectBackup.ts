import { validateRoom } from './model';
import type { Room } from './types';

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

/** Legacy room JSON is handled by the existing room importer. No network or storage is touched. */
export function parseProjectBackup(value: unknown): ProjectBackup | null {
  const document = object(value);
  if (!document || !Object.hasOwn(document, 'format')) return null;
  if (document.format !== '3d-space-offline' || document.version !== 1) return invalid('la versión no es compatible.');
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
    const data = describeBlob(entry.data, 20 * MB, 'Un modelo', ['', 'model/gltf-binary', 'application/octet-stream']);
    total += data.bytes;
    if (total > 100 * MB) return invalid('los modelos superan 100 MB en total.');
    return { id: asset.id, name: asset.name.trim(), data };
  });
  for (const id of required) if (!ids.has(id)) return invalid('falta un modelo utilizado por el diseño.');
  const sketch = document.sketch === null ? null : describeBlob(document.sketch, 10 * MB, 'El croquis', ['image/png', 'image/jpeg', 'image/webp']);
  // Validate even unused entries, but only return models that the design actually references.
  const decoded: ProjectBackup['assets'] = [];
  for (const asset of assets) {
    const blob = decodeBlob(asset.data, 'Un modelo', 'model/gltf-binary');
    if (required.has(asset.id)) decoded.push({ id: asset.id, name: asset.name, blob });
  }
  return { room, assets: decoded, sketch: sketch ? decodeBlob(sketch, 'El croquis') : null };
}
