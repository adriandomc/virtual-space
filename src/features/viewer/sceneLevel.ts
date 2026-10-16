import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightTexturesLib } from 'three/addons/lights/RectAreaLightTexturesLib.js';
import { bounds, pointInPolygon, polygonArea, roomWallEndpoints, wallCount } from '../../domain/project/model';
import { createCeilingFinishMaterial, createSlabMaterials, createWallFinishMaterial, createFloorMaterial, createWoodMaterial, setMaterialTextureResolution } from './materials';
import { box } from './furnitureRendering';
import { daylightFactor, daylightOpeningArea, renderPixelRatio } from './navigation';
import type { Point, Room, Selection } from '../../domain/project/types';
import { wallRoofProfile } from '../../domain/project/projectGeometry';
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
