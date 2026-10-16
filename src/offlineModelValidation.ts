import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { ModelAsset } from './modelAssets';
import { preflightGlb } from './glbPreflight';

const invalid = () => { throw new Error('El modelo GLB no es válido para guardarlo sin conexión.'); };
const integer = (value: unknown, max = Number.MAX_SAFE_INTEGER): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : invalid();
type Json = Record<string, any>;

/** Bound parsing before GLTFLoader allocates geometry or decodes embedded images. */
export function inspectOfflineGlb(bytes: ArrayBuffer): { document: Json; texturePixels: number; meshInstances: number; materials: number; triangles: number } {
  const preflight = preflightGlb(new Uint8Array(bytes));
  const view = new DataView(bytes);
  if (bytes.byteLength > 20 * 1024 * 1024) throw new Error('El modelo debe pesar como máximo 20 MB.');
  if (bytes.byteLength < 28 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) invalid();
  const jsonSize = view.getUint32(12, true), binStart = 20 + jsonSize;
  if (!jsonSize || jsonSize > 1024 * 1024 || jsonSize % 4 || binStart + 8 > bytes.byteLength || view.getUint32(16, true) !== 0x4e4f534a) invalid();
  const binSize = view.getUint32(binStart, true);
  if (binSize % 4 || view.getUint32(binStart + 4, true) !== 0x004e4942 || binStart + 8 + binSize !== bytes.byteLength) invalid();
  let document: Json;
  try { document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes, 20, jsonSize))); }
  catch { return invalid(); }
  let count = 0;
  const inspect = (value: unknown, depth = 0) => {
    if (++count > 30000 || depth > 48) invalid();
    if (typeof value === 'number' && !Number.isFinite(value)) invalid();
    if (Array.isArray(value)) value.forEach(child => inspect(child, depth + 1));
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (key === 'uri' || key === 'extensions' && child && Object.keys(child).length) throw new Error('Usa un GLB integrado, sin enlaces externos ni extensiones.');
      inspect(child, depth + 1);
    }
  };
  inspect(document);
  if (!document?.asset || document.asset.version !== '2.0' || ['extensionsUsed', 'extensionsRequired', 'animations', 'skins'].some(key => document[key]?.length)) invalid();
  const list = (name: string, maximum: number): Json[] => {
    const value = document[name] ?? [];
    return Array.isArray(value) && value.length <= maximum && value.every(item => item && typeof item === 'object' && !Array.isArray(item)) ? value : invalid();
  };
  const buffers = list('buffers', 1), views = list('bufferViews', 2048), accessors = list('accessors', 1024);
  if (buffers.length !== 1 || integer(buffers[0].byteLength, binSize) < binSize - 3) invalid();
  for (const part of views) if (part.buffer !== 0 || integer(part.byteOffset ?? 0) + integer(part.byteLength) > buffers[0].byteLength) invalid();
  const componentBytes: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const elements: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  let decoded = 0;
  for (const accessor of accessors) {
    const part = views[integer(accessor.bufferView, views.length - 1)], size = componentBytes[accessor.componentType] * elements[accessor.type];
    const length = integer(accessor.count, 600000);
    if (!part || !size || !length || accessor.sparse || integer(accessor.byteOffset ?? 0) + (length - 1) * integer(part.byteStride ?? size) + size > part.byteLength || (decoded += length * size) > 32 * 1024 * 1024) invalid();
  }
  const meshes = list('meshes', 256), nodes = list('nodes', 512), scenes = list('scenes', 32);
  let primitives = 0;
  for (const mesh of meshes) {
    if (!Array.isArray(mesh.primitives) || !mesh.primitives.length || mesh.primitives.length > 128 || (primitives += mesh.primitives.length) > 512) invalid();
    for (const primitive of mesh.primitives) {
      if (!primitive || primitive.mode !== undefined && primitive.mode !== 4 || primitive.targets || !primitive.attributes) invalid();
      const position = accessors[integer(primitive.attributes.POSITION, accessors.length - 1)];
      if (!position || position.type !== 'VEC3' || position.componentType !== 5126) invalid();
      for (const [name, index] of Object.entries(primitive.attributes)) if (!['POSITION', 'NORMAL', 'TANGENT', 'TEXCOORD_0', 'TEXCOORD_1', 'COLOR_0'].includes(name) || !accessors[integer(index, accessors.length - 1)] || accessors[Number(index)].count !== position.count) invalid();
      if (primitive.indices !== undefined) {
        const indices = accessors[integer(primitive.indices, accessors.length - 1)];
        if (!indices || indices.type !== 'SCALAR' || ![5121, 5123, 5125].includes(indices.componentType) || indices.normalized) invalid();
      }
    }
  }
  const parents = new Set<number>(), visited = new Set<number>(), visiting = new Set<number>();
  for (const node of nodes) {
    if (node.skin !== undefined || node.camera !== undefined || node.weights !== undefined || node.mesh !== undefined && !meshes[integer(node.mesh, meshes.length - 1)]) invalid();
    if (node.children !== undefined && (!Array.isArray(node.children) || node.children.length > 512)) invalid();
    for (const child of node.children ?? []) { integer(child, nodes.length - 1); if (parents.has(child)) invalid(); parents.add(child); }
  }
  const visit = (index: number, depth = 0) => {
    if (visiting.has(index) || depth > 32) invalid();
    if (visited.has(index)) return;
    visiting.add(index); for (const child of nodes[index].children ?? []) visit(child, depth + 1); visiting.delete(index); visited.add(index);
  };
  nodes.forEach((_, index) => visit(index));
  if (!nodes.length || !scenes.length || !scenes[integer(document.scene ?? 0, scenes.length - 1)]) invalid();
  for (const scene of scenes) {
    if (!Array.isArray(scene.nodes) || scene.nodes.length > 512 || new Set(scene.nodes).size !== scene.nodes.length) invalid();
    for (const node of scene.nodes) if (!nodes[integer(node, nodes.length - 1)] || parents.has(node)) invalid();
  }
  list('materials', 256); list('samplers', 64);
  const images = list('images', 64), textures = list('textures', 64);
  const pixels = images.map(image => {
    const part = views[integer(image.bufferView, views.length - 1)];
    if (!part) return invalid();
    const data = new DataView(bytes, binStart + 8 + (part.byteOffset ?? 0), part.byteLength);
    let width = 0, height = 0;
    if (image.mimeType === 'image/png' && data.byteLength >= 33 && data.getUint32(0) === 0x89504e47 && data.getUint32(4) === 0x0d0a1a0a) {
      width = data.getUint32(16); height = data.getUint32(20);
    } else if (image.mimeType === 'image/jpeg' && data.byteLength > 4 && data.getUint16(0) === 0xffd8) {
      let offset = 2;
      while (offset + 4 < data.byteLength) {
        if (data.getUint8(offset++) !== 255) invalid();
        while (offset < data.byteLength && data.getUint8(offset) === 255) offset++;
        if (offset >= data.byteLength) break;
        const marker = data.getUint8(offset++);
        if (marker === 217 || marker === 218) break;
        if (marker === 1 || marker >= 208 && marker <= 215) continue;
        if (offset + 2 > data.byteLength) invalid();
        const length = data.getUint16(offset);
        if (length < 2 || offset + length > data.byteLength) invalid();
        if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) && length >= 8) { height = data.getUint16(offset + 3); width = data.getUint16(offset + 5); break; }
        offset += length;
      }
    }
    if (!width || !height || width > 4096 || height > 4096) throw new Error('Las texturas deben medir como máximo 4096 × 4096.');
    return width * height;
  });
  let texturePixels = 0;
  for (const texture of textures) {
    const value = pixels[integer(texture.source, pixels.length - 1)];
    if (!value || (texturePixels += value) > 16 * 1024 * 1024) invalid();
  }
  return { document, texturePixels, meshInstances: preflight.primitiveInstances, materials: preflight.materials, triangles: preflight.triangles };
}

export async function offlineModelMetadata(file: Blob, id: string, roomId: string, name: string): Promise<ModelAsset> {
  const bytes = await file.arrayBuffer(), { texturePixels, document, meshInstances, materials, triangles: expandedTriangles } = inspectOfflineGlb(bytes);
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => { if (!url.startsWith('blob:')) invalid(); return url; });
  let gltf;
  try { gltf = await new GLTFLoader(manager).parseAsync(bytes, ''); }
  catch { return invalid(); }
  const nodes: ModelAsset['nodes'] = [], bounds = new THREE.Box3();
  let triangles = 0;
  const textures = new Set<THREE.Texture>();
  try {
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(object => {
      if (!object.matrixWorld.elements.every(Number.isFinite)) invalid();
      const association = gltf.parser.associations.get(object) as { nodes?: number } | undefined;
      if (association?.nodes !== undefined) {
        const name = document.nodes[association.nodes].name;
        const generatedName = typeof name !== 'string' || !name.trim();
        nodes.push({ key: String(association.nodes), name: generatedName ? `Parte ${association.nodes + 1}` : name.slice(0, 80), mesh: object instanceof THREE.Mesh || object.children.some(child => child instanceof THREE.Mesh), ...(generatedName ? { generatedName: true as const } : {}) });
      }
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry;
      const position = geometry.getAttribute('position');
      if (!position) invalid();
      for (const attribute of Object.values(geometry.attributes) as THREE.BufferAttribute[]) for (let index = 0; index < attribute.array.length; index++) if (!Number.isFinite(attribute.array[index])) invalid();
      if (geometry.index) for (const index of geometry.index.array) if (!Number.isSafeInteger(index) || index < 0 || index >= position.count) invalid();
      triangles += (geometry.index?.count ?? position.count) / 3;
      if (triangles > 200000 || !Number.isInteger(triangles)) throw new Error('El modelo debe tener como máximo 200 000 triángulos.');
      bounds.expandByObject(object);
    });
    const size = bounds.getSize(new THREE.Vector3());
    if (!triangles || size.toArray().some(value => !Number.isFinite(value) || value < 0 || value > 10000)) invalid();
    return { id, roomId, name: name.replace(/\.glb$/i, '').trim().slice(0, 80) || 'Modelo', size: file.size, createdAt: new Date().toISOString(), width: Math.max(.01, size.x), height: Math.max(.01, size.y), depth: Math.max(.01, size.z), triangles: expandedTriangles, texturePixels, meshInstances, materials, nodes };
  } finally {
    gltf.scene.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        material.dispose();
      }
    });
    for (const texture of textures) { texture.dispose(); if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) texture.image.close(); }
  }
}
