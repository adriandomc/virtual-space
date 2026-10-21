import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { bounds, furnitureCorners } from '../../domain/project/model';
import { createFabricMaterial, createFurnitureMaterial, tintMaterial } from './materials';
import { getGraphicsProfile } from '../../client/graphics/graphicsSettings';
import { createDuvetGeometry, createPillowGeometry } from './beddingGeometry';
import { buildCatalogGeometry } from './catalogGeometry';
import { isFurnitureVariant } from '../../domain/models/furnitureCatalog';
import { attachCustomModel } from './customModel';
import { groupDisplayGeometry } from './displayGeometry';
import { prepareScenePicking } from './scenePickingAcceleration';
import type { FurnitureItem, Room, Selection } from '../../domain/project/types';
type FurnitureRenderOptions = { geometry?: 'low' | 'medium' | 'high'; textures?: number; roomId?: string; publicView?: boolean; onError?: (message: string) => void; onLoaded?: () => void; editable?: boolean };

export function box(group: THREE.Group, size: [number, number, number], at: [number, number, number], material: THREE.Material, rounded = false) {
  const beveled = group.userData.architectural;
  const detail = group.userData.geometry ?? 'high';
  const geometry = detail !== 'low' && (rounded || beveled) ? new RoundedBoxGeometry(...size, detail === 'medium' ? 1 : beveled ? 3 : 2, Math.min(beveled ? 0.012 : 0.06, ...size.map(value => value / 3))) : new THREE.BoxGeometry(...size);
  if (beveled) {
    const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
    for (let i = 0; i < position.count; i++) {
      const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i)), nz = Math.abs(normal.getZ(i));
      uv.setXY(i, nx > ny && nx > nz ? position.getZ(i) : position.getX(i), ny > nx && ny > nz ? position.getZ(i) : position.getY(i));
    }
    if (import.meta.env?.DEV) console.assert(Array.from(uv.array).every(Number.isFinite), 'Furniture UV coordinates must be finite');
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...at);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

export function addStoredFurniture(parent: THREE.Group, item: FurnitureItem, quality: Room['renderQuality'], options: FurnitureRenderOptions = {}) {
  const group = new THREE.Group();
  group.userData.architectural = quality === 'hyperrealistic';
  group.userData.geometry = options.geometry ?? 'high';
  group.position.set(item.x, 0, item.z);
  group.rotation.y = THREE.MathUtils.degToRad(item.rotation);
  group.userData.selection = { kind: 'furniture', id: item.id } satisfies Selection;
  group.userData.furnitureAppearance = { material: item.material, quality };
  parent.add(group);
  if (item.type === 'custom') {
    attachCustomModel(group, item, quality, { roomId: options.roomId, publicOnly: options.publicView, onError: options.onError, onLoaded: options.onLoaded, textureResolution: options.textures });
    return group;
  }
  const w = item.width, d = item.depth, h = item.height;
  const body = createFurnitureMaterial(item.color!, item.material!, quality);
  const face = body;
  const handles = new THREE.MeshStandardMaterial({ color: '#626559', metalness: 0.65, roughness: 0.35 });
  body.name = face.name = `3D Space:${item.material!}`;
  handles.name = '3D Space:metal';
  if (isFurnitureVariant(item.type, item.variant)) {
    buildCatalogGeometry(group, item, { body, face, handles }, quality, options.geometry);
  } else if (item.type === 'bed' && quality === 'hyperrealistic') {
    const ivory = createFabricMaterial('#eee8df', quality);
    ivory.side = THREE.DoubleSide;
    const linen = createFabricMaterial('#ccc1b1', quality);
    box(group, [w, h, d * 0.05], [0, h / 2, -d * 0.475], body, true);
    box(group, [w * 0.91, h * 0.61, d * 0.048], [0, h * 0.675, -d * 0.432], linen, true);
    box(group, [w * 0.96, h * 0.18, d * 0.94], [0, h * 0.26, d * 0.02], body, true);
    box(group, [w * 0.92, h * 0.23, d * 0.90], [0, h * 0.455, d * 0.025], ivory, true);
    const duvet = new THREE.Mesh(createDuvetGeometry(w, d, h, options.geometry), ivory);
    duvet.castShadow = duvet.receiveShadow = true;
    group.add(duvet);
    const columns = w < 1.3 ? 1 : 2;
    for (let i = 0; i < columns; i++) {
      const pillow = new THREE.Mesh(createPillowGeometry(w * 0.79 / columns, h * 0.145, d * 0.225, options.geometry), ivory);
      pillow.position.set(columns === 1 ? 0 : (i - 0.5) * w * 0.45, h * 0.665, -d * 0.27);
      pillow.rotation.y = (i ? 1 : -1) * 0.05 * Math.min(1, w / d, d / w);
      pillow.castShadow = pillow.receiveShadow = true;
      group.add(pillow);
      const cushion = new THREE.Mesh(createPillowGeometry(w * 0.55 / columns, Math.min(h * 0.145, d * 0.13), d * 0.15, options.geometry), linen);
      cushion.position.set(pillow.position.x, h * 0.74, -d * 0.375);
      cushion.rotation.x = -Math.min(0.5, h / d * 0.5);
      cushion.castShadow = cushion.receiveShadow = true;
      group.add(cushion);
    }
    for (const x of [-w * 0.4, w * 0.4]) for (const z of [-d * 0.4, d * 0.4]) box(group, [w * 0.055, h * 0.17, d * 0.045], [x, h * 0.085, z], body);
  } else if (item.type === 'bed') {
    const ivory = new THREE.MeshStandardMaterial({ color: '#f1ebdf', roughness: 1 });
    box(group, [w, h, d * 0.05], [0, h / 2, -d * 0.475], body, true);
    box(group, [w * 0.96, h * 0.18, d * 0.94], [0, h * 0.24, d * 0.02], body, true);
    box(group, [w * 0.91, h * 0.20, d * 0.9], [0, h * 0.43, d * 0.025], ivory, true);
    const blanket = new THREE.MeshStandardMaterial({ color: '#aab59c', roughness: 1 });
    box(group, [w * 0.92, h * 0.035, d * 0.63], [0, h * 0.545, d * 0.15], blanket, true);
    const columns = w < 1.3 ? 1 : 2;
    for (let i = 0; i < columns; i++) box(group, [w * 0.74 / columns, h * 0.09, d * 0.21], [columns === 1 ? 0 : (i - 0.5) * w * 0.45, h * 0.56, -d * 0.285], ivory, true);
    for (const x of [-w * 0.4, w * 0.4]) for (const z of [-d * 0.4, d * 0.4]) box(group, [w * 0.055, h * 0.16, d * 0.045], [x, h * 0.08, z], body);
  }
  const usedMaterials = new Set<THREE.Material>();
  group.traverse(object => {
    if (object instanceof THREE.Mesh) {
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => usedMaterials.add(material));
      object.userData.furnitureMaterialRole ??= object.material === body ? 'body' : object.material === handles ? 'handles' : 'fabric';
    }
  });
  for (const material of new Set([body, face, handles])) if (!usedMaterials.has(material)) material.dispose();
  if (!options.editable) { groupDisplayGeometry(group); prepareScenePicking(group); }
  if (import.meta.env?.DEV) {
    group.updateWorldMatrix(true, true);
    const actual = new THREE.Box3().setFromObject(group);
    const footprint = bounds(furnitureCorners(item));
    console.assert(actual.min.x >= footprint.minX - 0.001 && actual.max.x <= footprint.maxX + 0.001 && actual.min.z >= footprint.minZ - 0.001 && actual.max.z <= footprint.maxZ + 0.001 && actual.min.y >= -0.001 && actual.max.y <= h + 0.001, 'Furniture geometry exceeds its declared dimensions', item.id);
  }
  return group;
}

export function createFurnitureModel(item: FurnitureItem, quality: Room['renderQuality'] = 'standard'): THREE.Group {
  return addStoredFurniture(new THREE.Group(), { ...item, x: 0, z: 0, rotation: 0 }, quality, { editable: true });
}

/** Repainting preserves the display buffers, original parts and authored hardware/fabric colors. */
export function updateFurnitureAppearance(group: THREE.Object3D, item: FurnitureItem, quality: Room['renderQuality'], replaceTextures = false) {
  if (item.type === 'custom') {
    const update = group.userData.updateCustomAppearance as ((next: FurnitureItem, quality: Room['renderQuality'], resolution?: number) => void) | undefined;
    update?.(item, quality, getGraphicsProfile().textures); return;
  }
  const before = group.userData.furnitureAppearance as { material: FurnitureItem['material']; quality: Room['renderQuality'] } | undefined;
  const replace = replaceTextures || before?.material !== item.material || before?.quality !== quality;
  const replacements = new Map<THREE.Material, THREE.Material>(), tinted = new Set<THREE.Material>();
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    const role = object.userData.furnitureMaterialRole;
    if (role !== 'body' && !(replaceTextures && role === 'fabric')) return;
    const update = (material: THREE.Material) => {
      if (!replace) { if (!tinted.has(material)) { tinted.add(material); tintMaterial(material, item.color!); } return material; }
      if (!replacements.has(material)) {
        const next = role === 'body' ? createFurnitureMaterial(item.color!, item.material!, quality) : createFabricMaterial('#' + (material as THREE.MeshStandardMaterial).color.getHexString(), quality);
        next.name = role === 'body' ? `3D Space:${item.material!}` : material.name;
        next.side = material.side; next.transparent = material.transparent; next.opacity = material.opacity; next.alphaTest = material.alphaTest;
        replacements.set(material, next);
      }
      return replacements.get(material)!;
    };
    object.material = Array.isArray(object.material) ? object.material.map(update) : update(object.material);
  });
  replacements.forEach((_next, previous) => previous.dispose());
  group.userData.furnitureAppearance = { material: item.material, quality };
}

