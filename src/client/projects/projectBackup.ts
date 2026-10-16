import { validateProjectDocument, type ProjectDocument } from '../../domain/project/projectDocument';
import { offlineModelMetadata } from '../offline/offlineModelValidation';
import { validateSketchBlob } from '../../domain/models/imageValidation';
import { validateModelBudget } from '../../domain/models/modelBudget';
import type { ModelAsset } from '../../domain/models/glbValidation';
import type { FileEntry } from '@zip.js/zip.js';

export type ProjectBackup = { project: ProjectDocument; assets: { id: string; name: string; blob: Blob }[]; sketches: { levelId: string; blob: Blob }[] };
const MB = 1024 * 1024;
export const MAX_PROJECT_ARCHIVE = 225 * MB;
const MANIFEST_LIMIT = 4 * MB, MAX_ENTRIES = 113;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const invalid = (message: string): never => { throw new Error(`El respaldo no es válido: ${message}`); };
const safeName = (name: unknown): name is string => typeof name === 'string' && !!name.trim() && name.length <= 80 && !/[\u0000-\u001f\u007f]/.test(name);

async function extract(entry: FileEntry, maximum: number, type: string) {
  if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 1 || entry.uncompressedSize > maximum) invalid('un archivo supera el tamaño permitido.');
  const parts: BlobPart[] = []; let bytes = 0;
  await entry.getData(new WritableStream<Uint8Array>({ write(chunk) {
    bytes += chunk.byteLength;
    if (bytes > maximum || bytes > entry.uncompressedSize) invalid('un archivo supera el tamaño permitido.');
    parts.push(new Uint8Array(chunk));
  } }), { checkSignature: true, useWebWorkers: false });
  if (bytes !== entry.uncompressedSize) invalid('un archivo está incompleto.');
  return new Blob(parts, { type });
}

export async function parseProjectBackup(value: unknown): Promise<ProjectBackup> {
  if (!(value instanceof Blob) || !value.size || value.size > MAX_PROJECT_ARCHIVE) return invalid('usa un archivo .3dspace actual de hasta 225 MB.');
  const signature = new Uint8Array(await value.slice(0, 4).arrayBuffer());
  if (signature[0] !== 80 || signature[1] !== 75 || signature[2] !== 3 || signature[3] !== 4) invalid('usa un archivo .3dspace actual. Los formatos anteriores no se admiten.');
  const { ZipReader, BlobReader } = await import('@zip.js/zip.js/index-native.js');
  const reader = new ZipReader(new BlobReader(value), { useWebWorkers: false });
  try {
    const files = new Map<string, FileEntry>(); let expanded = 0;
    for await (const entry of reader.getEntriesGenerator()) {
      if (files.size >= MAX_ENTRIES || entry.directory || entry.encrypted || entry.filename.length > 150 || entry.filename.includes('\\') || !/^(manifest\.json|models\/[0-9a-f-]+\.glb|sketches\/\d+\.(png|jpg|webp))$/i.test(entry.filename) || files.has(entry.filename)) invalid('hay rutas o archivos repetidos o no permitidos.');
      if (![0, 8].includes(entry.compressionMethod) || !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 1 || (expanded += entry.uncompressedSize) > 224 * MB) invalid('el contenido expandido supera los límites.');
      files.set(entry.filename, entry as FileEntry);
    }
    const manifestEntry = files.get('manifest.json');
    if (!manifestEntry) invalid('falta el manifiesto del proyecto.');
    let manifest: Record<string, unknown> | null;
    try { manifest = object(JSON.parse(await (await extract(manifestEntry!, MANIFEST_LIMIT, 'application/json')).text())); }
    catch (cause) { if (cause instanceof SyntaxError) return invalid('el manifiesto no contiene JSON válido.'); throw cause; }
    if (!manifest || manifest.format !== '3d-space-project' || manifest.version !== 3 || !Array.isArray(manifest.assets) || manifest.assets.length > 100 || !Array.isArray(manifest.sketches) || manifest.sketches.length > 12) return invalid('usa una copia actual de 3D Space.');
    let project: ProjectDocument;
    try { project = validateProjectDocument(manifest.project); }
    catch (cause) { return invalid(cause instanceof Error ? cause.message : 'revisa el diseño.'); }
    const assets: ProjectBackup['assets'] = [], sketches: ProjectBackup['sketches'] = [];
    const usedPaths = new Set(['manifest.json']);
    const take = async (path: unknown, size: unknown, maximum: number, type: string) => {
      if (typeof path !== 'string' || usedPaths.has(path) || !files.has(path)) return invalid('falta un archivo o su ruta está repetida.');
      const entry = files.get(path)!; usedPaths.add(path);
      if (size !== entry.uncompressedSize) invalid('el tamaño declarado no coincide con el archivo.');
      return extract(entry, maximum, type);
    };
    let modelBytes = 0;
    for (const data of manifest.assets) {
      const asset = object(data);
      if (!asset || typeof asset.id !== 'string' || !UUID.test(asset.id) || !safeName(asset.name) || asset.path !== `models/${asset.id}.glb`) return invalid('revisa los identificadores y nombres de los modelos.');
      const blob = await take(asset.path, asset.size, 20 * MB, 'model/gltf-binary');
      if ((modelBytes += blob.size) > 100 * MB) invalid('los modelos superan 100 MB en total.');
      assets.push({ id: asset.id, name: asset.name.trim(), blob });
    }
    for (const [index, data] of manifest.sketches.entries()) {
      const sketch = object(data);
      if (!sketch || typeof sketch.levelId !== 'string' || typeof sketch.type !== 'string' || !imageTypes.includes(sketch.type) || sketch.path !== `sketches/${index}.${sketch.type === 'image/jpeg' ? 'jpg' : sketch.type.slice(6)}`) return invalid('revisa los croquis del proyecto.');
      sketches.push({ levelId: sketch.levelId, blob: await take(sketch.path, sketch.size, 10 * MB, sketch.type) });
    }
    if (usedPaths.size !== files.size) invalid('el paquete contiene archivos no declarados.');
    const backup = { project, assets, sketches };
    await validateProjectBackupResources(backup);
    return backup;
  } catch (cause) {
    if (cause instanceof Error && cause.message.startsWith('El respaldo no es válido:')) throw cause;
    return invalid('el archivo está dañado o contiene rutas no permitidas.');
  } finally { await reader.close(); }
}

export async function validateProjectBackupResources(backup: ProjectBackup): Promise<void> {
  validateProjectDocument(backup.project);
  if (!Array.isArray(backup.assets) || backup.assets.length > 100 || !Array.isArray(backup.sketches) || backup.sketches.length > 12) invalid('revisa la cantidad de recursos del proyecto.');
  const models = new Map<string, ModelAsset>(); let total = 0;
  for (const asset of backup.assets) {
    if (models.has(asset.id) || !UUID.test(asset.id) || !safeName(asset.name)) invalid('hay modelos repetidos o incorrectos.');
    if (!(asset.blob instanceof Blob) || asset.blob.type !== 'model/gltf-binary' || !asset.blob.size || asset.blob.size > 20 * MB) invalid('un modelo tiene un formato o tamaño incorrecto.');
    total += asset.blob.size; if (total > 100 * MB) invalid('los modelos superan 100 MB en total.');
    models.set(asset.id, await offlineModelMetadata(asset.blob, asset.id, '', asset.name));
  }
  validateModelBudget(backup.project.levels.flatMap(level => level.furniture), models);
  const levels = new Set<string>();
  for (const sketch of backup.sketches) {
    if (!backup.project.levels.some(level => level.id === sketch.levelId) || levels.has(sketch.levelId)) invalid('hay croquis de niveles inexistentes o repetidos.');
    levels.add(sketch.levelId); const blob = sketch.blob;
    if (!(blob instanceof Blob) || !imageTypes.includes(blob.type) || !blob.size || blob.size > 10 * MB) invalid('el croquis supera 10 MB o tiene un formato incorrecto.');
    await validateSketchBlob(blob);
  }
}

export async function serializeProjectBackup(backup: ProjectBackup): Promise<Blob> {
  await validateProjectBackupResources(backup);
  const { ZipWriter, BlobReader, BlobWriter, TextReader } = await import('@zip.js/zip.js/index-native.js');
  const assets = backup.assets.map(asset => ({ id: asset.id, name: asset.name, path: `models/${asset.id}.glb`, size: asset.blob.size }));
  const sketches = backup.sketches.map((sketch, index) => ({ levelId: sketch.levelId, type: sketch.blob.type, size: sketch.blob.size, path: `sketches/${index}.${sketch.blob.type === 'image/jpeg' ? 'jpg' : sketch.blob.type.slice(6)}` }));
  const manifest = JSON.stringify({ format: '3d-space-project', version: 3, project: backup.project, assets, sketches });
  if (new TextEncoder().encode(manifest).byteLength > MANIFEST_LIMIT) invalid('el manifiesto supera el tamaño permitido.');
  const writer = new ZipWriter(new BlobWriter('application/vnd.3dspace+zip'), { useWebWorkers: false, level: 0 });
  await writer.add('manifest.json', new TextReader(manifest));
  for (const [index, asset] of backup.assets.entries()) await writer.add(assets[index].path, new BlobReader(asset.blob));
  for (const [index, sketch] of backup.sketches.entries()) await writer.add(sketches[index].path, new BlobReader(sketch.blob));
  return writer.close();
}
