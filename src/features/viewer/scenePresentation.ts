import * as THREE from 'three/webgpu';
import { pointInPolygon } from '../../domain/project/model';
import { ceilingFinishTargets } from '../../domain/project/projectDocument';
import { presentedLevelIds } from './sceneProjection';
import type { RoomSceneProps, SceneRuntime } from './sceneRuntime';
import { selectionKey } from './sceneSelection';

export function updatePresentation(runtime: SceneRuntime, props: RoomSceneProps, delta: number) {
  const presentation = props.presentation ?? { walls: 'cut', roofs: false, levels: 'active' };
  const visible = runtime.project ? presentedLevelIds(runtime.project, runtime.activeLevelId ?? runtime.project.activeLevelId, props.mode === 'walk' ? 'all' : presentation.levels) : null;
  const views = runtime.levelViews ? [...runtime.levelViews.values()].map(view => view.runtime) : [runtime];
  const coveringSlabs = new Set(runtime.project ? ceilingFinishTargets(runtime.project, runtime.activeLevelId ?? runtime.project.activeLevelId).filter(target => target.kind === 'surface' && target.side === 'undersideFinish').map(target => target.id) : []);
  const position = new THREE.Vector3();
  for (const view of views) {
    const room = view.builtRoom!;
    view.viewMode = props.mode;
    const isActive = !runtime.project || room.levelId === runtime.activeLevelId;
    const show = visible === null || visible.has(room.levelId!);
    const elevation = room.elevation ?? 0;
    const inside = !!runtime.viewTransition && runtime.camera.position.y < elevation + room.height - .03 && runtime.camera.position.y > elevation && pointInPolygon(runtime.camera.position, room.vertices);
    const enclosed = runtime.viewTransition ? inside : props.mode === 'walk';
    if (runtime.levelViews) view.content.traverse(object => { object.layers.mask = show ? object.userData.baseLayerMask ?? 1 : 2; });
    for (const wall of view.walls) wall.group.visible = enclosed || isActive && props.selection?.kind === 'wall' && (props.selection.id ? props.selection.id === wall.group.userData.selection.id : props.selection.index === wall.index) || presentation.walls === 'full' || presentation.walls === 'cut' && (runtime.camera.position.x - wall.midpoint.x) * wall.inward.x + (runtime.camera.position.z - wall.midpoint.z) * wall.inward.z > -.03;
    for (const [key, item] of view.objects) {
      if (key.startsWith('floor:') && coveringSlabs.has(item.userData.slabSurfaceId) && !show) item.layers.set(enclosed || presentation.roofs || props.selection?.kind === 'ceiling' && props.selection.id === item.userData.slabSurfaceId ? 0 : 1);
      if (key.startsWith('opening:')) item.visible = enclosed || isActive && props.selection?.kind === 'opening' && key === selectionKey(props.selection) || view.walls[item.userData.wall]?.group.visible === true;
      if (key.startsWith('furniture:')) item.visible = props.mode !== 'walk' || item.getWorldPosition(position).distanceTo(runtime.camera.position) <= runtime.graphics.distance;
      const overlay = item.userData.placementOverlay as THREE.Mesh | undefined;
      if (overlay) overlay.visible = props.mode === 'orbit' && view.invalidFurniture.has(key.slice('furniture:'.length));
    }
    for (const ceiling of view.ceilings ?? (view.ceiling ? [view.ceiling] : [])) {
      const selected = isActive && props.selection?.kind === 'ceiling' && (!props.selection.id || props.selection.id === ceiling.userData.selection.id);
      if (runtime.animateView) { const target = show && (enclosed || selected) ? 1 : 0; runtime.ceilingOpacity = THREE.MathUtils.damp(runtime.ceilingOpacity, target, 14, delta); if (Math.abs(runtime.ceilingOpacity - target) < .002) runtime.ceilingOpacity = target; (ceiling.material as THREE.Material).opacity = runtime.ceilingOpacity; ceiling.layers.set(runtime.ceilingOpacity > 0 ? 0 : 1); }
      else ceiling.layers.set(show && (enclosed || selected || presentation.roofs) ? 0 : 1);
    }
  }
  for (const object of runtime.projectExtras?.children ?? []) {
    const belongs = visible === null || (object.userData.levelIds as string[]).some(id => visible.has(id));
    const isRoof = object.userData.selection?.kind === 'roof';
    const show = belongs && (!isRoof || props.mode === 'walk' || presentation.roofs || props.selection?.kind === 'roof' && props.selection.id === object.userData.selection.id);
    object.traverse(child => child.layers.set(show ? 0 : 1));
  }
  for (const object of runtime.projectLighting?.children ?? runtime.content.children) if (object.userData.exterior) object.layers.set(props.mode === 'walk' ? 1 : 0);
}
