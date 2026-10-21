import * as THREE from 'three/webgpu';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createFurnitureMaterial, tintMaterial } from './materials';
import type { FurnitureItem, ModelPart, Room } from '../../domain/project/types';
import { readWorkshopGroup } from '../../domain/models/modelMetadata';
import { loadModelBlob } from '../../client/offline/offlineAssets';
import { onOfflinePurge } from '../../client/offline/offlineStorage';
import { onModelDeleted } from '../../client/models/modelRepository';
import { modelAssetUrl } from '../../client/models/modelUrl';
import { textureDimensions } from '../../client/graphics/graphicsSettings';
import { estimateMemoryInBytes } from 'three-mesh-bvh';
import { prepareScenePicking, releaseScenePicking } from './scenePickingAcceleration';

type Template = { scene: THREE.Group; bounds: THREE.Box3; gltf: GLTF; textureLods?: Map<number, Map<THREE.Texture, THREE.Texture>> };
type Entry = { promise: Promise<Template>; references: number; touched: number; value?: Template };
const cache = new Map<string, Entry>();
const originalMaterials = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>();
const maps = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const;
const cacheBudget = () => (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 32 : 64) * 1024 * 1024;

/** Estimate retained source buffers, decoded textures, texture variants and acceleration trees. */
export function modelTemplateBytes(scene: THREE.Group, textureLods?: Template['textureLods']): number {
  const buffers = new Set<ArrayBufferLike>(), textures = new Set<THREE.Texture>(), geometries = new Set<THREE.BufferGeometry>();
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const attribute of [...Object.values(object.geometry.attributes), ...(object.geometry.index ? [object.geometry.index] : [])]) buffers.add(attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array.buffer : attribute.array.buffer);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) for (const key of maps) { const texture = (material as THREE.MeshStandardMaterial)[key]; if (texture) textures.add(texture); }
  });
  textureLods?.forEach(lod => lod.forEach(texture => textures.add(texture)));
  let bytes = [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0);
  for (const texture of textures) { const image = texture.image as { width?: number; height?: number } | undefined; bytes += (image?.width ?? 0) * (image?.height ?? 0) * 4 * (texture.generateMipmaps ? 4 / 3 : 1); }
  for (const geometry of geometries) if (geometry.boundsTree) bytes += estimateMemoryInBytes(geometry.boundsTree);
  return Math.ceil(bytes);
}

export function customModelCacheUsage() {
  const entries = [...cache.values()];
  return { templates: entries.length, activeTemplates: entries.filter(entry => entry.references > 0).length, bytes: entries.reduce((sum, entry) => sum + (entry.value ? modelTemplateBytes(entry.value.scene, entry.value.textureLods) : 0), 0), budgetBytes: cacheBudget() };
}
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
  template.textureLods?.forEach(lod => lod.forEach(value => value.dispose()));
}

function modelTextureLod(template: Template, texture: THREE.Texture, maximum: number): THREE.Texture {
  const image = texture.image as { width?: number; height?: number } | undefined;
  if (typeof document === 'undefined' || !image?.width || !image.height || Math.max(image.width, image.height) <= maximum) return texture;
  template.textureLods ??= new Map();
  let maps = template.textureLods.get(maximum);
  if (!maps) { maps = new Map(); template.textureLods.set(maximum, maps); }
  const existing = maps.get(texture); if (existing) return existing;
  const size = textureDimensions(image.width, image.height, maximum), canvas = document.createElement('canvas');
  canvas.width = size.width; canvas.height = size.height;
  const context = canvas.getContext('2d'); if (!context) return texture;
  context.drawImage(texture.image as CanvasImageSource, 0, 0, size.width, size.height);
  const result = texture.clone(); result.source = new THREE.Source(canvas); result.needsUpdate = true; maps.set(texture, result);
  return result;
}
function trimCache() {
  const sizes = new Map([...cache].map(([key, entry]) => [key, entry.value ? modelTemplateBytes(entry.value.scene, entry.value.textureLods) : 0]));
  let bytes = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  const idle = [...cache.entries()].filter(([, entry]) => entry.references === 0).sort((a, b) => a[1].touched - b[1].touched);
  for (const [key, entry] of idle) {
    if (bytes <= cacheBudget() && cache.size <= 30) break;
    cache.delete(key);
    bytes -= sizes.get(key) ?? 0;
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
onModelDeleted(clearCustomModelCache);
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

/** Display buffers are immutable and template-owned; entering the workshop copies them for editing. */
export function cloneCustomModel(source: THREE.Group, editable = true): THREE.Group {
  const instance = source.clone(true);
  instance.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    originalMaterials.set(object, object.material);
    if (editable) object.geometry = object.geometry.clone();
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
  applyCustomMaterial(node, part, item, quality);
}

function applyCustomMaterial(node: THREE.Object3D, part: ModelPart, item: FurnitureItem, quality: Room['renderQuality']) {
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

function refreshCustomAppearance(root: THREE.Group, template: Template, before: FurnitureItem, item: FurnitureItem, quality: Room['renderQuality'], textureResolution?: number, rebuild = false) {
  if (!rebuild && before.material === item.material) {
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const source = originalMaterials.get(object); if (!source) return;
      let color = item.color;
      const ancestry: THREE.Object3D[] = []; for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) ancestry.push(parent);
      for (const parent of ancestry.reverse()) { const key = parent.userData.modelNodeKey as string | undefined; if (key !== undefined && item.parts?.[key]?.color) color = item.parts[key].color!; }
      const originals = Array.isArray(source) ? source : [source];
      (Array.isArray(object.material) ? object.material : [object.material]).forEach((material, index) => { const original = originals[index] as THREE.MeshStandardMaterial | undefined, hex = color ?? (original?.color ? '#' + original.color.getHexString() : null); if (hex) tintMaterial(material, hex); });
    });
    return;
  }
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const original = originalMaterials.get(object); if (!original) return;
    (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
    object.material = Array.isArray(original) ? original.map(material => material.clone()) : original.clone();
  });
  applyCustomMaterial(root, {}, item, quality);
  root.traverse(object => {
    const key = object.userData.modelNodeKey as string | undefined;
    if (key !== undefined && item.parts?.[key]) applyCustomMaterial(object, item.parts[key], { ...item, color: null, material: null }, quality);
    if (textureResolution && object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const standard = material as THREE.MeshStandardMaterial;
      for (const map of maps) if (standard[map]) standard[map] = modelTextureLod(template, standard[map]!, textureResolution);
    }
  });
}

function instantiate(template: Template, item: FurnitureItem, quality: Room['renderQuality'], textureResolution?: number, editable = false): THREE.Group {
  const model = cloneCustomModel(template.scene, editable), size = template.bounds.getSize(new THREE.Vector3()), center = template.bounds.getCenter(new THREE.Vector3());
  const content = new THREE.Group(); content.add(model);
  model.position.x -= center.x; model.position.y -= template.bounds.min.y; model.position.z -= center.z;
  content.scale.set(item.width / Math.max(0.01, size.x), item.height / Math.max(0.01, size.y), item.depth / Math.max(0.01, size.z));
  applyCustomPart(model, {}, item, quality);
  model.traverse(object => {
    const nodeKey = object.userData.modelNodeKey as string | undefined;
    const part = nodeKey === undefined ? undefined : item.parts?.[nodeKey];
    if (part) applyCustomPart(object, part, { ...item, color: null, material: null }, quality);
    if (textureResolution && object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const standard = material as THREE.MeshStandardMaterial;
      for (const key of maps) if (standard[key]) standard[key] = modelTextureLod(template, standard[key]!, textureResolution);
    }
  });
  return content;
}

export async function loadEditableModel(item: FurnitureItem, roomId?: string): Promise<THREE.Group> {
  if (!item.assetId) throw new Error('Selecciona un modelo personalizado.');
  const key = modelAssetUrl(item.assetId, roomId), entry = loadTemplate(key);
  try {
    const template = await entry.promise;
    const model = instantiate(template, item, 'realistic', undefined, true);
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
  roomId, publicOnly = false, onLoaded, onError, textureResolution,
}: { roomId?: string; publicOnly?: boolean; onLoaded?: () => void; onError?: (message: string) => void; textureResolution?: number } = {}): () => void {
  if (!item.assetId) return () => {};
  let cancelled = false, instance: THREE.Group | null = null, released = false;
  let currentItem = item, currentQuality = quality, currentResolution = textureResolution, loadedTemplate: Template | undefined;
  const key = modelAssetUrl(item.assetId, roomId, publicOnly), entry = loadTemplate(key);
  const cleanup = () => {
    cancelled = true;
    if (released) return;
    released = true;
    if (instance) {
      releaseScenePicking(instance);
      const materials = new Set<THREE.Material>();
      instance.traverse(object => { if (object instanceof THREE.Mesh) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material)); });
      materials.forEach(material => material.dispose());
      instance.removeFromParent(); instance = null;
    }
    releaseTemplate(key, entry);
  };
  parent.userData.disposeCustomModel = cleanup;
  parent.userData.updateCustomAppearance = (next: FurnitureItem, nextQuality: Room['renderQuality'], nextResolution?: number) => {
    if (cancelled) return;
    if (instance && loadedTemplate) refreshCustomAppearance(instance, loadedTemplate, currentItem, next, nextQuality, nextResolution, nextQuality !== currentQuality || nextResolution !== currentResolution);
    currentItem = next; currentQuality = nextQuality; currentResolution = nextResolution;
  };
  void entry.promise.then(template => {
    if (cancelled) return;
    loadedTemplate = template;
    const content = instantiate(template, currentItem, currentQuality, currentResolution);
    parent.add(content); instance = content;
    prepareScenePicking(content);
    parent.userData.customModelLoading = false;
    onLoaded?.();
  }).catch(error => { if (!cancelled) { parent.userData.customModelLoading = false; onError?.(error instanceof Error ? error.message : 'No se pudo cargar el modelo.'); } });
  parent.userData.customModelLoading = true;
  return cleanup;
}
