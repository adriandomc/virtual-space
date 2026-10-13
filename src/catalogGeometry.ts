import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { getFurniturePreset } from './furnitureCatalog';
import type { FurnitureItem, Room } from './types';

type MaterialRole = 'body' | 'face' | 'handles' | 'mirror' | 'light';
export type CatalogPart = { kind: 'box' | 'cylinder' | 'ellipse' | 'wedge'; size: [number, number, number]; at: [number, number, number]; material: MaterialRole; axis?: 'x' | 'y' | 'z' };
type CatalogItem = Pick<FurnitureItem, 'type' | 'width' | 'depth' | 'height'> & { variant?: string };

// The same normalized parts drive the 3D mesh and catalog previews.
export function getCatalogParts(type: string, variant?: string): CatalogPart[] {
  const preset = getFurniturePreset(type, variant);
  if (!preset) return [];
  const parts: CatalogPart[] = [];
  const box = (size: CatalogPart['size'], at: CatalogPart['at'], material: MaterialRole = 'body') => parts.push({ kind: 'box', size, at, material });
  const cylinder = (size: CatalogPart['size'], at: CatalogPart['at'], material: MaterialRole = 'body', axis: CatalogPart['axis'] = 'y') => parts.push({ kind: 'cylinder', size, at, material, axis });
  const shelf = (y: number, width = 1, x = 0, depth = 0.94, z = 0) => box([width, 0.035, depth], [x, y, z]);
  const casing = (width = 1, height = 1, depth = 0.94, x = 0, base = 0, z = -0.03) => {
    const t = 0.035;
    box([width, t, depth], [x, base + t / 2, z]);
    box([width, t, depth], [x, base + height - t / 2, z], 'face');
    for (const edge of [-1, 1]) box([t, height - t * 2, depth], [x + edge * (width / 2 - t / 2), base + height / 2, z]);
    box([width - t * 2, height - t * 2, t], [x, base + height / 2, z - depth / 2 + t / 2]);
  };
  const drawer = (width: number, height: number, x: number, y: number, z = 0.445) => {
    box([width, height, 0.04], [x, y, z], 'face');
    box([Math.min(width * 0.3, 0.15), 0.023, 0.027], [x, y, z + 0.034], 'handles');
  };
  const door = (width: number, height: number, x: number, y: number, z = 0.445, mirrored = false) => {
    box([width, height, 0.045], [x, y, z], 'face');
    if (mirrored) box([width * 0.82, height * 0.86, 0.009], [x, y, z + 0.027], 'mirror');
    box([0.015, 0.1, 0.025], [x + width * 0.3, y, z + 0.037], 'handles');
  };
  const legs = (top: number, x = 0.42, z = 0.37, width = 0.055) => {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box([width, top, width], [sx * x, top / 2, sz * z]);
  };
  const rail = (y: number, width = 0.88, x = 0, z = 0.04) => cylinder([width, 0.022, 0.028], [x, y, z], 'handles', 'x');
  const mirror = (shape: 'rectangle' | 'circle' | 'oval' = 'rectangle', width = 0.74, height = 0.43, x = 0, y = 0.77, z = -0.425) => {
    if (shape === 'rectangle') {
      box([width, height, 0.07], [x, y, z]);
      box([width - 0.06, height - 0.05, 0.01], [x, y, z + 0.041], 'mirror');
    } else {
      parts.push({ kind: 'ellipse', size: [width, height, 0.055], at: [x, y, z], material: 'body' });
      parts.push({ kind: 'ellipse', size: [width - 0.06, height - 0.04, 0.009], at: [x, y, z + 0.032], material: 'mirror' });
    }
  };
  switch (preset.id) {
    case 'wardrobe-classic':
      casing();
      for (const x of [-0.245, 0.245]) door(0.47, 0.69, x, 0.625);
      for (const y of [0.085, 0.225]) drawer(0.93, 0.12, 0, y);
      break;
    case 'wardrobe-sliding':
      casing();
      for (const x of [-0.245, 0.245]) {
        box([0.5, 0.94, 0.043], [x, 0.5, x < 0 ? 0.43 : 0.46], 'face');
        box([0.012, 0.24, 0.014], [x < 0 ? -0.025 : 0.025, 0.52, x < 0 ? 0.459 : 0.489], 'handles');
      }
      break;
    case 'wardrobe-l':
      casing(1, 1, 0.34, 0, 0, -0.33);
      casing(0.34, 1, 0.66, -0.33, 0, 0.17);
      for (const x of [-0.12, 0.27]) door(0.36, 0.92, x, 0.5, -0.14);
      box([0.045, 0.92, 0.60], [-0.14, 0.5, 0.17], 'face');
      box([0.024, 0.12, 0.015], [-0.104, 0.5, 0.1], 'handles');
      break;
    case 'wardrobe-corner':
      parts.push({ kind: 'wedge', size: [1, 0.94, 1], at: [0, 0.5, 0], material: 'body' });
      box([0.71, 0.92, 0.06], [-0.145, 0.5, 0.12], 'face');
      box([0.015, 0.13, 0.02], [0.12, 0.5, 0.16], 'handles');
      shelf(0.027, 1, 0, 0.94, -0.03);
      break;
    case 'wardrobe-rack':
      shelf(0.04); shelf(0.2, 0.92);
      for (const x of [-0.46, 0.46]) cylinder([0.05, 0.9, 0.065], [x, 0.5, 0], 'body');
      rail(0.94, 0.93);
      for (const x of [-0.45, 0.45]) box([0.07, 0.04, 0.88], [x, 0.02, 0]);
      break;
    case 'wardrobe-shelves':
      casing();
      box([0.035, 0.94, 0.91], [-0.06, 0.5, -0.03]);
      for (const y of [0.18, 0.36, 0.54, 0.72, 0.9]) shelf(y, 0.5, 0.215, 0.87, -0.02);
      rail(0.85, 0.36, -0.285);
      break;
    case 'wardrobe-double-rail':
      casing(); rail(0.87); rail(0.45); shelf(0.52); shelf(0.94);
      break;
    case 'wardrobe-drawers':
      casing();
      for (const x of [-0.245, 0.245]) door(0.47, 0.56, x, 0.69);
      for (const y of [0.07, 0.19, 0.31]) drawer(0.93, 0.10, 0, y);
      break;
    case 'wardrobe-mirror':
      casing();
      for (const x of [-0.245, 0.245]) door(0.47, 0.94, x, 0.5, 0.445, x > 0);
      break;
    case 'wardrobe-modular':
      casing();
      for (const x of [-0.17, 0.17]) box([0.025, 0.94, 0.9], [x, 0.5, -0.03]);
      rail(0.85, 0.26, -0.33); rail(0.8, 0.27, 0);
      for (const y of [0.22, 0.4, 0.58, 0.76]) shelf(y, 0.27, 0.33, 0.87, -0.03);
      for (const y of [0.095, 0.245]) drawer(0.28, 0.13, -0.33, y);
      shelf(0.33, 0.3, -0.33); shelf(0.95);
      break;
    case 'vanity-classic':
      shelf(0.49); legs(0.47);
      casing(0.29, 0.44, 0.83, -0.325, 0.02);
      for (const y of [0.135, 0.345]) drawer(0.26, 0.18, -0.325, y);
      mirror();
      break;
    case 'vanity-round':
      shelf(0.49); legs(0.47, 0.41, 0.35, 0.035);
      drawer(0.8, 0.09, 0, 0.415);
      mirror('circle', 0.65, 0.46, 0, 0.755);
      break;
    case 'vanity-oval':
      shelf(0.47); legs(0.45, 0.36, 0.34, 0.04);
      drawer(0.75, 0.1, 0, 0.39);
      mirror('oval', 0.5, 0.50, 0, 0.735);
      shelf(0.15, 0.82, 0, 0.7);
      break;
    case 'vanity-trifold':
      shelf(0.49); legs(0.47);
      for (const x of [-0.31, 0.31]) drawer(0.27, 0.095, x, 0.4);
      mirror('rectangle', 0.43, 0.44, 0, 0.76);
      for (const x of [-0.36, 0.36]) mirror('rectangle', 0.26, 0.36, x, 0.75, -0.3);
      break;
    case 'vanity-double-drawers':
      shelf(0.50);
      for (const x of [-0.345, 0.345]) {
        casing(0.3, 0.46, 0.9, x, 0.02);
        for (const y of [0.1, 0.25, 0.4]) drawer(0.275, 0.12, x, y);
      }
      mirror('rectangle', 0.69, 0.45, 0, 0.755);
      break;
    case 'vanity-floating':
      casing(1, 0.16, 0.94, 0, 0.36);
      for (const x of [-0.24, 0.24]) drawer(0.46, 0.12, x, 0.44);
      mirror('rectangle', 0.82, 0.44, 0, 0.76);
      box([0.92, 0.09, 0.025], [0, 0.405, -0.487], 'handles');
      break;
    case 'vanity-corner':
      parts.push({ kind: 'wedge', size: [1, 0.055, 1], at: [0, 0.49, 0], material: 'face' });
      for (const [x, z] of [[-0.43, -0.43], [0.4, -0.43], [-0.43, 0.4]]) box([0.055, 0.46, 0.055], [x, 0.23, z]);
      mirror('rectangle', 0.68, 0.44, -0.14, 0.75);
      drawer(0.48, 0.1, -0.17, 0.405, -0.03);
      break;
    case 'vanity-lighted':
      shelf(0.49); legs(0.47);
      drawer(0.85, 0.1, 0, 0.41);
      mirror('rectangle', 0.84, 0.44, 0, 0.76);
      for (const x of [-0.375, 0.375]) for (const y of [0.59, 0.7, 0.81, 0.92]) cylinder([0.03, 0.025, 0.03], [x, y, -0.367], 'light', 'z');
      for (const x of [-0.24, -0.08, 0.08, 0.24]) cylinder([0.03, 0.025, 0.03], [x, 0.955, -0.367], 'light', 'z');
      break;
    case 'vanity-minimal':
      shelf(0.5); legs(0.48, 0.44, 0.38, 0.025);
      mirror('circle', 0.5, 0.43, 0, 0.755);
      box([0.03, 0.12, 0.045], [0, 0.55, -0.425], 'handles');
      break;
    case 'vanity-side-shelves':
      shelf(0.48, 0.73, -0.13); legs(0.46, 0.42, 0.35, 0.04);
      casing(0.25, 1, 0.94, 0.375);
      for (const y of [0.2, 0.4, 0.6, 0.8]) shelf(y, 0.20, 0.375, 0.85, -0.01);
      drawer(0.60, 0.1, -0.13, 0.4);
      mirror('rectangle', 0.59, 0.44, -0.14, 0.75);
      break;
    case 'nightstand-classic':
      casing(1, 0.82, 0.94, 0, 0.18); legs(0.18, 0.41, 0.36, 0.065);
      for (const y of [0.39, 0.78]) drawer(0.9, 0.34, 0, y);
      break;
    case 'nightstand-single':
      casing(1, 0.82, 0.94, 0, 0.18); legs(0.18);
      drawer(0.9, 0.25, 0, 0.825); shelf(0.65, 0.93, 0, 0.90, -0.03);
      break;
    case 'nightstand-three':
      casing();
      for (const y of [0.18, 0.5, 0.82]) drawer(0.9, 0.285, 0, y);
      break;
    case 'nightstand-open':
      casing(); shelf(0.33, 0.94, 0, 0.89, -0.01); shelf(0.67, 0.94, 0, 0.89, -0.01);
      break;
    case 'nightstand-round':
      cylinder([1, 0.09, 1], [0, 0.955, 0], 'face');
      cylinder([0.08, 0.86, 0.08], [0, 0.48, 0], 'handles');
      cylinder([0.68, 0.075, 0.68], [0, 0.045, 0]);
      cylinder([0.8, 0.04, 0.8], [0, 0.33, 0]);
      break;
    case 'nightstand-floating':
      casing(1, 0.45, 0.94, 0, 0.55);
      drawer(0.91, 0.35, 0, 0.775);
      box([0.87, 0.12, 0.028], [0, 0.71, -0.486], 'handles');
      break;
    case 'nightstand-cube':
      casing();
      break;
    case 'nightstand-cabinet':
      casing(1, 0.85, 0.94, 0, 0.15); legs(0.15);
      door(0.91, 0.75, 0, 0.58);
      break;
    case 'nightstand-tripod':
      cylinder([1, 0.07, 1], [0, 0.965, 0], 'face');
      for (const angle of [0, Math.PI * 2 / 3, Math.PI * 4 / 3]) cylinder([0.065, 0.93, 0.065], [Math.sin(angle) * 0.32, 0.465, Math.cos(angle) * 0.32]);
      break;
    case 'nightstand-nested':
      box([0.68, 0.065, 0.92], [-0.15, 0.9675, -0.04], 'face');
      for (const x of [-0.44, 0.14]) for (const z of [-0.44, 0.35]) box([0.04, 0.935, 0.04], [x, 0.4675, z], 'handles');
      box([0.55, 0.06, 0.72], [0.225, 0.64, 0.14], 'face');
      for (const x of [0, 0.45]) for (const z of [-0.16, 0.45]) box([0.04, 0.61, 0.04], [x, 0.305, z], 'handles');
      break;
  }
  return parts;
}

export function buildCatalogGeometry(group: THREE.Group, item: CatalogItem, materials: { body: THREE.Material; face: THREE.Material; handles: THREE.Material }, quality: Room['renderQuality']): boolean {
  const parts = getCatalogParts(item.type, item.variant);
  if (!parts.length) return false;
  const architectural = quality === 'hyperrealistic';
  let mirror: THREE.Material | undefined;
  let light: THREE.Material | undefined;
  for (const part of parts) {
    const size: [number, number, number] = [part.size[0] * item.width, part.size[1] * item.height, part.size[2] * item.depth];
    let geometry: THREE.BufferGeometry;
    if (part.kind === 'box') geometry = architectural ? new RoundedBoxGeometry(...size, 2, Math.min(0.008, ...size.map(value => value / 4))) : new THREE.BoxGeometry(...size);
    else if (part.kind === 'wedge') {
      const shape = new THREE.Shape();
      shape.moveTo(-size[0] / 2, -size[2] / 2); shape.lineTo(size[0] / 2, -size[2] / 2); shape.lineTo(-size[0] / 2, size[2] / 2); shape.closePath();
      geometry = new THREE.ExtrudeGeometry(shape, { depth: size[1], bevelEnabled: false });
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(0, -size[1] / 2, 0);
      geometry.rotateY(Math.PI);
    } else {
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, architectural ? 40 : 24);
      if (part.kind === 'ellipse' || part.axis === 'z') geometry.rotateX(Math.PI / 2);
      if (part.axis === 'x') geometry.rotateZ(Math.PI / 2);
      geometry.scale(...size);
    }
    if (architectural) {
      const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
      for (let i = 0; i < positions.count; i++) {
        const nx = Math.abs(normals.getX(i)), ny = Math.abs(normals.getY(i)), nz = Math.abs(normals.getZ(i));
        uv.setXY(i, nx > ny && nx > nz ? positions.getZ(i) : positions.getX(i), ny > nx && ny > nz ? positions.getZ(i) : positions.getY(i));
      }
    }
    let material: THREE.Material;
    if (part.material === 'mirror') material = mirror ??= quality === 'standard' ? new THREE.MeshBasicMaterial({ color: '#b8cbcb' }) : new THREE.MeshPhysicalNodeMaterial({ color: '#e5ecec', metalness: 1, roughness: architectural ? 0.06 : 0.12 });
    else if (part.material === 'light') material = light ??= new THREE.MeshStandardNodeMaterial({ color: '#fff4d9', emissive: '#ffe5bd', emissiveIntensity: 0.65, roughness: 0.3 });
    else material = materials[part.material];
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(part.at[0] * item.width, part.at[1] * item.height, part.at[2] * item.depth);
    mesh.castShadow = part.material !== 'mirror' && part.material !== 'light';
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return true;
}
