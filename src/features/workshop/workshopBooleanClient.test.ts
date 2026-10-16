import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { startWorkshopBoolean } from './workshopBooleanClient';
import { booleanTransfers, packBooleanMesh, unpackBooleanMesh } from './workshopBooleanTransfer';
import type { BooleanReply, BooleanRequest } from './workshopBooleanTransfer';
import { disposeWorkshopModel } from './modelWorkshopGeometry';
import { combineWorkshopMeshes } from './workshopBoolean';

test('worker packets preserve parent-relative transforms, normalized attributes and live buffers', () => {
  const parent = new THREE.Group(); parent.position.set(2, 1, -3); parent.scale.set(2, 1, .5); parent.rotation.y = .4;
  const geometry = new THREE.BoxGeometry(1, 1, 1), color = new Uint8Array(geometry.getAttribute('position').count * 3).fill(128);
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3, true));
  geometry.setAttribute('uv1', geometry.getAttribute('uv').clone());
  geometry.setDrawRange(3, 30);
  const material = new THREE.MeshStandardMaterial({ color: '#abcdef' }), mesh = new THREE.Mesh(geometry, material); mesh.position.set(.3, .4, -.5); mesh.rotation.y = .8; parent.add(mesh);
  const before = geometry.getAttribute('position').array.slice(), indexBefore = geometry.index!.array.slice();
  const packed = packBooleanMesh(mesh, 'base', parent);
  assert.equal(packed.materials[0].name, 'csg-input-base-0');
  assert.ok(Math.abs(packed.geometry.attributes.color.array[0] - 128 / 255) < 1e-6);
  const transferred = structuredClone(packed, { transfer: booleanTransfers(packed.geometry) });
  assert.equal(packed.geometry.attributes.position.array.byteLength, 0);
  assert.deepEqual(geometry.getAttribute('position').array, before); assert.deepEqual(geometry.index!.array, indexBefore);
  const rebuilt = unpackBooleanMesh(transferred), originalMatrix = parent.matrixWorld.clone().invert().multiply(mesh.matrixWorld);
  assert.deepEqual(rebuilt.geometry.drawRange, geometry.drawRange);
  assert.deepEqual(rebuilt.geometry.getAttribute('uv1').array, geometry.getAttribute('uv1').array);
  assert.equal(Array.isArray(rebuilt.material), false, 'single material must keep ignoring BoxGeometry face group material indices');
  rebuilt.updateMatrixWorld(true);
  assert.ok(rebuilt.matrixWorld.elements.every((value, index) => Math.abs(value - originalMatrix.elements[index]) < 1e-8));
  const expected = geometry.clone().applyMatrix4(originalMatrix); expected.computeBoundingBox();
  const actual = new THREE.Box3().setFromObject(rebuilt);
  assert.ok(actual.min.distanceTo(expected.boundingBox!.min) < 1e-6 && actual.max.distanceTo(expected.boundingBox!.max) < 1e-6);
  expected.dispose(); disposeWorkshopModel(new THREE.Group().add(rebuilt)); disposeWorkshopModel(parent);
});

test('transported single-material cubes still produce a valid cut with authored face groups', () => {
  const source = new THREE.Group(), rebuilt = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()), tool = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, .5), new THREE.MeshStandardMaterial());
  tool.position.x = .5; source.add(base, tool);
  let result: THREE.Mesh | undefined;
  try {
    const left = unpackBooleanMesh(packBooleanMesh(base, 'base', source)), right = unpackBooleanMesh(packBooleanMesh(tool, 'tool', source));
    rebuilt.add(left, right);
    result = combineWorkshopMeshes(left, right, 'subtract');
    assert.ok((result.geometry.index?.count ?? result.geometry.getAttribute('position').count) > 0);
    assert.ok((Array.isArray(result.material) ? result.material : [result.material]).every(material => /^csg-input-(base|tool)-0$/.test(material.name)));
    assert.equal(source.children.length, 2); assert.equal(base.geometry.getAttribute('position').count, 24);
  } finally { disposeWorkshopModel(source); disposeWorkshopModel(rebuilt); if (result) disposeWorkshopModel(new THREE.Group().add(result)); }
});

test('worker completion and cancellation preserve source materials and terminate their workers', async t => {
  const previous = globalThis.Worker;
  const workers: FakeWorker[] = [];
  let mode: 'success' | 'error' | 'hang' = 'success';
  class FakeWorker {
    onmessage: ((event: MessageEvent<BooleanReply>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(request: BooleanRequest, transfers: ArrayBuffer[]) {
      const packet = structuredClone(request, { transfer: transfers });
      if (mode === 'hang') return;
      const reply: BooleanReply = mode === 'error' ? { error: 'Las piezas no se cruzan.' } : { geometry: packet.base.geometry, materials: packet.base.materials.map(value => value.name), position: [.2, .3, .4], name: 'Resultado' };
      queueMicrotask(() => { if (!this.terminated) this.onmessage?.({ data: reply } as MessageEvent<BooleanReply>); });
    }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = FakeWorker as unknown as typeof Worker;
  const texture = new THREE.DataTexture(new Uint8Array([0, 100, 200, 255]), 1, 1);
  const material = new THREE.MeshStandardMaterial({ color: '#abcdef', metalness: .8, roughness: .24, map: texture }); material.name = '3D Space:metal';
  const base = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material), tool = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, .5), new THREE.MeshStandardMaterial());
  const content = new THREE.Group(); content.add(base, tool);
  const originalGeometry = base.geometry, originalPositions = base.geometry.getAttribute('position').array.slice();
  try {
    await t.test('the result recovers the original authored texture and material properties', async () => {
      const operation = startWorkshopBoolean(base, tool, 'subtract'), result = await operation.promise;
      assert.notEqual(result.geometry, originalGeometry); assert.notEqual(result.material, material);
      assert.equal((result.material as THREE.MeshStandardMaterial).map, texture);
      assert.equal((result.material as THREE.MeshStandardMaterial).name, '3D Space:metal');
      assert.equal((result.material as THREE.MeshStandardMaterial).metalness, .8);
      assert.deepEqual(result.position.toArray(), [.2, .3, .4]); assert.equal(workers.at(-1)!.terminated, true);
      assert.deepEqual(base.geometry.getAttribute('position').array, originalPositions);
      disposeWorkshopModel(new THREE.Group().add(result));
    });
    await t.test('a failed boolean rejects once and leaves both source pieces intact', async () => {
      mode = 'error'; await assert.rejects(startWorkshopBoolean(base, tool, 'intersect').promise, /no se cruzan/);
      assert.equal(workers.at(-1)!.terminated, true); assert.equal(content.children.length, 2);
      assert.equal(base.geometry, originalGeometry); assert.deepEqual(base.geometry.getAttribute('position').array, originalPositions);
    });
    await t.test('cancel terminates a running worker and rejects the unfinished operation', async () => {
      mode = 'hang'; const operation = startWorkshopBoolean(base, tool, 'union'); operation.cancel();
      await assert.rejects(operation.promise, /canceló/); assert.equal(workers.at(-1)!.terminated, true);
      assert.equal(base.geometry.getAttribute('position').array.byteLength, originalPositions.byteLength);
    });
    await t.test('timeout terminates a worker without blocking the caller or consuming sources', async context => {
      context.mock.timers.enable({ apis: ['setTimeout'] });
      const operation = startWorkshopBoolean(base, tool, 'union');
      context.mock.timers.tick(20000);
      await assert.rejects(operation.promise, /tardó demasiado/); assert.equal(workers.at(-1)!.terminated, true);
      assert.equal(content.children.length, 2); context.mock.timers.reset();
    });
    await t.test('an invalid choice rejects before allocating any worker', async () => {
      const count = workers.length;
      await assert.rejects(startWorkshopBoolean(base, base, 'subtract').promise, /distintas/);
      assert.equal(workers.length, count);
    });
  } finally { globalThis.Worker = previous; disposeWorkshopModel(content); texture.dispose(); }
});
