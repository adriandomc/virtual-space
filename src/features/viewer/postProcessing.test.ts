import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createArchitecturalPostProcessing } from './postProcessing';

test('a failed architectural pass restores renderer output for fallback on desktop and mobile', () => {
  for (const clientWidth of [390, 1280]) {
    let target: THREE.RenderTarget | null = null;
    let clearColor = new THREE.Color('#123456');
    let fail = true, pixelRatioUpdates = 0;
    const failedTarget = new THREE.RenderTarget();
    const renderer = {
      domElement: { clientWidth }, toneMapping: THREE.AgXToneMapping, outputColorSpace: THREE.SRGBColorSpace,
      xr: { enabled: true }, autoClear: false,
      getRenderTarget: () => target, setRenderTarget: (next: THREE.RenderTarget | null) => { target = next; },
      getActiveCubeFace: () => 0, getActiveMipmapLevel: () => 0,
      getRenderObjectFunction: () => null, setRenderObjectFunction() {},
      getPixelRatio: () => 1, setPixelRatio() { pixelRatioUpdates++; }, getMRT: () => null, setMRT() {},
      getClearColor: (color: THREE.Color) => color.copy(clearColor), getClearAlpha: () => 0.5,
      setClearColor: (color: THREE.Color) => { clearColor = color.clone(); },
      getScissorTest: () => false, setScissorTest() {},
      render() { if (fail) { target = failedTarget; clearColor.set('#ffffff'); throw new Error('Unavailable GPU effect'); } },
    } as unknown as THREE.WebGPURenderer;
    const pipeline = createArchitecturalPostProcessing(renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
    assert.throws(() => pipeline.render(), /Unavailable GPU effect/);
    assert.equal(renderer.toneMapping, THREE.AgXToneMapping);
    assert.equal(renderer.outputColorSpace, THREE.SRGBColorSpace);
    assert.equal(renderer.xr.enabled, true);
    assert.equal(target, null);
    assert.equal(clearColor.getHexString(), '123456');
    fail = false;
    pipeline.render();
    assert.equal(pixelRatioUpdates, 1, 'successful frames must not reset the canvas after drawing');
    assert.doesNotThrow(() => { pipeline.dispose(); pipeline.dispose(); });
    failedTarget.dispose();
  }
});
