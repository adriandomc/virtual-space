import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';
import { buildPickingTree, packPickingGeometry, type PickingGeometryData, type PickingTreeReply } from './pickingBvhProtocol';
import { ScenePickingAcceleration } from './scenePickingAcceleration';

class FakeWorker {
  onmessage: ((event: MessageEvent<PickingTreeReply>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  data?: PickingGeometryData;
  stopped = false;
  postMessage(data: PickingGeometryData) { this.data = data; }
  terminate() { this.stopped = true; }
  finish() { this.onmessage?.({ data: { tree: buildPickingTree(this.data!) } } as MessageEvent<PickingTreeReply>); }
}
const denseMesh = () => new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));

test('indirect acceleration preserves original face indices, material sides, groups and all visible hits', () => {
  for (const indexed of [true, false]) {
    const source = new THREE.BoxGeometry(2, 2, 2, 8, 8, 8), geometry = indexed ? source : source.toNonIndexed();
    const materials = Array.from({ length: 6 }, () => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), mesh = new THREE.Mesh(geometry, materials);
    const beforeIndex = geometry.index?.array.slice(); const positions = geometry.getAttribute('position').array.slice();
    const ray = new THREE.Raycaster(new THREE.Vector3(.13, .27, 4), new THREE.Vector3(0, 0, -1)); mesh.updateWorldMatrix(true, true);
    const expected = ray.intersectObject(mesh).map(hit => [hit.faceIndex, hit.face?.materialIndex, hit.distance]);
    geometry.boundsTree = MeshBVH.deserialize(buildPickingTree(packPickingGeometry(geometry)), geometry, { setIndex: false }); mesh.raycast = acceleratedRaycast;
    assert.deepEqual(ray.intersectObject(mesh).map(hit => [hit.faceIndex, hit.face?.materialIndex, hit.distance]), expected);
    assert.deepEqual(geometry.index?.array, beforeIndex); assert.deepEqual(geometry.getAttribute('position').array, positions); assert.equal(ray.firstHitOnly, undefined);
    geometry.dispose(); source.dispose(); materials.forEach(material => material.dispose());
  }
});

test('shared geometry builds once and disposing one instance does not cancel another instance', async () => {
  const workers: FakeWorker[] = [], acceleration = new ScenePickingAcceleration({ maximumWorkers: 1, workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker as unknown as Worker; } });
  const first = denseMesh(), second = new THREE.Mesh(first.geometry, first.material), group = new THREE.Group().add(first, second);
  try {
    acceleration.prepare(group); await Promise.resolve(); assert.equal(workers.length, 1); assert(first.geometry.getAttribute('position').array.byteLength > 0);
    acceleration.release(first); assert.equal(workers[0].stopped, false);
    workers[0].finish(); assert(first.geometry.boundsTree); assert.equal(first.raycast, THREE.Mesh.prototype.raycast); assert.equal(second.raycast, acceleratedRaycast);
  } finally { acceleration.release(group); first.geometry.dispose(); (first.material as THREE.Material).dispose(); acceleration.dispose(); }
});

test('the worker pool and queue stay bounded and stale results cannot restore replaced geometry', async () => {
  const workers: FakeWorker[] = [], acceleration = new ScenePickingAcceleration({ maximumWorkers: 1, maximumQueued: 2, workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker as unknown as Worker; } });
  const objects = Array.from({ length: 5 }, denseMesh), group = new THREE.Group().add(...objects);
  try {
    acceleration.prepare(group); await Promise.resolve(); assert.equal(workers.length, 1);
    objects[0].geometry.getAttribute('position').needsUpdate = true;
    workers[0].finish(); await Promise.resolve(); assert.equal(objects[0].geometry.boundsTree, undefined, 'stale position version rejected');
    workers[0].finish(); assert(objects[1].geometry.boundsTree); assert.equal(objects[2].geometry.boundsTree, undefined, 'bounded queue leaves native picking available');
    acceleration.prepare(objects[2]); await Promise.resolve(); const staleReply = workers[0].onmessage; objects[2].geometry.dispose(); assert(workers[0].stopped);
    staleReply?.({ data: { tree: buildPickingTree(workers[0].data!) } } as MessageEvent<PickingTreeReply>); assert.equal(objects[2].geometry.boundsTree, undefined);
  } finally { acceleration.release(group); objects.forEach(object => { object.geometry.dispose(); (object.material as THREE.Material).dispose(); }); acceleration.dispose(); }
});

test('instanced geometry retains native transformed hits and instance identifiers', () => {
  let workers = 0;
  const acceleration = new ScenePickingAcceleration({ workerFactory: () => { workers++; return new FakeWorker() as unknown as Worker; } });
  const geometry = new THREE.SphereGeometry(1, 32, 20), material = new THREE.MeshBasicMaterial(), mesh = new THREE.InstancedMesh(geometry, material, 2);
  mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-4, 0, 0)); mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(4, 0, 0)); mesh.updateWorldMatrix(true, true);
  const ray = new THREE.Raycaster(new THREE.Vector3(4, .1, 5), new THREE.Vector3(0, 0, -1)), original = mesh.raycast, before = ray.intersectObject(mesh);
  assert.equal(before[0]?.instanceId, 1);
  acceleration.prepare(mesh); assert.equal(mesh.raycast, original); assert.equal(workers, 0);
  const after = ray.intersectObject(mesh); assert.deepEqual(after.map(hit => [hit.instanceId, hit.faceIndex, hit.distance]), before.map(hit => [hit.instanceId, hit.faceIndex, hit.distance]));
  acceleration.release(mesh); acceleration.dispose(); geometry.dispose(); material.dispose();
});

test('replacing accelerated geometry with a small mesh releases and cancels its old lease', async () => {
  const workers: FakeWorker[] = [], acceleration = new ScenePickingAcceleration({ workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker as unknown as Worker; } });
  const mesh: THREE.Mesh = denseMesh(), previous = mesh.geometry;
  try {
    acceleration.prepare(mesh); await Promise.resolve(); assert.equal(mesh.raycast, acceleratedRaycast); assert(workers[0].data);
    mesh.geometry = new THREE.BoxGeometry(); acceleration.prepare(mesh);
    assert.equal(workers[0].stopped, true); assert.equal(mesh.raycast, THREE.Mesh.prototype.raycast); assert.equal(previous.boundsTree, undefined);
    const reused = new THREE.Mesh(previous, mesh.material); acceleration.prepare(reused); await Promise.resolve(); assert.equal(workers.length, 2); workers[1].finish(); assert(previous.boundsTree); acceleration.release(reused);
  } finally { acceleration.release(mesh); acceleration.dispose(); previous.dispose(); mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose(); }
});
