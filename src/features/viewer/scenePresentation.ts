import * as THREE from 'three/webgpu';
import { pointInPolygon } from '../../domain/project/model';
import { ceilingFinishTargets } from '../../domain/project/projectDocument';
import { presentedLevelIds } from './sceneProjection';
import type { RoomSceneProps, SceneRuntime } from './sceneRuntime';
import { selectionKey } from './sceneSelection';
import { applyPresentationLayers } from './scenePresentationLayers';

export function updatePresentation(runtime: SceneRuntime, props: RoomSceneProps, delta: number) {
  let animating = false;
  const presentation = props.presentation ?? { walls: 'cut', roofs: false, levels: 'active' };
  const visible = runtime.project ? presentedLevelIds(runtime.project, runtime.activeLevelId ?? runtime.project.activeLevelId, props.mode === 'walk' ? 'all' : presentation.levels) : null;
  const views = runtime.levelViews ? [...runtime.levelViews.values()].map(view => view.runtime) : [runtime];
  const ceilingTargets = runtime.project ? ceilingFinishTargets(runtime.project, runtime.activeLevelId ?? runtime.project.activeLevelId) : [];
  const coveringSlabs = new Set(ceilingTargets.filter(target => target.kind === 'surface' && target.side === 'undersideFinish').map(target => target.id));
  const selectedRoofCeiling = props.selection?.kind === 'ceiling' ? ceilingTargets.find(target => target.kind === 'roof' && (!props.selection?.id || props.selection.id === target.id))?.id : undefined;
  const position = new THREE.Vector3();
  for (const view of views) {
    const room = view.builtRoom!;
    view.viewMode = props.mode;
    const isActive = !runtime.project || room.levelId === runtime.activeLevelId;
    const show = visible === null || visible.has(room.levelId!);
    const elevation = room.elevation ?? 0;
    const inside = !!runtime.viewTransition && runtime.camera.position.y < elevation + room.height - .03 && runtime.camera.position.y > elevation && pointInPolygon(runtime.camera.position, room.vertices);
    const enclosed = runtime.viewTransition ? inside : props.mode === 'walk';
    if (runtime.levelViews) applyPresentationLayers(view.content, String(show), object => {
      object.userData.baseLayerMask ??= object.layers.mask;
      return show ? object.userData.baseLayerMask : 2;
    });
    for (const wall of view.walls) wall.group.visible = enclosed || isActive && props.selection?.kind === 'wall' && (props.selection.id ? props.selection.id === wall.group.userData.selection.id : props.selection.index === wall.index) || presentation.walls === 'full' || presentation.walls === 'cut' && (runtime.camera.position.x - wall.midpoint.x) * wall.inward.x + (runtime.camera.position.z - wall.midpoint.z) * wall.inward.z > -.03;
    for (const [key, item] of view.objects) {
      if (key.startsWith('floor:')) {
        // Slab ceilings override the normal level mask. Reset only these meshes each frame,
        // including when an unchanged slab no longer covers the current room.
        item.layers.mask = show ? item.userData.baseLayerMask ?? 1 : 2;
        if (coveringSlabs.has(item.userData.slabSurfaceId) && !show) item.layers.set(enclosed || presentation.roofs || props.selection?.kind === 'ceiling' && props.selection.id === item.userData.slabSurfaceId ? 0 : 1);
      }
      if (key.startsWith('opening:')) item.visible = enclosed || isActive && props.selection?.kind === 'opening' && key === selectionKey(props.selection) || view.walls[item.userData.wall]?.group.visible === true;
      if (key.startsWith('furniture:')) item.visible = props.mode !== 'walk' || item.getWorldPosition(position).distanceTo(runtime.camera.position) <= runtime.graphics.distance;
      const overlay = item.userData.placementOverlay as THREE.Mesh | undefined;
      if (overlay) overlay.visible = props.mode === 'orbit' && view.invalidFurniture.has(key.slice('furniture:'.length));
    }
    for (const ceiling of view.ceilings ?? (view.ceiling ? [view.ceiling] : [])) {
      const selected = isActive && props.selection?.kind === 'ceiling' && (!props.selection.id || props.selection.id === ceiling.userData.selection.id);
      if (runtime.animateView) {
        const target = show && (enclosed || selected || presentation.roofs) ? 1 : 0, material = ceiling.material as THREE.Material;
        const opacity = THREE.MathUtils.damp(material.opacity, target, 14, delta);
        material.opacity = Math.abs(opacity - target) < .002 ? target : opacity;
        if (material.opacity !== target) animating = true;
        ceiling.layers.set(material.opacity > 0 ? 0 : 1);
      }
      else ceiling.layers.set(show && (enclosed || selected || presentation.roofs) ? 0 : 1);
    }
  }
  for (const object of runtime.projectExtras?.children ?? []) {
    const belongs = visible === null || (object.userData.levelIds as string[]).some(id => visible.has(id));
    const isRoof = object.userData.selection?.kind === 'roof';
    const show = belongs && (!isRoof || props.mode === 'walk' || presentation.roofs || selectedRoofCeiling === object.userData.selection?.id || props.selection?.kind === 'roof' && props.selection.id === object.userData.selection.id);
    applyPresentationLayers(object, String(show), () => show ? 1 : 2);
  }
  for (const object of runtime.projectLighting?.children ?? runtime.content.children) if (object.userData.exterior) object.layers.set(props.mode === 'walk' ? 1 : 0);
  return animating;
}
