import * as THREE from 'three/webgpu';
import { acquireGraphicsJob } from '../../shared/graphicsJobs';
import { acceleratedRaycast, MeshBVH } from 'three-mesh-bvh';
import { packPickingGeometry, type PickingTreeReply } from './pickingBvhProtocol';

type Stamp = { position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute; positionVersion: number; index: THREE.BufferAttribute | null; indexVersion: number; topology: string };
type Lease = { geometry: THREE.BufferGeometry; users: number; job?: Job; treeStamp?: Stamp; disposed: boolean; failed: boolean };
type Job = { lease: Lease; stamp: Stamp; slot?: Slot; abort: AbortController; release?: () => void };
type Slot = { worker: Worker; job?: Job; timer?: ReturnType<typeof setTimeout> };
const nativeRaycast = THREE.Mesh.prototype.raycast;
function stamp(geometry: THREE.BufferGeometry): Stamp {
  const position = geometry.getAttribute('position');
  return { position, positionVersion: position instanceof THREE.InterleavedBufferAttribute ? position.data.version : position.version, index: geometry.index, indexVersion: geometry.index?.version ?? 0, topology: JSON.stringify([geometry.groups, geometry.drawRange]) };
}
function unchanged(geometry: THREE.BufferGeometry, before: Stamp) {
  const now = stamp(geometry);
  return now.position === before.position && now.positionVersion === before.positionVersion && now.index === before.index && now.indexVersion === before.indexVersion && now.topology === before.topology;
}

/** Bounded background preprocessing; absence/failure of workers keeps native picking usable. */
export class ScenePickingAcceleration {
  private leases = new WeakMap<THREE.BufferGeometry, Lease>();
  private meshes = new WeakMap<THREE.Mesh, Lease>();
  private queue: Job[] = [];
  private slots: Slot[] = [];
  private idleTimer?: ReturnType<typeof setTimeout>;
  private readonly maximumWorkers: number;
  private readonly maximumQueued: number;
  private readonly workerFactory: (() => Worker) | undefined;

  constructor(options: { workerFactory?: () => Worker; maximumWorkers?: number; maximumQueued?: number } = {}) {
    this.maximumWorkers = options.maximumWorkers ?? (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 1 : 2);
    this.maximumQueued = options.maximumQueued ?? 32;
    this.workerFactory = options.workerFactory ?? (typeof Worker === 'undefined' ? undefined : () => new Worker(new URL('./pickingBvh.worker.ts', import.meta.url), { type: 'module' }));
  }

  prepare(root: THREE.Object3D): void {
    root.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      const geometry = object.geometry;
      // acceleratedRaycast's Mesh fallback does not apply InstancedMesh transforms/instance IDs.
      // Release an old lease even if replacement geometry no longer qualifies for acceleration.
      if (object instanceof THREE.SkinnedMesh || object instanceof THREE.InstancedMesh || object instanceof THREE.BatchedMesh || geometry.morphAttributes.position?.length || !geometry.getAttribute('position') || (geometry.index?.count ?? geometry.getAttribute('position').count) < 768) { this.releaseMesh(object); return; }
      let lease = this.meshes.get(object);
      if (lease?.geometry !== geometry) { this.releaseMesh(object); lease = undefined; }
      if (!lease) {
        lease = this.leases.get(geometry);
        if (!lease) {
          lease = { geometry, users: 0, disposed: false, failed: false }; this.leases.set(geometry, lease);
          const owned = lease;
          geometry.addEventListener('dispose', () => { owned.disposed = true; this.cancel(owned); geometry.boundsTree = undefined; this.leases.delete(geometry); });
        }
        if (lease.disposed) return;
        lease.users++; this.meshes.set(object, lease);
      }
      // Never set firstHitOnly globally: eligibility and paint-side filters may need later hits.
      object.raycast = acceleratedRaycast;
      if (lease.treeStamp && !unchanged(geometry, lease.treeStamp)) { geometry.boundsTree = undefined; lease.treeStamp = undefined; lease.failed = false; }
      if (!geometry.boundsTree && !lease.job && !lease.failed && this.workerFactory && this.queue.length < this.maximumQueued) {
        const job: Job = { lease, stamp: stamp(geometry), abort: new AbortController() }; lease.job = job; this.queue.push(job);
      }
    });
    this.pump();
  }

  release(root: THREE.Object3D): void { root.traverse(object => { if (object instanceof THREE.Mesh) this.releaseMesh(object); }); }

  private releaseMesh(mesh: THREE.Mesh) {
    const lease = this.meshes.get(mesh); if (!lease) return;
    this.meshes.delete(mesh); lease.users--;
    if (mesh.raycast === acceleratedRaycast) mesh.raycast = nativeRaycast;
    if (!lease.users) this.cancel(lease);
  }

  private cancel(lease: Lease) {
    const job = lease.job; if (!job) return;
    job.abort.abort(); job.release?.(); job.release = undefined;
    lease.job = undefined; this.queue = this.queue.filter(value => value !== job);
    if (job.slot) { this.retire(job.slot); this.pump(); }
  }

  private retire(slot: Slot) {
    if (slot.timer) clearTimeout(slot.timer);
    slot.job?.abort.abort(); slot.job?.release?.(); if (slot.job) slot.job.release = undefined;
    slot.worker.onmessage = null; slot.worker.onerror = null; slot.worker.onmessageerror = null; slot.worker.terminate();
    this.slots = this.slots.filter(value => value !== slot);
  }

  private finish(slot: Slot, reply?: PickingTreeReply) {
    const job = slot.job; if (!job) return;
    if (slot.timer) clearTimeout(slot.timer); slot.timer = undefined; slot.job = undefined;
    job.release?.(); job.release = undefined;
    const { lease } = job;
    if (lease.job === job) {
      lease.job = undefined;
      if (!lease.disposed && lease.users && unchanged(lease.geometry, job.stamp)) {
        if (reply && 'tree' in reply) {
          try { lease.geometry.boundsTree = MeshBVH.deserialize(reply.tree, lease.geometry, { setIndex: false }); lease.treeStamp = job.stamp; }
          catch { lease.failed = true; }
        } else lease.failed = true;
      }
    }
    this.pump();
  }

  private pump() {
    if (!this.workerFactory) return;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
    while (this.queue.length) {
      let slot = this.slots.find(value => !value.job);
      if (!slot && this.slots.length < this.maximumWorkers) {
        try {
          slot = { worker: this.workerFactory() }; this.slots.push(slot);
          const owned = slot;
          slot.worker.onmessage = ({ data }: MessageEvent<PickingTreeReply>) => this.finish(owned, data);
          const failure = () => { const job = owned.job; this.retire(owned); if (job && job.lease.job === job) { job.lease.job = undefined; job.lease.failed = true; } this.pump(); };
          slot.worker.onerror = failure; slot.worker.onmessageerror = failure;
        } catch { for (const job of this.queue.splice(0)) { job.lease.job = undefined; job.lease.failed = true; } break; }
      }
      if (!slot) break;
      const job = this.queue.shift()!;
      if (job.lease.disposed || !job.lease.users || job.lease.job !== job) continue;
      job.slot = slot; slot.job = job;
      const owned = slot;
      void acquireGraphicsJob(job.abort.signal).then(release => {
        if (job.abort.signal.aborted || owned.job !== job || job.lease.job !== job) { release(); return; }
        job.release = release;
        if (!unchanged(job.lease.geometry, job.stamp)) { this.finish(owned); return; }
        try {
          const data = packPickingGeometry(job.lease.geometry);
          owned.timer = setTimeout(() => { const pending = owned.job; this.retire(owned); if (pending && pending.lease.job === pending) { pending.lease.job = undefined; pending.lease.failed = true; } this.pump(); }, 20000);
          owned.worker.postMessage(data, [data.position.buffer, data.index.buffer]);
        } catch { this.finish(owned); }
      }).catch(() => { if (owned.job === job && job.lease.job === job) this.finish(owned); });
    }
    if (this.slots.length && !this.queue.length && this.slots.every(slot => !slot.job)) this.idleTimer = setTimeout(() => { for (const slot of [...this.slots]) this.retire(slot); this.idleTimer = undefined; }, 1000);
  }

  dispose(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = undefined; }
    for (const job of this.queue.splice(0)) { job.abort.abort(); job.lease.job = undefined; }
    for (const slot of [...this.slots]) { if (slot.job) slot.job.lease.job = undefined; this.retire(slot); }
  }
}

const acceleration = new ScenePickingAcceleration();
export const prepareScenePicking = (root: THREE.Object3D) => acceleration.prepare(root);
export const releaseScenePicking = (root: THREE.Object3D) => acceleration.release(root);
