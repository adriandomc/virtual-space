import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { FurnitureMaterial } from './types';

export type EditableVertex = { id: number; position: [number, number, number]; indices: number[] };
const EPSILON = 0.000001;
const finitePoint = (point: number[]) => point.length === 3 && point.every(value => Number.isFinite(value) && Math.abs(value) <= 10000);

export function getEditableVertices(geometry: THREE.BufferGeometry): EditableVertex[] {
  const position = geometry.getAttribute('position');
  const vertices: EditableVertex[] = [], groups = new Map<string, EditableVertex>();
  for (let i = 0; i < position.count; i++) {
    const point: [number, number, number] = [position.getX(i), position.getY(i), position.getZ(i)];
    const key = point.map(value => Math.round(value / EPSILON)).join(':');
    const existing = groups.get(key);
    if (existing) existing.indices.push(i);
    else { const vertex = { id: vertices.length, position: point, indices: [i] }; vertices.push(vertex); groups.set(key, vertex); }
  }
  return vertices;
}

function finishGeometry(geometry: THREE.BufferGeometry) {
  geometry.getAttribute('position').needsUpdate = true;
  geometry.deleteAttribute('tangent');
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
}

export function moveModelVertex(geometry: THREE.BufferGeometry, id: number, point: [number, number, number]): void {
  if (!finitePoint(point)) throw new Error('Las coordenadas no son válidas.');
  const vertex = getEditableVertices(geometry)[id];
  if (!vertex) throw new Error('Selecciona un vértice válido.');
  for (const index of vertex.indices) geometry.getAttribute('position').setXYZ(index, ...point);
  finishGeometry(geometry);
}

export function addModelVertex(geometry: THREE.BufferGeometry, point: [number, number, number]): number {
  if (!finitePoint(point)) throw new Error('Las coordenadas no son válidas.');
  if (getEditableVertices(geometry).some(vertex => vertex.position.every((value, i) => Math.abs(value - point[i]) < EPSILON))) throw new Error('Ya existe un vértice en esas coordenadas.');
  if (geometry.getAttribute('position').count > 600000) throw new Error('El modelo tiene demasiados vértices.');
  if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i));
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const values = new Float32Array((attribute.count + 1) * attribute.itemSize);
    for (let i = 0; i < attribute.count; i++) for (let j = 0; j < attribute.itemSize; j++) values[i * attribute.itemSize + j] = attribute.getComponent(i, j);
    if (name === 'position') values.set(point, attribute.count * attribute.itemSize);
    if (name === 'color') values.fill(1, attribute.count * attribute.itemSize);
    geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
  }
  finishGeometry(geometry);
  return getEditableVertices(geometry).findIndex(vertex => vertex.position.every((value, i) => Math.abs(value - point[i]) < EPSILON));
}

function triangleIndices(geometry: THREE.BufferGeometry): number[] {
  return geometry.index ? Array.from(geometry.index.array) : Array.from({ length: geometry.getAttribute('position').count }, (_, i) => i);
}

export function getModelFaces(geometry: THREE.BufferGeometry): [number, number, number][] {
  const indices = triangleIndices(geometry), vertices = getEditableVertices(geometry), lookup = new Map<number, number>();
  for (const vertex of vertices) for (const index of vertex.indices) lookup.set(index, vertex.id);
  const faces: [number, number, number][] = [];
  for (let i = 0; i < indices.length; i += 3) faces.push([lookup.get(indices[i])!, lookup.get(indices[i + 1])!, lookup.get(indices[i + 2])!]);
  return faces;
}

function replaceFaces(geometry: THREE.BufferGeometry, retained: { indices: number[]; material: number }[]) {
  geometry.setIndex(retained.flatMap(face => face.indices));
  geometry.clearGroups();
  let previous = -1;
  retained.forEach((face, index) => {
    if (face.material !== previous) { geometry.addGroup(index * 3, 3, face.material); previous = face.material; }
    else geometry.groups[geometry.groups.length - 1].count += 3;
  });
  geometry.setDrawRange(0, retained.length * 3);
  finishGeometry(geometry);
}

export function deleteModelFace(geometry: THREE.BufferGeometry, id: number): void {
  const indices = triangleIndices(geometry);
  if (!Number.isInteger(id) || id < 0 || id >= indices.length / 3) throw new Error('Selecciona una cara válida.');
  const retained = [];
  for (let i = 0; i < indices.length; i += 3) if (i / 3 !== id) retained.push({ indices: indices.slice(i, i + 3), material: geometry.groups.find(group => i >= group.start && i < group.start + group.count)?.materialIndex ?? 0 });
  replaceFaces(geometry, retained);
}

export function addModelFace(geometry: THREE.BufferGeometry, ids: [number, number, number]): void {
  const vertices = getEditableVertices(geometry);
  if (new Set(ids).size !== 3 || ids.some(id => !Number.isInteger(id) || !vertices[id])) throw new Error('Elige tres vértices distintos.');
  const [a, b, c] = ids.map(id => new THREE.Vector3(...vertices[id].position));
  if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-16) throw new Error('La cara necesita tres vértices que formen un triángulo.');
  const indices = triangleIndices(geometry), count = indices.length;
  if (count / 3 >= 200000) throw new Error('El modelo tiene demasiadas caras.');
  if (!geometry.groups.length && count) geometry.addGroup(0, count, 0);
  geometry.setIndex([...indices, ...ids.map(id => vertices[id].indices[0])]);
  geometry.addGroup(count, 3, 0); geometry.setDrawRange(0, count + 3); finishGeometry(geometry);
}

export function deleteModelVertex(geometry: THREE.BufferGeometry, id: number): void {
  const vertex = getEditableVertices(geometry)[id];
  if (!vertex) throw new Error('Selecciona un vértice válido.');
  const removed = new Set(vertex.indices), indices = triangleIndices(geometry), retained = [];
  for (let i = 0; i < indices.length; i += 3) if (!indices.slice(i, i + 3).some(index => removed.has(index))) retained.push({ indices: indices.slice(i, i + 3), material: geometry.groups.find(group => i >= group.start && i < group.start + group.count)?.materialIndex ?? 0 });
  const lookup = new Map<number, number>();
  let count = 0;
  for (let i = 0; i < geometry.getAttribute('position').count; i++) if (!removed.has(i)) lookup.set(i, count++);
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const values = new Float32Array(count * attribute.itemSize);
    for (const [from, to] of lookup) for (let j = 0; j < attribute.itemSize; j++) values[to * attribute.itemSize + j] = attribute.getComponent(from, j);
    geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
  }
  replaceFaces(geometry, retained.map(face => ({ ...face, indices: face.indices.map(index => lookup.get(index)!) })));
}

export function standardModelMaterial(source: THREE.Material): THREE.MeshStandardMaterial {
  const original = source as THREE.MeshStandardMaterial;
  const material = new THREE.MeshStandardMaterial({ color: original.color?.clone() ?? new THREE.Color('#b8a084'), roughness: original.roughness ?? 0.7, metalness: original.metalness ?? 0, side: source.side, transparent: source.transparent, opacity: source.opacity, alphaTest: source.alphaTest });
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'] as const) material[key] = original[key] ?? null;
  if (original.emissive) material.emissive.copy(original.emissive);
  material.emissiveIntensity = Math.min(1, original.emissiveIntensity ?? 0);
  if (original.normalScale) material.normalScale.copy(original.normalScale);
  material.name = original.name; material.vertexColors = original.vertexColors; material.userData = {};
  return material;
}

export function setWorkshopMaterial(mesh: THREE.Mesh, surface: FurnitureMaterial, color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Usa un color hexadecimal de seis dígitos.');
  for (const source of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    const material = source as THREE.MeshStandardMaterial;
    material.color.set(color); material.metalness = surface === 'metal' ? 1 : 0;
    material.roughness = surface === 'wood' ? .72 : surface === 'plastic' ? .32 : .24;
    material.name = `3D Space:${surface}`; material.userData.surface = surface; material.needsUpdate = true;
  }
}

export function workshopSurface(material: THREE.MeshStandardMaterial): FurnitureMaterial {
  if (/^3D Space:(wood|plastic|metal)$/.test(material.name)) return material.name.slice('3D Space:'.length) as FurnitureMaterial;
  return material.userData.surface ?? (material.metalness > .8 ? 'metal' : material.roughness < .45 ? 'plastic' : 'wood');
}

export function setWorkshopColor(mesh: THREE.Mesh, color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Usa un color hexadecimal de seis dígitos.');
  for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    (material as THREE.MeshStandardMaterial).color.set(color); material.needsUpdate = true;
  }
}

export function cloneWorkshopModel(source: THREE.Group): THREE.Group {
  const result = new THREE.Group();
  source.updateWorldMatrix(true, true);
  source.traverseVisible(object => {
    if (!(object instanceof THREE.Mesh) || !object.visible || !object.geometry.getAttribute('position')) return;
    const materials = (Array.isArray(object.material) ? object.material : [object.material]).map(standardModelMaterial);
    const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>(object.geometry.clone(), materials.length === 1 ? materials[0] : materials);
    object.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    const reconstructed = new THREE.Matrix4().compose(mesh.position, mesh.quaternion, mesh.scale);
    if (object.matrixWorld.elements.some((value, index) => Math.abs(value - reconstructed.elements[index]) > .00001)) {
      // Nonuniform parent scales can introduce shear; bake it without changing the visible shape.
      mesh.geometry.applyMatrix4(object.matrixWorld); mesh.geometry.computeBoundingBox();
      mesh.geometry.boundingBox!.getCenter(mesh.position); mesh.geometry.translate(-mesh.position.x, -mesh.position.y, -mesh.position.z);
      mesh.quaternion.identity(); mesh.scale.set(1, 1, 1);
    }
    mesh.name = object.name || `Pieza ${result.children.length + 1}`; mesh.castShadow = mesh.receiveShadow = true;
    result.add(mesh);
  });
  return result;
}

export function disposeWorkshopModel(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  group.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments) { geometries.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material); } });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); group.clear();
}

export async function exportWorkshopGLB(group: THREE.Group): Promise<ArrayBuffer> {
  if (!group.children.length) throw new Error('Agrega al menos una pieza.');
  const copy = cloneWorkshopModel(group);
  try {
    for (const object of [...copy.children]) if (object instanceof THREE.Mesh && (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) === 0) {
      object.removeFromParent(); disposeWorkshopModel(new THREE.Group().add(object));
    }
    let triangles = 0;
    if (copy.children.length >= 512) throw new Error('El modelo admite hasta 511 piezas.');
    copy.traverse(object => {
      object.userData = {};
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry, positions = geometry.getAttribute('position');
      triangles += (geometry.index?.count ?? positions.count) / 3;
      for (let i = 0; i < positions.count; i++) if (!finitePoint([positions.getX(i), positions.getY(i), positions.getZ(i)])) throw new Error('El modelo contiene coordenadas no válidas.');
      if (![...object.position.toArray(), ...object.scale.toArray(), ...object.quaternion.toArray()].every(Number.isFinite) || object.scale.toArray().some(value => value === 0)) throw new Error('Revisa el tamaño y la posición de las piezas.');
    });
    if (!triangles || triangles > 200000) throw new Error('El modelo debe tener entre 1 y 200 000 caras.');
    const box = new THREE.Box3().setFromObject(copy), size = box.getSize(new THREE.Vector3());
    if (![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite) || size.toArray().some(value => value > 10000)) throw new Error('Revisa las dimensiones del modelo.');
    const output = await new GLTFExporter().parseAsync(copy, { binary: true, onlyVisible: true, maxTextureSize: 4096 });
    if (!(output instanceof ArrayBuffer)) throw new Error('No se pudo guardar el modelo.');
    if (output.byteLength > 20 * 1024 * 1024) throw new Error('El modelo debe pesar como máximo 20 MB.');
    return output;
  } finally { disposeWorkshopModel(copy); }
}
