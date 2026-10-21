import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { applyDrawingBufferSize, GpuFrameSampler, hasWalkInput, SceneFrameStatistics, sceneDiagnosticsEnabled } from './sceneFrame';

test('changing resolution updates the drawing buffer immediately without rebuilding architecture', () => {
  let ratio = 1, width = 1000, height = 600, writes = 0;
  const renderer = { getSize: (v: THREE.Vector2) => v.set(width, height), getPixelRatio: () => ratio, setPixelRatio: (value: number) => { ratio = value; writes++; }, setSize: (w: number, h: number) => { width = w; height = h; } };
  const size = new THREE.Vector2();
  assert.equal(applyDrawingBufferSize(renderer, size, 1000, 600, .5), true);
  assert.deepEqual({ ratio, width, height, writes }, { ratio: .5, width: 1000, height: 600, writes: 1 });
  assert.equal(applyDrawingBufferSize(renderer, size, 1000, 600, .5), false);
  assert.equal(writes, 1);
});

test('idle walking and ordinary sessions do not enable scene diagnostics', () => {
  assert.equal(hasWalkInput(new Set(), { x: 0, z: 0 }), false);
  assert.equal(hasWalkInput(new Set(['forward']), { x: 0, z: 0 }), true);
  assert.equal(hasWalkInput(new Set(), { x: .1, z: 0 }), true);
  assert.equal(sceneDiagnosticsEnabled('?room=example'), false);
  assert.equal(sceneDiagnosticsEnabled('?profile=1'), true);
});

test('GPU timings never block frames and ignore results after disposal', async () => {
  let finish!: (value: number) => void, calls = 0;
  const renderer = { resolveTimestampsAsync: () => { calls++; return new Promise<number>(resolve => { finish = resolve; }); } };
  const sampler = new GpuFrameSampler();
  sampler.configure({ isWebGPUBackend: true, trackTimestamp: true });
  sampler.sample(renderer, 0); sampler.sample(renderer, 1000);
  assert.equal(calls, 1);
  finish(4); await new Promise(resolve => setImmediate(resolve));
  assert.equal(sampler.milliseconds, 4);
  sampler.sample(renderer, 1001); sampler.dispose(); finish(20);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sampler.milliseconds, 4);
});

test('WebGL batch timestamps never become per-frame GPU costs or allocate tracking queries', async () => {
  let calls = 0;
  const renderer = { resolveTimestampsAsync: async () => { calls++; return 60; } };
  const backend = { trackTimestamp: true }, sampler = new GpuFrameSampler();
  sampler.configure(backend);
  for (let time = 0; time < 3000; time += 16) sampler.sample(renderer, time);
  await Promise.resolve();
  assert.equal(backend.trackTimestamp, false); assert.equal(calls, 0);
  assert.equal(sampler.milliseconds, undefined); assert.equal(sampler.kind, 'unavailable');
  sampler.configure({ isWebGPUBackend: true, trackTimestamp: false });
  sampler.sample(renderer, 4000); assert.equal(calls, 0);
});

test('a failed GPU resolver removes its old measurement from adaptation', async () => {
  const sampler = new GpuFrameSampler(); sampler.configure({ isWebGPUBackend: true, trackTimestamp: true });
  sampler.sample({ resolveTimestampsAsync: async () => 8 }, 0);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(sampler.milliseconds, 8);
  sampler.sample({ resolveTimestampsAsync: async () => { throw new Error('Device lost'); } }, 1000);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(sampler.milliseconds, undefined); assert.equal(sampler.kind, 'unavailable');
});

test('diagnostic frame statistics are bounded and separate cadence, CPU and unavailable GPU timing', () => {
  const samples = new SceneFrameStatistics();
  samples.record(2, 0); samples.record(4, 16); samples.record(6, 32, 8);
  assert.equal(samples.renderedFrames, 3);
  assert.deepEqual(samples.summary(), { samples: 3, cpu: { count: 3, mean: 4, p50: 4, p95: 6, max: 6 }, cadence: { count: 2, mean: 24, p50: 16, p95: 32, max: 32 }, gpu: { count: 1, mean: 8, p50: 8, p95: 8, max: 8 } });
  for (let index = 0; index < 5000; index++) samples.record(3, 16);
  assert.equal(samples.summary().samples, 4096); assert.equal(samples.summary().gpu, null);
  samples.reset(); assert.equal(samples.summary().samples, 0); assert.equal(samples.renderedFrames, 5003);
});
