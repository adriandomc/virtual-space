import { t, useLocale } from './i18n';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import { DoorClosed, DoorOpen, Lightbulb, LoaderCircle } from 'lucide-react';
import { bounds, furnitureCorners, furnitureWalkable, interiorPoint, interiorWalkPoint, invalidFurnitureIds, itemWorldPosition, moveSceneItem, pointInPolygon, polygonArea, toggleSceneInteraction, roomWallEndpoints, wallCount } from './model';
import { createCeilingMaterial, createCeilingFinishMaterial, createSlabMaterials, createWallFinishMaterial, createFabricMaterial, createFloorMaterial, createRoofInteriorMaterial, createFurnitureMaterial, createWoodMaterial, disposeArchitecturalTextures, setMaterialTextureResolution } from './materials';
import { createDuvetGeometry, createPillowGeometry } from './beddingGeometry';
import { buildCatalogGeometry } from './catalogGeometry';
import { isFurnitureVariant } from './furnitureCatalog';
import { attachCustomModel } from './customModel';
import { createArchitecturalPostProcessing } from './postProcessing';
import { daylightFactor, daylightOpeningArea, joystickVector, renderPixelRatio } from './navigation';
import { createCameraTransition, sampleCameraTransition } from './cameraTransition';
import type { CameraPose, CameraTransition } from './cameraTransition';
import type { FurnitureItem, Point, Room, Selection, ViewMode } from './types';
import { ceilingFinishTargets, levelOutline, projectLevel, projectToRoom, updateProjectRoom, type ProjectDocument, type ProjectLevel } from './projectDocument';
import { buildRoofGeometry, buildStairGeometry, wallRoofProfile } from './projectGeometry';
import { architecturalViewBounds, furnitureGeometrySignature, indexedArchitectureGeometry, levelGeometrySignature, presentedLevelIds, projectedLevelScene, projectNavigationSignature, residentLevelIds, shadowLightIds, sceneResourceUsage, slabGeometry } from './sceneProjection';
import { ArchitecturalNavigation, type WalkState } from './architecturalNavigation';
import { getGraphicsPreferences, getGraphicsProfile, useGraphicsSettings, GraphicsPerformanceController, setAdaptiveGraphicsTier, type GraphicsProfile } from './graphicsSettings';
import './scene.css';
import { registerBeforeAppUpdate } from './appOffline';

type Props = {
  room: Room;
  project?: ProjectDocument;
  activeLevelId?: string;
  onProjectChange?: (project: ProjectDocument) => void;
  onActiveLevelChange?: (levelId: string) => void;
  presentation?: { walls: 'full' | 'cut' | 'hidden'; roofs: boolean; levels: 'active' | 'below' | 'all' };
  paused?: boolean;
  roomId?: string;
  publicView?: boolean;
  onModelError?: (message: string) => void;
  mode: ViewMode;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  onChange: (room: Room) => boolean | void;
  readOnly: boolean;
  transformMode: 'translate' | 'rotate';
  resetKey: number;
  onReady?: (backend: string) => void;
  animateView?: boolean;
};
type WallView = { group: THREE.Group; midpoint: THREE.Vector3; inward: THREE.Vector3; material: THREE.MeshStandardNodeMaterial; opposite: THREE.MeshStandardNodeMaterial; finishKey: string; index: number };
const KEY_DIRECTIONS: Record<string, string> = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyQ: 'lookLeft', KeyE: 'lookRight', KeyR: 'lookUp', KeyF: 'lookDown' };
type Runtime = {
  project?: ProjectDocument;
  activeLevelId?: string;
  presentation?: Props['presentation'];
  levelMeta?: ProjectLevel;
  levelOnly?: boolean;
  parentRuntime?: Runtime;
  shadowLightIds?: Set<string>;
  textureProfile?: number;
  itemProfile?: string;
  architectureBuilds?: number;
  renderedStructure?: string;
  levelViews?: Map<string, { runtime: Runtime; resident: boolean }>;
  projectExtras?: THREE.Group;
  extrasSignature?: string;
  projectLighting?: THREE.Group;
  lightingSignature?: string;
  navigator?: ArchitecturalNavigation;
  navigationSignature?: string;
  walkState?: WalkState;
  ceilings?: THREE.Mesh[];
  geometrySignature?: string;
  graphics: GraphicsProfile;
  needsRender: boolean;
  overlayPaused?: boolean;
  previewFill?: THREE.HemisphereLight;
  roomId?: string;
  publicView?: boolean;
  onModelError?: (message: string) => void;
  renderer: THREE.WebGPURenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
  walls: WallView[];
  ceiling: THREE.Mesh | null;
  yaw: number;
  pitch: number;
  fittedDistance: number;
  objects: Map<string, THREE.Object3D>;
  invalidFurniture: Set<string>;
  selectionBox: THREE.BoxHelper | null;
  transform: TransformControls;
  proxy: THREE.Object3D;
  manipulating: Selection | null;
  directDragging: boolean;
  pendingEdit: boolean;
  lastOpeningBuild: number;
  environment: THREE.RenderTarget | null;
  architecturalEnvironment: THREE.RenderTarget | null;
  sky: THREE.DataTexture | null;
  loadingSky: boolean;
  disposed: boolean;
  areaTextures: ReturnType<typeof RectAreaLightTexturesLib.init> | null;
  postProcessing: ReturnType<typeof createArchitecturalPostProcessing> | null;
  postFailed: boolean;
  viewMode: ViewMode;
  builtRoom: Room | null;
  structure: string;
  outlinedKey: string | null;
  walkBlocked: boolean;
  viewTransition: CameraTransition | null;
  orbitPose: (CameraPose & { target: THREE.Vector3 }) | null;
  animateView: boolean;
  ceilingOpacity: number;
};

function disposeArchitecture(runtime: Runtime) {
  runtime.disposed = true;
  runtime.postProcessing?.dispose();
  runtime.architecturalEnvironment?.dispose();
  runtime.sky?.dispose();
  if (runtime.areaTextures) {
    for (const key of ['LTC_FLOAT_1', 'LTC_FLOAT_2', 'LTC_HALF_1', 'LTC_HALF_2'] as const) runtime.areaTextures[key].dispose();
  }
  disposeArchitecturalTextures();
}

function updateEnvironment(runtime: Runtime, room: Room, mode: ViewMode) {
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

const selectionKey = (selection: Selection) => selection.kind === 'wall' ? `wall:${selection.id ?? selection.index}` : 'id' in selection ? `${selection.kind}:${selection.id}` : selection.kind;
const sameSelection = (a: Selection | null, b: Selection | null) => a != null && b != null && selectionKey(a) === selectionKey(b);
const canMove = (selection: Selection | null) => selection != null && ['furniture', 'opening', 'light'].includes(selection.kind);
const canInteract = (room: Room, selection: Selection | null) => selection?.kind === 'light' ? room.lights.some(light => light.id === selection.id) : selection?.kind === 'opening' && room.openings.some(opening => opening.id === selection.id && opening.type === 'door' && opening.doorStyle !== 'frame');

function updateSelection(runtime: Runtime, props: Props) {
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
  const position = selection ? itemWorldPosition(props.room, selection) : null;
  const editable = canMove(selection) && !props.readOnly && props.mode === 'orbit' && !runtime.viewTransition;
  if (!editable || !position) { runtime.transform.detach(); runtime.transform.enabled = false; return; }
  runtime.proxy.position.set(position.x, position.y + (props.room.elevation ?? 0), position.z);
  const furniture = selection?.kind === 'furniture' ? props.room.furniture.find(item => item.id === selection.id) : null;
  runtime.proxy.rotation.set(0, furniture ? THREE.MathUtils.degToRad(furniture.rotation) : 0, 0);
  const rotate = props.transformMode === 'rotate' && props.selection?.kind === 'furniture';
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

function updateRoom(runtime: Runtime, room: Room) {
  runtime.needsRender = true;
  if (runtime.project && !runtime.levelOnly) { buildProjectScene(runtime, runtime.project); return; }
  const structure = levelGeometrySignature(room, runtime.geometrySignature);
  if (runtime.builtRoom === room && runtime.structure === structure) return;
  if (runtime.structure !== structure) { buildRoom(runtime, room); return; }
  const previous = runtime.builtRoom;
  const textureChanged = runtime.textureProfile !== runtime.graphics.textures;
  setMaterialTextureResolution(runtime.graphics.textures);
  const itemsChanged = reconcileRoomItems(runtime, room);
  for (const wall of runtime.walls) {
    const segment = room.wallSegments?.[wall.index], original = runtime.levelMeta?.walls.find(item => item.id === segment?.id);
    const left = original?.left ?? { color: segment?.leftColor ?? room.wallColors[wall.index], material: 'concrete' as const }, right = original?.right ?? { color: segment?.rightColor ?? room.wallColors[wall.index], material: 'concrete' as const };
    const finishKey = [left.color, left.material, right.color, right.material].join(':');
    if (textureChanged || wall.finishKey !== finishKey) {
      wall.material.dispose(); wall.opposite.dispose(); wall.material = createWallFinishMaterial(left, room.renderQuality); wall.opposite = createWallFinishMaterial(right, room.renderQuality); wall.finishKey = finishKey; (wall.group.children[0] as THREE.Mesh).material = [wall.material, wall.opposite];
    }
  }
  for (const surface of runtime.levelMeta?.surfaces ?? []) {
    const mesh = runtime.objects.get(`${surface.kind}:${surface.id}`) as THREE.Mesh | undefined;
    const before = previous?.surfaces?.find(value => value.id === surface.id);
    if (mesh && (textureChanged || JSON.stringify([before?.finish, before?.undersideFinish]) !== JSON.stringify([surface.finish, surface.undersideFinish]))) {
      new Set(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => material.dispose());
      mesh.material = surface.kind === 'floor' ? createSlabMaterials(surface.finish, surface.undersideFinish, room.renderQuality) : createCeilingFinishMaterial(surface.finish, room.renderQuality);
    }
  }
  if (!runtime.levelMeta && previous && (previous.floorColor !== room.floorColor || previous.floorFinish !== room.floorFinish)) { const floor = runtime.objects.get('floor') as THREE.Mesh; (floor.material as THREE.Material).dispose(); floor.material = createFloorMaterial(room); }
  if (!runtime.levelMeta && previous?.ceilingColor !== room.ceilingColor && runtime.ceiling) { (runtime.ceiling.material as THREE.Material).dispose(); runtime.ceiling.material = createCeilingMaterial(room.ceilingColor, room.renderQuality); }
  for (const opening of room.openings) {
    if (opening.type !== 'door' || opening.doorStyle === 'frame') continue;
    runtime.content.traverse(object => { if (object.userData.doorId === opening.id) object.rotation.y = opening.open === false ? 0 : object.userData.openAngle; });
  }
  if (textureChanged) runtime.content.traverse(object => { if (object instanceof THREE.Mesh && object.userData.doorLeaf) { const previous = object.material as THREE.MeshStandardMaterial; previous.dispose(); object.material = createWoodMaterial('#' + previous.color.getHexString(), room.renderQuality); } });
  let moved = itemsChanged;
  for (const item of room.furniture) {
    let group = runtime.objects.get(`furniture:${item.id}`);
    const before = previous?.furniture.find(value => value.id === item.id);
    if (group && before && (before.color !== item.color || before.material !== item.material)) {
      const overlay = group.userData.placementOverlay as THREE.Mesh | undefined;
      overlay?.removeFromParent(); const old = new THREE.Group(); old.add(group); disposeContent(old);
      group = addStoredFurniture(runtime.content, item, room.renderQuality, runtime); runtime.objects.set(`furniture:${item.id}`, group);
      if (overlay) { group.add(overlay); group.userData.placementOverlay = overlay; }
      moved = true;
    }
    const radians = THREE.MathUtils.degToRad(item.rotation);
    if (group && (group.position.x !== item.x || group.position.z !== item.z || group.rotation.y !== radians)) {
      group.position.set(item.x, 0, item.z);
      group.rotation.y = radians;
      moved = true;
    }
  }
  for (const item of room.lights) {
    const group = runtime.objects.get(`light:${item.id}`);
    group?.traverse(object => { if (object instanceof THREE.PointLight) { object.color.copy(kelvinColor(item.temperature)); object.intensity = item.enabled ? item.lumens / (4 * Math.PI) : 0; object.castShadow = runtime.graphics.shadows > 0 && item.enabled && (runtime.shadowLightIds ? runtime.shadowLightIds.has(item.id) : room.lights.filter(light => light.enabled).findIndex(light => light.id === item.id) < (runtime.graphics.geometry === 'low' ? 1 : 3)); object.shadow.mapSize.set(Math.min(runtime.graphics.shadows || 512, 1024), Math.min(runtime.graphics.shadows || 512, 1024)); object.shadow.needsUpdate = true; } if (object instanceof THREE.HemisphereLight) { object.color.copy(kelvinColor(item.temperature)); object.groundColor.copy(object.color); object.intensity = item.enabled ? Math.min(.25, item.lumens / (polygonArea(room.vertices) * 180)) : 0; } if (object.userData.bulb && object instanceof THREE.Mesh) { const material = object.material as THREE.MeshStandardMaterial; material.color.copy(item.enabled ? kelvinColor(item.temperature) : new THREE.Color('#c0bcae')); material.emissive.copy(kelvinColor(item.temperature)); material.emissiveIntensity = item.enabled ? 3 : 0; } });
    if (group && (group.position.x !== item.x || group.position.y !== item.y || group.position.z !== item.z)) {
      group.position.set(item.x, item.y, item.z);
      const cord = group.children.find(child => child.userData.cord);
      if (cord) {
        const length = Math.max(0.02, room.height - item.y - 0.1);
        cord.scale.y = length / cord.userData.length;
        cord.position.y = 0.1 + length / 2;
      }
      moved = true;
    }
  }
  if (moved || previous?.openings.some((opening, index) => opening.open !== room.openings[index]?.open)) runtime.scene.traverse(object => { if (object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight) object.shadow.needsUpdate = true; });
  updateFurniturePlacement(runtime, room);
  runtime.builtRoom = room;
  runtime.textureProfile = runtime.graphics.textures;
  if (!runtime.levelOnly) updateEnvironment(runtime, room, runtime.viewMode);
}

function updateFurniturePlacement(runtime: Runtime, room: Room) {
  runtime.invalidFurniture = invalidFurnitureIds(room);
  for (const item of room.furniture) {
    const overlay = runtime.objects.get(`furniture:${item.id}`)?.userData.placementOverlay as THREE.Mesh | undefined;
    if (overlay) overlay.visible = runtime.viewMode === 'orbit' && runtime.invalidFurniture.has(item.id);
  }
}

function sceneBounds(room: Room) {
  return bounds([...room.vertices, ...room.furniture.flatMap(furnitureCorners), ...room.lights]);
}

function disposeContent(group: THREE.Group) {
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

function kelvinColor(kelvin: number) {
  const t = Math.max(1000, Math.min(12000, kelvin)) / 100;
  const r = t <= 66 ? 255 : 329.6987 * (t - 60) ** -0.1332;
  const g = t <= 66 ? 99.4708 * Math.log(t) - 161.1196 : 288.1222 * (t - 60) ** -0.0755;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177 * Math.log(t - 10) - 305.0448;
  return new THREE.Color().setRGB(...[r, g, b].map(channel => Math.min(255, Math.max(0, channel)) / 255) as [number, number, number], THREE.SRGBColorSpace);
}

function floorShape(vertices: Point[]) {
  const shape = new THREE.Shape();
  vertices.forEach((vertex, index) => index ? shape.lineTo(vertex.x, -vertex.z) : shape.moveTo(vertex.x, -vertex.z));
  shape.closePath();
  return shape;
}

function box(group: THREE.Group, size: [number, number, number], at: [number, number, number], material: THREE.Material, rounded = false) {
  const beveled = group.userData.architectural;
  const detail = group.userData.geometry ?? 'high';
  const geometry = detail !== 'low' && (rounded || beveled) ? new RoundedBoxGeometry(...size, detail === 'medium' ? 1 : beveled ? 3 : 2, Math.min(beveled ? 0.012 : 0.06, ...size.map(value => value / 3))) : new THREE.BoxGeometry(...size);
  if (beveled) {
    const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
    for (let i = 0; i < position.count; i++) {
      const nx = Math.abs(normal.getX(i)), ny = Math.abs(normal.getY(i)), nz = Math.abs(normal.getZ(i));
      uv.setXY(i, nx > ny && nx > nz ? position.getZ(i) : position.getX(i), ny > nx && ny > nz ? position.getZ(i) : position.getY(i));
    }
    if (import.meta.env.DEV) console.assert(Array.from(uv.array).every(Number.isFinite), 'Furniture UV coordinates must be finite');
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...at);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addStoredFurniture(parent: THREE.Group, item: FurnitureItem, quality: Room['renderQuality'], runtime?: Runtime) {
  const group = new THREE.Group();
  group.userData.architectural = quality === 'hyperrealistic';
  group.userData.geometry = runtime?.graphics.geometry ?? 'high';
  group.position.set(item.x, 0, item.z);
  group.rotation.y = THREE.MathUtils.degToRad(item.rotation);
  group.userData.selection = { kind: 'furniture', id: item.id } satisfies Selection;
  parent.add(group);
  if (item.type === 'custom') {
    attachCustomModel(group, item, quality, { roomId: runtime?.roomId, publicOnly: runtime?.publicView, onError: runtime?.onModelError, onLoaded: () => {
      if (!runtime || runtime.disposed) return;
      runtime.needsRender = true;
      if (runtime.parentRuntime) runtime.parentRuntime.needsRender = true;
      runtime.scene.traverse(object => { if (object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight) object.shadow.needsUpdate = true; });
      (runtime.parentRuntime?.selectionBox ?? runtime.selectionBox)?.update();
    }, textureResolution: runtime?.graphics.textures });
    return group;
  }
  const w = item.width, d = item.depth, h = item.height;
  const body = createFurnitureMaterial(item.color!, item.material!, quality);
  const face = body;
  const handles = new THREE.MeshStandardMaterial({ color: '#626559', metalness: 0.65, roughness: 0.35 });
  body.name = face.name = `3D Space:${item.material!}`;
  handles.name = '3D Space:metal';
  if (isFurnitureVariant(item.type, item.variant)) {
    buildCatalogGeometry(group, item, { body, face, handles }, quality, runtime?.graphics.geometry);
  } else if (item.type === 'bed' && quality === 'hyperrealistic') {
    const ivory = createFabricMaterial('#eee8df', quality);
    ivory.side = THREE.DoubleSide;
    const linen = createFabricMaterial('#ccc1b1', quality);
    box(group, [w, h, d * 0.05], [0, h / 2, -d * 0.475], body, true);
    box(group, [w * 0.91, h * 0.61, d * 0.048], [0, h * 0.675, -d * 0.432], linen, true);
    box(group, [w * 0.96, h * 0.18, d * 0.94], [0, h * 0.26, d * 0.02], body, true);
    box(group, [w * 0.92, h * 0.23, d * 0.90], [0, h * 0.455, d * 0.025], ivory, true);
    const duvet = new THREE.Mesh(createDuvetGeometry(w, d, h, runtime?.graphics.geometry), ivory);
    duvet.castShadow = duvet.receiveShadow = true;
    group.add(duvet);
    const columns = w < 1.3 ? 1 : 2;
    for (let i = 0; i < columns; i++) {
      const pillow = new THREE.Mesh(createPillowGeometry(w * 0.79 / columns, h * 0.145, d * 0.225, runtime?.graphics.geometry), ivory);
      pillow.position.set(columns === 1 ? 0 : (i - 0.5) * w * 0.45, h * 0.665, -d * 0.27);
      pillow.rotation.y = (i ? 1 : -1) * 0.05 * Math.min(1, w / d, d / w);
      pillow.castShadow = pillow.receiveShadow = true;
      group.add(pillow);
      const cushion = new THREE.Mesh(createPillowGeometry(w * 0.55 / columns, Math.min(h * 0.145, d * 0.13), d * 0.15, runtime?.graphics.geometry), linen);
      cushion.position.set(pillow.position.x, h * 0.74, -d * 0.375);
      cushion.rotation.x = -Math.min(0.5, h / d * 0.5);
      cushion.castShadow = cushion.receiveShadow = true;
      group.add(cushion);
    }
    for (const x of [-w * 0.4, w * 0.4]) for (const z of [-d * 0.4, d * 0.4]) box(group, [w * 0.055, h * 0.17, d * 0.045], [x, h * 0.085, z], body);
  } else if (item.type === 'bed') {
    const ivory = new THREE.MeshStandardMaterial({ color: '#f1ebdf', roughness: 1 });
    box(group, [w, h, d * 0.05], [0, h / 2, -d * 0.475], body, true);
    box(group, [w * 0.96, h * 0.18, d * 0.94], [0, h * 0.24, d * 0.02], body, true);
    box(group, [w * 0.91, h * 0.20, d * 0.9], [0, h * 0.43, d * 0.025], ivory, true);
    const blanket = new THREE.MeshStandardMaterial({ color: '#aab59c', roughness: 1 });
    box(group, [w * 0.92, h * 0.035, d * 0.63], [0, h * 0.545, d * 0.15], blanket, true);
    const columns = w < 1.3 ? 1 : 2;
    for (let i = 0; i < columns; i++) box(group, [w * 0.74 / columns, h * 0.09, d * 0.21], [columns === 1 ? 0 : (i - 0.5) * w * 0.45, h * 0.56, -d * 0.285], ivory, true);
    for (const x of [-w * 0.4, w * 0.4]) for (const z of [-d * 0.4, d * 0.4]) box(group, [w * 0.055, h * 0.16, d * 0.045], [x, h * 0.08, z], body);
  }
  const usedMaterials = new Set<THREE.Material>();
  group.traverse(object => {
    if (object instanceof THREE.Mesh) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => usedMaterials.add(material));
  });
  for (const material of new Set([body, face, handles])) if (!usedMaterials.has(material)) material.dispose();
  if (import.meta.env.DEV) {
    group.updateWorldMatrix(true, true);
    const actual = new THREE.Box3().setFromObject(group);
    const footprint = bounds(furnitureCorners(item));
    console.assert(actual.min.x >= footprint.minX - 0.001 && actual.max.x <= footprint.maxX + 0.001 && actual.min.z >= footprint.minZ - 0.001 && actual.max.z <= footprint.maxZ + 0.001 && actual.min.y >= -0.001 && actual.max.y <= h + 0.001, 'Furniture geometry exceeds its declared dimensions', item.id);
  }
  return group;
}

export function createFurnitureModel(item: FurnitureItem, quality: Room['renderQuality'] = 'standard'): THREE.Group {
  return addStoredFurniture(new THREE.Group(), { ...item, x: 0, z: 0, rotation: 0 }, quality);
}

function removeSceneItem(object: THREE.Object3D) {
  const detached = new THREE.Group(); detached.add(object); disposeContent(detached);
}

function addRoomFurniture(runtime: Runtime, room: Room, item: FurnitureItem) {
  const object = addStoredFurniture(runtime.content, item, room.renderQuality, runtime);
  const overlay = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicNodeMaterial({ color: '#ed4040', transparent: true, opacity: .28, depthWrite: false, toneMapped: false }));
  overlay.scale.set(item.width + .02, item.height + .02, item.depth + .02); overlay.position.y = item.height / 2; overlay.renderOrder = 20; overlay.raycast = () => {}; object.add(overlay); object.userData.placementOverlay = overlay;
  runtime.objects.set(`furniture:${item.id}`, object);
}

function addRoomLight(runtime: Runtime, room: Room, light: Room['lights'][number]) {
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
    const fixture = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, cordLength, 6), new THREE.MeshStandardMaterial({ color: '#343931', roughness: 0.8 }));
    fixture.position.set(0, 0.1 + cordLength / 2, 0);
    fixture.userData.cord = true;
    fixture.userData.length = cordLength;
    lightGroup.add(fixture);
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

function reconcileRoomItems(runtime: Runtime, room: Room) {
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

function buildLevelRoom(runtime: Runtime, room: Room) {
  runtime.architectureBuilds = (runtime.architectureBuilds ?? 0) + 1;
  runtime.needsRender = true;
  setMaterialTextureResolution(runtime.graphics.textures);
  disposeContent(runtime.content);
  const group = runtime.content;
  const architectural = room.renderQuality === 'hyperrealistic';
  const detailed = room.renderQuality !== 'standard';
  const highResolution = detailed && !window.matchMedia('(pointer: coarse)').matches && runtime.renderer.domElement.clientWidth > 700;
  if (!architectural) { runtime.postProcessing?.dispose(); runtime.postProcessing = null; runtime.postFailed = false; }
  runtime.renderer.shadowMap.type = architectural ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  runtime.renderer.toneMapping = architectural ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
  runtime.renderer.toneMappingExposure = architectural ? 1.45 : 1;
  if (architectural && !runtime.areaTextures) {
    runtime.areaTextures = RectAreaLightTexturesLib.init();
    THREE.RectAreaLightNode.setLTC(runtime.areaTextures);
  }
  const b = bounds(room.vertices);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const span = Math.max(b.width, b.depth, room.height);
  runtime.walls = [];
  runtime.objects.clear();
  const shape = floorShape(room.vertices);
  const floors = runtime.levelMeta?.surfaces.filter(surface => surface.kind === 'floor');
  for (const surface of floors ?? [null]) {
    const floorOutline = surface ? surface.outline.map(id => runtime.levelMeta!.points.find(point => point.id === id)!) : room.vertices;
    const material = surface ? createSlabMaterials(surface.finish, surface.undersideFinish, room.renderQuality) : createFloorMaterial(room);
    const thickness = surface?.thickness ?? 0.18;
    const geometry = slabGeometry(floorOutline, surface?.holes.map(hole => hole.vertices) ?? [], thickness);
    const floor = new THREE.Mesh(geometry, material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = surface?.elevation ?? 0;
    floor.castShadow = floor.receiveShadow = true;
    floor.userData.selection = { kind: 'floor', ...(surface ? { id: surface.id } : {}) } satisfies Selection;
    if (surface) { floor.userData.slabSurfaceId = surface.id; floor.userData.levelId = room.levelId; }
    if (!runtime.objects.has('floor')) runtime.objects.set('floor', floor);
    if (surface) runtime.objects.set(`floor:${surface.id}`, floor);
    group.add(floor);
  }
  const trim = architectural ? new THREE.MeshPhysicalNodeMaterial({ color: '#ebe7df', roughness: 0.45, clearcoat: 0.12, clearcoatRoughness: 0.5 }) : new THREE.MeshStandardMaterial({ color: '#efece3', roughness: 0.8 });
  const shadowMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const glassMaterial = architectural ? new THREE.MeshPhysicalNodeMaterial({ color: '#ffffff', transmission: 0.98, thickness: 0.004, ior: 1.5, roughness: 0.025, metalness: 0, transparent: true, side: THREE.DoubleSide, depthWrite: false }) : new THREE.MeshStandardMaterial({ color: '#acd6dc', transparent: true, opacity: 0.12, roughness: 0.15, side: THREE.DoubleSide, depthWrite: false });
  for (let index = 0; index < wallCount(room); index++) {
    const [start, end] = roomWallEndpoints(room, index);
    const segment = room.wallSegments?.[index], thickness = segment?.thickness ?? room.thickness, height = segment?.height ?? room.height;
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    const openings = room.openings.filter(opening => opening.wall === index).sort((a, b) => a.offset - b.offset);
    const wallShape = new THREE.Shape();
    wallShape.moveTo(-thickness / 2, 0);
    for (const opening of openings.filter(opening => opening.type === 'door')) {
      wallShape.lineTo(opening.offset, 0);
      wallShape.lineTo(opening.offset, opening.height);
      wallShape.lineTo(opening.offset + opening.width, opening.height);
      wallShape.lineTo(opening.offset + opening.width, 0);
    }
    wallShape.lineTo(length + thickness / 2, 0);
    const top = runtime.project && room.levelId && segment ? wallRoofProfile(runtime.project, room.levelId, segment.id) : [{ t: 0, height }, { t: 1, height }];
    for (const point of [...top].reverse()) wallShape.lineTo(point.t * length + (point.t === 1 ? thickness / 2 : point.t === 0 ? -thickness / 2 : 0), point.height);
    wallShape.closePath();
    for (const opening of openings.filter(opening => opening.type === 'window')) {
      const hole = new THREE.Path();
      hole.moveTo(opening.offset, opening.sill);
      hole.lineTo(opening.offset, opening.sill + opening.height);
      hole.lineTo(opening.offset + opening.width, opening.sill + opening.height);
      hole.lineTo(opening.offset + opening.width, opening.sill);
      hole.closePath();
      wallShape.holes.push(hole);
    }
    const geometry = new THREE.ExtrudeGeometry(wallShape, { depth: thickness, bevelEnabled: false });
    geometry.translate(0, 0, -thickness / 2);
    const original = runtime.levelMeta?.walls.find(wall => wall.id === segment?.id);
    const left = original?.left ?? { color: room.wallColors[index], material: 'concrete' as const }, right = original?.right ?? { color: segment?.rightColor ?? room.wallColors[index], material: 'concrete' as const };
    const material = createWallFinishMaterial(left, room.renderQuality), opposite = createWallFinishMaterial(right, room.renderQuality);
    const finishKey = [left.color, left.material, right.color, right.material].join(':');
    geometry.clearGroups();
    const normals = geometry.getAttribute('normal');
    let groupStart = 0, side = normals.getZ(0) < -0.5 ? 1 : 0;
    for (let vertex = 3; vertex < normals.count; vertex += 3) { const next = normals.getZ(vertex) < -0.5 ? 1 : 0; if (side !== next) { geometry.addGroup(groupStart, vertex - groupStart, side); groupStart = vertex; side = next; } }
    geometry.addGroup(groupStart, normals.count - groupStart, side);
    const wallGroup = new THREE.Group();
    wallGroup.userData.architectural = architectural;
    wallGroup.position.set(start.x, 0, start.z);
    wallGroup.rotation.y = -Math.atan2(dz, dx);
    wallGroup.userData.selection = { kind: 'wall', index, ...(segment ? { id: segment.id } : {}) } satisfies Selection;
    const mesh = new THREE.Mesh(geometry, [material, opposite]);
    mesh.receiveShadow = true;
    wallGroup.add(mesh);
    group.add(wallGroup);
    runtime.objects.set(`wall:${index}`, wallGroup);
    if (segment) runtime.objects.set(`wall:${segment.id}`, wallGroup);
    // Shadow-only geometry keeps the room closed while the orbit view cuts away walls and roof.
    const caster = new THREE.Mesh(geometry, shadowMaterial);
    caster.position.copy(wallGroup.position);
    caster.rotation.copy(wallGroup.rotation);
    caster.layers.set(1);
    caster.castShadow = true;
    group.add(caster);
    const midpoint = new THREE.Vector3((start.x + end.x) / 2, 0, (start.z + end.z) / 2);
    const inward = new THREE.Vector3(-dz / length, 0, dx / length);
    if (!pointInPolygon({ x: midpoint.x + inward.x * 0.01, z: midpoint.z + inward.z * 0.01 }, room.vertices)) inward.negate();
    runtime.walls.push({ group: wallGroup, midpoint, inward, material, opposite, finishKey, index });
    const innerSide = inward.dot(new THREE.Vector3(-dz / length, 0, dx / length));
    let previousDoorEnd = 0;
    for (const opening of openings.filter(opening => opening.type === 'door')) {
      const width = opening.offset - previousDoorEnd;
      if (width > 0.01) box(wallGroup, [width, 0.09, 0.035], [previousDoorEnd + width / 2, 0.045, innerSide * (thickness / 2 + 0.016)], trim);
      previousDoorEnd = opening.offset + opening.width;
    }
    if (length - previousDoorEnd > 0.01) box(wallGroup, [length - previousDoorEnd, 0.09, 0.035], [(length + previousDoorEnd) / 2, 0.045, innerSide * (thickness / 2 + 0.016)], trim);
    for (const opening of openings) {
      const y = opening.type === 'door' ? 0 : opening.sill;
      const frame = 0.045;
      const x = opening.offset + opening.width / 2;
      const openingGroup = new THREE.Group();
      openingGroup.userData.architectural = architectural;
      openingGroup.position.copy(wallGroup.position);
      openingGroup.rotation.copy(wallGroup.rotation);
      openingGroup.userData.selection = { kind: 'opening', id: opening.id } satisfies Selection;
      openingGroup.userData.wall = index;
      runtime.objects.set(`opening:${opening.id}`, openingGroup);
      group.add(openingGroup);
      for (const edge of [-1, 1]) box(openingGroup, [frame, opening.height + frame, thickness + 0.045], [x + edge * (opening.width / 2 - frame / 2), y + opening.height / 2, 0], trim);
      box(openingGroup, [opening.width, frame, thickness + 0.045], [x, y + opening.height - frame / 2, 0], trim);
      if (opening.type === 'window') {
        box(openingGroup, [opening.width + 0.09, frame, thickness + 0.11], [x, y, 0], trim);
        box(openingGroup, [frame * 0.65, opening.height, 0.035], [x, y + opening.height / 2, 0], trim);
        box(openingGroup, [opening.width, frame * 0.65, 0.035], [x, y + opening.height * 0.55, 0], trim);
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(opening.width, opening.height), glassMaterial);
        glass.position.set(x, y + opening.height / 2, 0);
        openingGroup.add(glass);
      } else {
        const hitPlane = new THREE.Mesh(new THREE.PlaneGeometry(opening.width, opening.height), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
        hitPlane.position.set(x, opening.height / 2, 0);
        openingGroup.add(hitPlane);
        if (opening.doorStyle !== 'frame') {
          const direction = opening.doorStyle === 'left' ? -1 : 1;
          const hinge = new THREE.Group();
          hinge.userData.architectural = architectural;
          hinge.position.set(opening.offset + (direction === 1 ? frame : opening.width - frame), 0, innerSide * thickness / 2);
          hinge.userData.doorId = opening.id; hinge.userData.openAngle = direction * innerSide * -Math.PI * 0.4;
          hinge.rotation.y = opening.open === false ? 0 : direction * innerSide * -Math.PI * 0.4;
          openingGroup.add(hinge);
          const leaf = box(hinge, [opening.width - frame * 2, opening.height - frame, 0.04], [direction * (opening.width - frame * 2) / 2, (opening.height - frame) / 2, 0], architectural ? createWoodMaterial('#c7b297', room.renderQuality) : new THREE.MeshStandardMaterial({ color: '#c7b297', roughness: 0.8 }));
          leaf.userData.doorLeaf = architectural;
          leaf.castShadow = true;
          box(hinge, [0.07, 0.025, 0.075], [direction * (opening.width - 0.15), Math.min(0.98, (opening.height - frame) / 2), innerSide * 0.045], new THREE.MeshStandardMaterial({ color: '#7c7b6c', metalness: 0.75, roughness: 0.3 }));
        }
      }
      const openingShadows = openingGroup.clone(true);
      openingShadows.traverse(object => object.layers.set(1));
      group.add(openingShadows);
    }
    const shadowFrames = wallGroup.clone(true);
    shadowFrames.remove(shadowFrames.children[0]);
    shadowFrames.traverse(object => object.layers.set(1));
    group.add(shadowFrames);
  }
  runtime.ceilings = []; runtime.ceiling = null;
  for (const surface of runtime.levelMeta ? runtime.levelMeta.surfaces.filter(value => value.kind === 'ceiling') : [null]) {
  const ceilingShape = surface ? floorShape(surface.outline.map(id => runtime.levelMeta!.points.find(point => point.id === id)!)) : shape;
  for (const hole of surface?.holes ?? []) { const path = new THREE.Path(); hole.vertices.forEach((point, index) => index ? path.lineTo(point.x, -point.z) : path.moveTo(point.x, -point.z)); path.closePath(); ceilingShape.holes.push(path); }
  const ceiling = new THREE.Mesh(new THREE.ExtrudeGeometry(ceilingShape, { depth: surface?.thickness ?? 0.1, bevelEnabled: false }), createCeilingFinishMaterial(surface?.finish ?? { color: room.ceilingColor, material: 'concrete' }, room.renderQuality));
  ceiling.rotation.x = -Math.PI / 2;
  ceiling.position.y = surface?.elevation ?? room.height;
  ceiling.layers.set(1);
  ceiling.castShadow = ceiling.receiveShadow = true;
  ceiling.userData.selection = { kind: 'ceiling', ...(surface ? { id: surface.id } : {}) } satisfies Selection;
  runtime.objects.set('ceiling', ceiling);
  if (surface) runtime.objects.set(`ceiling:${surface.id}`, ceiling);
  group.add(ceiling);
  runtime.ceiling = ceiling;
  runtime.ceilings.push(ceiling);
  if (runtime.animateView) {
    const material = ceiling.material as THREE.Material;
    material.transparent = true;
    material.depthWrite = false;
    material.opacity = runtime.ceilingOpacity;
    ceiling.castShadow = false;
    const ceilingShadow = new THREE.Mesh(ceiling.geometry, shadowMaterial);
    ceilingShadow.position.copy(ceiling.position);
    ceilingShadow.rotation.copy(ceiling.rotation);
    ceilingShadow.layers.set(1);
    ceilingShadow.castShadow = true;
    group.add(ceilingShadow);
  }
  }
  if (!runtime.levelOnly) {
  const day = room.sun.enabled ? Math.max(0, Math.sin((room.sun.hour - 6) / 12 * Math.PI)) : 0;
  const daylightBounce = daylightFactor(day, daylightOpeningArea(room), polygonArea(room.vertices));
  // shortcut: hemisphere approximates diffuse daylight bounce; use global illumination for calibrated lighting accuracy.
  group.add(new THREE.HemisphereLight(architectural ? '#eef2ff' : '#f5f7ff', '#d3ceba', architectural ? daylightBounce * 0.14 : 0.035 + daylightBounce * 3.5));
  if (architectural && day > 0) {
    // shortcut: window area lights approximate sky bounce without occlusion; replace with traced GI for calibrated transport.
    for (const opening of room.openings) {
      if (opening.type === 'door' && opening.doorStyle !== 'frame' && opening.open === false) continue;
      const [start, end] = roomWallEndpoints(room, opening.wall);
      const t = (opening.offset + opening.width / 2) / Math.hypot(end.x - start.x, end.z - start.z);
      const inward = runtime.walls[opening.wall].inward;
      const light = new THREE.RectAreaLight(kelvinColor(5500), day * room.sun.intensity * 3.2, opening.width, opening.height);
      light.position.set(start.x + (end.x - start.x) * t + inward.x * (room.thickness / 2 + 0.01), opening.sill + opening.height / 2, start.z + (end.z - start.z) * t + inward.z * (room.thickness / 2 + 0.01));
      light.lookAt(light.position.x + inward.x, light.position.y, light.position.z + inward.z);
      group.add(light);
    }
  }
  const sun = new THREE.DirectionalLight(kelvinColor(4500 + day * 2000), room.sun.enabled ? room.sun.intensity * day : 0);
  const azimuth = THREE.MathUtils.degToRad(room.sun.azimuth + (room.sun.hour - 12) * 12);
  const elevation = day * Math.PI * 0.25;
  const distance = span * 4;
  sun.position.set(cx + Math.sin(azimuth) * Math.cos(elevation) * distance, Math.sin(elevation) * distance, cz - Math.cos(azimuth) * Math.cos(elevation) * distance);
  sun.target.position.set(cx, 0, cz);
  sun.castShadow = day > 0 && runtime.graphics.shadows > 0;
  const shadowSize = runtime.graphics.shadows || 512;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -span;
  sun.shadow.camera.right = sun.shadow.camera.top = span;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = distance + span * 3;
  sun.shadow.camera.layers.enable(1);
  sun.shadow.bias = -0.0001;
  sun.shadow.normalBias = architectural ? 0.007 : 0.018;
  sun.shadow.radius = architectural ? 2.5 : 1;
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  group.add(sun, sun.target);
  }
  reconcileRoomItems(runtime, room);
  if (!runtime.levelOnly) {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(30, span * 4), Math.max(30, span * 4)), new THREE.MeshStandardMaterial({ color: '#e9ece4', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, -0.19, cz);
  ground.receiveShadow = true;
  ground.userData.exterior = architectural;
  group.add(ground);
  const grid = new THREE.GridHelper(Math.max(24, Math.ceil(span * 3)), Math.max(24, Math.ceil(span * 3)), '#cdd4c8', '#dce1d7');
  grid.position.set(cx, -0.185, cz);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = architectural ? 0.07 : 0.28;
  grid.userData.exterior = architectural;
  group.add(grid);
  }
  runtime.builtRoom = room;
  runtime.textureProfile = runtime.graphics.textures;
  runtime.structure = levelGeometrySignature(room, runtime.geometrySignature);
  updateFurniturePlacement(runtime, room);
  runtime.renderer.setPixelRatio(renderPixelRatio(window.devicePixelRatio, room.renderQuality, highResolution) * runtime.graphics.renderScale);
  if (!runtime.levelOnly && (detailed || room.furniture.some(item => item.material === 'metal')) && !runtime.environment) {
    const environmentScene = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(runtime.renderer);
    try { runtime.environment = generator.fromScene(environmentScene, 0.04, 0.1, 100, { size: 128 }); }
    catch { runtime.environment = null; }
    finally { environmentScene.dispose(); generator.dispose(); }
  }
  if (!runtime.levelOnly) updateEnvironment(runtime, room, runtime.viewMode);
  // Interaction raycasts can run before the first render of rebuilt objects.
  group.updateWorldMatrix(true, true);
}

function projectGlobalLighting(runtime: Runtime, project: ProjectDocument, room: Room) {
  const signature = JSON.stringify({ sun: project.sun, quality: project.renderQuality, graphics: runtime.graphics.shadows, levels: project.levels.map(level => [level.id, level.elevation, level.height, level.outline, level.points]) });
  if (signature === runtime.lightingSignature) {
    const hemisphere = runtime.projectLighting?.children.find(object => object instanceof THREE.HemisphereLight) as THREE.HemisphereLight | undefined;
    const day = project.sun.enabled ? Math.max(0, Math.sin((project.sun.hour - 6) / 12 * Math.PI)) : 0, bounce = daylightFactor(day, daylightOpeningArea(room), polygonArea(room.vertices));
    if (hemisphere) hemisphere.intensity = project.renderQuality === 'hyperrealistic' ? .035 + bounce * .16 : .12 + bounce * 2;
    return;
  }
  if (runtime.projectLighting) { disposeContent(runtime.projectLighting); runtime.projectLighting.removeFromParent(); }
  const group = new THREE.Group(); runtime.projectLighting = group; runtime.content.add(group); runtime.lightingSignature = signature;
  const outline = project.levels.flatMap(levelOutline), area = bounds(outline), top = Math.max(...project.levels.map(level => level.elevation + level.height)), span = Math.max(area.width, area.depth, top), cx = (area.minX + area.maxX) / 2, cz = (area.minZ + area.maxZ) / 2;
  const day = project.sun.enabled ? Math.max(0, Math.sin((project.sun.hour - 6) / 12 * Math.PI)) : 0;
  const bounce = daylightFactor(day, daylightOpeningArea(room), polygonArea(room.vertices));
  group.add(new THREE.HemisphereLight('#eef2ff', '#c5c0b3', project.renderQuality === 'hyperrealistic' ? 0.035 + bounce * 0.16 : 0.12 + bounce * 2));
  const sun = new THREE.DirectionalLight(kelvinColor(4500 + day * 2000), project.sun.enabled ? project.sun.intensity * day : 0);
  const azimuth = THREE.MathUtils.degToRad(project.sun.azimuth + (project.sun.hour - 12) * 12), elevation = day * Math.PI * 0.25, distance = span * 4;
  sun.position.set(cx + Math.sin(azimuth) * Math.cos(elevation) * distance, top / 2 + Math.sin(elevation) * distance, cz - Math.cos(azimuth) * Math.cos(elevation) * distance); sun.target.position.set(cx, top / 2, cz);
  sun.castShadow = day > 0 && runtime.graphics.shadows > 0; sun.shadow.mapSize.set(runtime.graphics.shadows || 512, runtime.graphics.shadows || 512); sun.shadow.camera.left = sun.shadow.camera.bottom = -span; sun.shadow.camera.right = sun.shadow.camera.top = span; sun.shadow.camera.near = 0.1; sun.shadow.camera.far = distance + span * 3; sun.shadow.camera.layers.enable(1); sun.shadow.normalBias = 0.012; sun.shadow.bias = -0.0001; sun.shadow.autoUpdate = false; sun.shadow.needsUpdate = true; group.add(sun, sun.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(30, span * 3), Math.max(30, span * 3)), new THREE.MeshStandardMaterial({ color: '#e5e8df', roughness: 1 })); ground.rotation.x = -Math.PI / 2; ground.position.set(cx, -0.2, cz); ground.receiveShadow = true; ground.userData.exterior = true; group.add(ground);
}

function buildProjectScene(runtime: Runtime, project: ProjectDocument) {
  if (project.renderQuality !== 'hyperrealistic') { runtime.postProcessing?.dispose(); runtime.postProcessing = null; runtime.postFailed = false; }
  if (project.renderQuality === 'hyperrealistic' && !runtime.areaTextures) { runtime.areaTextures = RectAreaLightTexturesLib.init(); THREE.RectAreaLightNode.setLTC(runtime.areaTextures); }
  const activeId = runtime.activeLevelId ?? project.activeLevelId;
  const residentLevels = residentLevelIds(project, activeId, runtime.viewMode === 'walk', runtime.camera.position, runtime.graphics.distance);
  runtime.shadowLightIds = shadowLightIds(project, activeId, residentLevels, runtime.camera.position, runtime.graphics.shadows === 0 ? 0 : runtime.graphics.geometry === 'low' ? 1 : 3);
  runtime.levelViews ??= new Map();
  for (const [id, view] of runtime.levelViews) if (!project.levels.some(level => level.id === id)) { disposeContent(view.runtime.content); view.runtime.content.removeFromParent(); runtime.levelViews.delete(id); }
  for (const level of project.levels) {
    const resident = residentLevels.has(level.id);
    const room = projectedLevelScene(project, level.id, resident);
    let view = runtime.levelViews.get(level.id);
    if (!view) {
      const group = new THREE.Group(); group.name = level.id; runtime.content.add(group);
      const child: Runtime = { ...runtime, parentRuntime: runtime, levelOnly: true, levelMeta: level, geometrySignature: JSON.stringify(project.roofs.filter(roof => roof.levelId === level.id).map(({ finish: _finish, undersideFinish: _under, ...roof }) => roof)), content: group, objects: new Map(), walls: [], ceiling: null, levelViews: undefined, projectExtras: undefined, projectLighting: undefined, builtRoom: null, structure: '', postProcessing: null, selectionBox: null };
      view = { runtime: child, resident }; runtime.levelViews.set(level.id, view); buildLevelRoom(child, room);
    } else {
      view.resident = resident; view.runtime.project = project; view.runtime.levelMeta = level; view.runtime.shadowLightIds = runtime.shadowLightIds;
      view.runtime.geometrySignature = JSON.stringify(project.roofs.filter(roof => roof.levelId === level.id).map(({ finish: _finish, undersideFinish: _under, ...roof }) => roof));
      view.runtime.graphics = runtime.graphics;
      updateRoom(view.runtime, room);
    }
    view.runtime.content.position.y = level.elevation;
    view.runtime.content.traverse(object => { if (object.userData.baseLayerMask === undefined) object.userData.baseLayerMask = object.layers.mask; });
  }
  runtime.projectExtras ??= new THREE.Group();
  if (!runtime.projectExtras.parent) runtime.content.add(runtime.projectExtras);
  const retainedExtras = new Set<string>();
  for (const stair of project.stairs) {
    const key = `stair:${stair.id}`; retainedExtras.add(key);
    const { finish: _finish, ...structural } = stair;
    const signature = JSON.stringify({ structural, elevations: [projectLevel(project, stair.fromLevelId).elevation, projectLevel(project, stair.toLevelId).elevation] });
    let group = runtime.projectExtras.children.find(object => object.name === key) as THREE.Group | undefined;
    if (group?.userData.geometrySignature !== signature) {
      if (group) { disposeContent(group); group.removeFromParent(); }
      group = new THREE.Group(); group.name = key; group.userData.selection = { kind: 'stair', id: stair.id }; group.userData.levelIds = [stair.fromLevelId, stair.toLevelId]; group.userData.geometrySignature = signature; runtime.projectExtras.add(group);
      const data = buildStairGeometry(project, stair), positions = data.triangles.flat();
      const geometry = indexedArchitectureGeometry(positions, data.triangles.map((_, index) => [index * 3, index * 3 + 1, index * 3 + 2]));
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
      if (data.rails.length) {
        const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial(), data.rails.length), transform = new THREE.Object3D();
        data.rails.forEach((rail, index) => { transform.position.set(rail.center.x, rail.center.y, rail.center.z); transform.rotation.set(0, THREE.MathUtils.degToRad(rail.rotation), 0); transform.scale.set(rail.size.x, rail.size.y, rail.size.z); transform.updateMatrix(); rails.setMatrixAt(index, transform.matrix); }); rails.castShadow = rails.receiveShadow = true; group.add(rails);
      }
    }
    const appearance = JSON.stringify([stair.finish, project.renderQuality, runtime.graphics.textures]);
    if (group!.userData.appearance !== appearance) {
      const mesh = group!.children[0] as THREE.Mesh; (mesh.material as THREE.Material).dispose(); mesh.material = createFloorMaterial({ ...projectToRoom(project, stair.fromLevelId), floorColor: stair.finish.color, floorFinish: stair.finish.material });
      const rails = group!.children[1] as THREE.Mesh | undefined; if (rails) { (rails.material as THREE.Material).dispose(); rails.material = createFurnitureMaterial('#6a655b', 'metal', project.renderQuality); }
      group!.userData.appearance = appearance;
    }
  }
  for (const roof of project.roofs) {
    const key = `roof:${roof.id}`; retainedExtras.add(key);
    const { finish: _finish, undersideFinish: _under, ...structural } = roof;
    const signature = JSON.stringify([structural, projectLevel(project, roof.levelId).elevation]);
    let group = runtime.projectExtras.children.find(object => object.name === key) as THREE.Group | undefined;
    if (group?.userData.geometrySignature !== signature) {
      if (group) { disposeContent(group); group.removeFromParent(); }
      group = new THREE.Group(); group.name = key; group.userData.selection = { kind: 'roof', id: roof.id }; group.userData.levelIds = [roof.levelId]; group.userData.geometrySignature = signature; runtime.projectExtras.add(group);
      const data = buildRoofGeometry(project, roof), geometry = indexedArchitectureGeometry(data.vertices, data.triangles, data.uvs);
      geometry.clearGroups();
      const top: number[] = [], underside: number[] = [];
      for (const triangle of data.triangles) { const [a, b, c] = triangle.map(index => data.vertices[index]); const normalY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z); (normalY < -1e-7 ? underside : top).push(...triangle); }
      geometry.setIndex([...top, ...underside]); if (top.length) geometry.addGroup(0, top.length, 0); if (underside.length) geometry.addGroup(top.length, underside.length, 1);
      const mesh = new THREE.Mesh(geometry, []); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    }
    const appearance = JSON.stringify([roof.finish, roof.undersideFinish, project.renderQuality, runtime.graphics.textures]);
    if (group!.userData.appearance !== appearance) {
      const mesh = group!.children[0] as THREE.Mesh; (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => material.dispose());
      const base = projectToRoom(project, roof.levelId);
      mesh.material = [createFloorMaterial({ ...base, floorColor: roof.finish.color, floorFinish: roof.finish.material }), createRoofInteriorMaterial(roof.undersideFinish, project.renderQuality)];
      group!.userData.appearance = appearance;
    }
  }
  for (const object of [...runtime.projectExtras.children]) if (!retainedExtras.has(object.name)) { disposeContent(object as THREE.Group); object.removeFromParent(); }
  const selected = runtime.levelViews.get(activeId)!.runtime;
  runtime.objects = new Map(selected.objects); runtime.walls = selected.walls; runtime.ceiling = selected.ceiling; runtime.ceilings = selected.ceilings; runtime.invalidFurniture = selected.invalidFurniture; runtime.builtRoom = projectToRoom(project, activeId);
  for (const target of ceilingFinishTargets(project, activeId)) if (target.kind === 'surface' && target.side === 'undersideFinish') {
    const slab = runtime.levelViews.get(target.levelId)?.runtime.objects.get(`floor:${target.id}`);
    if (slab) runtime.objects.set(`ceiling:${target.id}`, slab);
  }
  runtime.projectExtras?.children.forEach(object => { const selection = object.userData.selection as Selection; if (selection) runtime.objects.set(selectionKey(selection), object); });
  const navigation = projectNavigationSignature(project);
  if (navigation !== runtime.renderedStructure) { runtime.scene.traverse(object => { if (object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight) object.shadow.needsUpdate = true; }); runtime.renderedStructure = navigation; }
  if (navigation !== runtime.navigationSignature) { runtime.navigator = new ArchitecturalNavigation(project); runtime.navigationSignature = navigation; if (runtime.walkState) runtime.walkState = runtime.navigator.hasSurface(runtime.walkState.surfaceId) ? runtime.navigator.move(runtime.walkState, { x: 0, z: 0 }) : runtime.navigator.start(activeId, runtime.walkState) ?? undefined; }
  projectGlobalLighting(runtime, project, runtime.builtRoom);
  if (project.renderQuality !== 'standard' && !runtime.environment) { const environmentScene = new RoomEnvironment(), generator = new THREE.PMREMGenerator(runtime.renderer); try { runtime.environment = generator.fromScene(environmentScene, 0.04, 0.1, 100, { size: 128 }); } catch { runtime.environment = null; } finally { environmentScene.dispose(); generator.dispose(); } }
  updateEnvironment(runtime, runtime.builtRoom, runtime.viewMode); runtime.content.updateWorldMatrix(true, true); runtime.needsRender = true;
}

function buildRoom(runtime: Runtime, room: Room) {
  if (runtime.project && !runtime.levelOnly) buildProjectScene(runtime, runtime.project);
  else buildLevelRoom(runtime, room);
}

function fitOrbitCamera(runtime: Runtime, room: Room, preserveZoom = false) {
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

function resetCamera(runtime: Runtime, room: Room, mode: ViewMode) {
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

function finishViewTransition(runtime: Runtime) {
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

function startViewTransition(runtime: Runtime, room: Room, mode: ViewMode) {
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

function updatePresentation(runtime: Runtime, props: Props, delta: number) {
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

export default function RoomScene(props: Props) {
  const graphicsPreferences = useGraphicsSettings();
  const locale = useLocale();
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const overlayPaused = useRef(false);
  const [preview, setPreview] = useState<Room | null>(null);
  const [previewProject, setPreviewProject] = useState<ProjectDocument | null>(null);
  const effectiveRoom = props.readOnly ? preview ?? props.room : props.room;
  const effectiveProject = props.readOnly ? previewProject ?? props.project : props.project;
  const effectiveActiveLevelId = props.readOnly ? previewProject?.activeLevelId ?? props.activeLevelId : props.activeLevelId;
  const current = useRef(props);
  current.current = { ...props, room: effectiveRoom, project: effectiveProject, activeLevelId: effectiveActiveLevelId };
  const directions = useRef(new Set<string>());
  const joystick = useRef({ x: 0, z: 0 });
  const [stick, setStick] = useState({ x: 0, z: 0 });
  const joystickPointer = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [walkBlocked, setWalkBlocked] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const lastResetKey = useRef(props.resetKey);
  const [notice, setNotice] = useState('');
  const [walkTarget, setWalkTarget] = useState<Selection | null>(null);
  const walkTargetRef = useRef<Selection | null>(null);
  useEffect(() => {
    const invalidate = () => { if (runtime.current) runtime.current.needsRender = true; };
    window.addEventListener('space-material-ready', invalidate); document.addEventListener('visibilitychange', invalidate);
    return () => { window.removeEventListener('space-material-ready', invalidate); document.removeEventListener('visibilitychange', invalidate); };
  }, []);
  useEffect(() => {
    const modal = (event: Event) => { overlayPaused.current = (event as CustomEvent<boolean>).detail === true; if (runtime.current) { runtime.current.overlayPaused = overlayPaused.current; runtime.current.needsRender = true; } directions.current.clear(); joystick.current = { x: 0, z: 0 }; setStick({ x: 0, z: 0 }); };
    window.addEventListener('space-mesh-editor-active', modal);
    return () => window.removeEventListener('space-mesh-editor-active', modal);
  }, []);
  useEffect(() => {
    const active = runtime.current;
    if (!active || !ready) return;
    active.graphics = getGraphicsProfile(); active.postProcessing?.dispose(); active.postProcessing = null; active.postFailed = false;
    buildRoom(active, current.current.room); updateSelection(active, current.current);
  }, [graphicsPreferences, ready]);
  useEffect(() => {
    if (runtime.current) runtime.current.needsRender = true;
    if (props.paused) { directions.current.clear(); joystick.current = { x: 0, z: 0 }; setStick({ x: 0, z: 0 }); }
  }, [props.paused]);
  useEffect(() => {
    runtime.current?.renderer.domElement.setAttribute('aria-label', t('Visor 3D del cuarto. Arrastra para mirar. En recorrido: WASD o flechas para moverte, Q y E para girar, R y F para mirar arriba y abajo. Toca puertas y focos, o mira hacia ellos y pulsa Enter o espacio.'));
  }, [locale, ready]);

  const changeWalkTarget = (target: Selection | null) => {
    if (target === null && walkTargetRef.current === null || sameSelection(target, walkTargetRef.current)) return;
    walkTargetRef.current = target;
    setWalkTarget(target);
  };
  const interact = (target: Selection | null) => {
    const state = current.current, active = runtime.current;
    if (!active || active.viewTransition || state.mode !== 'walk' || !canInteract(state.room, target) || !target) return;
    const next = toggleSceneInteraction(state.room, target);
    if (!state.readOnly && state.onChange(next) === false) return;
    current.current = { ...state, room: next };
    if (state.project) { const project = updateProjectRoom(state.project, active.activeLevelId ?? state.project.activeLevelId, next); active.project = project; current.current.project = project; if (state.readOnly) setPreviewProject(project); }
    updateRoom(active, next);
    updateSelection(active, current.current);
    changeWalkTarget(target);
    if (state.readOnly) setPreview(next);
    setNotice('');
  };

  useEffect(() => { setPreview(null); setPreviewProject(null); }, [props.room, props.project, props.readOnly]);

  useEffect(() => {
    let cancelled = false;
    let renderer: THREE.WebGPURenderer | null = null;
    let observer: ResizeObserver | null = null;
    let removeEvents = () => {};
    let removeOrbitEvents = () => {};
    const mount = container.current;
    if (!mount) return;
    const initialize = async () => {
      try {
        renderer = new THREE.WebGPURenderer({ antialias: true });
        try { await renderer.init(); }
        catch {
          try { renderer.dispose(); } catch { /* initialization may not have allocated a backend */ }
          if (cancelled) return;
          renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: true });
          await renderer.init();
        }
        if (cancelled) { renderer.dispose(); return; }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#e9ece4');
        const camera = new THREE.PerspectiveCamera(43, 1, 0.025, 250);
        const canvas = renderer.domElement;
        canvas.tabIndex = 0;
        canvas.setAttribute('aria-label', t('Visor 3D del cuarto. Arrastra para mirar. En recorrido: WASD o flechas para moverte, Q y E para girar, R y F para mirar arriba y abajo. Toca puertas y focos, o mira hacia ellos y pulsa Enter o espacio.'));
        mount.append(canvas);
        const transform = new TransformControls(camera, canvas);
        transform.enabled = false;
        transform.setSize(window.matchMedia('(pointer: coarse)').matches ? 1.35 : 1.05);
        transform.setColors('#ce756a', '#819968', '#6d97b4', '#d7ab5b');
        const proxy = new THREE.Object3D();
        scene.add(proxy, transform.getHelper());
        const controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.enablePan = true;
        const content = new THREE.Group();
        scene.add(content);
        const active: Runtime = { graphics: getGraphicsProfile(), needsRender: true, renderer, scene, camera, controls, content, walls: [], ceiling: null, yaw: 0, pitch: 0, fittedDistance: 0, objects: new Map(), invalidFurniture: new Set(), selectionBox: null, walkBlocked: false, viewTransition: null, orbitPose: null, animateView: !!current.current.animateView, ceilingOpacity: current.current.mode === 'walk' ? 1 : 0, transform, proxy, manipulating: null, directDragging: false, pendingEdit: false, lastOpeningBuild: 0, environment: null, architecturalEnvironment: null, sky: null, loadingSky: false, disposed: false, areaTextures: null, postProcessing: null, postFailed: false, viewMode: current.current.mode, builtRoom: null, structure: '', outlinedKey: null };
        // Wheel input may finish controls.update() before the next animation frame; its change event must invalidate that frame.
        const invalidateOrbit = () => { active.needsRender = true; };
        controls.addEventListener('change', invalidateOrbit);
        removeOrbitEvents = () => controls.removeEventListener('change', invalidateOrbit);
        runtime.current = active;
        active.overlayPaused = overlayPaused.current;
        active.roomId = current.current.roomId;
        active.project = current.current.project; active.activeLevelId = current.current.activeLevelId ?? active.project?.activeLevelId; active.presentation = current.current.presentation;
        active.publicView = current.current.publicView;
        active.onModelError = message => current.current.onModelError?.(message);
        buildRoom(active, current.current.room);
        resetCamera(active, current.current.room, current.current.mode);
        updateSelection(active, current.current);
        setWalkBlocked(active.walkBlocked);
        const resize = () => {
          const width = Math.max(1, mount.clientWidth);
          const height = Math.max(1, mount.clientHeight);
          const detailed = current.current.room.renderQuality !== 'standard';
          const highResolution = detailed && !window.matchMedia('(pointer: coarse)').matches && width > 700;
          const ratio = renderPixelRatio(window.devicePixelRatio, current.current.room.renderQuality, highResolution) * active.graphics.renderScale;
          const size = active.renderer.getSize(new THREE.Vector2());
          if (size.x !== width || size.y !== height || active.renderer.getPixelRatio() !== ratio) {
            active.postProcessing?.dispose(); active.postProcessing = null;
            active.renderer.setPixelRatio(ratio); active.renderer.setSize(width, height);
          }
          let shadowProfileChanged = false;
          content.traverse(object => {
            if (!(object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight)) return;
            const size = object instanceof THREE.DirectionalLight ? active.graphics.shadows || 512 : Math.min(active.graphics.shadows || 512, 1024);
            if (object.shadow.mapSize.x !== size) { object.shadow.mapSize.set(size, size); object.shadow.needsUpdate = true; shadowProfileChanged = true; }
          });
          // Recreate shadow nodes when switching profiles so GPU bindings do not retain the old maps.
          if (shadowProfileChanged) { buildRoom(active, current.current.room); updateSelection(active, current.current); }
          const aspect = width / height;
          if (Math.abs(camera.aspect - aspect) > 0.001) {
            camera.aspect = aspect;
            if (current.current.mode === 'orbit' && !active.viewTransition) fitOrbitCamera(active, current.current.room, true);
          }
          camera.updateProjectionMatrix();
        };
        observer = new ResizeObserver(resize);
        observer.observe(mount);
        resize();
        let pointer: { id: number; x: number; y: number; startX: number; startY: number; handled: boolean; multi: boolean } | null = null;
        const pointers = new Set<number>();
        let directPlane: THREE.Plane | null = null;
        const dragOffset = new THREE.Vector3();
        const ray = new THREE.Raycaster();
        const point = new THREE.Vector3();
        const normalized = (event: PointerEvent) => {
          const rect = canvas.getBoundingClientRect();
          return { x: (event.clientX - rect.left) / rect.width * 2 - 1, y: -(event.clientY - rect.top) / rect.height * 2 + 1, button: event.button };
        };
        const setRay = (event: PointerEvent) => { const position = normalized(event); ray.setFromCamera(new THREE.Vector2(position.x, position.y), camera); };
        const pickRay = (changeLevel = false): Selection | null => {
          const targets = [...new Set(active.objects.values())].filter(object => object.visible && object.layers.test(camera.layers));
          for (const hit of ray.intersectObjects(targets, true)) {
            if (hit.object.userData.slabSurfaceId) {
              const id = hit.object.userData.slabSurfaceId as string;
              if (hit.face?.materialIndex === 1 && active.project) {
                const lower = active.project.levels.find(level => ceilingFinishTargets(active.project!, level.id).some(target => target.id === id && target.side === 'undersideFinish'));
                if (lower) { if (changeLevel && lower.id !== active.activeLevelId) current.current.onActiveLevelChange?.(lower.id); return { kind: 'ceiling', id }; }
              }
              if (hit.object.userData.levelId !== active.activeLevelId) continue;
            }
            let item: THREE.Object3D | null = hit.object;
            while (item && !item.userData.selection) item = item.parent;
            if (item?.userData.selection) return item.userData.selection;
          }
          return null;
        };
        const pick = (event: PointerEvent): Selection | null => { setRay(event); return pickRay(true); };
        const findWalkTarget = () => {
          const state = current.current;
          camera.updateMatrixWorld();
          ray.setFromCamera(new THREE.Vector2(), camera);
          const lookedAt = pickRay();
          const candidates = [lookedAt, walkTargetRef.current, state.selection];
          for (const candidate of candidates) {
            if (!candidate || !canInteract(state.room, candidate)) continue;
            const position = itemWorldPosition(state.room, candidate);
            if (!position) continue;
            const target = new THREE.Vector3(position.x, position.y + (state.room.elevation ?? 0), position.z);
            if (target.distanceTo(camera.position) > 5) continue;
            const screen = target.project(camera);
            if (screen.z < -1 || screen.z > 1 || Math.abs(screen.x) > 0.95 || Math.abs(screen.y) > 0.95) continue;
            ray.setFromCamera(new THREE.Vector2(screen.x, screen.y), camera);
            if (sameSelection(pickRay(), candidate)) return candidate;
          }
          return null;
        };
        let lastCommitError: Error | null = null;
        const commitProxy = (force = false) => {
          if (!active.pendingEdit) return;
          const state = current.current;
          const selected = active.manipulating;
          if (state.readOnly || state.mode !== 'orbit' || !selected) { active.pendingEdit = false; return; }
          if (selected.kind === 'opening' && !force && performance.now() - active.lastOpeningBuild < 80) return;
          active.pendingEdit = false;
          active.lastOpeningBuild = performance.now();
          try {
            const next = moveSceneItem(state.room, selected, { x: proxy.position.x, y: proxy.position.y - (state.room.elevation ?? 0), z: proxy.position.z, rotation: THREE.MathUtils.radToDeg(proxy.rotation.y) });
            if (next !== state.room && state.onChange(next) === false) throw new Error('No se pudo aplicar el cambio.');
            current.current = { ...state, room: next };
            if (state.project) { active.project = updateProjectRoom(state.project, active.activeLevelId ?? state.project.activeLevelId, next); current.current.project = active.project; }
            const accepted = itemWorldPosition(next, selected);
            if (accepted) proxy.position.set(accepted.x, accepted.y + (state.room.elevation ?? 0), accepted.z);
            if (selected.kind === 'furniture') { const item = next.furniture.find(item => item.id === selected.id); if (item) proxy.rotation.y = THREE.MathUtils.degToRad(item.rotation); }
            updateRoom(active, next);
            updateSelection(active, current.current);
            setNotice('');
            lastCommitError = null;
            return true;
          } catch (cause) { lastCommitError = cause instanceof Error ? cause : new Error('No se puede colocar aquí.'); setNotice(lastCommitError.message); return false; }
        };
        const unregisterFlush = registerBeforeAppUpdate(async () => { if (active.pendingEdit && commitProxy(true) === false) throw lastCommitError ?? new Error('No se puede colocar aquí.'); });
        const finishDrag = () => {
          commitProxy(true);
          active.directDragging = false;
          active.manipulating = null;
          active.pendingEdit = false;
          directPlane = null;
          controls.enabled = current.current.mode === 'orbit' && !active.viewTransition;
          updateSelection(active, current.current);
        };
        const changed = () => { if (active.transform.dragging) active.pendingEdit = true; };
        const dragging = (event: { value: unknown }) => {
          if (event.value) { active.manipulating = current.current.selection; controls.enabled = false; }
          else finishDrag();
        };
        transform.addEventListener('objectChange', changed);
        transform.addEventListener('dragging-changed', dragging);
        const down = (event: PointerEvent) => {
          if (active.viewTransition) { event.preventDefault(); event.stopImmediatePropagation(); return; }
          if ((transform.dragging || active.directDragging) && pointer && event.pointerId !== pointer.id) { event.preventDefault(); event.stopImmediatePropagation(); return; }
          canvas.focus({ preventScroll: true });
          pointers.add(event.pointerId);
          if (pointer && pointers.size > 1) pointer.multi = true;
          if (pointers.size > 1) return;
          pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, handled: false, multi: false };
          if (current.current.mode === 'walk') canvas.setPointerCapture(event.pointerId);
          if (!transform.enabled || current.current.readOnly || current.current.mode !== 'orbit' || event.button !== 0) return;
          transform.pointerHover(normalized(event) as unknown as PointerEvent);
          if (transform.axis) { pointer.handled = true; controls.enabled = false; return; }
          const selected = pick(event);
          if (current.current.transformMode !== 'translate' || !canMove(selected) || !sameSelection(selected, current.current.selection)) return;
          directPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -proxy.position.y);
          if (!ray.ray.intersectPlane(directPlane, point)) { directPlane = null; return; }
          dragOffset.copy(proxy.position).sub(point);
          active.manipulating = selected;
          active.directDragging = true;
          controls.enabled = false;
          pointer.handled = true;
          event.preventDefault(); event.stopImmediatePropagation();
          canvas.setPointerCapture(event.pointerId);
        };
        const move = (event: PointerEvent) => {
          if (active.viewTransition) { event.preventDefault(); event.stopImmediatePropagation(); return; }
          if (!pointer || pointer.id !== event.pointerId) return;
          if (active.directDragging && directPlane) {
            event.preventDefault(); event.stopImmediatePropagation();
            if (current.current.readOnly || current.current.mode !== 'orbit') { finishDrag(); return; }
            setRay(event);
            if (ray.ray.intersectPlane(directPlane, point)) { proxy.position.copy(point).add(dragOffset); active.pendingEdit = true; }
            return;
          }
          if (current.current.mode !== 'walk') return;
          if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) >= 5) pointer.handled = true;
          active.yaw -= (event.clientX - pointer.x) * 0.004;
          active.pitch = THREE.MathUtils.clamp(active.pitch - (event.clientY - pointer.y) * 0.004, -1.25, 1.25);
          camera.rotation.set(active.pitch, active.yaw, 0, 'YXZ');
          pointer.x = event.clientX;
          pointer.y = event.clientY;
        };
        const up = (event: PointerEvent) => {
          pointers.delete(event.pointerId);
          if (active.viewTransition) { pointer = null; event.preventDefault(); event.stopImmediatePropagation(); return; }
          if (!pointer || pointer.id !== event.pointerId) return;
          if (active.directDragging) { event.preventDefault(); event.stopImmediatePropagation(); finishDrag(); if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); }
          else if (!pointer.handled && !pointer.multi && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 5) {
            const selected = pick(event);
            if (current.current.mode === 'walk') interact(selected);
            else current.current.onSelect(selected);
          }
          pointer = null;
        };
        const cancel = () => { pointers.clear(); if (transform.dragging) transform.pointerUp(null); if (active.directDragging) finishDrag(); pointer = null; controls.enabled = current.current.mode === 'orbit' && !active.viewTransition; };
        const keyDown = (event: KeyboardEvent) => {
          if (event.target !== canvas) return;
          if (active.viewTransition) { if (KEY_DIRECTIONS[event.code] || event.code === 'Enter' || event.code === 'Space') event.preventDefault(); return; }
          if (event.code === 'Escape') { cancel(); current.current.onSelect(null); return; }
          if (current.current.mode === 'orbit' && !current.current.readOnly && canMove(current.current.selection)) {
            const selected = current.current.selection;
            const position = selected ? itemWorldPosition(current.current.room, selected) : null;
            const step = current.current.room.editing.snap ? current.current.room.editing.step : 0.05;
            const shift = ({ ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, 0, -step], ArrowDown: [0, 0, step], KeyR: [0, step, 0], KeyF: [0, -step, 0] } as Record<string, number[]>)[event.code];
            const rotation = selected?.kind === 'furniture' && (event.code === 'KeyQ' || event.code === 'KeyE');
            if (position && selected && (shift || rotation)) {
              event.preventDefault();
              active.manipulating = selected;
              proxy.position.set(position.x + (shift?.[0] ?? 0), (current.current.room.elevation ?? 0) + position.y + (shift?.[1] ?? 0), position.z + (shift?.[2] ?? 0));
              if (rotation) proxy.rotation.y += THREE.MathUtils.degToRad(event.code === 'KeyQ' ? 15 : -15);
              active.pendingEdit = true; commitProxy(true); active.manipulating = null; updateSelection(active, current.current);
            }
            return;
          }
          if (current.current.mode !== 'walk') return;
          if (event.code === 'Enter' || event.code === 'Space') {
            event.preventDefault();
            if (!event.repeat) interact(findWalkTarget());
            return;
          }
          const direction = KEY_DIRECTIONS[event.code];
          if (direction) { directions.current.add(direction); event.preventDefault(); }
        };
        const keyUp = (event: KeyboardEvent) => {
          const direction = KEY_DIRECTIONS[event.code];
          if (direction) directions.current.delete(direction);
        };
        const blur = () => { cancel(); directions.current.clear(); joystickPointer.current = null; joystick.current = { x: 0, z: 0 }; setStick({ x: 0, z: 0 }); };
        canvas.addEventListener('pointerdown', down, true);
        canvas.addEventListener('pointermove', move, true);
        canvas.addEventListener('pointerup', up, true);
        canvas.addEventListener('pointercancel', cancel);
        canvas.addEventListener('lostpointercapture', cancel);
        window.addEventListener('keydown', keyDown);
        window.addEventListener('keyup', keyUp);
        window.addEventListener('blur', blur);
        removeEvents = () => {
          unregisterFlush();
          canvas.removeEventListener('pointerdown', down, true);
          canvas.removeEventListener('pointermove', move, true);
          canvas.removeEventListener('pointerup', up, true);
          canvas.removeEventListener('pointercancel', cancel);
          canvas.removeEventListener('lostpointercapture', cancel);
          transform.removeEventListener('objectChange', changed);
          transform.removeEventListener('dragging-changed', dragging);
          window.removeEventListener('keydown', keyDown);
          window.removeEventListener('keyup', keyUp);
          window.removeEventListener('blur', blur);
        };
        let previous = 0, lastWalkTargetUpdate = 0, lastMetricsUpdate = -Infinity, lastResidencyUpdate = -Infinity;
        const performanceController = new GraphicsPerformanceController();
        let sampledPreferences = getGraphicsPreferences();
        await renderer.setAnimationLoop(time => {
          if (cancelled) return;
          if (current.current.paused || active.overlayPaused || document.visibilityState === 'hidden') { previous = 0; return; }
          if (active.graphics.fps && previous && time - previous < 1000 / active.graphics.fps - 1) return;
          const elapsedMs = previous ? time - previous : 0;
          const delta = Math.min(0.04, elapsedMs / 1000);
          previous = time;
          const state = current.current;
          if (active.project && time - lastResidencyUpdate > 500) { const desired = residentLevelIds(active.project, active.activeLevelId ?? active.project.activeLevelId, state.mode === 'walk', camera.position, active.graphics.distance); const changed = [...active.levelViews ?? []].some(([id, view]) => view.resident !== desired.has(id)); if (changed) buildProjectScene(active, active.project); lastResidencyUpdate = time; }
          commitProxy();
          if (active.viewTransition) {
            if (sampleCameraTransition(active.viewTransition, performance.now(), camera)) {
              finishViewTransition(active);
              updateSelection(active, current.current);
              setTransitioning(false);
              setWalkBlocked(active.walkBlocked);
            }
          } else if (state.mode === 'walk') {
            active.yaw += (Number(directions.current.has('lookLeft')) - Number(directions.current.has('lookRight'))) * delta * 1.4;
            active.pitch = THREE.MathUtils.clamp(active.pitch + (Number(directions.current.has('lookUp')) - Number(directions.current.has('lookDown'))) * delta, -1.25, 1.25);
            camera.rotation.set(active.pitch, active.yaw, 0, 'YXZ');
            const forward = Number(directions.current.has('forward')) - Number(directions.current.has('back')) - joystick.current.z;
            const right = Number(directions.current.has('right')) - Number(directions.current.has('left')) + joystick.current.x;
            const length = Math.max(1, Math.hypot(forward, right));
            const distance = delta * 1.8 / length;
            const dx = (-Math.sin(active.yaw) * forward + Math.cos(active.yaw) * right) * distance;
            const dz = (-Math.cos(active.yaw) * forward - Math.sin(active.yaw) * right) * distance;
            if (active.navigator) {
              active.walkState ??= active.navigator.start(active.activeLevelId ?? active.project!.activeLevelId, camera.position) ?? undefined;
              if (active.walkState) {
                active.walkState = active.navigator.move(active.walkState, { x: dx, z: dz });
                camera.position.set(active.walkState.x, active.walkState.eyeY, active.walkState.z);
                if (active.walkState.levelId !== active.activeLevelId) {
                  active.activeLevelId = active.walkState.levelId;
                  if (active.project) { buildProjectScene(active, active.project); const next = projectToRoom(active.project, active.activeLevelId); current.current = { ...current.current, room: next, activeLevelId: active.activeLevelId }; if (state.readOnly) { setPreview(next); setPreviewProject({ ...active.project, activeLevelId: active.activeLevelId }); } }
                  state.onActiveLevelChange?.(active.activeLevelId);
                }
              }
            } else {
              if (furnitureWalkable({ x: camera.position.x + dx, z: camera.position.z }, state.room)) camera.position.x += dx;
              if (furnitureWalkable({ x: camera.position.x, z: camera.position.z + dz }, state.room)) camera.position.z += dz;
            }
            if (time - lastWalkTargetUpdate >= 80) { changeWalkTarget(findWalkTarget()); lastWalkTargetUpdate = time; }
          } else if (!transform.dragging && !active.directDragging && controls.update()) active.needsRender = true;
          if (state.mode === 'walk') {
            const pose = JSON.stringify({ x: camera.position.x, z: camera.position.z, yaw: active.yaw, feetY: active.walkState?.y ?? camera.position.y - 1.6, eyeY: camera.position.y, levelId: active.walkState?.levelId ?? active.activeLevelId, surfaceId: active.walkState?.surfaceId, blocked: active.walkState?.blocked ?? active.walkBlocked });
            if (canvas.dataset.walkPose !== pose) canvas.dataset.walkPose = pose;
          }
          updatePresentation(active, current.current, delta);
          if (state.mode === 'orbit' && !active.needsRender && !active.viewTransition && !transform.dragging && !active.directDragging) return;
          try {
            const renderStarted = performance.now();
            if (state.room.renderQuality === 'hyperrealistic' && active.graphics.ao !== 'off' && !active.postProcessing && !active.postFailed) {
              try { active.postProcessing = createArchitecturalPostProcessing(active.renderer, scene, camera, active.graphics.ao); }
              catch (cause) { active.postFailed = true; console.warn('Architectural effects:', cause); }
            }
            if (active.postProcessing) {
              try { active.postProcessing.render(); }
              catch (cause) {
                console.warn('Architectural effects:', cause);
                active.postProcessing.dispose(); active.postProcessing = null; active.postFailed = true;
                active.renderer.render(scene, camera);
              }
            } else active.renderer.render(scene, camera);
            active.needsRender = false;
            if (time - lastMetricsUpdate >= 1000) {
              const resources = sceneResourceUsage(scene), info = active.renderer.info;
              canvas.dataset.sceneMetrics = JSON.stringify({ sampledAt: Date.now(), activeLevelId: active.activeLevelId ?? active.builtRoom?.levelId ?? null, levels: active.project?.levels.length ?? 1, residentLevels: active.levelViews ? [...active.levelViews.values()].filter(view => view.resident).length : 1, architectureBuilds: active.levelViews ? [...active.levelViews.values()].reduce((sum, view) => sum + (view.runtime.architectureBuilds ?? 0), 0) : active.architectureBuilds ?? 0, gpuGeometries: info.memory.geometries, gpuTextures: info.memory.textures, drawCalls: info.render.drawCalls, renderedTriangles: info.render.triangles, frameMs: Math.round((performance.now() - renderStarted) * 100) / 100, walk: active.walkState ? { levelId: active.walkState.levelId, feetY: active.walkState.y, eyeY: active.walkState.eyeY, x: active.walkState.x, z: active.walkState.z, yaw: active.yaw, surfaceId: active.walkState.surfaceId, blocked: active.walkState.blocked } : null, ...resources }); lastMetricsUpdate = time;
            }
            const settings = getGraphicsPreferences();
            if (settings !== sampledPreferences && JSON.stringify(settings) !== JSON.stringify(sampledPreferences)) { performanceController.reset(); sampledPreferences = settings; }
            const adaptive = performanceController.sample(Math.max(performance.now() - renderStarted, elapsedMs), elapsedMs, active.graphics.fps || 60, settings.mode === 'auto');
            if (adaptive !== null) { setAdaptiveGraphicsTier(adaptive); sampledPreferences = getGraphicsPreferences(); }
          }
          catch (cause) {
            console.error('Room renderer:', cause);
            void active.renderer.setAnimationLoop(null);
            setError(t("No se pudo mostrar el cuarto. Actualiza el navegador o activa la aceleración gráfica."));
          }
        });
        if (cancelled) return;
        setReady(true);
        canvas.dataset.backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
        current.current.onReady?.(canvas.dataset.backend === 'webgpu' ? 'WebGPU · TSL' : 'WebGL2 · TSL');
      } catch (cause) {
        console.error('Room renderer initialization:', cause);
        observer?.disconnect();
        removeEvents();
        removeOrbitEvents();
        const active = runtime.current;
        if (active?.renderer === renderer) {
          active.controls.dispose();
          active.transform.dispose();
          active.environment?.dispose();
          if (active.selectionBox) { active.selectionBox.geometry.dispose(); (active.selectionBox.material as THREE.Material).dispose(); }
          disposeContent(active.content);
          disposeArchitecture(active);
          runtime.current = null;
        }
        try { renderer?.dispose(); } catch { /* a rejected backend might not be initialized */ }
        renderer?.domElement.remove();
        if (!cancelled) setError(t("Este navegador no pudo iniciar el visor 3D. Actualiza el navegador o activa la aceleración gráfica."));
      }
    };
    void initialize();
    return () => {
      cancelled = true;
      observer?.disconnect();
      removeEvents();
      removeOrbitEvents();
      directions.current.clear();
      joystick.current = { x: 0, z: 0 };
      const active = runtime.current;
      if (active) {
        void active.renderer.setAnimationLoop(null);
        active.controls.dispose();
        active.transform.dispose();
        active.environment?.dispose();
        if (active.selectionBox) { active.selectionBox.geometry.dispose(); (active.selectionBox.material as THREE.Material).dispose(); }
        disposeContent(active.content);
        disposeArchitecture(active);
        active.renderer.dispose();
        active.renderer.domElement.remove();
        runtime.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const active = runtime.current;
    if (!active || !ready) return;
    const previousLevelId = active.activeLevelId;
    const previousLevelsMode = active.presentation?.levels;
    active.project = effectiveProject; active.activeLevelId = effectiveActiveLevelId ?? effectiveProject?.activeLevelId; active.presentation = props.presentation;
    if (active.roomId !== props.roomId || active.publicView !== props.publicView) {
      active.roomId = props.roomId;
      active.publicView = props.publicView;
      buildRoom(active, effectiveRoom);
    } else updateRoom(active, effectiveRoom);
    updateSelection(active, current.current);
    if (props.mode === 'walk' && active.viewMode === props.mode && !active.viewTransition) {
      if (active.navigator) { if (previousLevelId !== active.activeLevelId && active.walkState?.levelId !== active.activeLevelId) resetCamera(active, effectiveRoom, props.mode); else if (active.walkState) active.camera.position.y = active.walkState.eyeY; }
      else { active.camera.position.y = (effectiveRoom.elevation ?? 0) + Math.min(1.65, effectiveRoom.height - 0.2); if (!furnitureWalkable(active.camera.position, effectiveRoom)) resetCamera(active, effectiveRoom, props.mode); }
      setWalkBlocked(active.walkBlocked);
    }
    if ((previousLevelId !== active.activeLevelId || previousLevelsMode !== active.presentation?.levels) && props.mode === 'orbit') resetCamera(active, effectiveRoom, props.mode);
  }, [effectiveRoom, effectiveProject, effectiveActiveLevelId, props.presentation, props.roomId, props.publicView, ready]);

  useEffect(() => {
    if (runtime.current && ready) {
      const active = runtime.current;
      directions.current.clear();
      joystickPointer.current = null;
      joystick.current = { x: 0, z: 0 };
      setStick({ x: 0, z: 0 });
      changeWalkTarget(null);
      const resetRequested = lastResetKey.current !== props.resetKey;
      lastResetKey.current = props.resetKey;
      if (props.animateView && !resetRequested && props.mode !== 'plan' && active.viewMode !== 'plan') {
        if (active.viewMode !== props.mode) {
          active.transform.pointerUp(null);
          active.directDragging = false;
          active.pendingEdit = false;
          active.manipulating = null;
          startViewTransition(active, current.current.room, props.mode);
          setTransitioning(!!active.viewTransition);
        }
      } else {
        resetCamera(active, current.current.room, props.mode);
        setTransitioning(false);
      }
      updateSelection(active, current.current);
      setWalkBlocked(active.walkBlocked);
    }
  }, [props.mode, props.resetKey, props.animateView, ready]);

  useEffect(() => {
    const active = runtime.current;
    if (!active || !ready) return;
    if (props.readOnly || props.mode !== 'orbit' || active.manipulating && !sameSelection(active.manipulating, props.selection)) {
      active.transform.pointerUp(null);
      active.directDragging = false;
      active.pendingEdit = false;
      active.manipulating = null;
      active.controls.enabled = props.mode === 'orbit' && !active.viewTransition;
    }
    updateSelection(active, current.current);
    setNotice('');
  }, [props.selection, props.readOnly, props.transformMode, props.mode, ready]);

  const moveJoystick = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (runtime.current?.viewTransition) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const vector = joystickVector((event.clientX - rect.left - rect.width / 2) / 34, (event.clientY - rect.top - rect.height / 2) / 34);
    joystick.current = vector;
    setStick(vector);
  };
  const releaseJoystick = () => {
    joystickPointer.current = null;
    joystick.current = { x: 0, z: 0 };
    setStick({ x: 0, z: 0 });
  };
  const targetDoor = walkTarget?.kind === 'opening' ? effectiveRoom.openings.find(opening => opening.id === walkTarget.id && opening.type === 'door' && opening.doorStyle !== 'frame') : null;
  const targetLight = walkTarget?.kind === 'light' ? effectiveRoom.lights.find(light => light.id === walkTarget.id) : null;
  const interactionLabel = targetDoor ? targetDoor.open === false ? t("Abrir puerta") : t("Cerrar puerta") : targetLight ? t(targetLight.enabled ? 'Apagar {{name}}' : 'Encender {{name}}', { name: targetLight.name }) : null;

  return <div className="room-scene" ref={container}>
    {!ready && !error && <div className="scene-loading"><LoaderCircle size={24} /><span>{t("Cargando…")}</span></div>}
    {error && <div className="scene-error" role="alert"><strong>{t("No pudimos iniciar el visor")}</strong><p>{t(error)}</p></div>}
    {notice && !error && <div className="scene-notice" role="status">{t(notice)}</div>}
    {ready && !error && !transitioning && props.mode === 'walk' && <><div className="walk-hint">{walkBlocked ? t("No queda espacio libre para caminar. Mueve algún mueble.") : t("Arrastra para mirar · Toca puertas y focos")}</div>{interactionLabel && <button type="button" className="walk-interaction" aria-pressed={targetDoor ? targetDoor.open !== false : targetLight?.enabled} onClick={() => interact(walkTargetRef.current)}>{targetDoor ? targetDoor.open === false ? <DoorOpen size={20} /> : <DoorClosed size={20} /> : <Lightbulb size={20} />}<span>{interactionLabel}</span></button>}<div className="walk-joystick"><button type="button" tabIndex={-1} className="joystick-base" aria-label={t("Joystick de movimiento: arrastra para caminar. Con teclado usa WASD en el visor.")} onPointerDown={event => { event.preventDefault(); event.stopPropagation(); joystickPointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); moveJoystick(event); }} onPointerMove={event => { if (joystickPointer.current === event.pointerId) { event.stopPropagation(); moveJoystick(event); } }} onPointerUp={releaseJoystick} onPointerCancel={releaseJoystick} onLostPointerCapture={releaseJoystick}><span className="joystick-knob" style={{ transform: `translate(${stick.x * 34}px, ${stick.z * 34}px)` }} /></button></div></>}
  </div>;
}
