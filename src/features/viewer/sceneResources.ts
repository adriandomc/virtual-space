import * as THREE from 'three/webgpu';
import { disposeArchitecturalTextures } from './materials';
import type { SceneRuntime } from './sceneRuntime';
import { releaseScenePicking } from './scenePickingAcceleration';
import { hasArchitecturalTextureOwners } from './architecturalTextureLoader';
import { disposeArchitecturalAreaTextures } from './areaLightTextures';

export function disposeArchitecture(runtime: SceneRuntime) {
  runtime.disposed = true;
  runtime.postProcessing?.dispose();
  runtime.architecturalEnvironment?.dispose();
  runtime.sky?.dispose();
  runtime.areaTextures = null;
  if (!hasArchitecturalTextureOwners()) { disposeArchitecturalTextures(); disposeArchitecturalAreaTextures(); }
}

export function disposeContent(group: THREE.Group) {
  const cleanups: (() => void)[] = [];
  group.traverse(object => { if (typeof object.userData.disposeCustomModel === 'function') cleanups.push(object.userData.disposeCustomModel); });
  cleanups.forEach(cleanup => cleanup());
  releaseScenePicking(group);
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
