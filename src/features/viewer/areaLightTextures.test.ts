import assert from 'node:assert/strict';
import test from 'node:test';
import type * as THREE from 'three/webgpu';
import { architecturalAreaTextures, disposeArchitecturalAreaTextures } from './areaLightTextures';
import { acquireArchitecturalTextureLoader } from './architecturalTextureLoader';
import { disposeArchitecture } from './sceneResources';
import type { SceneRuntime } from './sceneRuntime';

test('area-light maps are shared until the last renderer is released, then recreated once', async () => {
  const media = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
  Object.defineProperty(globalThis, 'matchMedia', { configurable: true, value: () => ({ matches: false }) });
  const renderer = { hasFeature: () => false } as unknown as THREE.WebGPURenderer;
  const first = acquireArchitecturalTextureLoader(renderer), second = acquireArchitecturalTextureLoader(renderer);
  const maps = architecturalAreaTextures(), original = maps.LTC_HALF_1;
  const values = [maps.LTC_FLOAT_1, maps.LTC_FLOAT_2, maps.LTC_HALF_1, maps.LTC_HALF_2];
  let disposed = 0; values.forEach(texture => texture.addEventListener('dispose', () => disposed++));
  try {
    assert.equal(architecturalAreaTextures().LTC_HALF_1, original);
    first(); disposeArchitecture({ areaTextures: maps } as SceneRuntime); assert.equal(disposed, 0);
    second(); disposeArchitecture({ areaTextures: maps } as SceneRuntime); assert.equal(disposed, 4);
    assert.notEqual(architecturalAreaTextures().LTC_HALF_1, original);
  } finally {
    first(); second(); disposeArchitecturalAreaTextures(); await new Promise(resolve => setImmediate(resolve));
    if (media) Object.defineProperty(globalThis, 'matchMedia', media); else Reflect.deleteProperty(globalThis, 'matchMedia');
  }
});
