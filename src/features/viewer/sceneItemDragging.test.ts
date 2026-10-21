import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createDefaultRoom } from '../../domain/project/model';
import { GestureCheckpoints, SceneItemDrag } from './sceneItemDragging';
import { stableStringify } from '../../shared/sameData';

test('light previews move the object without changing the source room and cancellation restores its transform', () => {
  const room = createDefaultRoom(), light = room.lights[0], object = new THREE.Group();
  object.position.set(light.x, light.y, light.z);
  const drag = new SceneItemDrag(room, { kind: 'light', id: light.id }, object);
  const next = drag.preview(room, { x: .4, y: 2, z: .3, rotation: 0 });
  assert.equal(room.lights[0].x, 0); assert.equal(next.lights[0].x, .4);
  assert.equal(object.position.x, .4);
  assert.deepEqual(drag.apply(room).lights, next.lights);
  drag.dispose(); assert.deepEqual(object.position.toArray(), [light.x, light.y, light.z]);
});

test('a remote change to the moving object cancels its draft but unrelated colors are preserved', () => {
  const room = createDefaultRoom(), light = room.lights[0], object = new THREE.Group();
  const drag = new SceneItemDrag(room, { kind: 'light', id: light.id }, object);
  drag.preview(room, { x: .2, y: 2, z: .1, rotation: 0 });
  const painted = { ...room, floorColor: '#123456' };
  assert.equal(drag.apply(painted).floorColor, '#123456');
  assert.equal(drag.compatible(JSON.parse(stableStringify(painted))), true);
  const remote = { ...room, lights: room.lights.map(item => ({ ...item, x: 1 })) };
  assert.equal(drag.compatible(remote), false);
  assert.throws(() => drag.apply(remote), /canceló/);
});

test('durable drag checkpoints coalesce and cancellation clears after an in-flight write', async () => {
  const room = createDefaultRoom(), calls: (typeof room | null)[] = [];
  let finish!: () => void;
  const checkpoints = new GestureCheckpoints(value => { calls.push(value); return value ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(); }, cause => { throw cause; });
  checkpoints.queue(room); checkpoints.tick(500); await Promise.resolve();
  checkpoints.queue({ ...room, name: 'latest' }); checkpoints.tick(1000);
  assert.equal(calls.length, 1);
  checkpoints.stop(true); finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [room, null]);
  checkpoints.tick(2000); assert.equal(calls.length, 2);
});

test('finishing a gesture prevents an unsent checkpoint microtask from overtaking the final commit', async () => {
  const calls: unknown[] = [], checkpoints = new GestureCheckpoints(async value => { calls.push(value); }, cause => { throw cause; });
  checkpoints.queue(createDefaultRoom()); checkpoints.tick(500); checkpoints.stop();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, []);
});
