import * as THREE from 'three/webgpu';
import { itemWorldPosition } from '../../domain/project/model';
import { projectLevel } from '../../domain/project/projectDocument';
import type { Room, Selection } from '../../domain/project/types';
import type { RoomSceneProps, SceneRuntime } from './sceneRuntime';

export const selectionKey = (selection: Selection) => selection.kind === 'wall' ? `wall:${selection.id ?? selection.index}` : 'id' in selection ? `${selection.kind}:${selection.id}` : selection.kind;

export const sameSelection = (a: Selection | null, b: Selection | null) => a != null && b != null && selectionKey(a) === selectionKey(b);

export const canMove = (selection: Selection | null) => selection != null && ['furniture', 'opening', 'light', 'stair'].includes(selection.kind);
export const canRotate = (selection: Selection | null) => selection?.kind === 'furniture' || selection?.kind === 'stair';

export function sceneItemPosition(props: RoomSceneProps, selection: Selection) {
  if (selection.kind === 'stair') {
    const stair = props.project?.stairs.find(item => item.id === selection.id);
    return stair ? { x: stair.x, y: projectLevel(props.project!, props.activeLevelId ?? stair.fromLevelId).elevation + .15, z: stair.z } : null;
  }
  const point = itemWorldPosition(props.room, selection);
  return point ? { ...point, y: point.y + (props.room.elevation ?? 0) } : null;
}

export const canInteract = (room: Room, selection: Selection | null) => selection?.kind === 'light' ? room.lights.some(light => light.id === selection.id) : selection?.kind === 'opening' && room.openings.some(opening => opening.id === selection.id && opening.type === 'door' && opening.doorStyle !== 'frame');

export function updateSelection(runtime: SceneRuntime, props: RoomSceneProps) {
  runtime.needsRender = true;
  const selection = props.selection;
  const key = selection ? selectionKey(selection) : null;
  const item = key && props.mode === 'orbit' ? runtime.objects.get(key) : null;
  if (runtime.selectionBox && (key !== runtime.outlinedKey || !item)) {
    runtime.selectionBox.removeFromParent();
    runtime.selectionBox.geometry.dispose();
    (runtime.selectionBox.material as THREE.Material).dispose();
    runtime.selectionBox = null;
  }
  if (item) {
    item.updateWorldMatrix(true, true);
    if (runtime.selectionBox) runtime.selectionBox.setFromObject(item);
    else runtime.selectionBox = new THREE.BoxHelper(item, '#b78436');
    (runtime.selectionBox.material as THREE.LineBasicMaterial).color.set(selection?.kind === 'furniture' && runtime.invalidFurniture.has(selection.id) ? '#d63f3f' : '#b78436');
    (runtime.selectionBox.material as THREE.Material).transparent = true;
    (runtime.selectionBox.material as THREE.Material).opacity = 0.8;
    (runtime.selectionBox.material as THREE.Material).depthTest = false;
    (runtime.selectionBox.material as THREE.Material).depthWrite = false;
    runtime.scene.add(runtime.selectionBox);
  }
  runtime.outlinedKey = key;
  runtime.walls.forEach(wall => {
    const selected = props.mode === 'orbit' && props.selection?.kind === 'wall' && wall.index === props.selection.index;
    wall.material.emissive.set(selected ? '#485443' : '#000000');
    wall.material.emissiveIntensity = selected ? 0.035 : 0;
    wall.opposite.emissive.copy(wall.material.emissive); wall.opposite.emissiveIntensity = wall.material.emissiveIntensity;
  });
  if (runtime.transform.dragging || runtime.directDragging) return;
  runtime.manipulating = null;
  const position = selection ? sceneItemPosition(props, selection) : null;
  const editable = canMove(selection) && (selection?.kind !== 'stair' || !!props.onProjectChange) && !props.readOnly && props.mode === 'orbit' && !runtime.viewTransition;
  if (!editable || !position) { runtime.transform.detach(); runtime.transform.enabled = false; return; }
  runtime.proxy.position.set(position.x, position.y, position.z);
  const furniture = selection?.kind === 'furniture' ? props.room.furniture.find(item => item.id === selection.id) : null;
  const stair = selection?.kind === 'stair' ? props.project?.stairs.find(item => item.id === selection.id) : null;
  runtime.proxy.rotation.set(0, THREE.MathUtils.degToRad(furniture?.rotation ?? stair?.rotation ?? 0), 0);
  const rotate = props.transformMode === 'rotate' && canRotate(selection);
  runtime.transform.setMode(rotate ? 'rotate' : 'translate');
  runtime.transform.setSpace('world');
  runtime.transform.showX = !rotate;
  runtime.transform.showZ = !rotate;
  runtime.transform.showY = rotate || selection?.kind === 'light' || selection?.kind === 'opening' && props.room.openings.find(item => item.id === selection.id)?.type === 'window';
  runtime.transform.setTranslationSnap(props.room.editing.snap ? props.room.editing.step : null);
  runtime.transform.setRotationSnap(props.room.editing.snap ? THREE.MathUtils.degToRad(15) : null);
  runtime.transform.enabled = true;
  runtime.transform.attach(runtime.proxy);
  if (import.meta.env.DEV) console.assert(runtime.proxy.parent === runtime.scene && Number.isFinite(runtime.proxy.position.length()), 'Invalid transform proxy');
}
