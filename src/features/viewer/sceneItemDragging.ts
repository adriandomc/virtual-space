import { stableStringify } from '../../shared/sameData';
import * as THREE from 'three/webgpu';
import { itemWorldPosition, moveSceneItem, previewSceneItemMove, roomWallEndpoints } from '../../domain/project/model';
import type { Room } from '../../domain/project/types';

type MovableSelection = { kind: 'furniture' | 'light' | 'opening'; id: string };
type Target = { x: number; y: number; z: number; rotation: number };

function dragScope(room: Room, selection: MovableSelection) {
  const items = selection.kind === 'furniture' ? room.furniture : selection.kind === 'light' ? room.lights : room.openings;
  const walls = room.wallSegments?.map(({ leftColor: _left, rightColor: _right, ...wall }) => wall);
  const openings = room.openings.map(({ color: _color, open: _open, ...opening }) => opening);
  return stableStringify({ levelId: room.levelId, vertices: room.vertices, height: room.height, thickness: room.thickness, editing: room.editing, walls, openings: selection.kind === 'opening' ? openings : undefined, item: items.find(item => item.id === selection.id) });
}

/** A gesture owns only a temporary transform; the accepted document remains authoritative. */
export class SceneItemDrag {
  room: Room;
  target: Target | undefined;
  private scope: string;
  private position: THREE.Vector3;
  private quaternion: THREE.Quaternion;
  private scale: THREE.Vector3;
  private matrix: THREE.Matrix4;
  private autoUpdate: boolean;
  private cord?: { object: THREE.Object3D; position: THREE.Vector3; scale: THREE.Vector3 };
  constructor(readonly base: Room, readonly selection: MovableSelection, readonly object: THREE.Object3D) {
    this.room = base; this.scope = dragScope(base, selection);
    object.updateMatrix(); this.position = object.position.clone(); this.quaternion = object.quaternion.clone(); this.scale = object.scale.clone(); this.matrix = object.matrix.clone(); this.autoUpdate = object.matrixAutoUpdate;
    const cord = object.children.find(child => child.userData.cord);
    if (cord) this.cord = { object: cord, position: cord.position.clone(), scale: cord.scale.clone() };
  }
  compatible(room: Room) { return dragScope(room, this.selection) === this.scope; }
  preview(room: Room, target: Target) {
    if (!this.compatible(room)) throw new Error('El movimiento se canceló porque cambió la construcción.');
    this.room = previewSceneItemMove(room, this.selection, target); this.target = target;
    const position = itemWorldPosition(this.room, this.selection)!;
    if (this.selection.kind === 'furniture') {
      const item = this.room.furniture.find(item => item.id === this.selection.id)!;
      this.object.position.set(item.x, 0, item.z); this.object.rotation.y = THREE.MathUtils.degToRad(item.rotation);
    } else if (this.selection.kind === 'light') {
      this.object.position.set(position.x, position.y, position.z);
      if (this.cord) {
        const length = Math.max(.02, room.height - position.y - .1);
        this.cord.object.scale.y = length / this.cord.object.userData.length;
        this.cord.object.position.y = .1 + length / 2;
      }
    } else {
      const before = this.base.openings.find(item => item.id === this.selection.id)!, after = this.room.openings.find(item => item.id === this.selection.id)!;
      const [a, b] = roomWallEndpoints(this.base, before.wall), [c, d] = roomWallEndpoints(this.room, after.wall);
      const turn = Math.atan2(b.z - a.z, b.x - a.x) - Math.atan2(d.z - c.z, d.x - c.x), origin = itemWorldPosition(this.base, this.selection)!;
      this.object.matrixAutoUpdate = false;
      this.object.matrix.makeTranslation(position.x, position.y, position.z).multiply(new THREE.Matrix4().makeRotationY(turn)).multiply(new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z)).multiply(this.matrix);
    }
    this.object.updateWorldMatrix(true, true); this.object.matrixWorldNeedsUpdate = true;
    return this.room;
  }
  apply(room: Room) {
    if (!this.compatible(room)) throw new Error('El movimiento se canceló porque cambió la construcción.');
    return this.target ? moveSceneItem(room, this.selection, this.target) : room;
  }
  dispose() {
    this.object.position.copy(this.position); this.object.quaternion.copy(this.quaternion); this.object.scale.copy(this.scale);
    this.object.matrix.copy(this.matrix); this.object.matrixAutoUpdate = this.autoUpdate; this.object.matrixWorldNeedsUpdate = true;
    if (this.cord) { this.cord.object.position.copy(this.cord.position); this.cord.object.scale.copy(this.cord.scale); }
  }
}

/** One durable checkpoint in flight, retaining only the latest pending pose. No server writes. */
export class GestureCheckpoints {
  private next: Room | undefined;
  private busy = false;
  private last = 0;
  private stopped = false;
  private tail = Promise.resolve();
  constructor(private write: ((room: Room | null) => Promise<void>) | undefined, private onError: (cause: unknown) => void) {}
  queue(room: Room) { if (!this.stopped) this.next = room; }
  tick(time: number) {
    if (!this.write || this.stopped || this.busy || !this.next || time - this.last < 500) return;
    const next = this.next; this.next = undefined; this.last = time; this.busy = true;
    this.tail = this.tail.then(() => this.stopped ? undefined : this.write!(next)).catch(cause => { if (!this.stopped) this.onError(cause); }).finally(() => { this.busy = false; });
  }
  stop(clear = false) {
    this.stopped = true; this.next = undefined;
    if (clear && this.write) {
      // Reserve cleanup's generation now, before another gesture can start. Persistence
      // serializes the actual storage writes and rechecks that generation before clearing.
      let clearing: Promise<void>;
      try { clearing = this.write(null); }
      catch (cause) { clearing = Promise.reject(cause); }
      this.tail = Promise.all([this.tail, clearing]).then(() => {}).catch(this.onError);
    }
  }
}
