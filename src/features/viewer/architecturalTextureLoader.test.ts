import { acquireGraphicsJob, graphicsJobUsage } from '../../shared/graphicsJobs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three/webgpu';
import { KTX2Loader, type KTX2LoaderWorkerConfig } from 'three/addons/loaders/KTX2Loader.js';
import { acquireArchitecturalTextureLoader, architecturalAssetPath, commonTextureSupport, hasArchitecturalTextureOwners, loadArchitecturalTexture } from './architecturalTextureLoader';

test('bundled compressed maps have complete mip chains, correct color transfer and verified local bytes', async () => {
  type Asset = { path: string; bytes: number; sha256: string; width: number; height: number; encoding: string; transfer: string };
  const manifest: { compressed: Record<string, Asset> }[] = JSON.parse(await readFile(new URL('../../../public/materials/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.length, 15);
  for (const entry of manifest) for (const [resolution, asset] of Object.entries(entry.compressed)) {
    const bytes = await readFile(new URL('../../../public' + asset.path, import.meta.url));
    assert.equal(bytes.length, asset.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
    assert.deepEqual([...bytes.subarray(0, 12)], [171, 75, 84, 88, 32, 50, 48, 187, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32LE(12), 0, 'Basis universal texture');
    assert.equal(bytes.readUInt32LE(20), asset.width); assert.equal(bytes.readUInt32LE(24), asset.height);
    assert.ok(Math.max(asset.width, asset.height) <= Number(resolution));
    assert.equal(asset.width % 4, 0); assert.equal(asset.height % 4, 0);
    assert.equal(bytes.readUInt32LE(40), Math.floor(Math.log2(Math.max(asset.width, asset.height))) + 1);
    const descriptor = bytes.readUInt32LE(48);
    assert.equal(bytes[descriptor + 14], asset.transfer === 'srgb' ? 2 : 1);
    assert.equal(bytes.readUInt32LE(44), asset.encoding === 'uastc' ? 2 : 1);
  }
  for (const file of ['basis_transcoder.js', 'basis_transcoder.wasm']) {
    assert.deepEqual(await readFile(new URL('../../../public/decoders/basis/' + file, import.meta.url)), await readFile(new URL('../../../node_modules/three/examples/jsm/libs/basis/' + file, import.meta.url)));
  }
  assert.equal(architecturalAssetPath('wood', 'normal', 2048, true), '/materials/ktx2/1024/wood/normal.ktx2');
  assert.equal(architecturalAssetPath('wood', 'color', 512, true), '/materials/ktx2/512/wood/color.ktx2');
});

test('simultaneous backends only select compression supported by all viewers', () => {
  const desktop: KTX2LoaderWorkerConfig = { astcSupported: false, astcHDRSupported: false, etc1Supported: false, etc2Supported: false, dxtSupported: true, bptcSupported: true, pvrtcSupported: false };
  const mobile = { ...desktop, astcSupported: true, dxtSupported: false, bptcSupported: false };
  assert.deepEqual(commonTextureSupport([desktop, desktop]), desktop);
  assert.ok(Object.values(commonTextureSupport([desktop, mobile])).every(value => !value));
  assert.ok(Object.values(commonTextureSupport([])).every(value => !value));
});

const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const fakeRenderer = (webgpu = false) => ({ backend: { isWebGPUBackend: webgpu }, hasFeature: (name: string) => name === 'texture-compression-bc' }) as unknown as THREE.WebGPURenderer;
const compressed = () => new THREE.CompressedTexture([{ data: new Uint8Array([1, 2, 3, 255]), width: 1, height: 1 }], 1, 1);
function browserFixture() {
  const document = Object.getOwnPropertyDescriptor(globalThis, 'document'), media = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  const original = { fetch: globalThis.fetch, init: KTX2Loader.prototype.init, parse: KTX2Loader.prototype.parse, dispose: KTX2Loader.prototype.dispose, imageLoad: THREE.TextureLoader.prototype.loadAsync, fallbackLoad: THREE.TextureLoader.prototype.load };
  const requests: string[] = [], loaders: KTX2Loader[] = [];
  let terminations = 0;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => ({ matches: false }) });
  globalThis.fetch = async input => { requests.push(String(input)); return new Response(new Uint8Array(8)); };
  KTX2Loader.prototype.init = function () {
    loaders.push(this);
    this.workerPool.workers.push({ terminate: () => terminations++ } as unknown as Worker);
    return this.transcoderPending = Promise.resolve();
  };
  // Fake init does not increment Three's module-global active count.
  KTX2Loader.prototype.dispose = function () { this.workerPool.dispose(); return this; };
  KTX2Loader.prototype.parse = function (_bytes, resolve) { resolve?.(compressed()); };
  THREE.TextureLoader.prototype.loadAsync = async () => new THREE.Texture({ width: 4, height: 2 } as HTMLImageElement);
  return {
    requests, loaders, get terminations() { return terminations; },
    restore() {
      globalThis.fetch = original.fetch; KTX2Loader.prototype.init = original.init; KTX2Loader.prototype.parse = original.parse; KTX2Loader.prototype.dispose = original.dispose;
      THREE.TextureLoader.prototype.loadAsync = original.imageLoad; THREE.TextureLoader.prototype.load = original.fallbackLoad;
      if (document) Object.defineProperty(globalThis, 'document', document); else Reflect.deleteProperty(globalThis, 'document');
      if (media) Object.defineProperty(globalThis, 'matchMedia', media); else Reflect.deleteProperty(globalThis, 'matchMedia');
    },
  };
}

test('transcoding preserves texture identity and late completion cannot revive a disposed map', async () => {
  const fixture = browserFixture(), pending: ((texture: THREE.CompressedTexture) => void)[] = [];
  KTX2Loader.prototype.parse = (_bytes, resolve) => { pending.push(resolve!); };
  const release = acquireArchitecturalTextureLoader(fakeRenderer());
  let ready = 0;
  const texture = loadArchitecturalTexture('wood', 'color', 512, () => ready++), id = texture.uuid;
  try {
    assert.equal((texture as THREE.DataTexture).isDataTexture, true, 'placeholder uses the uncompressed upload path');
    await tick(); assert.equal(pending.length, 1);
    pending.shift()!(compressed()); await tick();
    assert.equal(texture.uuid, id); assert.equal(ready, 1); assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
    assert.equal((texture as THREE.DataTexture).isDataTexture, true, 'Basis RGBA fallback uses data pixels');
    assert.equal((texture as THREE.CompressedTexture).isCompressedTexture, false);
    const mipmap = texture.mipmaps[0]; assert.ok('data' in mipmap); assert.equal(mipmap.data[0], 1);
    texture.dispose();
    const removed = loadArchitecturalTexture('wood', 'normal', 512, () => ready++);
    await tick(); removed.dispose();
    const result = compressed(); let disposed = false; result.addEventListener('dispose', () => { disposed = true; }); pending.shift()!(result);
    await tick(); assert.equal(ready, 1); assert.ok(disposed); assert.equal(fixture.terminations, 1);
  } finally { texture.dispose(); release(); await tick(); fixture.restore(); }
});

test('uncompressed backends release the last owner and unavailable decoder recovers the stable map through JPEG', async () => {
  const fixture = browserFixture();
  globalThis.fetch = async input => { fixture.requests.push(String(input)); return new Response(new Uint8Array(8), { status: String(input).endsWith('.wasm') ? 503 : 200 }); };
  let fallback = 0;
  THREE.TextureLoader.prototype.load = () => { fallback++; return new THREE.Texture(); };
  const renderer = { hasFeature: () => false } as unknown as THREE.WebGPURenderer;
  const releaseFirst = acquireArchitecturalTextureLoader(renderer), releaseSecond = acquireArchitecturalTextureLoader(renderer);
  const texture = loadArchitecturalTexture('wood', 'color', 512, () => {}), identity = texture.uuid;
  try {
    await tick();
    assert.equal(texture.uuid, identity); assert.equal((texture as THREE.CompressedTexture).isCompressedTexture, false);
    assert.equal(texture.image.width, 4); assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
    assert.ok(fixture.requests.includes('/materials/512/wood/color.jpg'));
    assert.equal(fixture.loaders.length, 0, 'failed decoder download never creates a worker');
    assert.equal(graphicsJobUsage().running, 0);
    releaseFirst(); assert.ok(hasArchitecturalTextureOwners());
    releaseSecond(); assert.equal(hasArchitecturalTextureOwners(), false);
    loadArchitecturalTexture('wood', 'color', 512, () => {}).dispose();
    assert.equal(fallback, 1, 'the empty all-false capability set must release the loader too');
  } finally { texture.dispose(); releaseFirst(); releaseSecond(); await tick(); fixture.restore(); }
});

test('WebGL DXT alone cannot select BC7 while WebGPU BC can', async () => {
  const fixture = browserFixture();
  try {
    for (const webgpu of [false, true]) {
      const release = acquireArchitecturalTextureLoader(fakeRenderer(webgpu)), texture = loadArchitecturalTexture('fabric', 'normal', 512, () => {});
      await tick(); texture.dispose(); release(); await tick();
    }
    const support = fixture.loaders.map(loader => loader.workerConfig);
    assert.equal(support.length, 2); assert.ok(support.every(config => config.dxtSupported));
    assert.equal(support[0].bptcSupported, false); assert.equal(support[1].bptcSupported, true);
  } finally { fixture.restore(); }
});

test('stalled download reserves no heavy-job slot and closing aborts it before a new viewer opens', async () => {
  const fixture = browserFixture(), previousFetch = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = async (input, options) => {
    if (!String(input).endsWith('.ktx2')) return previousFetch(input, options);
    return new Promise<Response>((_resolve, reject) => options!.signal!.addEventListener('abort', () => { aborted = true; reject(options!.signal!.reason); }, { once: true }));
  };
  const release = acquireArchitecturalTextureLoader(fakeRenderer()), texture = loadArchitecturalTexture('wood', 'color', 512, () => {});
  try {
    await tick(); assert.equal(graphicsJobUsage().running, 0);
    release(); await tick(); assert.ok(aborted);
    const csgRelease = await acquireGraphicsJob(); csgRelease();
    globalThis.fetch = previousFetch;
    const nextRelease = acquireArchitecturalTextureLoader(fakeRenderer());
    await tick(); assert.equal(texture.image.width, 1); assert.equal(texture.mipmaps.length, 1);
    nextRelease(); await tick(); assert.equal(graphicsJobUsage().running, 0);
  } finally { texture.dispose(); release(); await tick(); fixture.restore(); }
});

test('closing a stalled transcoder terminates workers and releases both shared slots for modelling and the next viewer', async () => {
  const fixture = browserFixture(), completedParse = KTX2Loader.prototype.parse;
  KTX2Loader.prototype.parse = () => {};
  const release = acquireArchitecturalTextureLoader(fakeRenderer());
  const first = loadArchitecturalTexture('wood', 'color', 512, () => {}), second = loadArchitecturalTexture('wood', 'normal', 512, () => {});
  try {
    await tick(); assert.equal(graphicsJobUsage().running, 2);
    const modelling = acquireGraphicsJob(); assert.equal(graphicsJobUsage().waiting, 1);
    release(); await tick(); assert.equal(fixture.terminations, 1);
    const releaseModelling = await modelling; assert.equal(graphicsJobUsage().running, 1); releaseModelling();
    KTX2Loader.prototype.parse = completedParse;
    const nextRelease = acquireArchitecturalTextureLoader(fakeRenderer()); await tick();
    assert.equal(first.mipmaps.length, 1); assert.equal(second.mipmaps.length, 1);
    assert.equal(graphicsJobUsage().running, 0); assert.equal(graphicsJobUsage().waiting, 0);
    nextRelease();
  } finally { first.dispose(); second.dispose(); release(); await tick(); fixture.restore(); }
});

test('a stalled decoder download times out, aborts the network request and falls back without occupying the shared budget', async context => {
  const fixture = browserFixture(), previousFetch = globalThis.fetch;
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let aborted = false;
  globalThis.fetch = async (input, options) => {
    if (!String(input).endsWith('.wasm')) return previousFetch(input, options);
    return new Promise<Response>((_resolve, reject) => options!.signal!.addEventListener('abort', () => { aborted = true; reject(options!.signal!.reason); }, { once: true }));
  };
  const release = acquireArchitecturalTextureLoader(fakeRenderer()), texture = loadArchitecturalTexture('wood', 'color', 512, () => {});
  try {
    await tick(); assert.equal(graphicsJobUsage().running, 0);
    context.mock.timers.tick(30_000); await tick();
    assert.ok(aborted); assert.equal(texture.image.width, 4); assert.equal(fixture.loaders.length, 0);
    const releaseModelling = await acquireGraphicsJob(); releaseModelling();
  } finally { texture.dispose(); release(); await tick(); context.mock.timers.reset(); fixture.restore(); }
});

test('transcoder timeout terminates the complete generation and all pending maps fall back without retaining slots', async context => {
  const fixture = browserFixture();
  const completedParse = KTX2Loader.prototype.parse;
  context.mock.timers.enable({ apis: ['setTimeout'] });
  KTX2Loader.prototype.parse = () => {};
  const release = acquireArchitecturalTextureLoader(fakeRenderer());
  const first = loadArchitecturalTexture('wood', 'color', 512, () => {}), second = loadArchitecturalTexture('wood', 'normal', 512, () => {});
  try {
    await tick(); assert.equal(graphicsJobUsage().running, 2);
    context.mock.timers.tick(20_000); await tick();
    assert.equal(fixture.terminations, 1); assert.equal(graphicsJobUsage().running, 0);
    assert.equal(first.image.width, 4); assert.equal(second.image.width, 4);
    KTX2Loader.prototype.parse = completedParse;
    const next = loadArchitecturalTexture('fabric', 'normal', 512, () => {});
    await tick();
    assert.equal(fixture.loaders.length, 2, 'a new request restarts a terminated pool without requiring renderer replacement');
    assert.equal(next.mipmaps.length, 1); assert.equal(first.mipmaps.length, 1); assert.equal(second.mipmaps.length, 1);
    next.dispose();
  } finally { first.dispose(); second.dispose(); release(); await tick(); context.mock.timers.reset(); fixture.restore(); }
});

test('late decoder initialization after close cannot create an orphan worker', async () => {
  const fixture = browserFixture();
  let complete!: () => void, retired!: KTX2Loader;
  KTX2Loader.prototype.init = function () { retired = this; return this.transcoderPending = new Promise<void>(resolve => { complete = resolve; }); };
  const release = acquireArchitecturalTextureLoader(fakeRenderer()), texture = loadArchitecturalTexture('wood', 'color', 512, () => {});
  try {
    await tick(); release(); await tick();
    let workers = 0;
    retired.workerPool.setWorkerCreator(() => { workers++; return {} as Worker; });
    complete(); await tick();
    await assert.rejects(retired.workerPool.postMessage({ type: 'transcode' }));
    assert.equal(workers, 0); assert.equal(graphicsJobUsage().running, 0);
  } finally { texture.dispose(); release(); await tick(); fixture.restore(); }
});
