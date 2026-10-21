import * as THREE from 'three';

type TransformEntry = { id: string; position: number[]; quaternion: number[]; scale: number[]; name: string; visible: boolean; group: unknown };
type MaterialEntry = { id: string; material: THREE.Material | THREE.Material[] };
type VertexEntry = { id: string; indices: number[]; positions: Float32Array; normals?: { indices: number[]; values: Float32Array }; tangent?: THREE.BufferAttribute | THREE.InterleavedBufferAttribute };
type WorkshopPatch = { kind: 'transforms'; entries: TransformEntry[] } | { kind: 'materials'; entries: MaterialEntry[] } | { kind: 'vertices'; entries: VertexEntry[] };
export type WorkshopPatchSpec = { kind: 'transforms'; ids: string[] } | { kind: 'materials'; ids: string[] } | { kind: 'vertices'; id: string; indices: number[] };
export type WorkshopSnapshot = { content: THREE.Group; selected: string | null; selectedIds: string[]; name: string; bytes: number; patch?: WorkshopPatch };
const MAX_STEPS = 20, MAX_BYTES = 64 * 1024 * 1024;

export function captureWorkshopSnapshot(content: THREE.Group, selected: string | null, name: string, selectedIds = selected ? [selected] : []): WorkshopSnapshot {
  const copy = content.clone(true), geometries = new Map<THREE.BufferGeometry, THREE.BufferGeometry>(), materials = new Map<THREE.Material, THREE.Material>(), buffers = new Set<ArrayBufferLike>();
  const material = (source: THREE.Material) => {
    if (!materials.has(source)) materials.set(source, source.clone());
    return materials.get(source)!;
  };
  let bytes = 0;
  const clone = (source: THREE.Object3D, target: THREE.Object3D) => {
    target.uuid = source.uuid;
    if (source instanceof THREE.Mesh && target instanceof THREE.Mesh) {
      if (!geometries.has(source.geometry)) geometries.set(source.geometry, source.geometry.clone());
      target.geometry = geometries.get(source.geometry)!;
      target.material = Array.isArray(source.material) ? source.material.map(material) : material(source.material);
    }
    source.children.forEach((child, index) => clone(child, target.children[index]));
  };
  clone(content, copy);
  for (const geometry of geometries.values()) for (const attribute of [...Object.values(geometry.attributes), ...(geometry.index ? [geometry.index] : [])]) {
    const array = attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array : attribute.array;
    if (!buffers.has(array.buffer)) { buffers.add(array.buffer); bytes += array.buffer.byteLength; }
  }
  return { content: copy, selected, selectedIds: [...selectedIds], name, bytes };
}

/** Ordinary edits retain only affected state; structural changes still take an owned full snapshot. */
export function captureWorkshopPatch(content: THREE.Group, selected: string | null, name: string, selectedIds: string[], spec: WorkshopPatchSpec): WorkshopSnapshot {
  const metadata = { content: new THREE.Group(), selected, name, selectedIds: [...selectedIds] };
  if (spec.kind === 'transforms') {
    const entries = content.children.filter(object => spec.ids.includes(object.uuid)).map(object => ({ id: object.uuid, position: object.position.toArray(), quaternion: object.quaternion.toArray(), scale: object.scale.toArray(), name: object.name, visible: object.visible, group: structuredClone(object.userData.workshopGroup ?? null) }));
    return { ...metadata, patch: { kind: spec.kind, entries }, bytes: JSON.stringify(entries).length * 2 };
  }
  if (spec.kind === 'materials') {
    const entries = content.children.filter((object): object is THREE.Mesh => object instanceof THREE.Mesh && spec.ids.includes(object.uuid)).map(object => ({ id: object.uuid, material: Array.isArray(object.material) ? object.material.map(material => material.clone()) : object.material.clone() }));
    return { ...metadata, patch: { kind: spec.kind, entries }, bytes: entries.reduce((sum, entry) => sum + (Array.isArray(entry.material) ? entry.material.length : 1) * 1024, 0) };
  }
  const mesh = content.children.find(object => object.uuid === spec.id) as THREE.Mesh | undefined;
  if (!mesh) throw new Error('No se pudo hacer el cambio.');
  const position = mesh.geometry.getAttribute('position'), normal = mesh.geometry.getAttribute('normal'), tangent = mesh.geometry.getAttribute('tangent');
  const entry: VertexEntry = { id: spec.id, indices: [...spec.indices], positions: Float32Array.from(spec.indices.flatMap(index => [position.getX(index), position.getY(index), position.getZ(index)])) };
  if (normal) {
    const values = new Float32Array(normal.count * 3);
    for (let index = 0; index < normal.count; index++) { values[index * 3] = normal.getX(index); values[index * 3 + 1] = normal.getY(index); values[index * 3 + 2] = normal.getZ(index); }
    entry.normals = { indices: Array.from({ length: normal.count }, (_, index) => index), values };
  }
  if (tangent) entry.tangent = tangent.clone();
  return { ...metadata, patch: { kind: 'vertices', entries: [entry] }, bytes: entry.positions.byteLength + (entry.normals?.values.byteLength ?? 0) + (entry.tangent?.array.byteLength ?? 0) };
}

/** Keep only normals changed by this gesture; authored normals elsewhere must survive undo. */
export function compactWorkshopVertexPatch(snapshot: WorkshopSnapshot, content: THREE.Group) {
  if (snapshot.patch?.kind !== 'vertices') return;
  snapshot.bytes = 0;
  for (const entry of snapshot.patch.entries) {
    const mesh = content.children.find(object => object.uuid === entry.id) as THREE.Mesh | undefined, current = mesh?.geometry.getAttribute('normal');
    if (entry.normals && current) {
      const indices: number[] = [], values: number[] = [];
      entry.normals.indices.forEach((index, offset) => { const old = entry.normals!.values.subarray(offset * 3, offset * 3 + 3); if (old[0] !== current.getX(index) || old[1] !== current.getY(index) || old[2] !== current.getZ(index)) { indices.push(index); values.push(...old); } });
      entry.normals = { indices, values: Float32Array.from(values) };
    }
    snapshot.bytes += entry.positions.byteLength + entry.indices.length * 4 + (entry.normals?.values.byteLength ?? 0) + (entry.normals?.indices.length ?? 0) * 4 + (entry.tangent?.array.byteLength ?? 0);
  }
}

export function matchingWorkshopSnapshot(previous: WorkshopSnapshot, content: THREE.Group, selected: string | null, name: string, selectedIds: string[]): WorkshopSnapshot {
  const patch = previous.patch;
  if (!patch) return captureWorkshopSnapshot(content, selected, name, selectedIds);
  if (patch.kind !== 'vertices') return captureWorkshopPatch(content, selected, name, selectedIds, { kind: patch.kind, ids: patch.entries.map(entry => entry.id) });
  const entry = patch.entries[0], current = captureWorkshopPatch(content, selected, name, selectedIds, { kind: 'vertices', id: entry.id, indices: entry.indices });
  const currentEntry = current.patch!.kind === 'vertices' ? current.patch!.entries[0] : null;
  if (currentEntry?.normals && entry.normals) { const values = currentEntry.normals.values; currentEntry.normals = { indices: [...entry.normals.indices], values: Float32Array.from(entry.normals.indices.flatMap(index => Array.from(values.subarray(index * 3, index * 3 + 3)))) }; }
  current.bytes = previous.bytes;
  return current;
}

/** Apply a sparse before-image without replacing unaffected pieces or vertex buffers. */
export function applyWorkshopPatch(snapshot: WorkshopSnapshot, content: THREE.Group): boolean {
  const patch = snapshot.patch; if (!patch) return false;
  for (const entry of patch.entries) if (!content.children.some(object => object.uuid === entry.id)) throw new Error('No se pudo hacer el cambio.');
  if (patch.kind === 'transforms') for (const entry of patch.entries) {
    const object = content.children.find(object => object.uuid === entry.id)!;
    object.position.fromArray(entry.position); object.quaternion.fromArray(entry.quaternion); object.scale.fromArray(entry.scale); object.name = entry.name; object.visible = entry.visible;
    if (entry.group === null) delete object.userData.workshopGroup; else object.userData.workshopGroup = structuredClone(entry.group);
  }
  if (patch.kind === 'materials') for (const entry of patch.entries) {
    const mesh = content.children.find(object => object.uuid === entry.id) as THREE.Mesh;
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => material.dispose()); mesh.material = entry.material;
  }
  if (patch.kind === 'vertices') for (const entry of patch.entries) {
    const mesh = content.children.find(object => object.uuid === entry.id) as THREE.Mesh, geometry = mesh.geometry, position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
    entry.indices.forEach((index, offset) => position.setXYZ(index, entry.positions[offset * 3], entry.positions[offset * 3 + 1], entry.positions[offset * 3 + 2])); position.needsUpdate = true;
    if (entry.normals) {
      const target = normal ?? new THREE.Float32BufferAttribute(new Float32Array(position.count * 3), 3);
      if (!normal) geometry.setAttribute('normal', target);
      entry.normals.indices.forEach((index, offset) => target.setXYZ(index, entry.normals!.values[offset * 3], entry.normals!.values[offset * 3 + 1], entry.normals!.values[offset * 3 + 2])); target.needsUpdate = true;
    } else geometry.deleteAttribute('normal');
    if (entry.tangent) geometry.setAttribute('tangent', entry.tangent); else geometry.deleteAttribute('tangent');
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  }
  snapshot.patch = undefined; // Ownership of material/tangent snapshots has transferred to live pieces.
  return true;
}

/** Geometry and materials are owned here; authored textures remain owned by the model loader. */
export function disposeWorkshopSnapshot(snapshot: WorkshopSnapshot) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
  if (snapshot.patch?.kind === 'materials') for (const entry of snapshot.patch.entries) (Array.isArray(entry.material) ? entry.material : [entry.material]).forEach(material => materials.add(material));
  snapshot.patch = undefined;
  snapshot.content.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
  });
  geometries.forEach(geometry => geometry.dispose()); materials.forEach(material => material.dispose()); snapshot.content.clear();
}

export class WorkshopHistory {
  readonly past: WorkshopSnapshot[] = [];
  readonly future: WorkshopSnapshot[] = [];
  private lastKey: string | undefined;
  private lastTime = 0;
  constructor(private now: () => number = Date.now) {}
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }

  captureCurrent(direction: 'undo' | 'redo', content: THREE.Group, selected: string | null, name: string, selectedIds: string[]) {
    const previous = (direction === 'undo' ? this.past : this.future).at(-1);
    return previous ? matchingWorkshopSnapshot(previous, content, selected, name, selectedIds) : captureWorkshopPatch(content, selected, name, selectedIds, { kind: 'transforms', ids: [] });
  }

  record(snapshot: WorkshopSnapshot, key?: string) {
    const branching = this.future.length > 0, time = this.now();
    this.future.splice(0).forEach(disposeWorkshopSnapshot);
    if (!branching && key !== undefined && key === this.lastKey && time >= this.lastTime && time - this.lastTime < 500 && this.past.length) {
      const earliest = this.past.at(-1)!;
      // Successive coordinate edits can affect additional normals or coincident vertices.
      if (earliest.patch?.kind === 'vertices' && snapshot.patch?.kind === 'vertices') {
        for (const later of snapshot.patch.entries) {
          const before = earliest.patch.entries.find(entry => entry.id === later.id); if (!before) continue;
          const merge = (indices: number[], values: Float32Array, nextIndices: number[], nextValues: Float32Array) => {
            const seen = new Set(indices), missing = nextIndices.flatMap((index, offset) => seen.has(index) ? [] : [{ index, offset }]);
            return { indices: [...indices, ...missing.map(value => value.index)], values: Float32Array.from([...values, ...missing.flatMap(value => Array.from(nextValues.subarray(value.offset * 3, value.offset * 3 + 3)))]) };
          };
          const positions = merge(before.indices, before.positions, later.indices, later.positions); before.indices = positions.indices; before.positions = positions.values;
          if (before.normals && later.normals) before.normals = merge(before.normals.indices, before.normals.values, later.normals.indices, later.normals.values);
        }
        earliest.bytes = earliest.patch.entries.reduce((sum, entry) => sum + entry.positions.byteLength + entry.indices.length * 4 + (entry.normals?.values.byteLength ?? 0) + (entry.normals?.indices.length ?? 0) * 4 + (entry.tangent?.array.byteLength ?? 0), 0);
      }
      disposeWorkshopSnapshot(snapshot);
    }
    else this.past.push(snapshot);
    this.lastKey = key; this.lastTime = time;
    this.prune(this.past[this.past.length - 1]);
  }

  // Supplied current states transfer ownership, including when no history is available.
  undo(current: WorkshopSnapshot): WorkshopSnapshot | null {
    const previous = this.past.pop(); this.lastKey = undefined;
    if (!previous) { disposeWorkshopSnapshot(current); return null; }
    this.future.push(current); this.prune(current); return previous;
  }

  redo(current: WorkshopSnapshot): WorkshopSnapshot | null {
    const next = this.future.pop(); this.lastKey = undefined;
    if (!next) { disposeWorkshopSnapshot(current); return null; }
    this.past.push(current); this.prune(current); return next;
  }

  clear() {
    this.past.splice(0).forEach(disposeWorkshopSnapshot); this.future.splice(0).forEach(disposeWorkshopSnapshot);
    this.lastKey = undefined; this.lastTime = 0;
  }

  private prune(protectedState: WorkshopSnapshot) {
    while (this.past.length + this.future.length > 1 && (this.past.length + this.future.length > MAX_STEPS || [...this.past, ...this.future].reduce((bytes, snapshot) => bytes + snapshot.bytes, 0) > MAX_BYTES)) {
      const list = this.past.length && this.past[0] !== protectedState ? this.past : this.future;
      const removed = list.shift(); if (removed) disposeWorkshopSnapshot(removed); else break;
    }
  }
}
