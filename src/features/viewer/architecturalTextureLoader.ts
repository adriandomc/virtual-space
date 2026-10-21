import * as THREE from 'three/webgpu';
import { KTX2Loader, type KTX2LoaderWorkerConfig } from 'three/addons/loaders/KTX2Loader.js';
import { acquireGraphicsJob } from '../../shared/graphicsJobs';

export type ArchitecturalSurface = 'wood' | 'plaster' | 'stone' | 'marble' | 'fabric';
export type ArchitecturalMap = 'color' | 'normal' | 'arm';
type Record = { texture: THREE.Texture; path: string; fallback: string; color: boolean; ready: () => void; sequence: number; replacing: boolean; abort?: AbortController };
type Generation = { config: KTX2LoaderWorkerConfig; loader: KTX2Loader; abort: AbortController; ready?: Promise<void>; disposed: boolean; retired: boolean };
const owners = new Map<symbol, KTX2LoaderWorkerConfig>();
const textures = new Set<Record>();
let generation: Generation | undefined;
const downloadTimeout = 30_000, decodeTimeout = 20_000;

/** Three's worker pool does not reject tasks when disposed. Bound the caller as well as the worker. */
function bounded<T>(start: () => Promise<T>, signal: AbortSignal, milliseconds: number, interrupt?: () => void, discard?: (value: T) => void): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    let settled = false;
    const clear = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); };
    const fail = (reason: unknown) => { if (settled) return; settled = true; clear(); interrupt?.(); reject(reason); };
    const cancel = () => fail(signal.reason);
    const timer = setTimeout(() => fail(new Error('Architectural texture operation timed out.')), milliseconds);
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve().then(() => { if (settled) throw signal.reason; return start(); }).then(value => {
      if (settled) { discard?.(value); return; }
      settled = true; clear(); resolve(value);
    }, reason => { if (settled) return; settled = true; clear(); reject(reason); });
  });
}
function linkedAbort(...signals: AbortSignal[]) {
  const controller = new AbortController();
  const listeners = signals.map(signal => { const abort = () => controller.abort(signal.reason); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); return { signal, abort }; });
  return { controller, release: () => listeners.forEach(({ signal, abort }) => signal.removeEventListener('abort', abort)) };
}
async function download(path: string, signal: AbortSignal) {
  const request = linkedAbort(signal);
  try {
    return await bounded(async () => {
      const response = await fetch(path, { signal: request.controller.signal });
      if (!response.ok) throw new Error(`Architectural texture download failed: ${response.status}`);
      return response.arrayBuffer();
    }, request.controller.signal, downloadTimeout, () => request.controller.abort());
  } finally { request.release(); }
}
function stopDecoder(value: Generation) {
  value.abort.abort();
  value.loader.manager.abort();
  // r180 decrements its active count even if init never ran, and dispose is not idempotent.
  if (value.loader.transcoderPending && !value.disposed) { value.disposed = true; value.loader.dispose(); }
}
function initialize(value: Generation) {
  return value.ready ??= (async () => {
    const files = ['basis_transcoder.js', 'basis_transcoder.wasm'];
    const bytes = await Promise.all(files.map(file => download('/decoders/basis/' + file, value.abort.signal)));
    if (value.abort.signal.aborted) throw value.abort.signal.reason;
    // Download before reserving a heavy-job slot. Three now reads only these local blobs.
    const urls = bytes.map((buffer, index) => URL.createObjectURL(new Blob([buffer], { type: index ? 'application/wasm' : 'application/javascript' })));
    value.loader.manager.setURLModifier(url => urls[files.findIndex(file => url.endsWith(file))] ?? url);
    try {
      const initialized = value.loader.init();
      // init may finish after retirement and recreate its worker source URL. No worker can be
      // created after cancellation (postMessage is guarded), but that late URL still needs cleanup.
      void initialized.then(() => {
        if (value.abort.signal.aborted) { value.loader.workerPool.dispose(); URL.revokeObjectURL(value.loader.workerSourceURL); }
      }, () => {});
      await bounded(() => initialized, value.abort.signal, decodeTimeout, () => stopDecoder(value));
    }
    finally { urls.forEach(url => URL.revokeObjectURL(url)); }
  })().catch(cause => { stopDecoder(value); throw cause; });
}

export function architecturalAssetPath(surface: ArchitecturalSurface, map: ArchitecturalMap, maximum: number, compressed = false) {
  return compressed ? `/materials/ktx2/${maximum <= 512 ? 512 : 1024}/${surface}/${map}.ktx2` : `/materials/${maximum <= 512 ? '512/' : ''}${surface}/${map}.jpg`;
}
export function commonTextureSupport(values: KTX2LoaderWorkerConfig[]): KTX2LoaderWorkerConfig {
  const supports = (key: keyof KTX2LoaderWorkerConfig) => values.length > 0 && values.every(value => value[key]);
  return { astcSupported: supports('astcSupported'), astcHDRSupported: false, etc1Supported: supports('etc1Supported'), etc2Supported: supports('etc2Supported'), dxtSupported: supports('dxtSupported'), bptcSupported: supports('bptcSupported'), pvrtcSupported: supports('pvrtcSupported') };
}
function configuration(renderer: THREE.WebGPURenderer): KTX2LoaderWorkerConfig {
  const webgpu = Boolean((renderer.backend as { isWebGPUBackend?: boolean } | undefined)?.isWebGPUBackend);
  return { astcSupported: Boolean(renderer.hasFeature('texture-compression-astc')), astcHDRSupported: false, etc1Supported: Boolean(renderer.hasFeature('texture-compression-etc1') || renderer.hasFeature('texture-compression-etc2')), etc2Supported: Boolean(renderer.hasFeature('texture-compression-etc2')), dxtSupported: Boolean(renderer.hasFeature('texture-compression-bc')), bptcSupported: Boolean(renderer.hasFeature('texture-compression-bptc') || webgpu && renderer.hasFeature('texture-compression-bc')), pvrtcSupported: Boolean(renderer.hasFeature('texture-compression-pvrtc')) };
}
function retire(value: Generation) {
  value.retired = true;
  stopDecoder(value);
  for (const record of textures) record.abort?.abort();
}
function configure() {
  if (!owners.size) { if (generation) retire(generation); generation = undefined; return; }
  const config = commonTextureSupport([...owners.values()]);
  if (generation && !generation.abort.signal.aborted && JSON.stringify(generation.config) === JSON.stringify(config)) return;
  if (generation) retire(generation);
  const loader = new KTX2Loader(new THREE.LoadingManager()).setTranscoderPath('/decoders/basis/').setWorkerLimit(matchMedia('(pointer: coarse)').matches ? 1 : 2);
  loader.workerConfig = config;
  const next: Generation = { config, retired: false, disposed: false, abort: new AbortController(), loader };
  const postMessage = loader.workerPool.postMessage.bind(loader.workerPool);
  loader.workerPool.postMessage = (...args) => next.abort.signal.aborted ? Promise.reject(next.abort.signal.reason) : postMessage(...args);
  generation = next;
  // Shared maps must work with every live backend, including simultaneous WebGL/WebGPU viewers.
  for (const record of textures) load(record, next);
}

/** Acquire after renderer.init(); release on every initialization/disposal exit. */
export function acquireArchitecturalTextureLoader(renderer: THREE.WebGPURenderer) {
  const id = Symbol(); owners.set(id, configuration(renderer)); configure();
  let released = false;
  return () => { if (released) return; released = true; owners.delete(id); configure(); };
}
/** Shared material maps remain alive until the last initialized viewer releases its loader. */
export function hasArchitecturalTextureOwners() { return owners.size > 0; }
function replace(record: Record, loaded: THREE.Texture) {
  // r180 returns a CompressedTexture even when Basis falls back to RGBA pixels. WebGPU's
  // compressed upload path accepts only actual block formats, so route those pixels as data.
  if (loaded instanceof THREE.CompressedTexture && Number(loaded.format) === THREE.RGBAFormat) {
    const first = loaded.mipmaps[0] as { data: Uint8Array; width: number; height: number };
    const pixels = new THREE.DataTexture(); pixels.copy(loaded);
    pixels.image = { data: first.data, width: first.width, height: first.height };
    loaded.dispose(); loaded = pixels;
  }
  record.replacing = true; record.texture.dispose(); record.replacing = false;
  const { wrapS, wrapT, anisotropy } = record.texture;
  record.texture.copy(loaded);
  // A failed transcoder may recover through the original JPEG without changing material/node references.
  Object.assign(record.texture, { isCompressedTexture: loaded instanceof THREE.CompressedTexture, isDataTexture: !!(loaded as THREE.DataTexture).isDataTexture });
  record.texture.name = record.path;
  record.texture.wrapS = wrapS; record.texture.wrapT = wrapT; record.texture.anisotropy = anisotropy;
  record.texture.colorSpace = record.color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  record.texture.needsUpdate = true;
  loaded.dispose(); record.ready();
}
function load(record: Record, current: Generation) {
  record.abort?.abort();
  const abort = new AbortController(); record.abort = abort;
  const sequence = ++record.sequence;
  const valid = () => textures.has(record) && record.sequence === sequence && !current.retired;
  void (async () => {
    const pipeline = linkedAbort(abort.signal, current.abort.signal);
    try {
      const [buffer] = await Promise.all([download(record.path, pipeline.controller.signal), initialize(current)]);
      const release = await acquireGraphicsJob(pipeline.controller.signal);
      let loaded: THREE.Texture;
      try {
        if (!valid()) return;
        loaded = await bounded(() => new Promise<THREE.Texture>((resolve, reject) => current.loader.parse(buffer, resolve, reject)), pipeline.controller.signal, decodeTimeout,
          () => stopDecoder(current), texture => texture.dispose());
      }
      finally { release(); }
      if (valid()) replace(record, loaded); else loaded.dispose();
    } catch {
      if (!valid()) return;
      try {
        const bytes = await download(record.fallback, abort.signal);
        const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
        try {
          const loaded = await bounded(() => new THREE.TextureLoader().loadAsync(url), abort.signal, decodeTimeout, undefined, texture => texture.dispose());
          if (valid()) replace(record, loaded); else loaded.dispose();
        } finally { URL.revokeObjectURL(url); }
      } catch (cause) { if (valid()) console.warn('Architectural texture unavailable:', record.path, cause); }
    } finally { pipeline.release(); }
  })().catch(cause => { if (valid()) console.warn('Architectural texture loader:', cause); });
}

/** Stable texture identity lets TSL nodes receive compressed pixels without rebuilding materials. */
export function loadArchitecturalTexture(surface: ArchitecturalSurface, map: ArchitecturalMap, maximum: number, ready: () => void): THREE.Texture {
  const fallback = architecturalAssetPath(surface, map, maximum);
  if (typeof document === 'undefined') { const texture = new THREE.Texture(); texture.name = fallback; return texture; }
  // A failed/cancelled shared pool is retried on demand, never in an automatic retry loop.
  if (generation?.abort.signal.aborted && !generation.retired) configure();
  if (!generation) { const texture = new THREE.TextureLoader().load(fallback, ready); texture.name = fallback; return texture; }
  const path = architecturalAssetPath(surface, map, maximum, true);
  const pixels = new Uint8Array(map === 'normal' ? [128, 128, 255, 255] : [255, 255, 255, 255]);
  const texture = new THREE.DataTexture(pixels, 1, 1);
  texture.name = path; texture.colorSpace = map === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.minFilter = THREE.LinearFilter; texture.needsUpdate = true;
  const record: Record = { texture, path, fallback, color: map === 'color', ready, sequence: 0, replacing: false };
  textures.add(record);
  texture.addEventListener('dispose', () => { if (!record.replacing) { textures.delete(record); record.sequence++; record.abort?.abort(); } });
  load(record, generation);
  return texture;
}
