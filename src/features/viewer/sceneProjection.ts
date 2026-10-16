import * as THREE from 'three/webgpu';
import { projectLevel, projectStructure, projectToRoom, type ProjectDocument } from '../../domain/project/projectDocument';
import { buildRoofGeometry, type Vec3 } from '../../domain/project/projectGeometry';
import type { Point, Room } from '../../domain/project/types';

/** Appearance and transforms do not invalidate architectural buffers. */
export function levelGeometrySignature(room: Room, extra = '') {
  return JSON.stringify({ vertices: room.vertices, height: room.height, thickness: room.thickness, quality: room.renderQuality, walls: room.wallSegments?.map(({ leftColor: _left, rightColor: _right, ...wall }) => wall), surfaces: room.surfaces?.map(({ finish: _finish, undersideFinish: _underside, ...surface }) => surface), openings: room.openings.map(({ open: _open, ...opening }) => opening), extra });
}

export function furnitureGeometrySignature({ color: _color, material: _material, name: _name, x: _x, z: _z, rotation: _rotation, ...geometry }: Room['furniture'][number]) { return JSON.stringify(geometry); }

export function shadowLightIds(project: ProjectDocument, activeId: string, resident: Set<string>, position: Vec3, maximum: number) {
  const candidates = project.levels.filter(level => resident.has(level.id)).flatMap(level => level.lights.filter(light => light.enabled).map(light => ({ id: light.id, active: level.id === activeId, distance: Math.hypot(position.x - light.x, position.y - level.elevation - light.y, position.z - light.z) })));
  candidates.sort((a, b) => Number(b.active) - Number(a.active) || a.distance - b.distance);
  return new Set(candidates.slice(0, maximum).map(light => light.id));
}

/** Only the active floor keeps detailed furniture/models/lights resident. */
export function projectedLevelScene(project: ProjectDocument, levelId: string, resident: boolean): Room {
  const room = projectToRoom(project, levelId);
  if (resident) return room;
  // Interior walls and their openings remain visible through real slab/stair apertures.
  return { ...room, furniture: [], lights: [] };
}

export function residentLevelIds(project: ProjectDocument, activeId: string, walk: boolean, position: Point, distance: number) {
  const resident = new Set([activeId]);
  if (!walk) return resident;
  const candidates = project.stairs.filter(stair => stair.fromLevelId === activeId || stair.toLevelId === activeId).map(stair => ({ id: stair.fromLevelId === activeId ? stair.toLevelId : stair.fromLevelId, distance: Math.hypot(position.x - stair.x, position.z - stair.z) })).filter(candidate => candidate.distance <= Math.min(distance, 12)).sort((a, b) => a.distance - b.distance);
  for (const candidate of candidates) { resident.add(candidate.id); if (resident.size >= 3) break; }
  return resident;
}

export function presentedLevelIds(project: ProjectDocument, activeId: string, mode: 'active' | 'below' | 'all') {
  const active = projectLevel(project, activeId);
  return new Set(project.levels.filter(level => mode === 'all' || level.id === activeId || mode === 'below' && level.elevation <= active.elevation).map(level => level.id));
}

export function architecturalViewBounds(project: ProjectDocument, activeId: string, mode: 'active' | 'below' | 'all') {
  const visible = presentedLevelIds(project, activeId, mode), levels = project.levels.filter(level => visible.has(level.id));
  const vertices = levels.flatMap(level => level.points), roofVertices = project.roofs.filter(roof => visible.has(roof.levelId)).flatMap(roof => buildRoofGeometry(project, roof).vertices);
  const minX = Math.min(...vertices.map(point => point.x), ...roofVertices.map(point => point.x)), maxX = Math.max(...vertices.map(point => point.x), ...roofVertices.map(point => point.x));
  const minZ = Math.min(...vertices.map(point => point.z), ...roofVertices.map(point => point.z)), maxZ = Math.max(...vertices.map(point => point.z), ...roofVertices.map(point => point.z));
  const minY = Math.min(...levels.map(level => level.elevation)), maxY = Math.max(...levels.map(level => level.elevation + level.height), ...roofVertices.map(point => point.y));
  return { minX, maxX, minZ, maxZ, minY, maxY, width: maxX - minX, depth: maxZ - minZ, height: maxY - minY };
}

export function indexedArchitectureGeometry(vertices: Vec3[], triangles: [number, number, number][], uvs?: [number, number][]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flatMap(point => [point.x, point.y, point.z]), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute((uvs ?? vertices.map(point => [point.x, point.z] as [number, number])).flat(), 2));
  geometry.setIndex(triangles.flat()); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  return geometry;
}

export function projectNavigationSignature(project: ProjectDocument) {
  return JSON.stringify({ structure: projectStructure(project), openings: project.levels.flatMap(level => level.openings), furniture: project.levels.flatMap(level => level.furniture.map(item => [item.id, item.x, item.z, item.width, item.depth, item.height, item.rotation])) });
}

export function slabGeometry(outline: Point[], holes: Point[][], thickness: number, downward = true) {
  const shape = new THREE.Shape();
  outline.forEach((point, index) => index ? shape.lineTo(point.x, -point.z) : shape.moveTo(point.x, -point.z)); shape.closePath();
  for (const ring of holes) { const hole = new THREE.Path(); ring.forEach((point, index) => index ? hole.lineTo(point.x, -point.z) : hole.moveTo(point.x, -point.z)); hole.closePath(); shape.holes.push(hole); }
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
  if (downward) geometry.translate(0, 0, -thickness);
  // ExtrudeGeometry groups both caps together. Separate them so one real slab can have independent floor/ceiling finishes.
  geometry.clearGroups(); const normals = geometry.getAttribute('normal'); let start = 0, current = -1;
  for (let index = 0; index < normals.count; index += 3) {
    const z = normals.getZ(index), material = z > .5 ? 0 : z < -.5 ? 1 : 2;
    if (material !== current) { if (current >= 0) geometry.addGroup(start, index - start, current); start = index; current = material; }
  }
  if (current >= 0) geometry.addGroup(start, normals.count - start, current);
  return geometry;
}

/** CPU-side byte estimate, shared buffers/textures counted only once. GPU driver overhead is additional. */
export function sceneResourceUsage(scene: THREE.Object3D) {
  const buffers = new Set<ArrayBufferLike>(), textures = new Set<THREE.Texture>();
  let meshes = 0, triangles = 0, textureBytes = 0;
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes++;
    const geometry = object.geometry;
    for (const attribute of Object.values(geometry.attributes) as (THREE.BufferAttribute | THREE.InterleavedBufferAttribute)[]) buffers.add(attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array.buffer : attribute.array.buffer);
    if (object instanceof THREE.InstancedMesh) buffers.add(object.instanceMatrix.array.buffer);
    if (geometry.index) buffers.add(geometry.index.array.buffer);
    triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3 * (object instanceof THREE.InstancedMesh ? object.count : 1);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) for (const property of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const) { const texture = (material as THREE.MeshStandardMaterial)[property]; if (texture) textures.add(texture); }
  });
  textures.forEach(texture => { const image = texture.image as { width?: number; height?: number } | null; if (image?.width && image.height) textureBytes += image.width * image.height * 4 * (texture.generateMipmaps ? 4 / 3 : 1); });
  return { meshes, triangles, geometryBytes: [...buffers].reduce((bytes, buffer) => bytes + buffer.byteLength, 0), textures: textures.size, textureBytes: Math.ceil(textureBytes) };
}
