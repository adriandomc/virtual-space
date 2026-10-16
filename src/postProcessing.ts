import * as THREE from 'three/webgpu';
import { mix, pass, vec4 } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { denoise } from 'three/addons/tsl/display/DenoiseNode.js';

export function createArchitecturalPostProcessing(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, detail: 'low' | 'medium' | 'high' = 'high') {
  const small = renderer.domElement.clientWidth <= 700 || typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  const scenePass = pass(scene, camera, { samples: 0 });
  const depth = scenePass.getTextureNode('depth');
  // Three r180 reconstructs normals from depth when null; its type declaration omits this supported case.
  const normals = null as unknown as THREE.Node;
  const occlusion = ao(depth, normals, camera);
  occlusion.resolutionScale = detail === 'low' ? 0.25 : 0.5;
  occlusion.samples.value = small || detail !== 'high' ? 8 : 16;
  occlusion.radius.value = 0.32;
  occlusion.thickness.value = 0.12;
  occlusion.distanceFallOff.value = 0.7;
  const filtered = denoise(occlusion.getTextureNode(), depth, normals, camera);
  filtered.radius.value = 3;
  const beauty = scenePass.getTextureNode('output');
  const processing = new THREE.PostProcessing(renderer);
  processing.outputNode = vec4(beauty.rgb.mul(mix(1, filtered.r, 0.72)), beauty.a);
  let disposed = false;
  let state: ReturnType<typeof THREE.RendererUtils.saveRendererState> | undefined;
  return {
    render() {
      state = THREE.RendererUtils.saveRendererState(renderer, state);
      const xrEnabled = renderer.xr.enabled;
      try { processing.render(); }
      catch (cause) { THREE.RendererUtils.restoreRendererState(renderer, state); throw cause; }
      finally { renderer.xr.enabled = xrEnabled; }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      processing.dispose(); scenePass.dispose(); occlusion.dispose(); filtered.dispose();
      // The addon owns noise textures but does not dispose them in r180.
      (occlusion as unknown as { _noiseNode: { value: THREE.Texture } })._noiseNode.value.dispose();
      (filtered.noiseNode as THREE.TextureNode).value.dispose();
    },
  };
}
