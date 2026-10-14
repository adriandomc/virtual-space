import * as THREE from 'three';

export type WorkshopGroup = { id: string; name: string };
export type WorkshopSelectionTransform = {
  center: THREE.Vector3;
  pieces: { mesh: THREE.Mesh; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }[];
};

/** Extras describe selection groups only; they never change geometry or its hierarchy. */
export function readWorkshopGroup(value: unknown): WorkshopGroup | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { id, name } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof name !== 'string') return null;
  const label = name.trim();
  if (!label || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label)) return null;
  return { id, name: label };
}

export function workshopGroup(piece: THREE.Object3D): WorkshopGroup | null {
  return readWorkshopGroup(piece.userData.workshopGroup);
}

export function workshopSelectionUnit(piece: THREE.Mesh, pieces: THREE.Mesh[]): THREE.Mesh[] {
  const group = workshopGroup(piece);
  return group ? pieces.filter(candidate => workshopGroup(candidate)?.id === group.id) : [piece];
}

export function groupWorkshopPieces(pieces: THREE.Mesh[], name: string, id: string = crypto.randomUUID()): boolean {
  const group = readWorkshopGroup({ id, name });
  if (pieces.length < 2 || !group) return false;
  for (const piece of pieces) piece.userData.workshopGroup = { ...group };
  return true;
}

export function ungroupWorkshopPieces(pieces: THREE.Mesh[]) {
  for (const piece of pieces) delete piece.userData.workshopGroup;
}

export function selectionBounds(pieces: THREE.Mesh[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const piece of pieces) { piece.updateWorldMatrix(true, false); box.union(new THREE.Box3().setFromObject(piece)); }
  return box;
}

/** Siblings keep individual scale and orientation. No matrix decomposition means no shear. */
export function captureSelectionTransform(pieces: THREE.Mesh[]): WorkshopSelectionTransform {
  if (!pieces.length || pieces.some(piece => piece.parent !== pieces[0].parent)) throw new Error('Selecciona piezas del mismo modelo.');
  const center = selectionBounds(pieces).getCenter(new THREE.Vector3());
  pieces[0].parent?.worldToLocal(center);
  return { center, pieces: pieces.map(mesh => ({ mesh, position: mesh.position.clone(), quaternion: mesh.quaternion.clone(), scale: mesh.scale.clone() })) };
}

export function applySelectionTransform(snapshot: WorkshopSelectionTransform, position: THREE.Vector3, rotation = new THREE.Quaternion(), scale = 1): boolean {
  if (![...position.toArray(), ...rotation.toArray(), scale].every(Number.isFinite) || scale <= 0 || Math.abs(rotation.lengthSq() - 1) > .00001) return false;
  const next = snapshot.pieces.map(piece => ({
    ...piece,
    nextPosition: piece.position.clone().sub(snapshot.center).multiplyScalar(scale).applyQuaternion(rotation).add(position),
    nextQuaternion: rotation.clone().multiply(piece.quaternion),
    nextScale: piece.scale.clone().multiplyScalar(scale),
  }));
  if (next.some(piece => piece.nextPosition.toArray().some(value => Math.abs(value) > 10000) || piece.nextScale.toArray().some(value => !Number.isFinite(value) || value === 0 || scale !== 1 && (Math.abs(value) < .001 || Math.abs(value) > 1000)))) return false;
  for (const piece of next) { piece.mesh.position.copy(piece.nextPosition); piece.mesh.quaternion.copy(piece.nextQuaternion); piece.mesh.scale.copy(piece.nextScale); piece.mesh.updateMatrix(); }
  return true;
}

/** Build a bounds-only proxy; its hidden material is never exported or raycast as content. */
export function createSelectionProxy(pieces: THREE.Mesh[]): THREE.Mesh {
  const snapshot = captureSelectionTransform(pieces), parent = pieces[0].parent;
  const box = new THREE.Box3();
  for (const piece of pieces) {
    const inverse = parent?.matrixWorld.clone().invert() ?? new THREE.Matrix4();
    const bounds = new THREE.Box3().setFromObject(piece).applyMatrix4(inverse);
    box.union(bounds);
  }
  const proxy = new THREE.Mesh(new THREE.BoxGeometry(...box.getSize(new THREE.Vector3()).toArray() as [number, number, number]), new THREE.MeshBasicMaterial({ visible: false }));
  proxy.position.copy(snapshot.center);
  return proxy;
}

export function duplicateWorkshopPieces(pieces: THREE.Mesh[], offset = new THREE.Vector3(.15, 0, .15)): THREE.Mesh[] {
  const groups = new Map<string, string>();
  const counts = new Map<string, number>();
  for (const piece of pieces) { const group = workshopGroup(piece); if (group) counts.set(group.id, (counts.get(group.id) ?? 0) + 1); }
  return pieces.map(piece => {
    const copy = piece.clone(); copy.geometry = piece.geometry.clone();
    copy.material = Array.isArray(piece.material) ? piece.material.map(material => material.clone()) : piece.material.clone();
    copy.name = `${piece.name} copia`.slice(0, 80); copy.position.add(offset);
    const group = workshopGroup(piece);
    if (group && counts.get(group.id)! > 1) { if (!groups.has(group.id)) groups.set(group.id, crypto.randomUUID()); copy.userData.workshopGroup = { id: groups.get(group.id), name: `${group.name} copia`.slice(0, 80) }; }
    else delete copy.userData.workshopGroup;
    return copy;
  });
}
