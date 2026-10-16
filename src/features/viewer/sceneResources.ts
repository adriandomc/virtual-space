import * as THREE from 'three/webgpu';
import { disposeArchitecturalTextures } from './materials';
import type { SceneRuntime } from './sceneRuntime';

export function disposeArchitecture(runtime: SceneRuntime) {
  runtime.disposed = true;
  runtime.postProcessing?.dispose();
  runtime.architecturalEnvironment?.dispose();
  runtime.sky?.dispose();
  if (runtime.areaTextures) {
    for (const key of ['LTC_FLOAT_1', 'LTC_FLOAT_2', 'LTC_HALF_1', 'LTC_HALF_2'] as const) runtime.areaTextures[key].dispose();
  }
  disposeArchitecturalTextures();
}

export function disposeContent(group: THREE.Group) {
  const cleanups: (() => void)[] = [];
  group.traverse(object => { if (typeof object.userData.disposeCustomModel === 'function') cleanups.push(object.userData.disposeCustomModel); });
  cleanups.forEach(cleanup => cleanup());
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  group.traverse(object => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      geometries.add(object.geometry);
      (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
    }
    if (object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight) object.shadow.dispose();
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  group.clear();
}
