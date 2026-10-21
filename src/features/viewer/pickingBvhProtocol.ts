import * as THREE from 'three/webgpu';
import { MeshBVH, type SerializedBVH } from 'three-mesh-bvh';

export type PickingGeometryData = {
  position: Float32Array;
  index: Uint32Array;
  groups: THREE.BufferGeometry['groups'];
  drawRange: THREE.BufferGeometry['drawRange'];
};
export type PickingTreeData = SerializedBVH & { indirectBuffer?: Uint16Array | Uint32Array };
export type PickingTreeReply = { tree: PickingTreeData } | { failed: true };

/** Copy only the immutable position/index data; rendering buffers are never transferred away. */
export function packPickingGeometry(geometry: THREE.BufferGeometry): PickingGeometryData {
  const source = geometry.getAttribute('position'), position = new Float32Array(source.count * 3);
  for (let index = 0; index < source.count; index++) position.set([source.getX(index), source.getY(index), source.getZ(index)], index * 3);
  const index = geometry.index ? Uint32Array.from(geometry.index.array) : Uint32Array.from({ length: source.count }, (_, value) => value);
  return { position, index, groups: geometry.groups.map(group => ({ ...group })), drawRange: { ...geometry.drawRange } };
}

export function buildPickingTree(data: PickingGeometryData): PickingTreeData {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(data.position, 3)); geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
  geometry.groups = data.groups; geometry.setDrawRange(data.drawRange.start, data.drawRange.count);
  try { return MeshBVH.serialize(new MeshBVH(geometry, { indirect: true, maxLeafSize: 12 }), { cloneBuffers: false }) as PickingTreeData; }
  finally { geometry.dispose(); }
}

export function pickingTreeTransfers(tree: PickingTreeData): ArrayBuffer[] {
  return [...new Set([...tree.roots, tree.index?.buffer, tree.indirectBuffer?.buffer].filter((value): value is ArrayBuffer => value instanceof ArrayBuffer))];
}
