import * as THREE from 'three/webgpu';
import { projectLevel, projectStructure, type ProjectDocument } from '../../domain/project/projectDocument';
import { updateStair } from '../../domain/project/projectOperations';

export type StairPose = { x: number; z: number; rotation: number };

function scope(project: ProjectDocument, id: string) {
  const stair = project.stairs.find(item => item.id === id);
  if (!stair) return null;
  const ids = [stair.fromLevelId, stair.toLevelId];
  return projectStructure({ ...project, levels: project.levels.filter(level => ids.includes(level.id)), stairs: project.stairs.filter(item => ids.includes(item.fromLevelId) || ids.includes(item.toLevelId)), roofs: project.roofs.filter(roof => ids.includes(roof.levelId)) });
}

export function stairPose(project: ProjectDocument, target: StairPose, original?: StairPose): StairPose {
  const unchanged = (key: keyof StairPose) => original && Math.abs(target[key] - original[key]) < 1e-7;
  const snap = (key: 'x' | 'z') => unchanged(key) ? original![key] : project.editing.snap ? Number((Math.round(target[key] / project.editing.step) * project.editing.step).toFixed(6)) : target[key];
  const rotation = unchanged('rotation') ? original!.rotation : project.editing.snap ? Math.round(target.rotation / 15) * 15 : target.rotation;
  return { x: snap('x'), z: snap('z'), rotation: ((rotation % 360) + 360) % 360 };
}

// Geometry stays resident during a gesture; only the completed operation rebuilds its slab and navigation.
export class StairTransformPreview {
  readonly base: ProjectDocument;
  readonly id: string;
  readonly group: THREE.Object3D;
  pose: StairPose;
  error = '';
  private signature: string | null;
  private outline: THREE.Line;
  private overlay = new THREE.Group();
  private material = new THREE.MeshBasicMaterial({ color: '#e34e4e', transparent: true, opacity: .35, depthWrite: false, depthTest: false });
  private previous = '';
  private checked = '';

  constructor(project: ProjectDocument, id: string, group: THREE.Object3D) {
    this.base = project; this.id = id; this.group = group;
    const stair = project.stairs.find(item => item.id === id)!;
    this.pose = { x: stair.x, z: stair.z, rotation: stair.rotation };
    this.signature = scope(project, id);
    const hole = projectLevel(project, stair.toLevelId).surfaces.flatMap(surface => surface.holes).find(hole => hole.stairId === id)!;
    const y = projectLevel(project, stair.toLevelId).elevation + .025;
    const points = hole.vertices.map(point => new THREE.Vector3(point.x, y, point.z));
    this.outline = new THREE.Line(new THREE.BufferGeometry().setFromPoints([...points, points[0]]), new THREE.LineBasicMaterial({ color: '#66834f', depthTest: false, transparent: true, opacity: .9 }));
    this.outline.renderOrder = 1001; this.outline.raycast = () => {};
    group.traverse(object => { if (object instanceof THREE.Mesh) { const copy = object.clone(); copy.material = this.material; copy.castShadow = copy.receiveShadow = false; copy.raycast = () => {}; copy.renderOrder = 1000; this.overlay.add(copy); } });
    this.overlay.visible = false; group.add(this.overlay, this.outline);
  }

  compatible(project: ProjectDocument) { return project.id === this.base.id && scope(project, this.id) === this.signature; }
  get hasPreview() { return this.previous !== ''; }

  preview(target: StairPose, validate = true) {
    const original = this.base.stairs.find(item => item.id === this.id)!;
    const pose = stairPose(this.base, target, original), key = JSON.stringify(pose);
    this.pose = pose;
    if (validate && key !== this.checked) {
      try { updateStair(this.base, this.id, pose); this.error = ''; }
      catch (cause) { this.error = cause instanceof Error ? cause.message : 'No se puede colocar aquí.'; }
      this.checked = key;
    }
    if (key !== this.previous) {
      this.previous = key;
      this.group.matrixAutoUpdate = false;
      this.group.matrix.makeTranslation(pose.x, 0, pose.z).multiply(new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(pose.rotation - original.rotation))).multiply(new THREE.Matrix4().makeTranslation(-original.x, 0, -original.z));
      this.group.matrixWorldNeedsUpdate = true;
    }
    this.overlay.visible = !!this.error;
    (this.outline.material as THREE.LineBasicMaterial).color.set(this.error ? '#d63f3f' : '#66834f');
  }

  apply(project: ProjectDocument) {
    if (!this.compatible(project)) throw new Error('El movimiento se canceló porque cambió la construcción.');
    return updateStair(project, this.id, this.pose);
  }

  dispose() {
    this.overlay.removeFromParent(); this.outline.removeFromParent();
    this.overlay.traverse(object => { if (object instanceof THREE.InstancedMesh) object.dispose(); }); this.overlay.clear();
    this.material.dispose(); this.outline.geometry.dispose(); (this.outline.material as THREE.Material).dispose();
    this.group.matrix.identity(); this.group.matrixAutoUpdate = true; this.group.matrixWorldNeedsUpdate = true;
  }
}
