import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { polygonArea } from '../../domain/project/model';
import { daylightFactor, daylightOpeningArea } from './navigation';
import type { Room, ViewMode } from '../../domain/project/types';
import type { SceneRuntime } from './sceneRuntime';

export function updateEnvironment(runtime: SceneRuntime, room: Room, mode: ViewMode) {
  runtime.needsRender = true;
  const architectural = room.renderQuality === 'hyperrealistic';
  const detailed = room.renderQuality !== 'standard' || room.furniture.some(item => item.material === 'metal');
  const day = room.sun.enabled ? Math.max(0, Math.sin((room.sun.hour - 6) / 12 * Math.PI)) : 0;
  const bounce = daylightFactor(day, daylightOpeningArea(room), polygonArea(room.vertices));
  const lampLumens = room.lights.filter(light => light.enabled).reduce((sum, light) => sum + light.lumens, 0);
  if (!runtime.previewFill) { runtime.previewFill = new THREE.HemisphereLight('#ffffff', '#b5bcab', 0); runtime.previewFill.name = 'editor-preview-fill'; runtime.scene.add(runtime.previewFill); }
  runtime.previewFill.intensity = mode === 'orbit' ? architectural ? .5 : .75 : 0;
  runtime.scene.environment = architectural ? runtime.architecturalEnvironment?.texture ?? runtime.environment?.texture ?? null : detailed ? runtime.environment?.texture ?? null : null;
  runtime.scene.environmentIntensity = architectural ? bounce * room.sun.intensity / 3 * 0.18 + Math.min(0.14, lampLumens / 40000) : detailed ? Math.min(0.25, bounce * 0.18 + lampLumens / 20000) : 0;
  runtime.scene.environmentRotation.y = architectural ? THREE.MathUtils.degToRad(room.sun.azimuth) : 0;
  runtime.scene.background = architectural && mode === 'walk' && runtime.sky ? runtime.sky : new THREE.Color(architectural ? mode === 'walk' ? '#070b14' : '#e6e2d9' : '#e9ece4');
  runtime.scene.backgroundIntensity = architectural ? day * room.sun.intensity / 3 : 1;
  runtime.scene.backgroundRotation.y = runtime.scene.environmentRotation.y;
  if (architectural && !runtime.loadingSky && !runtime.sky) {
    runtime.loadingSky = true;
    void new HDRLoader().loadAsync('/environments/sunset-fairway-1k.hdr').then(async texture => {
      if (runtime.disposed) { texture.dispose(); return; }
      texture.mapping = THREE.EquirectangularReflectionMapping;
      const generator = new THREE.PMREMGenerator(runtime.renderer);
      try {
        // r180 implements this method, but its companion type declarations omit it.
        const environment = await (generator as THREE.PMREMGenerator & { fromEquirectangularAsync(texture: THREE.Texture): Promise<THREE.RenderTarget> }).fromEquirectangularAsync(texture);
        if (runtime.disposed) { environment.dispose(); texture.dispose(); return; }
        runtime.architecturalEnvironment = environment;
        runtime.sky = texture;
        if (runtime.builtRoom) updateEnvironment(runtime, runtime.builtRoom, runtime.viewMode);
      } catch (cause) { texture.dispose(); console.warn('Architectural environment:', cause); }
      finally { generator.dispose(); }
    }).catch(cause => { if (!runtime.disposed) console.warn('Architectural environment:', cause); });
  }
}

export function kelvinColor(kelvin: number) {
  const t = Math.max(1000, Math.min(12000, kelvin)) / 100;
  const r = t <= 66 ? 255 : 329.6987 * (t - 60) ** -0.1332;
  const g = t <= 66 ? 99.4708 * Math.log(t) - 161.1196 : 288.1222 * (t - 60) ** -0.0755;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177 * Math.log(t - 10) - 305.0448;
  return new THREE.Color().setRGB(...[r, g, b].map(channel => Math.min(255, Math.max(0, channel)) / 255) as [number, number, number], THREE.SRGBColorSpace);
}
