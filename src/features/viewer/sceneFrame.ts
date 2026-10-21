import type * as THREE from 'three/webgpu';

/** Detailed diagnostics are deliberately opt-in: traversing a scene is not a frame-time metric. */
export function sceneDiagnosticsEnabled(search = typeof location === 'undefined' ? '' : location.search) {
  return import.meta.env?.VITE_SCENE_DIAGNOSTICS === 'true' || new URLSearchParams(search).get('profile') === '1';
}

export function hasWalkInput(directions: ReadonlySet<string>, joystick: { x: number; z: number }) {
  return directions.size > 0 || Math.abs(joystick.x) > .001 || Math.abs(joystick.z) > .001;
}

export function applyDrawingBufferSize(renderer: Pick<THREE.WebGPURenderer, 'getSize' | 'getPixelRatio' | 'setPixelRatio' | 'setSize'>, size: THREE.Vector2, width: number, height: number, ratio: number) {
  renderer.getSize(size);
  width = Math.max(1, width); height = Math.max(1, height);
  if (size.x === width && size.y === height && renderer.getPixelRatio() === ratio) return false;
  renderer.setPixelRatio(ratio); renderer.setSize(width, height);
  return true;
}

/** Read GPU timing asynchronously and at most once per sample; unsupported backends stay on CPU/cadence. */
export class GpuFrameSampler {
  milliseconds: number | undefined;
  kind: 'webgpu-pass-set' | 'unavailable' = 'unavailable';
  private pending = false;
  private stopped = false;
  private nextSample = 0;
  configure(backend: { isWebGPUBackend?: boolean; trackTimestamp?: boolean }) {
    // r180's WebGL resolver sums every frame in a batch; it is not a per-frame duration.
    if (backend.isWebGPUBackend !== true) backend.trackTimestamp = false;
    this.kind = backend.isWebGPUBackend === true && backend.trackTimestamp === true ? 'webgpu-pass-set' : 'unavailable';
    this.milliseconds = undefined;
  }
  sample(renderer: Pick<THREE.WebGPURenderer, 'resolveTimestampsAsync'>, time: number) {
    if (this.kind === 'unavailable' || this.stopped || this.pending || time < this.nextSample) return;
    this.nextSample = time + 500; this.pending = true;
    void renderer.resolveTimestampsAsync('render').then(value => {
      if (!this.stopped && value !== undefined && Number.isFinite(value) && value > 0) this.milliseconds = value;
    }).catch(() => { this.stopped = true; this.milliseconds = undefined; this.kind = 'unavailable'; }).finally(() => { this.pending = false; });
  }
  dispose() { this.stopped = true; }
}

/** Bounded diagnostic samples count submitted main frames, rather than rAF or shadow passes. */
export class SceneFrameStatistics {
  renderedFrames = 0;
  private samples: { cpu: number; cadence: number; gpu?: number }[] = [];
  private cursor = 0;
  reset() { this.samples = []; this.cursor = 0; }
  record(cpu: number, cadence: number, gpu?: number) {
    this.renderedFrames++;
    this.samples[this.cursor] = { cpu, cadence, gpu };
    this.cursor = (this.cursor + 1) % 4096;
  }
  summary() {
    const distribution = (values: number[]) => {
      values = values.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
      return values.length ? { count: values.length, mean: values.reduce((sum, value) => sum + value, 0) / values.length, p50: values[Math.floor((values.length - 1) * .5)], p95: values[Math.ceil((values.length - 1) * .95)], max: values[values.length - 1] } : null;
    };
    return { samples: this.samples.length, cpu: distribution(this.samples.map(value => value.cpu)), cadence: distribution(this.samples.map(value => value.cadence)), gpu: distribution(this.samples.flatMap(value => value.gpu === undefined ? [] : [value.gpu])) };
  }
}
