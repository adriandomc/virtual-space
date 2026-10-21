import * as THREE from 'three/webgpu';
import type { Opening, Room, RoomLight } from '../../domain/project/types';
import { createFurnitureMaterial, createWoodMaterial, tintMaterial } from './materials';

export function openingFrameMaterial(opening: Opening, quality: Room['renderQuality']) {
  return createFurnitureMaterial(opening.color ?? (quality === 'hyperrealistic' ? '#ebe7df' : '#efece3'), 'plastic', quality);
}

export function openingLeafMaterial(opening: Opening, quality: Room['renderQuality']) {
  return createWoodMaterial(opening.color ?? '#c7b297', quality);
}

export function lightBodyMaterial(light: RoomLight, quality: Room['renderQuality']) {
  return createFurnitureMaterial(light.color ?? '#343931', 'plastic', quality);
}

/** Repaint only tagged opaque parts; glass, hardware and emitted light retain their own materials. */
export function repaintOpening(root: THREE.Object3D, opening: Opening, quality: Room['renderQuality'], replace = false) {
  const frames: THREE.Mesh[] = [], leaves: THREE.Mesh[] = [];
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh) || object.userData.openingPaintId !== opening.id) return;
    (object.userData.openingPaintRole === 'frame' ? frames : leaves).push(object);
  });
  const old = new Set<THREE.Material>();
  for (const [meshes, create] of [[frames, openingFrameMaterial], [leaves, openingLeafMaterial]] as const) {
    if (!meshes.length) continue;
    if (!replace) {
      const hex = opening.color ?? (meshes === leaves ? '#c7b297' : quality === 'hyperrealistic' ? '#ebe7df' : '#efece3');
      meshes.forEach(mesh => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => tintMaterial(material, hex)));
      continue;
    }
    const material = create(opening, quality);
    meshes.forEach(mesh => { (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(value => old.add(value)); mesh.material = material; });
  }
  old.forEach(material => material.dispose());
}

export function repaintLightBody(group: THREE.Object3D, light: RoomLight, quality: Room['renderQuality'], replace = false) {
  const meshes: THREE.Mesh[] = [];
  group.traverse(object => { if (object instanceof THREE.Mesh && object.userData.lightBody) meshes.push(object); });
  if (!meshes.length) return;
  if (!replace) { meshes.forEach(mesh => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => tintMaterial(material, light.color ?? '#343931'))); return; }
  const old = new Set<THREE.Material>(), material = lightBodyMaterial(light, quality);
  meshes.forEach(mesh => { (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(value => old.add(value)); mesh.material = material; });
  old.forEach(value => value.dispose());
}
