import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { HttpError } from './auth.js';
import type { ProjectDocument } from './projectDocument.js';
import { readProject } from './projectRepository.js';
import { validateModelBudget } from './modelBudget.js';
import { preflightGlb } from './glbPreflight.js';

export const MODEL_MAX_BYTES = 20 * 1024 * 1024;
export const MODEL_ACCOUNT_BYTES = 100 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Json = Record<string, any>;
export type ModelNode = { key: string; name: string; mesh: boolean; generatedName?: true };
export type ModelAsset = { id: string; roomId?: string; name: string; size: number; createdAt: string; width: number; height: number; depth: number; triangles: number; texturePixels: number; meshInstances: number; materials: number; nodes: ModelNode[] };
type GeometryInfo = Omit<ModelAsset, 'id' | 'roomId' | 'name' | 'size' | 'createdAt'>;
const invalid = (message = 'El modelo GLB no es válido.') => { throw new HttpError(400, message); };
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max ? value : invalid();
const finite = (value: unknown, min = -1e6, max = 1e6): number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : invalid();
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value : invalid();
const list = (value: unknown, limit: number): Json[] => value === undefined ? [] : Array.isArray(value) && value.length <= limit ? value.map(object) : invalid('El modelo tiene demasiados elementos.');
const vector = (value: unknown, length: number, fallback: number[]): number[] => value === undefined ? fallback : Array.isArray(value) && value.length === length ? value.map(component => finite(component)) : invalid();

function imageDimensions(bytes: Buffer, mime: string): [number, number] {
  if (mime === 'image/png') {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') invalid('La textura PNG no es válida.');
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (mime === 'image/jpeg' && bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216) {
    let position = 2;
    while (position < bytes.length) {
      if (bytes[position++] !== 255) invalid('La textura JPG no es válida.');
      while (bytes[position] === 255) position++;
      const marker = bytes[position++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (position + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(position);
      if (length < 2 || position + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) return [bytes.readUInt16BE(position + 5), bytes.readUInt16BE(position + 3)];
      position += length;
    }
  }
  return invalid('Usa texturas PNG o JPG integradas en el modelo.');
}

type Matrix = number[];
const identity: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a: Matrix, b: Matrix): Matrix {
  return Array.from({ length: 16 }, (_, index) => {
    const row = index % 4, column = Math.floor(index / 4);
    return a[row] * b[column * 4] + a[row + 4] * b[column * 4 + 1] + a[row + 8] * b[column * 4 + 2] + a[row + 12] * b[column * 4 + 3];
  });
}
function nodeMatrix(node: Json): Matrix {
  if (node.matrix !== undefined) {
    if (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined) invalid();
    const result = vector(node.matrix, 16, identity);
    if (result[3] !== 0 || result[7] !== 0 || result[11] !== 0 || result[15] !== 1) invalid();
    return result;
  }
  const [tx, ty, tz] = vector(node.translation, 3, [0, 0, 0]);
  const [sx, sy, sz] = vector(node.scale, 3, [1, 1, 1]);
  const [x, y, z, w] = vector(node.rotation, 4, [0, 0, 0, 1]);
  if (Math.abs(x * x + y * y + z * z + w * w - 1) > 0.001 || [sx, sy, sz].some(value => value === 0 || Math.abs(value) > 1000)) invalid();
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}

/** Static, self-contained GLB: never let an uploaded document make secondary network requests. */
export function validateGlb(data: Buffer): GeometryInfo {
  if (data.length > MODEL_MAX_BYTES) throw new HttpError(413, 'El modelo debe pesar como máximo 20 MB.');
  let preflight: ReturnType<typeof preflightGlb>;
  try { preflight = preflightGlb(data); } catch (cause) { throw new HttpError(400, cause instanceof Error ? cause.message : 'El modelo GLB no es válido.'); }
  if (data.length < 28 || data.readUInt32LE(0) !== 0x46546c67 || data.readUInt32LE(4) !== 2 || data.readUInt32LE(8) !== data.length) invalid();
  const jsonSize = data.readUInt32LE(12);
  if (!jsonSize || jsonSize > 1024 * 1024 || jsonSize % 4 || data.readUInt32LE(16) !== 0x4e4f534a || 20 + jsonSize + 8 > data.length) invalid();
  let document: Json;
  try { document = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(20, 20 + jsonSize)).trimEnd())); }
  catch { return invalid(); }
  const binStart = 20 + jsonSize;
  const binSize = data.readUInt32LE(binStart);
  if (binSize % 4 || data.readUInt32LE(binStart + 4) !== 0x004e4942 || binStart + 8 + binSize !== data.length) invalid();
  const binary = data.subarray(binStart + 8);
  if (object(document.asset).version !== '2.0' || document.asset.minVersion && document.asset.minVersion !== '2.0') invalid();
  let jsonNodes = 0;
  const inspect = (value: unknown, depth = 0) => {
    if (++jsonNodes > 30000 || depth > 48) invalid('El modelo es demasiado complejo.');
    if (Array.isArray(value)) value.forEach(child => inspect(child, depth + 1));
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (key === 'uri') invalid('El modelo debe incluir sus texturas y datos, sin enlaces externos.');
      if (key === 'extensions' && child && Object.keys(object(child)).length) invalid('Exporta un GLB estático sin compresión ni extensiones.');
      inspect(child, depth + 1);
    }
  };
  inspect(document);
  if (['extensionsUsed', 'extensionsRequired', 'animations', 'skins'].some(key => document[key]?.length)) invalid('Exporta un GLB estático sin compresión ni animaciones.');
  const buffers = list(document.buffers, 1);
  if (buffers.length !== 1 || integer(buffers[0].byteLength, 1) > binSize || binSize - buffers[0].byteLength > 3) invalid();
  const views = list(document.bufferViews, 2048);
  for (const view of views) {
    if (integer(view.buffer) !== 0 || integer(view.byteOffset ?? 0) + integer(view.byteLength, 1) > buffers[0].byteLength) invalid();
    if (view.byteStride !== undefined && (integer(view.byteStride, 4, 252) % 4)) invalid();
  }
  const reference = (value: unknown, entries: Json[]): Json => entries[integer(value, 0, entries.length - 1)] ?? invalid();
  const componentBytes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const typeSizes: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const accessors = list(document.accessors, 1024);
  let decodedBytes = 0;
  for (const accessor of accessors) {
    if (accessor.sparse !== undefined || typeof accessor.type !== 'string' || !typeSizes[accessor.type] || !componentBytes[accessor.componentType]) invalid('Exporta el modelo sin accesores dispersos.');
    const view = reference(accessor.bufferView, views), bytes = componentBytes[accessor.componentType], elementSize = bytes * typeSizes[accessor.type];
    const count = integer(accessor.count, 1, 600000), offset = integer(accessor.byteOffset ?? 0), stride = view.byteStride ?? elementSize;
    if (offset % bytes || ((view.byteOffset ?? 0) + offset) % bytes || stride < elementSize || offset + (count - 1) * stride + elementSize > view.byteLength) invalid();
    if (accessor.normalized !== undefined && typeof accessor.normalized !== 'boolean') invalid();
    for (const key of ['min', 'max']) if (accessor[key] !== undefined) vector(accessor[key], typeSizes[accessor.type], []);
    decodedBytes += elementSize * count;
    if (decodedBytes > 32 * 1024 * 1024) invalid('El modelo requiere demasiada memoria.');
  }
  const readComponent = (accessor: Json, index: number, component = 0) => {
    const view = reference(accessor.bufferView, views), bytes = componentBytes[accessor.componentType];
    const offset = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0) + index * (view.byteStride ?? typeSizes[accessor.type] * bytes) + component * bytes;
    let value = accessor.componentType === 5126 ? binary.readFloatLE(offset) : accessor.componentType === 5125 ? binary.readUInt32LE(offset) : accessor.componentType === 5123 ? binary.readUInt16LE(offset) : accessor.componentType === 5122 ? binary.readInt16LE(offset) : accessor.componentType === 5121 ? binary.readUInt8(offset) : binary.readInt8(offset);
    if (accessor.normalized && accessor.componentType !== 5126) value = accessor.componentType === 5120 ? Math.max(value / 127, -1) : accessor.componentType === 5122 ? Math.max(value / 32767, -1) : value / (accessor.componentType === 5121 ? 255 : accessor.componentType === 5123 ? 65535 : 4294967295);
    return finite(value);
  };
  const images = list(document.images, 64), textures = list(document.textures, 64), samplers = list(document.samplers, 64), materials = list(document.materials, 256);
  const pixels = images.map(image => {
    const view = reference(image.bufferView, views);
    const [width, height] = imageDimensions(binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength), image.mimeType);
    if (!width || !height || width > 4096 || height > 4096) invalid('Las texturas deben medir como máximo 4096 × 4096.');
    return width * height;
  });
  let texturePixels = 0;
  for (const texture of textures) {
    texturePixels += pixels[integer(texture.source, 0, images.length - 1)];
    if (texture.sampler !== undefined) reference(texture.sampler, samplers);
    if (texturePixels > 16 * 1024 * 1024) invalid('Las texturas requieren demasiada memoria.');
  }
  for (const sampler of samplers) {
    if (sampler.magFilter !== undefined && ![9728, 9729].includes(sampler.magFilter)) invalid();
    if (sampler.minFilter !== undefined && ![9728, 9729, 9984, 9985, 9986, 9987].includes(sampler.minFilter)) invalid();
    for (const key of ['wrapS', 'wrapT']) if (sampler[key] !== undefined && ![33071, 33648, 10497].includes(sampler[key])) invalid();
  }
  for (const material of materials) {
    const pbr = material.pbrMetallicRoughness === undefined ? {} : object(material.pbrMetallicRoughness);
    if (pbr.baseColorFactor !== undefined) vector(pbr.baseColorFactor, 4, []).forEach(value => finite(value, 0, 1));
    if (material.emissiveFactor !== undefined) vector(material.emissiveFactor, 3, []).forEach(value => finite(value, 0, 1));
    for (const key of ['metallicFactor', 'roughnessFactor']) if (pbr[key] !== undefined) finite(pbr[key], 0, 1);
    if (material.alphaMode !== undefined && !['OPAQUE', 'MASK', 'BLEND'].includes(material.alphaMode)) invalid();
    if (material.alphaCutoff !== undefined) finite(material.alphaCutoff, 0, 1);
    for (const value of [pbr.baseColorTexture, pbr.metallicRoughnessTexture, material.normalTexture, material.occlusionTexture, material.emissiveTexture]) if (value !== undefined) {
      const info = object(value); reference(info.index, textures);
      if (info.texCoord !== undefined) integer(info.texCoord, 0, 1);
      if (info.scale !== undefined) finite(info.scale, -10, 10);
      if (info.strength !== undefined) finite(info.strength, 0, 1);
    }
  }
  const meshes = list(document.meshes, 256);
  let primitiveCount = 0;
  const meshInfo = meshes.map(mesh => {
    const primitives = list(mesh.primitives, 128);
    if (!primitives.length || (primitiveCount += primitives.length) > 512 || mesh.weights !== undefined) invalid();
    return primitives.map(primitive => {
      if (primitive.mode !== undefined && primitive.mode !== 4 || primitive.targets !== undefined) invalid('Usa un modelo estático formado por triángulos.');
      const attributes = object(primitive.attributes), position = reference(attributes.POSITION, accessors);
      if (position.type !== 'VEC3' || position.componentType !== 5126) invalid();
      for (const [key, value] of Object.entries(attributes)) {
        if (!['POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0'].includes(key)) invalid('El modelo incluye atributos no admitidos.');
        const accessor = reference(value, accessors);
        if (accessor.count !== position.count || accessor.type !== (key.startsWith('TEXCOORD') ? 'VEC2' : key === 'TANGENT' ? 'VEC4' : key === 'COLOR_0' ? accessor.type : 'VEC3') || key === 'COLOR_0' && !['VEC3', 'VEC4'].includes(accessor.type)) invalid();
        for (let index = 0; index < accessor.count; index++) for (let component = 0; component < typeSizes[accessor.type]; component++) readComponent(accessor, index, component);
      }
      let vertexCount = position.count;
      if (primitive.indices !== undefined) {
        const indices = reference(primitive.indices, accessors);
        if (indices.type !== 'SCALAR' || ![5121, 5123, 5125].includes(indices.componentType) || indices.normalized) invalid();
        vertexCount = indices.count;
        for (let index = 0; index < indices.count; index++) integer(readComponent(indices, index), 0, position.count - 1);
      }
      if (vertexCount % 3) invalid();
      if (primitive.material !== undefined) reference(primitive.material, materials);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let index = 0; index < position.count; index++) for (let component = 0; component < 3; component++) {
        const value = readComponent(position, index, component); min[component] = Math.min(min[component], value); max[component] = Math.max(max[component], value);
      }
      return { min, max, triangles: vertexCount / 3 };
    });
  });
  const nodes = list(document.nodes, 512), scenes = list(document.scenes, 32);
  if (!nodes.length || !scenes.length) invalid('El modelo no contiene una escena.');
  const parents = new Set<number>();
  for (const node of nodes) {
    nodeMatrix(node);
    if (node.skin !== undefined || node.weights !== undefined || node.camera !== undefined) invalid('Usa un modelo estático sin cámaras.');
    if (node.mesh !== undefined) reference(node.mesh, meshes);
    if (node.children !== undefined && (!Array.isArray(node.children) || node.children.length > 512)) invalid();
    for (const child of node.children ?? []) {
      integer(child, 0, nodes.length - 1);
      if (parents.has(child)) invalid('El modelo tiene una jerarquía no válida.');
      parents.add(child);
    }
  }
  const visiting = new Set<number>(), visited = new Set<number>();
  const checkCycle = (index: number, depth: number) => {
    if (visiting.has(index) || depth > 32) invalid('El modelo tiene una jerarquía no válida.');
    if (visited.has(index)) return;
    visiting.add(index); for (const child of nodes[index].children ?? []) checkCycle(child, depth + 1); visiting.delete(index); visited.add(index);
  };
  nodes.forEach((_, index) => checkCycle(index, 0));
  for (const scene of scenes) {
    if (!Array.isArray(scene.nodes) || scene.nodes.length > 512 || new Set(scene.nodes).size !== scene.nodes.length) invalid();
    for (const index of scene.nodes) { integer(index, 0, nodes.length - 1); if (parents.has(index)) invalid(); }
  }
  const scene = reference(document.scene ?? 0, scenes), min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  let triangles = 0;
  const activeNodes: ModelNode[] = [];
  const visit = (index: number, parent: Matrix) => {
    const node = nodes[index], matrix = multiply(parent, nodeMatrix(node));
    matrix.forEach(value => finite(value));
    const generatedName = typeof node.name !== 'string' || !node.name.trim();
    activeNodes.push({ key: String(index), name: generatedName ? `Parte ${index + 1}` : node.name.slice(0, 80), mesh: node.mesh !== undefined, ...(generatedName ? { generatedName: true as const } : {}) });
    for (const primitive of node.mesh === undefined ? [] : meshInfo[node.mesh]) {
      triangles += primitive.triangles;
      if (triangles > 200000) invalid('El modelo debe tener como máximo 200 000 triángulos.');
      for (let corner = 0; corner < 8; corner++) {
        const point = primitive.min.map((value, component) => corner & 1 << component ? primitive.max[component] : value);
        for (let component = 0; component < 3; component++) {
          const value = finite(matrix[component] * point[0] + matrix[component + 4] * point[1] + matrix[component + 8] * point[2] + matrix[component + 12]);
          min[component] = Math.min(min[component], value); max[component] = Math.max(max[component], value);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, matrix);
  };
  scene.nodes.forEach((index: number) => visit(index, identity));
  if (!triangles || !min.every(Number.isFinite)) invalid('El modelo no contiene superficies.');
  const dimensions = max.map((value, component) => Math.max(0.01, value - min[component]));
  if (dimensions.some(value => value > 10000)) invalid('Las dimensiones del modelo no son válidas.');
  return { width: dimensions[0], height: dimensions[1], depth: dimensions[2], triangles: preflight.triangles, texturePixels, meshInstances: preflight.primitiveInstances, materials: preflight.materials, nodes: activeNodes };
}

type AssetRow = { id: string; owner_id: string; room_id: string; name: string; size: number; created_at: number; metadata: string; data?: Uint8Array };
export function createModelAssets(database: DatabaseSync, { now = Date.now, canViewRoom, canEditRoom, recordAssetErasure }: {
  now?: () => number;
  canViewRoom: (roomId: string, userId: string | null) => boolean;
  canEditRoom: (roomId: string, userId: string) => boolean;
  recordAssetErasure?: (id: string, erase: () => void) => void;
}) {
  const find = database.prepare('SELECT id, owner_id, room_id, name, size, created_at, metadata FROM model_assets WHERE id = ?');
  const describe = (row: AssetRow): ModelAsset => ({ id: row.id, roomId: row.room_id, name: row.name, size: row.size, createdAt: new Date(row.created_at).toISOString(), ...JSON.parse(row.metadata) });
  const roomAssets = (roomId: string): Set<string> => {
    if (!UUID.test(roomId)) throw new HttpError(400, 'El proyecto no es válido.');
    const row = database.prepare('SELECT room FROM rooms WHERE id = ?').get(roomId) as { room: string } | undefined;
    return new Set(row ? readProject(database, roomId).levels.flatMap(level => level.furniture).filter(item => item.type === 'custom').map(item => item.assetId!) : []);
  };
  const permitted = (id: string, userId: string | null, roomId?: string): AssetRow => {
    if (!UUID.test(id)) throw new HttpError(404, 'Este modelo no existe.');
    const row = find.get(id) as AssetRow | undefined;
    if (!row || row.owner_id !== userId && (!roomId || row.room_id !== roomId || !canViewRoom(roomId, userId) || !roomAssets(roomId).has(id) && (!userId || !canEditRoom(roomId, userId)))) throw new HttpError(404, 'Este modelo no existe.');
    return row;
  };
  return {
    upload(ownerId: string, data: Buffer, name: string, roomId: string, requestedId?: string): ModelAsset {
      const room = UUID.test(roomId) ? database.prepare('SELECT owner_id FROM rooms WHERE id = ?').get(roomId) as { owner_id: string } | undefined : undefined;
      if (!room || room.owner_id !== ownerId) throw new HttpError(404, 'Este proyecto no existe.');
      const metadata = validateGlb(data);
      const cleanName = typeof name === 'string' ? name.trim().replace(/[\x00-\x1f\x7f]/g, '').replace(/\.glb$/i, '').slice(0, 80) : '';
      if (!cleanName) throw new HttpError(400, 'Escribe un nombre para el modelo.');
      if (requestedId !== undefined && !UUID.test(requestedId)) throw new HttpError(400, 'La identidad del modelo no es válida.');
      database.exec('BEGIN IMMEDIATE');
      try {
        if (requestedId) {
          const existing = find.get(requestedId) as AssetRow | undefined;
          if (existing) {
            const stored = database.prepare('SELECT data FROM model_assets WHERE id = ?').get(requestedId) as { data: Uint8Array };
            if (existing.owner_id !== ownerId || existing.room_id !== roomId || existing.name !== cleanName || !Buffer.from(stored.data).equals(data)) throw new HttpError(409, 'La identidad del modelo ya está en uso.');
            database.exec('COMMIT'); return describe(existing);
          }
        }
        const used = database.prepare('SELECT COALESCE(SUM(size), 0) AS total, COUNT(*) AS count FROM model_assets WHERE owner_id = ?').get(ownerId) as { total: number; count: number };
        if (used.total + data.length > MODEL_ACCOUNT_BYTES || used.count >= 100) throw new HttpError(413, 'Tu biblioteca admite hasta 100 MB y 100 modelos.');
        const id = requestedId ?? randomUUID(), createdAt = now();
        database.prepare('INSERT INTO model_assets (id, owner_id, room_id, name, size, created_at, metadata, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, ownerId, roomId, cleanName, data.length, createdAt, JSON.stringify(metadata), data);
        database.exec('COMMIT');
        return { id, roomId, name: cleanName, size: data.length, createdAt: new Date(createdAt).toISOString(), ...metadata };
      } catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    list(ownerId: string, roomId?: string, own = false): ModelAsset[] {
      if (own && !roomId) return (database.prepare('SELECT id, owner_id, room_id, name, size, created_at, metadata FROM model_assets WHERE owner_id = ? ORDER BY created_at DESC, id').all(ownerId) as AssetRow[]).map(describe);
      if (!roomId || !UUID.test(roomId)) throw new HttpError(400, 'Selecciona un diseño para ver sus modelos.');
      if (!canViewRoom(roomId, ownerId)) throw new HttpError(404, 'Este proyecto no existe.');
      if (own) return (database.prepare('SELECT id, owner_id, room_id, name, size, created_at, metadata FROM model_assets WHERE owner_id = ? ORDER BY created_at DESC, id').all(ownerId) as AssetRow[]).map(describe);
      const rows = database.prepare('SELECT id, owner_id, room_id, name, size, created_at, metadata FROM model_assets WHERE room_id = ? ORDER BY created_at DESC, id').all(roomId) as AssetRow[];
      const visible = canEditRoom(roomId, ownerId) ? rows : rows.filter(row => roomAssets(roomId).has(row.id));
      return visible.map(describe);
    },
    metadata(id: string, userId: string | null, roomId?: string) { return describe(permitted(id, userId, roomId)); },
    read(id: string, userId: string | null, roomId?: string): Buffer {
      permitted(id, userId, roomId);
      return Buffer.from((database.prepare('SELECT data FROM model_assets WHERE id = ?').get(id) as { data: Uint8Array }).data);
    },
    remove(id: string, ownerId: string, roomId?: string) {
      const row = permitted(id, ownerId);
      if (row.owner_id !== ownerId) throw new HttpError(403, 'Solo puedes eliminar tus modelos.');
      if (roomId && row.room_id !== roomId) throw new HttpError(409, 'El modelo pertenece a otro diseño.');
      const used = database.prepare("SELECT rooms.id FROM project_levels levels, rooms, json_each(levels.document, '$.furniture') item WHERE levels.room_id=rooms.id AND json_extract(item.value, '$.assetId') = ? LIMIT 1").get(id);
      if (used) throw new HttpError(409, 'El modelo está en un diseño. Retíralo antes de eliminarlo.');
      const erase = () => { database.prepare('DELETE FROM model_assets WHERE id = ?').run(id); };
      if (recordAssetErasure) recordAssetErasure(id, erase); else erase();
    },
    validateProjectReferences(project: ProjectDocument, userId: string, roomId?: string) {
      const items = project.levels.flatMap(level => level.furniture);
      if (items.some(item => item.type === 'custom') && (!roomId || !canEditRoom(roomId, userId))) throw new HttpError(400, 'El modelo no está disponible en este diseño.');
      const models = new Map<string, ModelAsset>();
      for (const item of items) if (item.type === 'custom') {
        const row = find.get(item.assetId!) as AssetRow | undefined;
        if (!row || row.room_id !== roomId) throw new HttpError(400, 'El modelo no está disponible en este diseño.');
        models.set(row.id, describe(row));
      }
      try { validateModelBudget(items, models); } catch (cause) { throw new HttpError(400, cause instanceof Error ? cause.message : 'El modelo no es válido.'); }
    },
  };
}
