import * as THREE from 'three';

export type WorkshopBooleanOperation = 'union' | 'subtract' | 'intersect';
export type GeometryPacket = {
  attributes: Record<string, { array: Float32Array; itemSize: number }>;
  index: Uint32Array | null;
  groups: { start: number; count: number; materialIndex: number }[];
  drawRange: { start: number; count: number };
};
export type MaterialPacket = {
  name: string; color: number; roughness: number; metalness: number; side: THREE.Side;
  transparent: boolean; opacity: number; alphaTest: number; vertexColors: boolean;
};
export type MeshPacket = { geometry: GeometryPacket; materials: MaterialPacket[]; materialArray: boolean; matrix: number[]; name: string };
export type BooleanRequest = { base: MeshPacket; tool: MeshPacket; operation: WorkshopBooleanOperation };
export type BooleanReply = { geometry: GeometryPacket; materials: string[]; position: number[]; name: string } | { error: string };

export function packBooleanGeometry(geometry: THREE.BufferGeometry): GeometryPacket {
  const attributes: GeometryPacket['attributes'] = {};
  for (const name of ['position', 'normal', 'uv', 'uv1', 'color']) {
    const attribute = geometry.getAttribute(name);
    if (!attribute) continue;
    const array = new Float32Array(attribute.count * attribute.itemSize);
    for (let index = 0; index < attribute.count; index++) for (let component = 0; component < attribute.itemSize; component++) {
      array[index * attribute.itemSize + component] = attribute.getComponent(index, component);
    }
    attributes[name] = { array, itemSize: attribute.itemSize };
  }
  const index = geometry.index ? Uint32Array.from({ length: geometry.index.count }, (_, offset) => geometry.index!.getX(offset)) : null;
  return { attributes, index, drawRange: { ...geometry.drawRange }, groups: geometry.groups.map(group => ({ start: group.start, count: group.count, materialIndex: group.materialIndex ?? 0 })) };
}

export function unpackBooleanGeometry(packet: GeometryPacket): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(packet.attributes)) geometry.setAttribute(name, new THREE.BufferAttribute(attribute.array, attribute.itemSize));
  if (packet.index) geometry.setIndex(new THREE.BufferAttribute(packet.index, 1));
  for (const group of packet.groups) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.setDrawRange(packet.drawRange.start, packet.drawRange.count);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

export function packBooleanMesh(mesh: THREE.Mesh, prefix: 'base' | 'tool', parent: THREE.Object3D | null): MeshPacket {
  parent?.updateWorldMatrix(true, false); mesh.updateWorldMatrix(true, false);
  const inverse = parent ? parent.matrixWorld.clone() : new THREE.Matrix4();
  if (Math.abs(inverse.determinant()) < 1e-12) throw new Error('Revisa la escala de las piezas.');
  inverse.invert();
  const matrix = inverse.multiply(mesh.matrixWorld).toArray();
  if (!matrix.every(Number.isFinite)) throw new Error('Revisa la posición de las piezas.');
  const originals = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return {
    geometry: packBooleanGeometry(mesh.geometry), matrix, name: mesh.name, materialArray: Array.isArray(mesh.material),
    materials: originals.map((source, index) => {
      const material = source as THREE.MeshStandardMaterial;
      return { name: `csg-input-${prefix}-${index}`, color: material.color?.getHex() ?? 0xb8a084, roughness: material.roughness ?? .7, metalness: material.metalness ?? 0, side: material.side, transparent: material.transparent, opacity: material.opacity, alphaTest: material.alphaTest, vertexColors: material.vertexColors };
    }),
  };
}

export function unpackBooleanMesh(packet: MeshPacket): THREE.Mesh {
  const materials = packet.materials.map(value => {
    const material = new THREE.MeshStandardMaterial(value); material.name = value.name; return material;
  });
  const mesh = new THREE.Mesh(unpackBooleanGeometry(packet.geometry), packet.materialArray ? materials : materials[0]);
  mesh.name = packet.name; mesh.matrix.fromArray(packet.matrix); mesh.matrixAutoUpdate = false;
  mesh.updateMatrixWorld(true);
  return mesh;
}

export const booleanTransfers = (geometry: GeometryPacket): ArrayBuffer[] => [
  ...Object.values(geometry.attributes).map(attribute => attribute.array.buffer as ArrayBuffer),
  ...(geometry.index ? [geometry.index.buffer as ArrayBuffer] : []),
];
