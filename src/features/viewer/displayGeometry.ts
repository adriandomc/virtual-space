import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type DisplayPart = { id: string; name: string; firstTriangle: number; triangles: number };

/** A derived display mesh never replaces the catalogue definition or the editable GLB. */
export function groupDisplayGeometry(root: THREE.Group): void {
  const batches = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]>();
  const sourceIds = new Map(root.children.map((child, index) => [child, String(child.userData.catalogPartId ?? index)]));
  for (const child of root.children) {
    if (!(child instanceof THREE.Mesh) || Array.isArray(child.material) || child instanceof THREE.SkinnedMesh || child instanceof THREE.InstancedMesh || !child.visible) continue;
    // Transparent parts retain independent depth sorting; grouping opaque boards is the expensive case.
    if (child.material.transparent || child.geometry.morphAttributes.position?.length) continue;
    const key = [child.material.uuid, child.castShadow, child.receiveShadow, child.layers.mask, child.renderOrder].join(':');
    const batch = batches.get(key) ?? []; batch.push(child); batches.set(key, batch);
  }
  for (const meshes of batches.values()) {
    if (meshes.length < 2) continue;
    const copies: THREE.BufferGeometry[] = [], parts: DisplayPart[] = [];
    let firstTriangle = 0;
    try {
      for (const mesh of meshes) {
        mesh.updateMatrix();
        const copy = mesh.geometry.clone().applyMatrix4(mesh.matrix); copy.clearGroups();
        if (!copy.index) copy.setIndex(Array.from({ length: copy.getAttribute('position').count }, (_, index) => index));
        if (mesh.matrix.determinant() < 0) for (let index = 0; index < copy.index!.count; index += 3) { const first = copy.index!.getX(index); copy.index!.setX(index, copy.index!.getX(index + 1)); copy.index!.setX(index + 1, first); }
        copies.push(copy);
        const triangles = copy.index!.count / 3;
        parts.push({ id: sourceIds.get(mesh)!, name: mesh.name, firstTriangle, triangles });
        firstTriangle += triangles;
      }
      const geometry = mergeGeometries(copies, false);
      if (!geometry) continue;
      geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      const first = meshes[0], merged = new THREE.Mesh(geometry, first.material);
      merged.name = first.name; merged.castShadow = first.castShadow; merged.receiveShadow = first.receiveShadow;
      merged.layers.mask = first.layers.mask; merged.renderOrder = first.renderOrder;
      merged.userData = { ...first.userData, displayParts: parts };
      for (const mesh of meshes) { root.remove(mesh); mesh.geometry.dispose(); }
      root.add(merged);
    } finally { copies.forEach(copy => copy.dispose()); }
  }
}

/** Triangle identities remain available to picking after merging compatible pieces. */
export function displayPartAt(hit: Pick<THREE.Intersection, 'object' | 'faceIndex'>): DisplayPart | undefined {
  if (hit.faceIndex === undefined || hit.faceIndex === null) return undefined;
  return (hit.object.userData.displayParts as DisplayPart[] | undefined)?.find(part => hit.faceIndex! >= part.firstTriangle && hit.faceIndex! < part.firstTriangle + part.triangles);
}
