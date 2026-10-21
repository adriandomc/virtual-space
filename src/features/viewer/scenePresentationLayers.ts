import type * as THREE from 'three/webgpu';

type LayerState = { dirty: boolean; key?: string; watched: Set<THREE.Object3D> };
const states = new WeakMap<THREE.Object3D, LayerState>();

/** Descendant events invalidate late GLB children and rebuilt bundles without scanning every frame. */
function track(root: THREE.Object3D) {
  const state: LayerState = { dirty: true, watched: new Set() };
  const added = (event: THREE.Object3DEventMap['childadded']) => { state.dirty = true; watch(event.child); };
  const removed = (event: THREE.Object3DEventMap['childremoved']) => {
    state.dirty = true;
    event.child.traverse(object => {
      object.removeEventListener('childadded', added); object.removeEventListener('childremoved', removed); state.watched.delete(object);
    });
  };
  const watch = (subtree: THREE.Object3D) => subtree.traverse(object => {
    if (state.watched.has(object)) return;
    state.watched.add(object); object.addEventListener('childadded', added); object.addEventListener('childremoved', removed);
  });
  watch(root); states.set(root, state); return state;
}

export function applyPresentationLayers(root: THREE.Object3D, key: string, mask: (object: THREE.Object3D) => number) {
  const state = states.get(root) ?? track(root);
  if (!state.dirty && state.key === key) return false;
  root.traverse(object => { object.layers.mask = mask(object); });
  state.dirty = false; state.key = key;
  return true;
}
