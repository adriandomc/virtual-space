import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { LoaderCircle } from 'lucide-react';
import { bounds, furnitureCorners, furnitureWalkable, interiorPoint, interiorWalkPoint, itemWorldPosition, moveSceneItem, pointInPolygon, polygonArea } from './model';
import { createCeilingMaterial, createFloorMaterial, createWallMaterial, createWoodMaterial } from './materials';
import { daylightFactor, joystickVector } from './navigation';
import type { FurnitureItem, Point, Room, Selection, ViewMode } from './types';
import './scene.css';

type Props = {
  room: Room;
  mode: ViewMode;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  onChange: (room: Room) => void;
  readOnly: boolean;
  transformMode: 'translate' | 'rotate';
  showFurniture: boolean;
  resetKey: number;
  onReady?: (backend: string) => void;
};
type WallView = { group: THREE.Group; midpoint: THREE.Vector3; inward: THREE.Vector3; material: THREE.MeshStandardNodeMaterial; index: number };
const KEY_DIRECTIONS: Record<string, string> = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyQ: 'lookLeft', KeyE: 'lookRight', KeyR: 'lookUp', KeyF: 'lookDown' };
type Runtime = {
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
  selectionBox: THREE.BoxHelper | null;
  transform: TransformControls;
  proxy: THREE.Object3D;
  manipulating: Selection | null;
  directDragging: boolean;
  pendingEdit: boolean;
  lastOpeningBuild: number;
  environment: THREE.RenderTarget | null;
  builtRoom: Room | null;
  structure: string;
  outlinedKey: string | null;
  walkBlocked: boolean;
};

const selectionKey = (selection: Selection) => selection.kind === 'wall' ? `wall:${selection.index}` : 'id' in selection ? `${selection.kind}:${selection.id}` : selection.kind;
const sameSelection = (a: Selection | null, b: Selection | null) => a != null && b != null && selectionKey(a) === selectionKey(b);
const canMove = (selection: Selection | null) => selection != null && ['furniture', 'opening', 'light'].includes(selection.kind);

function updateSelection(runtime: Runtime, props: Props) {
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
  });
  if (runtime.transform.dragging || runtime.directDragging) return;
  runtime.manipulating = null;
  const position = selection ? itemWorldPosition(props.room, selection) : null;
  const editable = canMove(selection) && !props.readOnly && props.mode === 'orbit';
  if (!editable || !position) { runtime.transform.detach(); runtime.transform.enabled = false; return; }
  runtime.proxy.position.set(position.x, position.y, position.z);
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

function structureOf(room: Room, reference: boolean) {
  const { furniture, lights, editing: _editing, name: _name, showFurniture: _showFurniture, ...shell } = room;
  return JSON.stringify({ ...shell, reference: reference && !furniture.length, furniture: furniture.map(({ x: _x, z: _z, rotation: _rotation, ...item }) => item), lights: lights.map(({ x: _x, y: _y, z: _z, ...item }) => item) });
}

function updateRoom(runtime: Runtime, room: Room, reference: boolean) {
  const structure = structureOf(room, reference);
  if (runtime.builtRoom === room && runtime.structure === structure) return;
  if (runtime.structure !== structure) { buildRoom(runtime, room, reference); return; }
  let moved = false;
  for (const item of room.furniture) {
    const group = runtime.objects.get(`furniture:${item.id}`);
    const radians = THREE.MathUtils.degToRad(item.rotation);
    if (group && (group.position.x !== item.x || group.position.z !== item.z || group.rotation.y !== radians)) {
      group.position.set(item.x, 0, item.z);
      group.rotation.y = radians;
      moved = true;
    }
  }
  for (const item of room.lights) {
    const group = runtime.objects.get(`light:${item.id}`);
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
  if (moved) runtime.content.traverse(object => { if (object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight) object.shadow.needsUpdate = true; });
  runtime.builtRoom = room;
}

function disposeContent(group: THREE.Group) {
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
  const geometry = rounded ? new RoundedBoxGeometry(...size, 2, Math.min(0.06, ...size.map(value => value / 3))) : new THREE.BoxGeometry(...size);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...at);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function addFurniture(group: THREE.Group, room: Room) {
  const b = bounds(room.vertices);
  // shortcut: reference furniture fits axis-aligned rectangular rooms; add placement tools before furnishing other floor plans.
  if (room.vertices.length !== 4 || room.vertices.some((v, i) => { const next = room.vertices[(i + 1) % 4]; return v.x !== next.x && v.z !== next.z; }) || b.width < 2.5 || b.depth < 2.5) return;
  const scale = Math.min(1, b.width / 5, b.depth / 4);
  const furniture = new THREE.Group();
  furniture.position.set((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
  furniture.scale.setScalar(scale);
  group.add(furniture);
  const fabric = new THREE.MeshStandardMaterial({ color: '#dad2c2', roughness: 1 });
  const cushion = new THREE.MeshStandardMaterial({ color: '#e7dfd1', roughness: 1 });
  const green = new THREE.MeshStandardMaterial({ color: '#57664c', roughness: 1 });
  const wood = new THREE.MeshStandardMaterial({ color: '#7d5739', roughness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: '#34392f', roughness: 0.8 });
  const rugMaterial = new THREE.MeshStandardMaterial({ color: '#e6dfcf', roughness: 1 });
  box(furniture, [2.65, 0.025, 2.1], [0, 0.018, 0.35], rugMaterial, true);
  box(furniture, [2.55, 0.35, 0.94], [-0.3, 0.31, -1.15], fabric, true);
  box(furniture, [2.55, 0.65, 0.21], [-0.3, 0.64, -1.57], fabric, true);
  for (const x of [-1.44, 0.84]) box(furniture, [0.27, 0.55, 0.92], [x, 0.59, -1.15], fabric, true);
  for (const x of [-0.84, 0.22]) box(furniture, [1.03, 0.19, 0.72], [x, 0.53, -1.06], cushion, true);
  const pillow = box(furniture, [0.44, 0.4, 0.18], [0.47, 0.85, -1.37], green, true);
  pillow.rotation.z = -0.2;
  for (const x of [-1.24, 0.64]) for (const z of [-1.44, -0.82]) box(furniture, [0.055, 0.2, 0.055], [x, 0.1, z], dark);
  const table = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.57, 0.07, 48), wood);
  table.position.set(0.28, 0.42, 0.32);
  table.castShadow = table.receiveShadow = true;
  furniture.add(table);
  for (const angle of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) box(furniture, [0.055, 0.4, 0.055], [0.28 + Math.cos(angle) * 0.37, 0.2, 0.32 + Math.sin(angle) * 0.37], dark);
  box(furniture, [0.24, 0.028, 0.32], [0.2, 0.475, 0.35], new THREE.MeshStandardMaterial({ color: '#efe8dd', roughness: 1 }));
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.38, 24), new THREE.MeshStandardMaterial({ color: '#d8c9b4', roughness: 1 }));
  pot.position.set(1.83, 0.19, -1.35);
  pot.castShadow = pot.receiveShadow = true;
  furniture.add(pot);
  for (let i = 0; i < 9; i++) {
    const angle = i * 2.4;
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), green);
    leaf.scale.set(0.13, 0.38 + (i % 3) * 0.05, 0.06);
    leaf.position.set(1.83 + Math.sin(angle) * 0.14, 0.66 + (i % 3) * 0.1, -1.35 + Math.cos(angle) * 0.14);
    leaf.rotation.set(Math.cos(angle) * 0.55, angle, Math.sin(angle) * 0.5);
    leaf.castShadow = true;
    furniture.add(leaf);
  }
}

function addStoredFurniture(parent: THREE.Group, item: FurnitureItem, quality: Room['renderQuality']) {
  const group = new THREE.Group();
  group.position.set(item.x, 0, item.z);
  group.rotation.y = THREE.MathUtils.degToRad(item.rotation);
  group.userData.selection = { kind: 'furniture', id: item.id } satisfies Selection;
  parent.add(group);
  const w = item.width, d = item.depth, h = item.height;
  const wood = createWoodMaterial('#b8a084', quality);
  const face = createWoodMaterial('#d0bea3', quality);
  const handles = new THREE.MeshStandardMaterial({ color: '#626559', metalness: 0.65, roughness: 0.35 });
  const ivory = new THREE.MeshStandardMaterial({ color: '#f1ebdf', roughness: 1 });
  if (item.type === 'bed') {
    box(group, [w, h, d * 0.05], [0, h / 2, -d * 0.475], wood, true);
    box(group, [w * 0.96, h * 0.18, d * 0.94], [0, h * 0.24, d * 0.02], wood, true);
    box(group, [w * 0.91, h * 0.20, d * 0.9], [0, h * 0.43, d * 0.025], ivory, true);
    const blanket = new THREE.MeshStandardMaterial({ color: '#aab59c', roughness: 1 });
    box(group, [w * 0.92, h * 0.035, d * 0.63], [0, h * 0.545, d * 0.15], blanket, true);
    const columns = w < 1.3 ? 1 : 2;
    for (let i = 0; i < columns; i++) box(group, [w * 0.74 / columns, h * 0.09, d * 0.21], [columns === 1 ? 0 : (i - 0.5) * w * 0.45, h * 0.56, -d * 0.285], ivory, true);
    for (const x of [-w * 0.4, w * 0.4]) for (const z of [-d * 0.4, d * 0.4]) box(group, [w * 0.055, h * 0.16, d * 0.045], [x, h * 0.08, z], wood);
  } else if (item.type === 'wardrobe') {
    box(group, [w, h, d * 0.84], [0, h / 2, -d * 0.08], wood, true);
    for (const x of [-w * 0.24, w * 0.24]) {
      box(group, [w * 0.46, h * 0.71, d * 0.12], [x, h * 0.615, d * 0.405], face, true);
      box(group, [w * 0.018, h * 0.12, d * 0.03], [x < 0 ? -w * 0.055 : w * 0.055, h * 0.58, d * 0.483], handles, true);
    }
    for (const y of [h * 0.07, h * 0.2]) {
      box(group, [w * 0.94, h * 0.11, d * 0.12], [0, y, d * 0.405], face, true);
      box(group, [w * 0.19, h * 0.014, d * 0.03], [0, y, d * 0.483], handles, true);
    }
  } else if (item.type === 'vanity') {
    box(group, [w, h * 0.045, d], [0, h * 0.475, 0], face, true);
    for (const x of [-w * 0.43, w * 0.43]) for (const z of [-d * 0.38, d * 0.38]) box(group, [w * 0.055, h * 0.45, d * 0.07], [x, h * 0.225, z], wood);
    box(group, [w * 0.3, h * 0.39, d * 0.82], [-w * 0.31, h * 0.25, -d * 0.075], wood, true);
    for (const y of [h * 0.17, h * 0.34]) {
      box(group, [w * 0.28, h * 0.15, d * 0.04], [-w * 0.31, y, d * 0.43], face, true);
      box(group, [w * 0.10, h * 0.009, d * 0.025], [-w * 0.31, y, d * 0.475], handles, true);
    }
    box(group, [w * 0.73, h * 0.46, d * 0.075], [0, h * 0.75, -d * 0.425], wood, true);
    const mirror = box(group, [w * 0.65, h * 0.4, d * 0.018], [0, h * 0.75, -d * 0.378], new THREE.MeshBasicMaterial({ color: '#c1d0d0' }), true);
    mirror.castShadow = false;
  } else {
    box(group, [w, h * 0.78, d * 0.84], [0, h * 0.51, -d * 0.08], wood, true);
    box(group, [w, h * 0.07, d], [0, h * 0.965, 0], face, true);
    for (const y of [h * 0.32, h * 0.69]) {
      box(group, [w * 0.92, h * 0.32, d * 0.10], [0, y, d * 0.425], face, true);
      box(group, [w * 0.21, h * 0.02, d * 0.025], [0, y, d * 0.487], handles, true);
    }
    for (const x of [-w * 0.37, w * 0.37]) for (const z of [-d * 0.36, d * 0.36]) box(group, [w * 0.07, h * 0.14, d * 0.07], [x, h * 0.07, z], wood);
  }
  if (import.meta.env.DEV) {
    group.updateWorldMatrix(true, true);
    const actual = new THREE.Box3().setFromObject(group);
    const footprint = bounds(furnitureCorners(item));
    console.assert(actual.min.x >= footprint.minX - 0.001 && actual.max.x <= footprint.maxX + 0.001 && actual.min.z >= footprint.minZ - 0.001 && actual.max.z <= footprint.maxZ + 0.001 && actual.min.y >= -0.001 && actual.max.y <= h + 0.001, 'Furniture geometry exceeds its declared dimensions', item.id);
  }
  return group;
}

function buildRoom(runtime: Runtime, room: Room, furniture: boolean) {
  disposeContent(runtime.content);
  const group = runtime.content;
  const b = bounds(room.vertices);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const span = Math.max(b.width, b.depth, room.height);
  runtime.walls = [];
  runtime.objects.clear();
  const shape = floorShape(room.vertices);
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), createFloorMaterial(room));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.005;
  floor.receiveShadow = true;
  floor.userData.selection = { kind: 'floor' } satisfies Selection;
  runtime.objects.set('floor', floor);
  group.add(floor);
  const plinth = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.18, bevelEnabled: false }), new THREE.MeshStandardMaterial({ color: '#d5d1c5', roughness: 0.95 }));
  plinth.rotation.x = -Math.PI / 2;
  plinth.position.y = -0.18;
  plinth.receiveShadow = true;
  group.add(plinth);
  const trim = new THREE.MeshStandardMaterial({ color: '#efece3', roughness: 0.8 });
  const shadowMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const glassMaterial = new THREE.MeshStandardMaterial({ color: '#acd6dc', transparent: true, opacity: 0.12, roughness: 0.15, side: THREE.DoubleSide, depthWrite: false });
  for (let index = 0; index < room.vertices.length; index++) {
    const start = room.vertices[index];
    const end = room.vertices[(index + 1) % room.vertices.length];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    const openings = room.openings.filter(opening => opening.wall === index).sort((a, b) => a.offset - b.offset);
    const wallShape = new THREE.Shape();
    wallShape.moveTo(-room.thickness / 2, 0);
    for (const opening of openings.filter(opening => opening.type === 'door')) {
      wallShape.lineTo(opening.offset, 0);
      wallShape.lineTo(opening.offset, opening.height);
      wallShape.lineTo(opening.offset + opening.width, opening.height);
      wallShape.lineTo(opening.offset + opening.width, 0);
    }
    wallShape.lineTo(length + room.thickness / 2, 0);
    wallShape.lineTo(length + room.thickness / 2, room.height);
    wallShape.lineTo(-room.thickness / 2, room.height);
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
    const geometry = new THREE.ExtrudeGeometry(wallShape, { depth: room.thickness, bevelEnabled: false });
    geometry.translate(0, 0, -room.thickness / 2);
    const material = createWallMaterial(room.wallColors[index], room.renderQuality);
    const wallGroup = new THREE.Group();
    wallGroup.position.set(start.x, 0, start.z);
    wallGroup.rotation.y = -Math.atan2(dz, dx);
    wallGroup.userData.selection = { kind: 'wall', index } satisfies Selection;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    wallGroup.add(mesh);
    group.add(wallGroup);
    runtime.objects.set(`wall:${index}`, wallGroup);
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
    runtime.walls.push({ group: wallGroup, midpoint, inward, material, index });
    const innerSide = inward.dot(new THREE.Vector3(-dz / length, 0, dx / length));
    let previousDoorEnd = 0;
    for (const opening of openings.filter(opening => opening.type === 'door')) {
      const width = opening.offset - previousDoorEnd;
      if (width > 0.01) box(wallGroup, [width, 0.09, 0.035], [previousDoorEnd + width / 2, 0.045, innerSide * (room.thickness / 2 + 0.016)], trim);
      previousDoorEnd = opening.offset + opening.width;
    }
    if (length - previousDoorEnd > 0.01) box(wallGroup, [length - previousDoorEnd, 0.09, 0.035], [(length + previousDoorEnd) / 2, 0.045, innerSide * (room.thickness / 2 + 0.016)], trim);
    for (const opening of openings) {
      const y = opening.type === 'door' ? 0 : opening.sill;
      const frame = 0.045;
      const x = opening.offset + opening.width / 2;
      const openingGroup = new THREE.Group();
      openingGroup.position.copy(wallGroup.position);
      openingGroup.rotation.copy(wallGroup.rotation);
      openingGroup.userData.selection = { kind: 'opening', id: opening.id } satisfies Selection;
      openingGroup.userData.wall = index;
      runtime.objects.set(`opening:${opening.id}`, openingGroup);
      group.add(openingGroup);
      for (const edge of [-1, 1]) box(openingGroup, [frame, opening.height + frame, room.thickness + 0.045], [x + edge * (opening.width / 2 - frame / 2), y + opening.height / 2, 0], trim);
      box(openingGroup, [opening.width, frame, room.thickness + 0.045], [x, y + opening.height - frame / 2, 0], trim);
      if (opening.type === 'window') {
        box(openingGroup, [opening.width + 0.09, frame, room.thickness + 0.11], [x, y, 0], trim);
        box(openingGroup, [frame * 0.65, opening.height, 0.035], [x, y + opening.height / 2, 0], trim);
        box(openingGroup, [opening.width, frame * 0.65, 0.035], [x, y + opening.height * 0.55, 0], trim);
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(opening.width, opening.height), glassMaterial);
        glass.position.set(x, y + opening.height / 2, 0);
        openingGroup.add(glass);
      } else {
        const hitPlane = new THREE.Mesh(new THREE.PlaneGeometry(opening.width, opening.height), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
        hitPlane.position.set(x, opening.height / 2, 0);
        openingGroup.add(hitPlane);
        const hinge = new THREE.Group();
        hinge.position.set(opening.offset + frame, 0, innerSide * room.thickness / 2);
        hinge.rotation.y = innerSide * -Math.PI * 0.4;
        openingGroup.add(hinge);
        const leaf = box(hinge, [opening.width - frame * 2, opening.height - frame, 0.04], [(opening.width - frame * 2) / 2, (opening.height - frame) / 2, 0], new THREE.MeshStandardMaterial({ color: '#c7b297', roughness: 0.8 }));
        leaf.castShadow = true;
        box(hinge, [0.07, 0.025, 0.075], [opening.width - 0.15, 0.98, innerSide * 0.045], new THREE.MeshStandardMaterial({ color: '#7c7b6c', metalness: 0.75, roughness: 0.3 }));
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
  const ceiling = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false }), createCeilingMaterial(room.ceilingColor, room.renderQuality));
  ceiling.rotation.x = -Math.PI / 2;
  ceiling.position.y = room.height;
  ceiling.layers.set(1);
  ceiling.castShadow = ceiling.receiveShadow = true;
  ceiling.userData.selection = { kind: 'ceiling' } satisfies Selection;
  runtime.objects.set('ceiling', ceiling);
  group.add(ceiling);
  runtime.ceiling = ceiling;
  const day = room.sun.enabled ? Math.max(0, Math.sin((room.sun.hour - 6) / 12 * Math.PI)) : 0;
  const daylightBounce = daylightFactor(day, room.openings.reduce((area, opening) => area + opening.width * opening.height, 0), polygonArea(room.vertices));
  // shortcut: hemisphere approximates diffuse daylight bounce; use global illumination for calibrated lighting accuracy.
  group.add(new THREE.HemisphereLight('#f5f7ff', '#d3ceba', 0.035 + daylightBounce * 3.5));
  const sun = new THREE.DirectionalLight(kelvinColor(4500 + day * 2000), room.sun.enabled ? room.sun.intensity * day : 0);
  const azimuth = THREE.MathUtils.degToRad(room.sun.azimuth + (room.sun.hour - 12) * 12);
  const elevation = day * Math.PI * 0.25;
  const distance = span * 4;
  sun.position.set(cx + Math.sin(azimuth) * Math.cos(elevation) * distance, Math.sin(elevation) * distance, cz - Math.cos(azimuth) * Math.cos(elevation) * distance);
  sun.target.position.set(cx, 0, cz);
  sun.castShadow = day > 0;
  const detailed = room.renderQuality === 'realistic';
  const highResolution = detailed && !window.matchMedia('(pointer: coarse)').matches && runtime.renderer.domElement.clientWidth > 700;
  const shadowSize = highResolution ? 4096 : 2048;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -span;
  sun.shadow.camera.right = sun.shadow.camera.top = span;
  sun.shadow.camera.near = 0.1;
  sun.shadow.camera.far = distance + span * 3;
  sun.shadow.camera.layers.enable(1);
  sun.shadow.bias = -0.0001;
  sun.shadow.normalBias = 0.018;
  sun.shadow.autoUpdate = false;
  sun.shadow.needsUpdate = true;
  group.add(sun, sun.target);
  for (const light of room.lights) {
    const lightGroup = new THREE.Group();
    lightGroup.position.set(light.x, light.y, light.z);
    lightGroup.userData.selection = { kind: 'light', id: light.id } satisfies Selection;
    runtime.objects.set(`light:${light.id}`, lightGroup);
    group.add(lightGroup);
    const temperature = kelvinColor(light.temperature);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.075, 20, 12), new THREE.MeshStandardMaterial({ color: light.enabled ? temperature : '#c0bcae', emissive: temperature, emissiveIntensity: light.enabled ? 3 : 0, roughness: 0.45 }));
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
    point.castShadow = light.enabled;
    const pointShadowSize = detailed && runtime.renderer.domElement.clientWidth > 700 ? 1024 : 512;
    point.shadow.mapSize.set(pointShadowSize, pointShadowSize);
    point.shadow.camera.near = 0.05;
    point.shadow.camera.far = span * 3;
    point.shadow.camera.layers.enable(1);
    point.shadow.bias = -0.0002;
    point.shadow.normalBias = 0.02;
    point.shadow.autoUpdate = false;
    point.shadow.needsUpdate = true;
    lightGroup.add(point);
  }
  if (room.furniture.length) for (const item of room.furniture) runtime.objects.set(`furniture:${item.id}`, addStoredFurniture(group, item, room.renderQuality));
  else if (furniture) addFurniture(group, room);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(30, span * 4), Math.max(30, span * 4)), new THREE.MeshStandardMaterial({ color: '#e9ece4', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(cx, -0.19, cz);
  ground.receiveShadow = true;
  group.add(ground);
  const grid = new THREE.GridHelper(Math.max(24, Math.ceil(span * 3)), Math.max(24, Math.ceil(span * 3)), '#cdd4c8', '#dce1d7');
  grid.position.set(cx, -0.185, cz);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.28;
  group.add(grid);
  runtime.builtRoom = room;
  runtime.structure = structureOf(room, furniture);
  runtime.renderer.setPixelRatio(Math.min(window.devicePixelRatio, highResolution ? 2 : 1.5));
  if (detailed && !runtime.environment) {
    const environmentScene = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(runtime.renderer);
    try { runtime.environment = generator.fromScene(environmentScene, 0.04, 0.1, 100, { size: 128 }); }
    catch { runtime.environment = null; }
    finally { environmentScene.dispose(); generator.dispose(); }
  }
  runtime.scene.environment = detailed ? runtime.environment?.texture ?? null : null;
  runtime.scene.environmentIntensity = detailed ? Math.min(0.25, daylightBounce * 0.18 + room.lights.filter(light => light.enabled).reduce((sum, light) => sum + light.lumens, 0) / 20000) : 0;
}

function fitOrbitCamera(runtime: Runtime, room: Room, preserveZoom = false) {
  const b = bounds(room.vertices);
  const radius = Math.hypot(b.width / 2, b.depth / 2, room.height * 0.72);
  const halfFov = Math.atan(Math.tan(THREE.MathUtils.degToRad(runtime.camera.fov / 2)) * Math.min(1, runtime.camera.aspect));
  const distance = radius / Math.sin(halfFov) * 1.04;
  const offset = runtime.camera.position.clone().sub(runtime.controls.target);
  const zoom = preserveZoom && runtime.fittedDistance ? offset.length() / runtime.fittedDistance : 1;
  runtime.camera.position.copy(runtime.controls.target).add(offset.normalize().multiplyScalar(distance * zoom));
  runtime.fittedDistance = distance;
  runtime.controls.maxDistance = Math.max(Math.max(b.width, b.depth, room.height) * 4, distance * 3);
  runtime.controls.update();
}

function resetCamera(runtime: Runtime, room: Room, mode: ViewMode) {
  const b = bounds(room.vertices);
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const span = Math.max(b.width, b.depth, room.height);
  runtime.controls.enabled = mode === 'orbit';
  runtime.walkBlocked = false;
  if (mode === 'walk') {
    const free = interiorWalkPoint(room);
    const position = free ?? interiorPoint(room.vertices, Math.max(0.2, room.thickness / 2 + 0.12));
    runtime.walkBlocked = free === null;
    runtime.camera.position.set(position.x, Math.min(1.65, room.height - 0.2), position.z);
    const target = interiorPoint(room.vertices);
    runtime.yaw = Math.hypot(target.x - position.x, target.z - position.z) > 0.1 ? Math.atan2(position.x - target.x, position.z - target.z) : 0;
    runtime.pitch = 0;
    runtime.camera.rotation.set(0, runtime.yaw, 0, 'YXZ');
    runtime.camera.fov = 70;
    runtime.renderer.domElement.focus({ preventScroll: true });
  } else {
    runtime.camera.position.set(cx - span * 1.05, span * 0.9, cz + span * 1.2);
    runtime.controls.target.set(cx, room.height * 0.28, cz);
    runtime.controls.minDistance = span * 0.45;
    runtime.controls.maxDistance = span * 4;
    runtime.controls.maxPolarAngle = Math.PI * 0.49;
    runtime.controls.update();
    runtime.camera.fov = 43;
    fitOrbitCamera(runtime, room);
  }
  runtime.camera.updateProjectionMatrix();
}

export default function RoomScene(props: Props) {
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const current = useRef(props);
  current.current = props;
  const directions = useRef(new Set<string>());
  const joystick = useRef({ x: 0, z: 0 });
  const [stick, setStick] = useState({ x: 0, z: 0 });
  const joystickPointer = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [walkBlocked, setWalkBlocked] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    let renderer: THREE.WebGPURenderer | null = null;
    let observer: ResizeObserver | null = null;
    let removeEvents = () => {};
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
        canvas.setAttribute('aria-label', 'Visor 3D del cuarto. Arrastra para mirar. En recorrido: WASD o flechas para moverte, Q y E para girar, R y F para mirar arriba y abajo.');
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
        const active: Runtime = { renderer, scene, camera, controls, content, walls: [], ceiling: null, yaw: 0, pitch: 0, fittedDistance: 0, objects: new Map(), selectionBox: null, walkBlocked: false, transform, proxy, manipulating: null, directDragging: false, pendingEdit: false, lastOpeningBuild: 0, environment: null, builtRoom: null, structure: '', outlinedKey: null };
        runtime.current = active;
        buildRoom(active, current.current.room, current.current.showFurniture);
        resetCamera(active, current.current.room, current.current.mode);
        updateSelection(active, current.current);
        setWalkBlocked(active.walkBlocked);
        const resize = () => {
          const width = Math.max(1, mount.clientWidth);
          const height = Math.max(1, mount.clientHeight);
          const highResolution = current.current.room.renderQuality === 'realistic' && !window.matchMedia('(pointer: coarse)').matches && width > 700;
          renderer?.setPixelRatio(Math.min(window.devicePixelRatio, highResolution ? 2 : 1.5));
          renderer?.setSize(width, height);
          content.traverse(object => {
            if (!(object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight)) return;
            const size = object instanceof THREE.DirectionalLight ? highResolution ? 4096 : 2048 : current.current.room.renderQuality === 'realistic' && width > 700 ? 1024 : 512;
            if (object.shadow.mapSize.x !== size) { object.shadow.mapSize.set(size, size); object.shadow.needsUpdate = true; }
          });
          const aspect = width / height;
          if (Math.abs(camera.aspect - aspect) > 0.001) {
            camera.aspect = aspect;
            if (current.current.mode === 'orbit') fitOrbitCamera(active, current.current.room, true);
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
        const pick = (event: PointerEvent): Selection | null => {
          setRay(event);
          const targets = [...active.objects.values()].filter(object => object.visible && object.layers.test(camera.layers));
          const hit = ray.intersectObjects(targets, true)[0];
          let item: THREE.Object3D | null = hit?.object ?? null;
          while (item && !item.userData.selection) item = item.parent;
          return item?.userData.selection ?? null;
        };
        const commitProxy = (force = false) => {
          if (!active.pendingEdit) return;
          const state = current.current;
          const selected = active.manipulating;
          if (state.readOnly || state.mode !== 'orbit' || !selected) { active.pendingEdit = false; return; }
          if (selected.kind === 'opening' && !force && performance.now() - active.lastOpeningBuild < 80) return;
          active.pendingEdit = false;
          active.lastOpeningBuild = performance.now();
          try {
            const next = moveSceneItem(state.room, selected, { x: proxy.position.x, y: proxy.position.y, z: proxy.position.z, rotation: THREE.MathUtils.radToDeg(proxy.rotation.y) });
            current.current = { ...state, room: next };
            const accepted = itemWorldPosition(next, selected);
            if (accepted) proxy.position.set(accepted.x, accepted.y, accepted.z);
            if (selected.kind === 'furniture') { const item = next.furniture.find(item => item.id === selected.id); if (item) proxy.rotation.y = THREE.MathUtils.degToRad(item.rotation); }
            updateRoom(active, next, state.showFurniture);
            updateSelection(active, current.current);
            if (next !== state.room) state.onChange(next);
            setNotice('');
          } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'No se puede colocar aquí.'); }
        };
        const finishDrag = () => {
          commitProxy(true);
          active.directDragging = false;
          active.manipulating = null;
          active.pendingEdit = false;
          directPlane = null;
          controls.enabled = current.current.mode === 'orbit';
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
          if (!pointer || pointer.id !== event.pointerId) return;
          if (active.directDragging && directPlane) {
            event.preventDefault(); event.stopImmediatePropagation();
            if (current.current.readOnly || current.current.mode !== 'orbit') { finishDrag(); return; }
            setRay(event);
            if (ray.ray.intersectPlane(directPlane, point)) { proxy.position.copy(point).add(dragOffset); active.pendingEdit = true; }
            return;
          }
          if (current.current.mode !== 'walk') return;
          active.yaw -= (event.clientX - pointer.x) * 0.004;
          active.pitch = THREE.MathUtils.clamp(active.pitch - (event.clientY - pointer.y) * 0.004, -1.25, 1.25);
          camera.rotation.set(active.pitch, active.yaw, 0, 'YXZ');
          pointer.x = event.clientX;
          pointer.y = event.clientY;
        };
        const up = (event: PointerEvent) => {
          pointers.delete(event.pointerId);
          if (!pointer || pointer.id !== event.pointerId) return;
          if (active.directDragging) { event.preventDefault(); event.stopImmediatePropagation(); finishDrag(); if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); }
          else if (!pointer.handled && !pointer.multi && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 5) current.current.onSelect(pick(event));
          pointer = null;
        };
        const cancel = () => { pointers.clear(); if (transform.dragging) transform.pointerUp(null); if (active.directDragging) finishDrag(); pointer = null; controls.enabled = current.current.mode === 'orbit'; };
        const keyDown = (event: KeyboardEvent) => {
          if (event.target instanceof HTMLElement && (event.target.matches('input, select, textarea, button') || event.target.isContentEditable)) return;
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
              proxy.position.set(position.x + (shift?.[0] ?? 0), position.y + (shift?.[1] ?? 0), position.z + (shift?.[2] ?? 0));
              if (rotation) proxy.rotation.y += THREE.MathUtils.degToRad(event.code === 'KeyQ' ? 15 : -15);
              active.pendingEdit = true; commitProxy(true); active.manipulating = null; updateSelection(active, current.current);
            }
            return;
          }
          if (current.current.mode !== 'walk') return;
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
        let previous = 0;
        await renderer.setAnimationLoop(time => {
          if (cancelled) return;
          const delta = Math.min(0.04, previous ? (time - previous) / 1000 : 0);
          previous = time;
          const state = current.current;
          commitProxy();
          if (state.mode === 'walk') {
            active.yaw += (Number(directions.current.has('lookLeft')) - Number(directions.current.has('lookRight'))) * delta * 1.4;
            active.pitch = THREE.MathUtils.clamp(active.pitch + (Number(directions.current.has('lookUp')) - Number(directions.current.has('lookDown'))) * delta, -1.25, 1.25);
            camera.rotation.set(active.pitch, active.yaw, 0, 'YXZ');
            const forward = Number(directions.current.has('forward')) - Number(directions.current.has('back')) - joystick.current.z;
            const right = Number(directions.current.has('right')) - Number(directions.current.has('left')) + joystick.current.x;
            const length = Math.max(1, Math.hypot(forward, right));
            const distance = delta * 1.8 / length;
            const dx = (-Math.sin(active.yaw) * forward + Math.cos(active.yaw) * right) * distance;
            const dz = (-Math.cos(active.yaw) * forward - Math.sin(active.yaw) * right) * distance;
            if (furnitureWalkable({ x: camera.position.x + dx, z: camera.position.z }, state.room)) camera.position.x += dx;
            if (furnitureWalkable({ x: camera.position.x, z: camera.position.z + dz }, state.room)) camera.position.z += dz;
          } else if (!transform.dragging && !active.directDragging) controls.update();
          for (const wall of active.walls) wall.group.visible = state.mode === 'walk' || state.selection?.kind === 'wall' && state.selection.index === wall.index || (camera.position.x - wall.midpoint.x) * wall.inward.x + (camera.position.z - wall.midpoint.z) * wall.inward.z > -0.03;
          for (const [key, item] of active.objects) if (key.startsWith('opening:')) item.visible = state.mode === 'walk' || state.selection?.kind === 'opening' && key === selectionKey(state.selection) || active.walls[item.userData.wall]?.group.visible === true;
          if (active.ceiling) active.ceiling.layers.set(state.mode === 'walk' || state.selection?.kind === 'ceiling' ? 0 : 1);
          try { active.renderer.render(scene, camera); }
          catch (cause) {
            console.error('Room renderer:', cause);
            void active.renderer.setAnimationLoop(null);
            setError('No se pudo mostrar el cuarto. Actualiza el navegador o activa la aceleración gráfica.');
          }
        });
        if (cancelled) return;
        setReady(true);
        current.current.onReady?.((renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WebGPU · TSL' : 'WebGL2 · TSL');
      } catch (cause) {
        console.error('Room renderer initialization:', cause);
        observer?.disconnect();
        removeEvents();
        const active = runtime.current;
        if (active?.renderer === renderer) {
          active.controls.dispose();
          active.transform.dispose();
          active.environment?.dispose();
          if (active.selectionBox) { active.selectionBox.geometry.dispose(); (active.selectionBox.material as THREE.Material).dispose(); }
          disposeContent(active.content);
          runtime.current = null;
        }
        try { renderer?.dispose(); } catch { /* a rejected backend might not be initialized */ }
        renderer?.domElement.remove();
        if (!cancelled) setError('Este navegador no pudo iniciar el visor 3D. Actualiza el navegador o activa la aceleración gráfica.');
      }
    };
    void initialize();
    return () => {
      cancelled = true;
      observer?.disconnect();
      removeEvents();
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
        active.renderer.dispose();
        active.renderer.domElement.remove();
        runtime.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const active = runtime.current;
    if (!active || !ready) return;
    updateRoom(active, props.room, props.showFurniture);
    updateSelection(active, props);
    if (props.mode === 'walk') {
      active.camera.position.y = Math.min(1.65, props.room.height - 0.2);
      if (!furnitureWalkable({ x: active.camera.position.x, z: active.camera.position.z }, props.room)) resetCamera(active, props.room, props.mode);
      setWalkBlocked(active.walkBlocked);
    }
  }, [props.room, props.showFurniture, ready]);

  useEffect(() => {
    if (runtime.current && ready) {
      directions.current.clear();
      joystick.current = { x: 0, z: 0 };
      setStick({ x: 0, z: 0 });
      resetCamera(runtime.current, props.room, props.mode);
      updateSelection(runtime.current, props);
      setWalkBlocked(runtime.current.walkBlocked);
    }
  }, [props.mode, props.resetKey, ready]);

  useEffect(() => {
    const active = runtime.current;
    if (!active || !ready) return;
    if (props.readOnly || props.mode !== 'orbit' || active.manipulating && !sameSelection(active.manipulating, props.selection)) {
      active.transform.pointerUp(null);
      active.directDragging = false;
      active.pendingEdit = false;
      active.manipulating = null;
      active.controls.enabled = props.mode === 'orbit';
    }
    updateSelection(active, props);
    setNotice('');
  }, [props.selection, props.readOnly, props.transformMode, props.mode, ready]);

  const moveJoystick = (event: React.PointerEvent<HTMLButtonElement>) => {
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

  return <div className="room-scene" ref={container}>
    {!ready && !error && <div className="scene-loading"><LoaderCircle size={24} /><span>Cargando…</span></div>}
    {error && <div className="scene-error" role="alert"><strong>No pudimos iniciar el visor</strong><p>{error}</p></div>}
    {notice && !error && <div className="scene-notice" role="status">{notice}</div>}
    {ready && !error && props.mode === 'walk' && <><div className="walk-hint">{walkBlocked ? 'No queda espacio libre para caminar. Mueve algún mueble.' : <>Arrastra para mirar <span>· WASD · Q/E · R/F</span></>}</div><div className="walk-joystick"><button type="button" tabIndex={-1} className="joystick-base" aria-label="Joystick de movimiento: arrastra para caminar. Con teclado usa WASD en el visor." onPointerDown={event => { event.preventDefault(); event.stopPropagation(); joystickPointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); moveJoystick(event); }} onPointerMove={event => { if (joystickPointer.current === event.pointerId) { event.stopPropagation(); moveJoystick(event); } }} onPointerUp={releaseJoystick} onPointerCancel={releaseJoystick} onLostPointerCapture={releaseJoystick}><span className="joystick-knob" style={{ transform: `translate(${stick.x * 34}px, ${stick.z * 34}px)` }} /></button></div></>}
  </div>;
}
