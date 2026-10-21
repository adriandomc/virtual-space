import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { architecturalAreaTextures } from './areaLightTextures';
import { bounds, polygonArea, roomWallEndpoints } from '../../domain/project/model';
import { createCeilingFinishMaterial, createSlabMaterials, createFloorMaterial, setMaterialTextureResolution } from './materials';
import { daylightFactor, daylightOpeningArea, renderPixelRatio } from './navigation';
import type { Point, Room, Selection } from '../../domain/project/types';
import { reconcileLevelWalls } from './sceneWalls';
import { prepareScenePicking } from './scenePickingAcceleration';
import { levelGeometrySignature, slabGeometry } from './sceneProjection';
import type { SceneRuntime } from './sceneRuntime';
import { disposeContent } from './sceneResources';
import { updateEnvironment, kelvinColor } from './sceneEnvironment';
import { updateFurniturePlacement, reconcileRoomItems } from './sceneItems';

function floorShape(vertices: Point[]) {
  const shape = new THREE.Shape();
  vertices.forEach((vertex, index) => index ? shape.lineTo(vertex.x, -vertex.z) : shape.moveTo(vertex.x, -vertex.z));
  shape.closePath();
  return shape;
}

export function buildLevelRoom(runtime: SceneRuntime, room: Room) {
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
    runtime.areaTextures = architecturalAreaTextures();
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
  reconcileLevelWalls(runtime, room);
  const shadowMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
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
  prepareScenePicking(group);
}
