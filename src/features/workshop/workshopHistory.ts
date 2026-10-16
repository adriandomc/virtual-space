import * as THREE from 'three';

export type WorkshopSnapshot = { content: THREE.Group; selected: string | null; selectedIds: string[]; name: string; bytes: number };
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

/** Geometry and materials are owned here; authored textures remain owned by the model loader. */
export function disposeWorkshopSnapshot(snapshot: WorkshopSnapshot) {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>();
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

  record(snapshot: WorkshopSnapshot, key?: string) {
    const branching = this.future.length > 0, time = this.now();
    this.future.splice(0).forEach(disposeWorkshopSnapshot);
    if (!branching && key !== undefined && key === this.lastKey && time >= this.lastTime && time - this.lastTime < 500 && this.past.length) disposeWorkshopSnapshot(snapshot);
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
