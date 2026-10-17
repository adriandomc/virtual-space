import * as THREE from 'three/webgpu';
import { bounds, invalidFurnitureIds, polygonArea } from '../../domain/project/model';
import { addStoredFurniture as renderFurniture } from './furnitureRendering';
import type { FurnitureItem, Room, Selection } from '../../domain/project/types';
import { furnitureGeometrySignature } from './sceneProjection';
import type { SceneRuntime } from './sceneRuntime';
import { disposeContent } from './sceneResources';
import { kelvinColor } from './sceneEnvironment';
import { lightBodyMaterial } from './sceneItemAppearance';

export function updateFurniturePlacement(runtime: SceneRuntime, room: Room) {
  runtime.invalidFurniture = invalidFurnitureIds(room);
  for (const item of room.furniture) {
    const overlay = runtime.objects.get(`furniture:${item.id}`)?.userData.placementOverlay as THREE.Mesh | undefined;
    if (overlay) overlay.visible = runtime.viewMode === 'orbit' && runtime.invalidFurniture.has(item.id);
  }
}

export function addStoredFurniture(parent: THREE.Group, item: FurnitureItem, quality: Room['renderQuality'], runtime?: SceneRuntime) {
  return renderFurniture(parent, item, quality, { geometry: runtime?.graphics.geometry, textures: runtime?.graphics.textures, roomId: runtime?.roomId, publicView: runtime?.publicView, onError: runtime?.onModelError, onLoaded: () => {
    if (!runtime || runtime.disposed) return;
    runtime.needsRender = true;
    if (runtime.parentRuntime) runtime.parentRuntime.needsRender = true;
    runtime.scene.traverse(object => { if (object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight) object.shadow.needsUpdate = true; });
    (runtime.parentRuntime?.selectionBox ?? runtime.selectionBox)?.update();
  } });
}

function removeSceneItem(object: THREE.Object3D) {
  const detached = new THREE.Group(); detached.add(object); disposeContent(detached);
}

function addRoomFurniture(runtime: SceneRuntime, room: Room, item: FurnitureItem) {
  const object = addStoredFurniture(runtime.content, item, room.renderQuality, runtime);
  const overlay = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicNodeMaterial({ color: '#ed4040', transparent: true, opacity: .28, depthWrite: false, toneMapped: false }));
  overlay.scale.set(item.width + .02, item.height + .02, item.depth + .02); overlay.position.y = item.height / 2; overlay.renderOrder = 20; overlay.raycast = () => {}; object.add(overlay); object.userData.placementOverlay = overlay;
  runtime.objects.set(`furniture:${item.id}`, object);
}

function addRoomLight(runtime: SceneRuntime, room: Room, light: Room['lights'][number]) {
  const group = runtime.content, architectural = room.renderQuality === 'hyperrealistic', area = bounds(room.vertices), span = Math.max(area.width, area.depth, room.height);
    const lightGroup = new THREE.Group();
    lightGroup.position.set(light.x, light.y, light.z);
    lightGroup.userData.selection = { kind: 'light', id: light.id } satisfies Selection;
    runtime.objects.set(`light:${light.id}`, lightGroup);
    group.add(lightGroup);
    const temperature = kelvinColor(light.temperature);
    // shortcut: diffuse lamp bounce is approximated; use ray tracing for occlusion-aware light transport.
    if (architectural) lightGroup.add(new THREE.HemisphereLight(temperature, temperature, light.enabled ? Math.min(0.25, light.lumens / (polygonArea(room.vertices) * 180)) : 0));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 12), new THREE.MeshStandardMaterial({ color: light.enabled ? temperature : '#c0bcae', emissive: temperature, emissiveIntensity: light.enabled ? 3 : 0, roughness: 0.45 }));
    bulb.userData.bulb = true;
    lightGroup.add(bulb);
    const hitSphere = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 8), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    lightGroup.add(hitSphere);
    const cordLength = Math.max(0.02, room.height - light.y - 0.1);
    const bodyMaterial = lightBodyMaterial(light, room.renderQuality);
    const fixture = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, cordLength, 6), bodyMaterial);
    fixture.position.set(0, 0.1 + cordLength / 2, 0);
    fixture.userData.cord = true;
    fixture.userData.length = cordLength;
    fixture.userData.lightBody = true;
    lightGroup.add(fixture);
    const socket = new THREE.Mesh(new THREE.CylinderGeometry(.035, .045, .065, 12), bodyMaterial);
    socket.position.y = .09; socket.userData.lightBody = true; lightGroup.add(socket);
    const point = new THREE.PointLight(temperature, light.enabled ? light.lumens / (4 * Math.PI) : 0, 0, 2);
    point.position.copy(bulb.position);
    point.castShadow = light.enabled && runtime.graphics.shadows > 0 && (runtime.shadowLightIds ? runtime.shadowLightIds.has(light.id) : room.lights.filter(value => value.enabled).indexOf(light) < (runtime.graphics.geometry === 'low' ? 1 : 3));
    const pointShadowSize = Math.min(runtime.graphics.shadows || 512, 1024);
    point.shadow.mapSize.set(pointShadowSize, pointShadowSize);
    point.shadow.camera.near = 0.05;
    point.shadow.camera.far = span * 3;
    point.shadow.camera.layers.enable(1);
    point.shadow.bias = -0.0002;
    point.shadow.normalBias = architectural ? 0.008 : 0.02;
    point.shadow.radius = architectural ? 2 : 1;
    point.shadow.autoUpdate = false;
    point.shadow.needsUpdate = true;
    lightGroup.add(point);
  return lightGroup;
}

export function reconcileRoomItems(runtime: SceneRuntime, room: Room) {
  const before = runtime.builtRoom;
  let changed = false;
  const profile = runtime.graphics.geometry + ':' + runtime.graphics.textures, profileChanged = runtime.itemProfile !== profile;
  const furniture = new Map(room.furniture.map(item => [item.id, item])), lights = new Set(room.lights.map(light => light.id));
  for (const [key, object] of runtime.objects) if (key.startsWith('furniture:') && !furniture.has(key.slice(10)) || key.startsWith('light:') && !lights.has(key.slice(6))) { removeSceneItem(object); runtime.objects.delete(key); changed = true; }
  for (const item of room.furniture) {
    const object = runtime.objects.get(`furniture:${item.id}`), previous = before?.furniture.find(value => value.id === item.id);
    if (object && previous && (profileChanged || furnitureGeometrySignature(previous) !== furnitureGeometrySignature(item))) { removeSceneItem(object); runtime.objects.delete(`furniture:${item.id}`); changed = true; }
    if (!runtime.objects.has(`furniture:${item.id}`)) { addRoomFurniture(runtime, room, item); changed = true; }
  }
  for (const light of room.lights) if (!runtime.objects.has(`light:${light.id}`)) { addRoomLight(runtime, room, light); changed = true; }
  runtime.itemProfile = profile;
  return changed;
}
