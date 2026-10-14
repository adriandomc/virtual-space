import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createFurnitureMaterial } from './materials';
import type { FurnitureItem, ModelPart, Room } from './types';
import type { ModelAsset } from './modelAssets';
import { accountRequest, isNetworkError } from './accountApi';
import { readWorkshopGroup } from './workshopGrouping';
import { copyOfflineModel, forgetOfflineModel, listOfflineModels, loadModelBlob, readModelMetadata, reconcileOfflineModels, rememberModelMetadata, uploadOfflineModel } from './offlineAssets';
import { onOfflinePurge } from './offlineStorage';

export type { ModelAsset } from './modelAssets';
export const modelAssetUrl = (id: string, roomId?: string, publicOnly = false) => `/api/models/${encodeURIComponent(id)}${roomId ? '?room=' + encodeURIComponent(roomId) : ''}${publicOnly ? (roomId ? '&' : '?') + 'public=1' : ''}`;
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
    if (isNetworkError(error) && roomId) return listOfflineModels(roomId, scope);
    throw error;
  }
}
export async function copyModel(asset: ModelAsset, roomId: string): Promise<ModelAsset> {
  return copyOfflineModel(asset, roomId);
}
export async function modelMetadata(id: string, roomId?: string): Promise<ModelAsset> {
  return readModelMetadata(id, roomId);
}
export async function deleteModel(id: string): Promise<void> { await accountRequest(modelAssetUrl(id), { method: 'DELETE' }); await forgetOfflineModel(id); clearCustomModelCache(); }

type Template = { scene: THREE.Group; bounds: THREE.Box3; gltf: GLTF };
type Entry = { promise: Promise<Template>; references: number; touched: number; value?: Template };
const cache = new Map<string, Entry>();
const maps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const;
function disposeTemplate(template: Template) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  template.scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const key of maps) { const texture = (material as THREE.MeshStandardMaterial)[key]; if (texture) textures.add(texture); }
    }
  });
  geometries.forEach(value => value.dispose()); materials.forEach(value => value.dispose());
  textures.forEach(value => { value.dispose(); if (typeof ImageBitmap !== 'undefined' && value.image instanceof ImageBitmap) value.image.close(); });
}
function trimCache() {
  const idle = [...cache.entries()].filter(([, entry]) => entry.references === 0).sort((a, b) => b[1].touched - a[1].touched);
  for (const [key, entry] of idle.slice(1)) {
    cache.delete(key);
    if (entry.value) disposeTemplate(entry.value);
  }
}
function releaseTemplate(key: string, entry: Entry) {
  entry.references--; entry.touched = Date.now();
  if (cache.get(key) !== entry && !entry.references && entry.value) { disposeTemplate(entry.value); entry.value = undefined; }
  trimCache();
}
export function clearCustomModelCache() {
  for (const [key, entry] of cache) if (!entry.references) { cache.delete(key); if (entry.value) disposeTemplate(entry.value); }
}
onOfflinePurge(() => {
  for (const [key, entry] of cache) { cache.delete(key); if (!entry.references && entry.value) disposeTemplate(entry.value); }
});

/** Trust parser associations, never uploaded extras, for logical GLTF meshes. */
export function prepareCustomModelTemplate(gltf: GLTF) {
  gltf.scene.traverse(object => {
    const association = gltf.parser.associations.get(object) as { nodes?: number; meshes?: number; primitives?: number } | undefined;
    const group = readWorkshopGroup(object.userData.workshopGroup);
    object.userData = {};
    if (group) object.userData.workshopGroup = group;
    if (association?.nodes !== undefined) object.userData.modelNodeKey = String(association.nodes);
    if (object instanceof THREE.Group && association?.meshes !== undefined && association.primitives === undefined) object.userData.logicalModelMesh = true;
    if (object instanceof THREE.Mesh) {
      if (association?.meshes !== undefined && association.primitives !== undefined && association.nodes === undefined) object.userData.logicalModelPrimitive = true;
      object.geometry.userData = {};
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.userData = {};
    }
  });
}
function loadTemplate(key: string): Entry {
  const existing = cache.get(key);
  if (existing) { existing.references++; existing.touched = Date.now(); return existing; }
  const entry: Entry = { references: 1, touched: Date.now(), promise: Promise.resolve(null as unknown as Template) };
  cache.set(key, entry);
  entry.promise = (async () => {
    const parsed = new URL(key, 'https://3d-space.invalid');
    const bytes = await (await loadModelBlob(decodeURIComponent(parsed.pathname.slice('/api/models/'.length)), parsed.searchParams.get('room') ?? undefined, parsed.searchParams.get('public') === '1')).arrayBuffer();
    const manager = new THREE.LoadingManager();
    manager.setURLModifier(url => { if (!url.startsWith('blob:')) throw new Error('El modelo contiene enlaces externos.'); return url; });
    const gltf = await new GLTFLoader(manager).parseAsync(bytes, '');
    prepareCustomModelTemplate(gltf);
    const template = { scene: gltf.scene, bounds: new THREE.Box3().setFromObject(gltf.scene), gltf };
    entry.value = template;
    if (cache.get(key) !== entry && !entry.references) { disposeTemplate(template); entry.value = undefined; }
    else trimCache();
    return template;
  })().catch(error => { if (cache.get(key) === entry) cache.delete(key); throw error; });
  return entry;
}

/** Each scene instance owns its geometry/materials; authored textures are shared until its template is released. */
export function cloneCustomModel(source: THREE.Group): THREE.Group {
  const instance = source.clone(true);
  instance.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry = object.geometry.clone();
    object.material = Array.isArray(object.material) ? object.material.map(material => material.clone()) : object.material.clone();
    object.castShadow = object.receiveShadow = true;
  });
  return instance;
}

export function applyCustomPart(node: THREE.Object3D, part: ModelPart, item: FurnitureItem, quality: Room['renderQuality']) {
  if (part.visible !== undefined) node.visible = part.visible;
  if (part.position) node.position.add(new THREE.Vector3(part.position.x, part.position.y, part.position.z));
  if (part.rotation) node.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...[part.rotation.x, part.rotation.y, part.rotation.z].map(THREE.MathUtils.degToRad) as [number, number, number])));
  if (part.scale) node.scale.multiply(new THREE.Vector3(part.scale.x, part.scale.y, part.scale.z));
  node.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.material = (Array.isArray(object.material) ? object.material : [object.material]).map(original => {
      const source = original as THREE.MeshStandardMaterial;
      const authoredSurface = /^3D Space:(wood|plastic|metal)$/.exec(source.name)?.[1] as ModelPart['material'];
      const surface = part.material ?? item.material ?? authoredSurface;
      if (surface) {
        const material = createFurnitureMaterial(part.color ?? item.color ?? (source.color ? '#' + source.color.getHexString() : '#cccccc'), surface, quality);
        material.name = `3D Space:${surface}`;
        material.side = source.side; material.transparent = source.transparent; material.opacity = source.opacity; material.alphaTest = source.alphaTest;
        source.dispose();
        return material;
      }
      if (part.color ?? item.color) source.color?.set(part.color ?? item.color!);
      if (quality === 'standard') { source.normalMap = null; source.roughnessMap = null; source.aoMap = null; }
      if (quality === 'hyperrealistic' && !(source instanceof THREE.MeshPhysicalNodeMaterial)) {
        const material = new THREE.MeshPhysicalNodeMaterial({ color: source.color, roughness: source.roughness ?? 0.8, metalness: source.metalness ?? 0, side: source.side, transparent: source.transparent, opacity: source.opacity, alphaTest: source.alphaTest, emissive: source.emissive, emissiveIntensity: source.emissiveIntensity, clearcoat: (source.metalness ?? 0) > 0.5 ? 0 : 0.15, clearcoatRoughness: 0.4 });
        for (const key of maps) material[key] = source[key];
        material.normalScale.copy(source.normalScale ?? new THREE.Vector2(1, 1));
        source.dispose();
        return material;
      }
      source.needsUpdate = true;
      return source;
    });
    if (object.material.length === 1) object.material = object.material[0];
  });
}

function instantiate(template: Template, item: FurnitureItem, quality: Room['renderQuality']): THREE.Group {
  const model = cloneCustomModel(template.scene), size = template.bounds.getSize(new THREE.Vector3()), center = template.bounds.getCenter(new THREE.Vector3());
  const content = new THREE.Group(); content.add(model);
  model.position.x -= center.x; model.position.y -= template.bounds.min.y; model.position.z -= center.z;
  content.scale.set(item.width / Math.max(0.01, size.x), item.height / Math.max(0.01, size.y), item.depth / Math.max(0.01, size.z));
  applyCustomPart(model, {}, item, quality);
  model.traverse(object => {
    const nodeKey = object.userData.modelNodeKey as string | undefined;
    const part = nodeKey === undefined ? undefined : item.parts?.[nodeKey];
    if (part) applyCustomPart(object, part, { ...item, color: undefined, material: undefined }, quality);
  });
  return content;
}

export async function loadEditableModel(item: FurnitureItem, roomId?: string): Promise<THREE.Group> {
  if (!item.assetId) throw new Error('Selecciona un modelo personalizado.');
  const key = modelAssetUrl(item.assetId, roomId), entry = loadTemplate(key);
  try {
    const template = await entry.promise;
    const model = instantiate(template, item, 'realistic');
    let disposed = false;
    model.userData.disposeEditorModel = () => {
      if (disposed) return;
      disposed = true;
      model.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose()); } });
      releaseTemplate(key, entry);
    };
    return model;
  } catch (error) { releaseTemplate(key, entry); throw error; }
}

export function attachCustomModel(parent: THREE.Group, item: FurnitureItem, quality: Room['renderQuality'], {
  roomId, publicOnly = false, onLoaded, onError,
}: { roomId?: string; publicOnly?: boolean; onLoaded?: () => void; onError?: (message: string) => void } = {}): () => void {
  if (!item.assetId) return () => {};
  let cancelled = false, instance: THREE.Group | null = null, released = false;
  const key = modelAssetUrl(item.assetId, roomId, publicOnly), entry = loadTemplate(key);
  const cleanup = () => {
    cancelled = true;
    if (released) return;
    released = true;
    if (instance) {
      instance.traverse(object => { if (object instanceof THREE.Mesh) { object.geometry.dispose(); (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose()); } });
      instance.removeFromParent(); instance = null;
    }
    releaseTemplate(key, entry);
  };
  parent.userData.disposeCustomModel = cleanup;
  void entry.promise.then(template => {
    if (cancelled) return;
    const content = instantiate(template, item, quality);
    parent.add(content); instance = content;
    parent.userData.customModelLoading = false;
    onLoaded?.();
  }).catch(error => { if (!cancelled) { parent.userData.customModelLoading = false; onError?.(error instanceof Error ? error.message : 'No se pudo cargar el modelo.'); } });
  parent.userData.customModelLoading = true;
  return cleanup;
}
