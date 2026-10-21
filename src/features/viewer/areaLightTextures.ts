import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';

let textures: ReturnType<typeof RectAreaLightTexturesLib.init> | undefined;

/** Three's init mutates static texture references; initialize once for all live renderer owners. */
export function architecturalAreaTextures() { return textures ??= RectAreaLightTexturesLib.init(); }

/** Call only after the final initialized viewer releases its shared graphics resources. */
export function disposeArchitecturalAreaTextures() {
  if (!textures) return;
  for (const key of ['LTC_FLOAT_1', 'LTC_FLOAT_2', 'LTC_HALF_1', 'LTC_HALF_2'] as const) textures[key].dispose();
  textures = undefined;
}
