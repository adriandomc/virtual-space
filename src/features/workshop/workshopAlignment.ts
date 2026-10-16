import * as THREE from 'three';

export type WorkshopAxis = 'x' | 'y' | 'z';
export type WorkshopAlignment = 'min' | 'center' | 'max' | 'before' | 'after';
// value is the matched surface/center plane, or the pivot coordinate for grid snapping.
export type WorkshopSnap = { axis: WorkshopAxis; value: number; reference: THREE.Mesh | null };
const AXES: WorkshopAxis[] = ['x', 'y', 'z'];
const LINEAR = [0, 1, 2, 4, 5, 6, 8, 9, 10];
type Attribute = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
type BoundsCache = { geometry: THREE.BufferGeometry; position: Attribute; index: THREE.BufferAttribute | null; positionVersion: number; indexVersion: number; start: number; count: number; linear: number[]; bounds: THREE.Box3 | null };
const boundsCache = new WeakMap<THREE.Mesh, BoundsCache>();

function visible(object: THREE.Object3D) {
  for (let current: THREE.Object3D | null = object; current; current = current.parent) if (!current.visible) return false;
  return true;
}
function localMatrix(object: THREE.Object3D) {
  return object.matrixAutoUpdate ? new THREE.Matrix4().compose(object.position, object.quaternion, object.scale) : object.matrix.clone();
}
function worldMatrix(object: THREE.Object3D | null): THREE.Matrix4 {
  const matrix = new THREE.Matrix4();
  for (let current = object; current; current = current.parent) matrix.premultiply(localMatrix(current));
  return matrix;
}
function validMatrix(matrix: THREE.Matrix4) {
  const determinant = matrix.determinant();
  return matrix.elements.every(Number.isFinite) && Number.isFinite(determinant) && Math.abs(determinant) > 1e-15;
}
function version(attribute: Attribute) { return attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.version : attribute.version; }

/** Tight bounds in the moving piece's parent coordinates, without changing source geometry or matrices. */
function bounds(mesh: THREE.Mesh, parent: THREE.Object3D | null): THREE.Box3 | null {
  if (!visible(mesh)) return null;
  const parentWorld = worldMatrix(parent);
  if (!validMatrix(parentWorld)) return null;
  const matrix = mesh.parent === parent ? localMatrix(mesh) : parentWorld.invert().multiply(worldMatrix(mesh));
  if (!validMatrix(matrix)) return null;
  const geometry = mesh.geometry, position = geometry.getAttribute('position'), index = geometry.getIndex();
  if (!position || position.itemSize !== 3) return null;
  const start = geometry.drawRange.start, count = Math.min(index?.count ?? position.count, start + geometry.drawRange.count) - start;
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 1) return null;
  const linear = LINEAR.map(index => matrix.elements[index]), positionVersion = version(position), indexVersion = index?.version ?? 0;
  let entry = boundsCache.get(mesh);
  if (!entry || entry.geometry !== geometry || entry.position !== position || entry.index !== index || entry.positionVersion !== positionVersion || entry.indexVersion !== indexVersion || entry.start !== start || entry.count !== count || linear.some((value, i) => value !== entry!.linear[i])) {
    const box = new THREE.Box3(), point = new THREE.Vector3(), transform = matrix.clone(); transform.setPosition(0, 0, 0);
    for (let i = start; i < start + count; i++) {
      const vertex = index?.getX(i) ?? i;
      if (!Number.isSafeInteger(vertex) || vertex < 0 || vertex >= position.count) { box.makeEmpty(); break; }
      point.fromBufferAttribute(position, vertex).applyMatrix4(transform);
      if (![point.x, point.y, point.z].every(Number.isFinite)) { box.makeEmpty(); break; }
      box.expandByPoint(point);
    }
    entry = { geometry, position, index, positionVersion, indexVersion, start, count, linear, bounds: box.isEmpty() ? null : box };
    boundsCache.set(mesh, entry);
  }
  return entry.bounds?.clone().translate(new THREE.Vector3().setFromMatrixPosition(matrix)) ?? null;
}

function offsets(piece: THREE.Box3, reference: THREE.Box3, axis: WorkshopAxis): Record<WorkshopAlignment, number> {
  return {
    min: reference.min[axis] - piece.min[axis],
    center: (reference.min[axis] + reference.max[axis] - piece.min[axis] - piece.max[axis]) / 2,
    max: reference.max[axis] - piece.max[axis],
    before: reference.min[axis] - piece.max[axis],
    after: reference.max[axis] - piece.min[axis],
  };
}

/** Axes and distances use the moving piece's parent coordinates. Only position is changed. */
export function alignWorkshopPiece(piece: THREE.Mesh, reference: THREE.Mesh, axis: WorkshopAxis, alignment: WorkshopAlignment): boolean {
  if (piece === reference || !piece.matrixAutoUpdate || !AXES.includes(axis) || !['min', 'center', 'max', 'before', 'after'].includes(alignment)) return false;
  const moving = bounds(piece, piece.parent), target = bounds(reference, piece.parent);
  if (!moving || !target) return false;
  const offset = offsets(moving, target, axis)[alignment];
  if (Math.abs(offset) <= 1e-9) return false;
  const value = piece.position[axis] + offset;
  if (!Number.isFinite(value)) return false;
  piece.position[axis] = value;
  return true;
}

/** Recomputed from the current position on every call: no retained target or drag latch. */
export function snapWorkshopPiece(piece: THREE.Mesh, references: THREE.Mesh[], axes: WorkshopAxis[], options: { grid: number | null; pieces: boolean; tolerance: number }): WorkshopSnap[] {
  const { grid, pieces, tolerance } = options;
  if (!piece.matrixAutoUpdate || !Number.isFinite(tolerance) || tolerance < 0) return [];
  const moving = bounds(piece, piece.parent);
  if (!moving) return [];
  const targets = pieces ? references.filter(reference => reference !== piece).map(reference => ({ reference, box: bounds(reference, piece.parent) })).filter((target): target is { reference: THREE.Mesh; box: THREE.Box3 } => target.box !== null) : [];
  const snaps: WorkshopSnap[] = [];
  for (const axis of new Set(axes.filter(axis => AXES.includes(axis)))) {
    let nearest: { distance: number; offset: number; plane: number; reference: THREE.Mesh } | undefined;
    for (const target of targets) {
      if (AXES.some(other => other !== axis && Math.max(target.box.min[other] - moving.max[other], moving.min[other] - target.box.max[other], 0) > tolerance)) continue;
      for (const [alignment, offset] of Object.entries(offsets(moving, target.box, axis))) {
        const distance = Math.abs(offset);
        const plane = alignment === 'min' || alignment === 'before' ? target.box.min[axis] : alignment === 'max' || alignment === 'after' ? target.box.max[axis] : (target.box.min[axis] + target.box.max[axis]) / 2;
        if (distance <= tolerance && (!nearest || distance < nearest.distance)) nearest = { distance, offset, plane, reference: target.reference };
      }
    }
    // Nearby surfaces win over the grid, so furniture can touch off-grid boards.
    const gridValue = grid !== null && Number.isFinite(grid) && grid > 0 ? Math.round(piece.position[axis] / grid) * grid : null;
    const offset = nearest?.offset ?? (gridValue !== null ? gridValue - piece.position[axis] : null);
    if (offset === null) continue;
    piece.position[axis] += offset;
    moving.min[axis] += offset; moving.max[axis] += offset;
    snaps.push({ axis, value: nearest?.plane ?? piece.position[axis], reference: nearest?.reference ?? null });
  }
  return snaps;
}
