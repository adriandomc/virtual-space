import { stableStringify } from '../../shared/sameData';
import { cachedRoofGeometry } from './sceneGeometryCache';
import * as THREE from 'three/webgpu';
import { pointInPolygon, roomWallEndpoints, wallCount } from '../../domain/project/model';
import { wallRoofProfile } from '../../domain/project/projectGeometry';
import type { Room, Selection } from '../../domain/project/types';
import { createWallFinishMaterial } from './materials';
import { openingFrameMaterial, openingLeafMaterial } from './sceneItemAppearance';
import { box } from './furnitureRendering';
import type { SceneRuntime } from './sceneRuntime';
import { disposeContent } from './sceneResources';
import { prepareScenePicking } from './scenePickingAcceleration';

export function wallGeometrySignature(room: Room, index: number) {
  const segment = room.wallSegments?.[index];
  return stableStringify([roomWallEndpoints(room, index), segment?.id, segment?.height ?? room.height, segment?.thickness ?? room.thickness,
    room.openings.filter(opening => opening.wall === index).map(({ open: _open, color: _color, ...opening }) => opening)]);
}

/** Each bundle owns one wall, its frames and its permanent shadow-only counterparts. */
export function reconcileLevelWalls(runtime: SceneRuntime, room: Room) {
  const count = wallCount(room), keep = new Set<number>();
  let changed = false;
  for (const object of [...runtime.content.children]) {
    const index = object.userData.wallBundle as number | undefined;
    if (index === undefined) continue;
    if (index < count && object.userData.wallSignature === wallGeometrySignature(room, index)) { keep.add(index); continue; }
    for (const [key, target] of runtime.objects) {
      let ancestor: THREE.Object3D | null = target;
      while (ancestor && ancestor !== object) ancestor = ancestor.parent;
      if (ancestor) runtime.objects.delete(key);
    }
    disposeContent(object as THREE.Group); object.removeFromParent(); changed = true;
  }
  runtime.walls.length = count;
  const indices = Array.from({ length: count }, (_, index) => index).filter(index => !keep.has(index));
  if (indices.length) buildWalls(runtime, room, indices);
  return changed || indices.length > 0;
}

function buildWalls(runtime: SceneRuntime, room: Room, indices: number[]) {
  const architectural = room.renderQuality === 'hyperrealistic';
  const undersides = runtime.project?.roofs.filter(roof => roof.levelId === room.levelId).flatMap(roof => cachedRoofGeometry(runtime.project!, roof).underside);
  for (const index of indices) {
    const group = new THREE.Group();
    group.userData.wallBundle = index;
    group.userData.wallSignature = wallGeometrySignature(room, index);
    runtime.content.add(group);
  const trim = architectural ? new THREE.MeshPhysicalNodeMaterial({ color: '#ebe7df', roughness: 0.45, clearcoat: 0.12, clearcoatRoughness: 0.5 }) : new THREE.MeshStandardMaterial({ color: '#efece3', roughness: 0.8 });
  const shadowMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const glassMaterial = architectural ? new THREE.MeshPhysicalNodeMaterial({ color: '#ffffff', transmission: 0.98, thickness: 0.004, ior: 1.5, roughness: 0.025, metalness: 0, transparent: true, side: THREE.DoubleSide, depthWrite: false }) : new THREE.MeshStandardMaterial({ color: '#acd6dc', transparent: true, opacity: 0.12, roughness: 0.15, side: THREE.DoubleSide, depthWrite: false });

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
    const top = runtime.project && room.levelId && segment ? wallRoofProfile(runtime.project, room.levelId, segment.id, undersides) : [{ t: 0, height }, { t: 1, height }];
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
    runtime.walls[index] = { group: wallGroup, midpoint, inward, material, opposite, finishKey, index };
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
      const frameMaterial = openingFrameMaterial(opening, room.renderQuality);
      const frameBox = (size: [number, number, number], at: [number, number, number]) => { const mesh = box(openingGroup, size, at, frameMaterial); mesh.userData.openingPaintId = opening.id; mesh.userData.openingPaintRole = 'frame'; return mesh; };
      for (const edge of [-1, 1]) frameBox([frame, opening.height + frame, thickness + 0.045], [x + edge * (opening.width / 2 - frame / 2), y + opening.height / 2, 0]);
      frameBox([opening.width, frame, thickness + 0.045], [x, y + opening.height - frame / 2, 0]);
      if (opening.type === 'window') {
        frameBox([opening.width + 0.09, frame, thickness + 0.11], [x, y, 0]);
        frameBox([frame * 0.65, opening.height, 0.035], [x, y + opening.height / 2, 0]);
        frameBox([opening.width, frame * 0.65, 0.035], [x, y + opening.height * 0.55, 0]);
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
          const leaf = box(hinge, [opening.width - frame * 2, opening.height - frame, 0.04], [direction * (opening.width - frame * 2) / 2, (opening.height - frame) / 2, 0], openingLeafMaterial(opening, room.renderQuality));
          leaf.userData.openingPaintId = opening.id; leaf.userData.openingPaintRole = 'leaf';
          leaf.castShadow = true;
          box(hinge, [0.07, 0.025, 0.075], [direction * (opening.width - 0.15), Math.min(0.98, (opening.height - frame) / 2), innerSide * 0.045], new THREE.MeshStandardMaterial({ color: '#7c7b6c', metalness: 0.75, roughness: 0.3 }));
        }
      }
      const openingShadows = openingGroup.clone(true);
      openingShadows.traverse(object => object.layers.set(1));
      openingGroup.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = false; });
      group.add(openingShadows);
    }
    const shadowFrames = wallGroup.clone(true);
    shadowFrames.remove(shadowFrames.children[0]);
    shadowFrames.traverse(object => object.layers.set(1));
    wallGroup.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = false; });
    group.add(shadowFrames);
    prepareScenePicking(group);
  }
}
