import * as THREE from 'three/webgpu';
import { bounds, furnitureCorners, interiorPoint, interiorWalkPoint } from '../../domain/project/model';
import { createCameraTransition, sampleCameraTransition } from './cameraTransition';
import type { CameraPose } from './cameraTransition';
import type { Room, ViewMode } from '../../domain/project/types';
import { architecturalViewBounds } from './sceneProjection';
import type { SceneRuntime } from './sceneRuntime';
import { updateEnvironment } from './sceneEnvironment';
import { updateFurniturePlacement } from './sceneItems';

function sceneBounds(room: Room) {
  return bounds([...room.vertices, ...room.furniture.flatMap(furnitureCorners), ...room.lights]);
}

export function fitOrbitCamera(runtime: SceneRuntime, room: Room, preserveZoom = false) {
  const b = runtime.project ? architecturalViewBounds(runtime.project, runtime.activeLevelId ?? runtime.project.activeLevelId, runtime.presentation?.levels ?? 'active') : { ...sceneBounds(room), minY: room.elevation ?? 0, maxY: (room.elevation ?? 0) + room.height };
  const target = runtime.controls.target;
  const radius = Math.hypot(Math.max(Math.abs(b.minX - target.x), Math.abs(b.maxX - target.x)), Math.max(Math.abs(b.minZ - target.z), Math.abs(b.maxZ - target.z)), Math.max(Math.abs(b.minY - target.y), Math.abs(b.maxY - target.y)));
  const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(runtime.camera.fov / 2)) * Math.min(1, runtime.camera.aspect));
  const distance = radius / Math.sin(halfFov) * 1.04;
  const offset = runtime.camera.position.clone().sub(runtime.controls.target);
  const zoom = preserveZoom && runtime.fittedDistance ? offset.length() / runtime.fittedDistance : 1;
  runtime.camera.position.copy(runtime.controls.target).add(offset.normalize().multiplyScalar(distance * zoom));
  runtime.fittedDistance = distance;
  runtime.controls.maxDistance = Math.max(Math.max(b.width, b.depth, room.height) * 4, distance * 3);
  runtime.camera.far = Math.max(250, runtime.controls.maxDistance + radius * 2);
  runtime.controls.update();
}

export function resetCamera(runtime: SceneRuntime, room: Room, mode: ViewMode) {
  runtime.needsRender = true;
  runtime.viewTransition = null;
  runtime.viewMode = mode;
  updateEnvironment(runtime, room, mode);
  const extent = runtime.project && mode === 'orbit' ? architecturalViewBounds(runtime.project, runtime.activeLevelId ?? runtime.project.activeLevelId, runtime.presentation?.levels ?? 'active') : null;
  const b = extent ?? (mode === 'orbit' ? sceneBounds(room) : bounds(room.vertices));
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const span = Math.max(b.width, b.depth, extent?.height ?? room.height), baseY = extent?.minY ?? room.elevation ?? 0;
  runtime.controls.enabled = mode === 'orbit';
  updateFurniturePlacement(runtime, room);
  runtime.walkBlocked = false;
  if (mode === 'walk') {
    runtime.walkState = runtime.navigator?.start(runtime.activeLevelId ?? runtime.project?.activeLevelId ?? '', runtime.walkState?.levelId === runtime.activeLevelId ? runtime.walkState : undefined) ?? undefined;
    const free = runtime.navigator ? runtime.walkState ?? null : interiorWalkPoint(room);
    const position = free ?? interiorPoint(room.vertices, Math.max(0.2, room.thickness / 2 + 0.12));
    runtime.walkBlocked = free === null;
    runtime.camera.position.set(position.x, runtime.walkState?.eyeY ?? (room.elevation ?? 0) + Math.min(1.65, room.height - 0.2), position.z);
    const target = interiorPoint(room.vertices);
    runtime.yaw = Math.hypot(target.x - position.x, target.z - position.z) > 0.1 ? Math.atan2(position.x - target.x, position.z - target.z) : 0;
    runtime.pitch = 0;
    runtime.camera.rotation.set(0, runtime.yaw, 0, 'YXZ');
    runtime.camera.fov = 70;
    runtime.renderer.domElement.focus({ preventScroll: true });
  } else {
    runtime.camera.position.set(cx - span * 1.05, baseY + span * 0.9, cz + span * 1.2);
    runtime.controls.target.set(cx, baseY + (extent?.height ?? room.height) * 0.4, cz);
    runtime.controls.minDistance = span * 0.45;
    runtime.controls.maxDistance = span * 4;
    runtime.controls.maxPolarAngle = Math.PI * 0.49;
    runtime.controls.update();
    runtime.camera.fov = 43;
    fitOrbitCamera(runtime, room);
  }
  runtime.camera.updateProjectionMatrix();
}

export function finishViewTransition(runtime: SceneRuntime) {
  runtime.viewTransition = null;
  runtime.camera.rotation.reorder('YXZ');
  runtime.yaw = runtime.camera.rotation.y;
  runtime.pitch = runtime.camera.rotation.x;
  if (runtime.viewMode === 'orbit' && runtime.orbitPose) {
    runtime.controls.target.copy(runtime.orbitPose.target);
    runtime.controls.enabled = true;
    runtime.controls.update();
  } else {
    runtime.controls.enabled = false;
    runtime.renderer.domElement.focus({ preventScroll: true });
  }
}

export function startViewTransition(runtime: SceneRuntime, room: Room, mode: ViewMode) {
  const { camera, controls } = runtime;
  if (runtime.viewMode === 'orbit' && !runtime.viewTransition) {
    runtime.orbitPose = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), target: controls.target.clone() };
  }
  const from = { position: camera.position.clone(), quaternion: camera.quaternion.clone() };
  // Drain pending orbit inertia while retaining the exact pose at the user's click.
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = damping;
  camera.position.copy(from.position);
  camera.quaternion.copy(from.quaternion);
  controls.enabled = false;
  runtime.transform.detach();
  runtime.transform.enabled = false;
  runtime.viewMode = mode;
  runtime.walkBlocked = false;
  let to: CameraPose;
  if (mode === 'walk') {
    runtime.walkState = runtime.navigator?.start(runtime.activeLevelId ?? runtime.project?.activeLevelId ?? '') ?? undefined;
    const free = runtime.navigator ? runtime.walkState ?? null : interiorWalkPoint(room);
    const position = free ?? interiorPoint(room.vertices, Math.max(0.2, room.thickness / 2 + 0.12));
    runtime.walkBlocked = free === null;
    to = { position: new THREE.Vector3(position.x, runtime.walkState?.eyeY ?? (room.elevation ?? 0) + Math.min(1.65, room.height - 0.2), position.z), quaternion: new THREE.Quaternion() };
  } else {
    if (!runtime.orbitPose) {
      // An animated scene can also be initialized in walk mode.
      const b = sceneBounds(room), span = Math.max(b.width, b.depth, room.height);
      const target = new THREE.Vector3((b.minX + b.maxX) / 2, (room.elevation ?? 0) + room.height * 0.28, (b.minZ + b.maxZ) / 2);
      const view = camera.clone();
      view.position.set(target.x - span * 1.05, (room.elevation ?? 0) + span * 0.9, target.z + span * 1.2);
      view.lookAt(target);
      runtime.orbitPose = { position: view.position.clone(), quaternion: view.quaternion.clone(), target };
    }
    to = runtime.orbitPose;
  }
  runtime.viewTransition = createCameraTransition(from, to, performance.now());
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    sampleCameraTransition(runtime.viewTransition, runtime.viewTransition.startedAt + runtime.viewTransition.duration, camera);
    runtime.ceilingOpacity = mode === 'walk' ? 1 : 0;
    finishViewTransition(runtime);
  }
  updateFurniturePlacement(runtime, room);
  updateEnvironment(runtime, room, mode);
}
