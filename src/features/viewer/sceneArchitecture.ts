import { stableStringify } from '../../shared/sameData';
import { cachedRoofGeometry } from './sceneGeometryCache';
import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { architecturalAreaTextures } from './areaLightTextures';
import { bounds, polygonArea } from '../../domain/project/model';
import { createCeilingMaterial, createCeilingFinishMaterial, createSlabMaterials, createWallFinishMaterial, createFloorMaterial, createRoofInteriorMaterial, createFurnitureMaterial, setMaterialTextureResolution, tintMaterial } from './materials';
import { daylightFactor, daylightOpeningArea } from './navigation';
import type { Room, Selection } from '../../domain/project/types';
import { ceilingFinishTargets, levelOutline, projectLevel, projectToRoom, type ProjectDocument } from '../../domain/project/projectDocument';
import { buildStairGeometry } from '../../domain/project/projectGeometry';
import { indexedArchitectureGeometry, levelGeometrySignature, projectedLevelScene, projectNavigationSignature, residentLevelIds, shadowLightIds } from './sceneProjection';
import { ArchitecturalNavigation } from './architecturalNavigation';
import type { SceneRuntime } from './sceneRuntime';
import { disposeContent } from './sceneResources';
import { updateEnvironment, kelvinColor } from './sceneEnvironment';
import { updateFurniturePlacement, reconcileRoomItems } from './sceneItems';
import { buildLevelRoom } from './sceneLevel';
import { reconcileLevelWalls } from './sceneWalls';
import { updateFurnitureAppearance } from './furnitureRendering';
import { prepareScenePicking } from './scenePickingAcceleration';
import { selectionKey } from './sceneSelection';
import { repaintLightBody, repaintOpening } from './sceneItemAppearance';
import { configurePointLightShadow } from './sceneLightShadows';

export function updateRoom(runtime: SceneRuntime, room: Room) {
  runtime.needsRender = true;
  if (runtime.project && !runtime.levelOnly) { buildProjectScene(runtime, runtime.project); return; }
  const structure = levelGeometrySignature(room, runtime.geometrySignature);
  if (runtime.builtRoom === room && runtime.structure === structure) return;
  if (runtime.structure !== structure) { buildRoom(runtime, room); return; }
  const previous = runtime.builtRoom;
  const textureChanged = runtime.textureProfile !== runtime.graphics.textures;
  setMaterialTextureResolution(runtime.graphics.textures);
  const wallsChanged = reconcileLevelWalls(runtime, room);
  const itemsChanged = reconcileRoomItems(runtime, room);
  for (const wall of runtime.walls) {
    const segment = room.wallSegments?.[wall.index], original = runtime.levelMeta?.walls.find(item => item.id === segment?.id);
    const left = original?.left ?? { color: segment?.leftColor ?? room.wallColors[wall.index], material: 'concrete' as const }, right = original?.right ?? { color: segment?.rightColor ?? room.wallColors[wall.index], material: 'concrete' as const };
    const finishKey = [left.color, left.material, right.color, right.material].join(':');
    if (textureChanged || wall.finishKey !== finishKey) {
      const parts = wall.finishKey.split(':');
      if (!textureChanged && parts[1] === left.material && parts[3] === right.material) {
        tintMaterial(wall.material, left.color); tintMaterial(wall.opposite, right.color); wall.finishKey = finishKey; continue;
      }
      wall.material.dispose(); wall.opposite.dispose(); wall.material = createWallFinishMaterial(left, room.renderQuality); wall.opposite = createWallFinishMaterial(right, room.renderQuality); wall.finishKey = finishKey; (wall.group.children[0] as THREE.Mesh).material = [wall.material, wall.opposite];
    }
  }
  for (const surface of runtime.levelMeta?.surfaces ?? []) {
    const mesh = runtime.objects.get(`${surface.kind}:${surface.id}`) as THREE.Mesh | undefined;
    const before = previous?.surfaces?.find(value => value.id === surface.id);
    if (mesh && (textureChanged || stableStringify([before?.finish, before?.undersideFinish]) !== stableStringify([surface.finish, surface.undersideFinish]))) {
      if (!textureChanged && before?.finish.material === surface.finish.material && before?.undersideFinish?.material === surface.undersideFinish?.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material, index) => tintMaterial(material, index === 1 ? (surface.undersideFinish ?? surface.finish).color : surface.finish.color)); continue;
      }
      new Set(Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => material.dispose());
      mesh.material = surface.kind === 'floor' ? createSlabMaterials(surface.finish, surface.undersideFinish, room.renderQuality) : createCeilingFinishMaterial(surface.finish, room.renderQuality);
    }
  }
  if (!runtime.levelMeta && previous && (textureChanged || previous.floorColor !== room.floorColor || previous.floorFinish !== room.floorFinish)) { const floor = runtime.objects.get('floor') as THREE.Mesh; if (!textureChanged && previous.floorFinish === room.floorFinish) tintMaterial(floor.material as THREE.Material, room.floorColor); else { (floor.material as THREE.Material).dispose(); floor.material = createFloorMaterial(room); } }
  if (!runtime.levelMeta && runtime.ceiling && (textureChanged || previous?.ceilingColor !== room.ceilingColor)) { if (!textureChanged) tintMaterial(runtime.ceiling.material as THREE.Material, room.ceilingColor); else { (runtime.ceiling.material as THREE.Material).dispose(); runtime.ceiling.material = createCeilingMaterial(room.ceilingColor, room.renderQuality); } }
  for (const opening of room.openings) {
    if (textureChanged || previous?.openings.find(value => value.id === opening.id)?.color !== opening.color) repaintOpening(runtime.content, opening, room.renderQuality, textureChanged);
    if (opening.type !== 'door' || opening.doorStyle === 'frame' || previous?.openings.find(value => value.id === opening.id)?.open === opening.open) continue;
    runtime.content.traverse(object => { if (object.userData.doorId === opening.id) object.rotation.y = opening.open === false ? 0 : object.userData.openAngle; });
  }
  let moved = itemsChanged || wallsChanged;
  for (const item of room.furniture) {
    const group = runtime.objects.get(`furniture:${item.id}`);
    const before = previous?.furniture.find(value => value.id === item.id);
    if (group && before && (textureChanged || before.color !== item.color || before.material !== item.material)) updateFurnitureAppearance(group as THREE.Group, item, room.renderQuality, textureChanged);
    const radians = THREE.MathUtils.degToRad(item.rotation);
    if (group && (group.position.x !== item.x || group.position.z !== item.z || group.rotation.y !== radians)) {
      group.position.set(item.x, 0, item.z);
      group.rotation.y = radians;
      moved = true;
    }
  }
  for (const item of room.lights) {
    const group = runtime.objects.get(`light:${item.id}`);
    if (group && (textureChanged || previous?.lights.find(value => value.id === item.id)?.color !== item.color)) repaintLightBody(group, item, room.renderQuality, textureChanged);
    const pointLights: THREE.PointLight[] = [];
    group?.traverse(object => {
      if (object instanceof THREE.PointLight) pointLights.push(object);
      if (object instanceof THREE.HemisphereLight) { object.color.copy(kelvinColor(item.temperature)); object.groundColor.copy(object.color); object.intensity = item.enabled ? Math.min(.25, item.lumens / (polygonArea(room.vertices) * 180)) : 0; }
      if (object.userData.bulb && object instanceof THREE.Mesh) { const material = object.material as THREE.MeshStandardMaterial; material.color.copy(item.enabled ? kelvinColor(item.temperature) : new THREE.Color('#c0bcae')); material.emissive.copy(kelvinColor(item.temperature)); material.emissiveIntensity = item.enabled ? 3 : 0; }
    });
    for (const light of pointLights) {
      light.color.copy(kelvinColor(item.temperature)); light.intensity = item.enabled ? item.lumens / (4 * Math.PI) : 0;
      const castsShadow = runtime.graphics.shadows > 0 && item.enabled && (runtime.shadowLightIds ? runtime.shadowLightIds.has(item.id) : room.lights.filter(light => light.enabled).findIndex(light => light.id === item.id) < (runtime.graphics.geometry === 'low' ? 1 : 3));
      configurePointLightShadow(light, castsShadow, Math.min(runtime.graphics.shadows || 512, 1024));
    }
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
  if (moved) updateFurniturePlacement(runtime, room);
  runtime.builtRoom = room;
  runtime.textureProfile = runtime.graphics.textures;
  if (!runtime.levelOnly) updateEnvironment(runtime, room, runtime.viewMode);
}

function projectGlobalLighting(runtime: SceneRuntime, project: ProjectDocument, room: Room) {
  const signature = stableStringify({ sun: project.sun, quality: project.renderQuality, graphics: runtime.graphics.shadows, levels: project.levels.map(level => [level.id, level.elevation, level.height, level.outline, level.points]) });
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

export function buildProjectScene(runtime: SceneRuntime, project: ProjectDocument) {
  if (project.renderQuality !== 'hyperrealistic') { runtime.postProcessing?.dispose(); runtime.postProcessing = null; runtime.postFailed = false; }
  if (project.renderQuality === 'hyperrealistic' && !runtime.areaTextures) { runtime.areaTextures = architecturalAreaTextures(); THREE.RectAreaLightNode.setLTC(runtime.areaTextures); }
  const activeId = runtime.activeLevelId ?? project.activeLevelId;
  const residentLevels = residentLevelIds(project, activeId, runtime.viewMode === 'walk', runtime.camera.position, runtime.graphics.distance);
  runtime.shadowLightIds = shadowLightIds(project, activeId, residentLevels, runtime.camera.position, runtime.graphics.shadows === 0 ? 0 : runtime.graphics.geometry === 'low' ? 1 : 3);
  runtime.levelViews ??= new Map();
  for (const [id, view] of runtime.levelViews) if (!project.levels.some(level => level.id === id)) { disposeContent(view.runtime.content); view.runtime.content.removeFromParent(); runtime.levelViews.delete(id); }
  for (const level of project.levels) {
    const resident = residentLevels.has(level.id);
    let view = runtime.levelViews.get(level.id);
    // Surface outlines reference stable point IDs. Interior coordinates can change without changing
    // those IDs or the outer room polygon, and must still invalidate the real slab/ceiling buffers.
    const surfacePoints = new Set(level.surfaces.flatMap(surface => surface.outline));
    const geometrySignature = stableStringify({ roofs: project.roofs.filter(roof => roof.levelId === level.id).map(({ finish: _finish, undersideFinish: _under, ...roof }) => roof), surfacePoints: level.points.filter(point => surfacePoints.has(point.id)) });
    const inputSignature = stableStringify([level, resident, project.renderQuality, project.sun, runtime.graphics.geometry, runtime.graphics.textures, runtime.graphics.shadows, [...runtime.shadowLightIds].sort(), geometrySignature]);
    if (view?.inputSignature === inputSignature) continue;
    const room = projectedLevelScene(project, level.id, resident);
    if (!view) {
      const group = new THREE.Group(); group.name = level.id; runtime.content.add(group);
      const child: SceneRuntime = { ...runtime, parentRuntime: runtime, levelOnly: true, levelMeta: level, geometrySignature, content: group, objects: new Map(), walls: [], ceiling: null, levelViews: undefined, projectExtras: undefined, projectLighting: undefined, builtRoom: null, structure: '', postProcessing: null, selectionBox: null };
      view = { runtime: child, resident, inputSignature }; runtime.levelViews.set(level.id, view); buildLevelRoom(child, room);
    } else {
      view.inputSignature = inputSignature; view.resident = resident; view.runtime.project = project; view.runtime.levelMeta = level; view.runtime.shadowLightIds = runtime.shadowLightIds;
      view.runtime.geometrySignature = geometrySignature;
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
    const signature = stableStringify({ structural, elevations: [projectLevel(project, stair.fromLevelId).elevation, projectLevel(project, stair.toLevelId).elevation] });
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
    const appearance = stableStringify([stair.finish, project.renderQuality, runtime.graphics.textures]);
    if (group!.userData.appearance !== appearance) {
      const mesh = group!.children[0] as THREE.Mesh;
      const pipeline = [stair.finish.material, project.renderQuality, runtime.graphics.textures].join(':');
      if (group!.userData.materialPipeline === pipeline) tintMaterial(mesh.material as THREE.Material, stair.finish.color);
      else { (mesh.material as THREE.Material).dispose(); mesh.material = createFloorMaterial({ renderQuality: project.renderQuality, floorColor: stair.finish.color, floorFinish: stair.finish.material }); }
      group!.userData.materialPipeline = pipeline;
      const rails = group!.children[1] as THREE.Mesh | undefined; if (rails && rails.userData.quality !== project.renderQuality) { (rails.material as THREE.Material).dispose(); rails.material = createFurnitureMaterial('#6a655b', 'metal', project.renderQuality); rails.userData.quality = project.renderQuality; }
      group!.userData.appearance = appearance;
    }
  }
  for (const roof of project.roofs) {
    const key = `roof:${roof.id}`; retainedExtras.add(key);
    const { finish: _finish, undersideFinish: _under, ...structural } = roof;
    const signature = stableStringify([structural, projectLevel(project, roof.levelId).elevation]);
    let group = runtime.projectExtras.children.find(object => object.name === key) as THREE.Group | undefined;
    if (group?.userData.geometrySignature !== signature) {
      if (group) { disposeContent(group); group.removeFromParent(); }
      group = new THREE.Group(); group.name = key; group.userData.selection = { kind: 'roof', id: roof.id }; group.userData.levelIds = [roof.levelId]; group.userData.geometrySignature = signature; runtime.projectExtras.add(group);
      const data = cachedRoofGeometry(project, roof), geometry = indexedArchitectureGeometry(data.vertices, data.triangles, data.uvs);
      geometry.clearGroups();
      const top: number[] = [], underside: number[] = [];
      for (const triangle of data.triangles) { const [a, b, c] = triangle.map(index => data.vertices[index]); const normalY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z); (normalY < -1e-7 ? underside : top).push(...triangle); }
      geometry.setIndex([...top, ...underside]); if (top.length) geometry.addGroup(0, top.length, 0); if (underside.length) geometry.addGroup(top.length, underside.length, 1);
      const mesh = new THREE.Mesh(geometry, []); mesh.castShadow = mesh.receiveShadow = true; group.add(mesh);
    }
    const appearance = stableStringify([roof.finish, roof.undersideFinish, project.renderQuality, runtime.graphics.textures]);
    if (group!.userData.appearance !== appearance) {
      const mesh = group!.children[0] as THREE.Mesh;
      const pipeline = [roof.finish.material, roof.undersideFinish.material, project.renderQuality, runtime.graphics.textures].join(':');
      if (group!.userData.materialPipeline === pipeline) {
        const materials = mesh.material as THREE.Material[]; tintMaterial(materials[0], roof.finish.color); tintMaterial(materials[1], roof.undersideFinish.color);
      } else {
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => material.dispose());
        mesh.material = [createFloorMaterial({ renderQuality: project.renderQuality, floorColor: roof.finish.color, floorFinish: roof.finish.material }), createRoofInteriorMaterial(roof.undersideFinish, project.renderQuality)];
      }
      group!.userData.materialPipeline = pipeline;
      group!.userData.appearance = appearance;
    }
  }
  for (const object of [...runtime.projectExtras.children]) if (!retainedExtras.has(object.name)) { disposeContent(object as THREE.Group); object.removeFromParent(); }
  const selected = runtime.levelViews.get(activeId)!.runtime;
  runtime.objects = new Map(selected.objects); runtime.walls = selected.walls; runtime.ceiling = selected.ceiling; runtime.ceilings = selected.ceilings; runtime.invalidFurniture = selected.invalidFurniture; runtime.builtRoom = selected.builtRoom!;
  for (const target of ceilingFinishTargets(project, activeId)) if (target.kind === 'surface' && target.side === 'undersideFinish') {
    const slab = runtime.levelViews.get(target.levelId)?.runtime.objects.get(`floor:${target.id}`);
    if (slab) runtime.objects.set(`ceiling:${target.id}`, slab);
  }
  runtime.projectExtras?.children.forEach(object => { const selection = object.userData.selection as Selection; if (selection) runtime.objects.set(selectionKey(selection), object); });
  const navigation = projectNavigationSignature(project);
  if (navigation !== runtime.renderedStructure) { runtime.scene.traverse(object => { if (object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight) object.shadow.needsUpdate = true; }); runtime.renderedStructure = navigation; }
  if (navigation !== runtime.navigationSignature) { runtime.navigator = new ArchitecturalNavigation(project); runtime.navigationSignature = navigation; if (runtime.walkState) runtime.walkState = runtime.navigator.hasSurface(runtime.walkState.surfaceId) ? runtime.navigator.move(runtime.walkState, { x: 0, z: 0 }) : runtime.navigator.start(activeId, runtime.walkState) ?? undefined; }
  runtime.navigator?.updateDynamic(project);
  projectGlobalLighting(runtime, project, runtime.builtRoom);
  if (project.renderQuality !== 'standard' && !runtime.environment) { const environmentScene = new RoomEnvironment(), generator = new THREE.PMREMGenerator(runtime.renderer); try { runtime.environment = generator.fromScene(environmentScene, 0.04, 0.1, 100, { size: 128 }); } catch { runtime.environment = null; } finally { environmentScene.dispose(); generator.dispose(); } }
  prepareScenePicking(runtime.projectExtras);
  updateEnvironment(runtime, runtime.builtRoom, runtime.viewMode); runtime.content.updateWorldMatrix(true, true); runtime.needsRender = true;
}

export function buildRoom(runtime: SceneRuntime, room: Room) {
  if (runtime.project && !runtime.levelOnly) buildProjectScene(runtime, runtime.project);
  else buildLevelRoom(runtime, room);
}
