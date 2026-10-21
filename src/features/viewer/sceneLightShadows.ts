import type * as THREE from 'three/webgpu';

/** Keep renderer-owned shadow targets alive while their light identity is in use. */
export function configurePointLightShadow(light: THREE.PointLight, castsShadow: boolean, size: number): THREE.PointLight {
  let next = light;
  if (light.castShadow !== castsShadow && light.parent) {
    // Three r180 shares analytic light nodes between materials. Mutating castShadow
    // can dispose a ShadowNode still referenced by another material's update list.
    // A new light UUID rebuilds those bindings without changing the authored fixture.
    const parent = light.parent;
    next = light.clone();
    next.castShadow = castsShadow;
    parent.remove(light); parent.add(next);
    light.dispose();
  } else next.castShadow = castsShadow;
  if (next !== light || next.shadow.mapSize.x !== size || next.shadow.mapSize.y !== size) {
    next.shadow.mapSize.set(size, size);
    next.shadow.needsUpdate = true;
  }
  // ShadowNode/PointShadowNode resize their existing render targets from mapSize.
  // Disposing or nulling the map here would leave cached texture bindings stale.
  return next;
}
