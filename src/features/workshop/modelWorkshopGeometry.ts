import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { workshopGroup } from './workshopGrouping';
import type { FurnitureMaterial } from '../../domain/project/types';

export type EditableVertex = { id: number; position: [number, number, number]; indices: number[] };
const EPSILON = 0.000001;
const finitePoint = (point: number[]) => point.length === 3 && point.every(value => Number.isFinite(value) && Math.abs(value) <= 10000);

export function clampWorkshopScale(scale: THREE.Vector3) {
  for (const axis of ['x', 'y', 'z'] as const) scale[axis] = (Math.sign(scale[axis]) || 1) * THREE.MathUtils.clamp(Math.abs(scale[axis]), .001, 1000);
}

export function fitWorkshopCamera(camera: THREE.PerspectiveCamera, bounds: THREE.Box3, aspect: number) {
  const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3()), span = Math.max(.01, ...size.toArray());
  const vertical = THREE.MathUtils.degToRad(camera.fov), horizontal = 2 * Math.atan(Math.tan(vertical / 2) * aspect);
  const distance = Math.max(.005, size.length() / 2) / Math.sin(Math.min(vertical, horizontal) / 2) * 1.15;
  camera.aspect = aspect; camera.near = Math.max(.0001, span / 1000); camera.far = Math.max(100, span * 100);
  camera.position.copy(center).add(new THREE.Vector3(1.1, .8, 1.2).normalize().multiplyScalar(distance));
  camera.lookAt(center); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  return center;
}

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
  const consumed = new Set<THREE.Object3D>();
  const mergePrimitives = (primitives: THREE.Mesh[]) => {
    const geometry = new THREE.BufferGeometry(), materials: THREE.Material[] = [], copies: THREE.BufferGeometry[] = [];
    try {
      for (const primitive of primitives) {
        const copy = primitive.geometry.clone(); copies.push(copy); compactVisibleGeometry(copy);
        if (!copy.getAttribute('normal')) copy.computeVertexNormals();
        copy.applyMatrix4(primitive.matrix);
        if (primitive.matrix.determinant() < 0) {
          const index = copy.index!;
          for (let i = 0; i < index.count; i += 3) { const first = index.getX(i); index.setX(i, index.getX(i + 1)); index.setX(i + 1, first); }
        }
      }
      const fields: [string, number][] = [['position', 3], ['normal', 3], ['uv', 2], ...(copies.some(copy => copy.getAttribute('uv1')) ? [['uv1', 2] as [string, number]] : []), ...(copies.some(copy => copy.getAttribute('color')) ? [['color', 4] as [string, number]] : [])];
      const total = copies.reduce((sum, copy) => sum + copy.getAttribute('position').count, 0);
      for (const [name, size] of fields) {
        const values = new Float32Array(total * size); let offset = 0;
        for (const copy of copies) {
          const attribute = copy.getAttribute(name), count = copy.getAttribute('position').count;
          for (let i = 0; i < count; i++) for (let j = 0; j < size; j++) values[(offset + i) * size + j] = attribute && j < attribute.itemSize ? attribute.getComponent(i, j) : name === 'color' ? 1 : 0;
          offset += count;
        }
        geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
      }
      const indices: number[] = []; let vertices = 0;
      copies.forEach((copy, i) => {
        const primitive = primitives[i], sources = Array.isArray(primitive.material) ? primitive.material : [primitive.material], start = indices.length, materialOffset = materials.length;
        materials.push(...sources.map(standardModelMaterial));
        for (let n = 0; n < copy.index!.count; n++) indices.push(copy.index!.getX(n) + vertices);
        if (Array.isArray(primitive.material) && copy.groups.length) copy.groups.forEach(group => geometry.addGroup(start + group.start, group.count, materialOffset + (group.materialIndex ?? 0)));
        else geometry.addGroup(start, copy.index!.count, materialOffset);
        vertices += copy.getAttribute('position').count;
      });
      geometry.setIndex(indices); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
      return { geometry, materials };
    } catch (error) { geometry.dispose(); materials.forEach(material => material.dispose()); throw error; }
    finally { copies.forEach(copy => copy.dispose()); }
  };
  source.updateWorldMatrix(true, true);
  source.traverseVisible(object => {
    if (consumed.has(object)) return;
    const primitives = object.userData.logicalModelMesh ? object.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh && child.visible && child.userData.logicalModelPrimitive === true && !!child.geometry.getAttribute('position')) : [];
    if (!(object instanceof THREE.Mesh) && !primitives.length) return;
    if (object instanceof THREE.Mesh && !object.geometry.getAttribute('position')) return;
    const cloned = primitives.length ? mergePrimitives(primitives) : { geometry: (object as THREE.Mesh).geometry.clone(), materials: (Array.isArray((object as THREE.Mesh).material) ? (object as THREE.Mesh).material as THREE.Material[] : [(object as THREE.Mesh).material as THREE.Material]).map(standardModelMaterial) };
    primitives.forEach(primitive => consumed.add(primitive));
    const { geometry, materials } = cloned;
    const mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.Material | THREE.Material[]>(geometry, materials.length === 1 ? materials[0] : materials);
    object.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
    const reconstructed = new THREE.Matrix4().compose(mesh.position, mesh.quaternion, mesh.scale);
    if (object.matrixWorld.elements.some((value, index) => Math.abs(value - reconstructed.elements[index]) > .00001)) {
      // Nonuniform parent scales can introduce shear; bake it without changing the visible shape.
      mesh.geometry.applyMatrix4(object.matrixWorld); mesh.geometry.computeBoundingBox();
      mesh.geometry.boundingBox!.getCenter(mesh.position); mesh.geometry.translate(-mesh.position.x, -mesh.position.y, -mesh.position.z);
      mesh.quaternion.identity(); mesh.scale.set(1, 1, 1);
    }
    mesh.name = object.name || `Pieza ${result.children.length + 1}`; mesh.castShadow = mesh.receiveShadow = true;
    const group = workshopGroup(object);
    if (group) mesh.userData.workshopGroup = group;
    result.add(mesh);
  });
  return result;
}

export function disposeWorkshopModel(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  group.traverse(object => { if (object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.LineSegments) { geometries.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material); } });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); group.clear();
}

function compactVisibleGeometry(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute('position'), start = geometry.drawRange.start, end = Math.min(geometry.index?.count ?? positions.count, start + geometry.drawRange.count);
  const used: number[] = [], indices: number[] = [], lookup = new Map<number, number>();
  for (let i = start; i < end; i++) {
    const original = geometry.index?.getX(i) ?? i;
    if (!lookup.has(original)) { lookup.set(original, used.length); used.push(original); }
    indices.push(lookup.get(original)!);
  }
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const values = new Float32Array(used.length * attribute.itemSize);
    used.forEach((original, target) => { for (let i = 0; i < attribute.itemSize; i++) values[target * attribute.itemSize + i] = attribute.getComponent(original, i); });
    geometry.setAttribute(name, new THREE.BufferAttribute(values, attribute.itemSize));
  }
  const groups = geometry.groups.map(group => ({ start: Math.max(start, group.start) - start, count: Math.max(0, Math.min(end, group.start + group.count) - Math.max(start, group.start)), materialIndex: group.materialIndex }));
  geometry.clearGroups(); groups.filter(group => group.count).forEach(group => geometry.addGroup(group.start, group.count, group.materialIndex));
  geometry.setIndex(indices); geometry.setDrawRange(0, indices.length); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
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
      const group = workshopGroup(object);
      object.userData = group ? { workshopGroup: group } : {};
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry;
      compactVisibleGeometry(geometry);
      const positions = geometry.getAttribute('position');
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
