import * as THREE from 'three/webgpu';
import { color, float, min, mix, normalMap, smoothstep, step, texture, uv, vec2, vec3, type ShaderNodeObject } from 'three/tsl';
import type { FloorFinish, Room } from './types';

type ShaderValue = ShaderNodeObject<THREE.Node>;
type Quality = Room['renderQuality'];

type ArchitecturalSurface = 'wood' | 'plaster' | 'stone' | 'marble' | 'fabric';
const architecturalTextures = new Map<string, THREE.Texture>();
const surfaceScale: Record<ArchitecturalSurface, number> = { wood: 1.7, plaster: 1, stone: 2.08, marble: 1.5, fabric: 0.264 };
// Measured linear albedo averages keep each photographed surface centered on its chosen HEX tint.
const surfaceLuminance: Record<ArchitecturalSurface, number> = { wood: 0.13486, plaster: 0.24731, stone: 0.26191, marble: 0.35256, fabric: 0.42989 };

function architecturalTexture(surface: ArchitecturalSurface, map: 'color' | 'normal' | 'arm') {
  const path = `/materials/${surface}/${map}.jpg`;
  let result = architecturalTextures.get(path);
  if (!result) {
    // Material construction also runs during Node tests, where ImageLoader has no DOM.
    result = typeof document === 'undefined' ? new THREE.Texture() : new THREE.TextureLoader().load(path, undefined, undefined, () => console.warn(`No se pudo cargar ${path}`));
    result.name = path;
    result.wrapS = result.wrapT = THREE.RepeatWrapping;
    result.colorSpace = map === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    result.anisotropy = 4;
    architecturalTextures.set(path, result);
  }
  return result;
}

export function disposeArchitecturalTextures() {
  architecturalTextures.forEach(map => map.dispose());
  architecturalTextures.clear();
}

function architecturalMaterial(hex: string, surface: ArchitecturalSurface, point: ShaderValue, normalStrength: number, roughness: [number, number]) {
  const material = new THREE.MeshPhysicalNodeMaterial({ color: hex, roughness: 0.6 });
  material.map = architecturalTexture(surface, 'color');
  material.normalMap = architecturalTexture(surface, 'normal');
  material.roughnessMap = material.aoMap = architecturalTexture(surface, 'arm');
  const sample = texture(material.map, point).rgb;
  const luminance = sample.dot(vec3(0.2126, 0.7152, 0.0722));
  // Keep the chosen paint/tint while retaining photographed contrast and a little natural chroma.
  const photographedTone = luminance.div(surfaceLuminance[surface]).clamp(0.3, 1.6);
  const painted = surface === 'plaster';
  material.colorNode = color(hex).mul(painted ? mix(float(1), photographedTone, 0.1) : photographedTone).mul(mix(vec3(1), sample.div(luminance.max(0.01)), painted ? 0.02 : 0.12));
  material.normalNode = normalMap(texture(material.normalMap, point).rgb, vec2(normalStrength));
  material.roughnessNode = texture(material.roughnessMap, point).g.clamp(roughness[0], roughness[1]);
  material.aoNode = mix(float(1), texture(material.aoMap, point).r, painted ? 0.08 : 0.45);
  return material;
}

function architecturalFloor(room: Room) {
  const finish = room.floorFinish;
  const surface = finish === 'wood' ? 'wood' : finish === 'marble' ? 'marble' : 'stone';
  const point = uv();
  const material = architecturalMaterial(room.floorColor, surface, point.div(surfaceScale[surface]), finish === 'wood' ? 0.55 : 0.7, finish === 'concrete' ? [0.7, 0.98] : finish === 'marble' ? [0.12, 0.35] : [0.24, 0.7]);
  material.clearcoat = finish === 'concrete' ? 0 : finish === 'marble' ? 0.5 : 0.22;
  material.clearcoatRoughness = finish === 'marble' ? 0.16 : 0.3;
  material.clearcoatNormalNode = material.normalNode;
  if (finish.startsWith('tile-')) {
    const body = tileBody(point, finish === 'tile-brick' ? 0.6 : 0.5, finish === 'tile-brick' ? 0.3 : 0.5, finish === 'tile-brick');
    const checker = point.x.mul(2).floor().add(point.y.mul(2).floor()).mul(0.5).fract().mul(2);
    const tone = finish === 'tile-checker' ? checker.mul(-0.68).add(1) : float(1);
    material.colorNode = mix(color('#b8b4a9'), (material.colorNode as ShaderValue).mul(tone), body);
    material.roughnessNode = mix(float(0.94), (material.roughnessNode as ShaderValue).mul(0.65), body);
    const normal = texture(material.normalMap!, point.div(surfaceScale[surface])).rgb.mul(2).sub(1);
    const delta = 0.001;
    const height = (p: ShaderValue) => tileBody(p, finish === 'tile-brick' ? 0.6 : 0.5, finish === 'tile-brick' ? 0.3 : 0.5, finish === 'tile-brick').mul(0.0012);
    const dx = height(point.add(vec2(delta, 0))).sub(height(point.sub(vec2(delta, 0)))).div(delta * 2);
    const dy = height(point.add(vec2(0, delta))).sub(height(point.sub(vec2(0, delta)))).div(delta * 2);
    material.normalNode = normalMap(vec3(normal.x.mul(0.35).sub(dx), normal.y.mul(0.35).sub(dy), normal.z).normalize().mul(0.5).add(0.5));
    material.clearcoatNormalNode = material.normalNode;
    material.clearcoatNode = body.mul(0.32);
  }
  return material;
}

function noise(p: ShaderValue) {
  return p.x.mul(127.1).add(p.y.mul(311.7)).sin().mul(43758.5453).fract();
}

function woodGrain(p: ShaderValue) {
  const bend = p.x.mul(3.5).sin().mul(3).add(p.y.mul(18).add(p.x.mul(6)).sin().mul(0.6));
  return p.y.mul(210).add(bend).sin().mul(0.35).add(p.y.mul(1200).add(bend.mul(2)).sin().mul(0.15)).add(0.5);
}

function tileBody(p: ShaderValue, width: number, depth: number, staggered = false) {
  const row = p.y.div(depth).floor();
  const shift = staggered ? row.mul(0.5).fract() : float(0);
  const cell = vec2(p.x.div(width).add(shift), p.y.div(depth)).fract();
  const edge = min(min(cell.x, cell.x.oneMinus()).mul(width), min(cell.y, cell.y.oneMinus()).mul(depth));
  return smoothstep(0.001, 0.005, edge);
}

function floorPattern(p: ShaderValue, finish: FloorFinish, realistic: boolean) {
  if (finish === 'wood') {
    if (!realistic) {
      const grain = p.x.mul(68).add(p.y.mul(13).sin().mul(3)).sin().mul(0.035).add(0.965);
      const plank = p.y.mul(6).floor().mul(17).sin().mul(0.035).add(0.965);
      const seam = step(0.018, p.y.mul(6).fract()).mul(0.14).add(0.86);
      return { tone: grain.mul(plank).mul(seam), height: float(0), roughness: float(0.78), body: float(1) };
    }
    const grain = woodGrain(p);
    const body = tileBody(p, 1.25, 0.18, true);
    const plank = p.y.div(0.18).floor().mul(17).sin().mul(0.06).add(0.94);
    return { tone: grain.mul(0.14).add(0.86).mul(plank).mul(body.mul(0.22).add(0.78)), height: body.mul(0.0012).add(grain.mul(0.0003)), roughness: grain.mul(0.13).add(0.44), body: float(1) };
  }
  if (finish.startsWith('tile-')) {
    const body = tileBody(p, finish === 'tile-brick' ? 0.6 : 0.5, finish === 'tile-brick' ? 0.3 : 0.5, finish === 'tile-brick');
    const checker = p.x.mul(2).floor().add(p.y.mul(2).floor()).mul(0.5).fract().mul(2);
    const variation = noise(p.mul(45));
    const tone = finish === 'tile-checker' ? checker.mul(-0.58).add(1) : variation.mul(realistic ? 0.025 : 0.005).add(0.975);
    return { tone, height: body.mul(0.002).add(variation.mul(0.00006)), roughness: mix(float(0.94), variation.mul(0.06).add(0.23), body), body };
  }
  if (finish === 'marble') {
    const wave = p.x.mul(3.1).add(p.y.mul(2.3)).add(p.x.mul(5).add(p.y.mul(3)).sin().mul(1.1)).add(p.y.mul(13).sin().mul(0.25)).sin().abs();
    const vein = smoothstep(0.035, 0.16, wave).oneMinus();
    return { tone: vein.mul(-0.46).add(1), height: vein.mul(-0.00012), roughness: vein.mul(0.1).add(0.17), body: float(1) };
  }
  const speckle = noise(p.mul(160));
  const cloud = p.x.mul(5).sin().mul(p.y.mul(7).sin()).mul(0.03).add(0.93);
  return { tone: cloud.mul(speckle.mul(0.09).add(0.91)), height: speckle.mul(0.00045), roughness: speckle.mul(0.12).add(0.84), body: float(1) };
}

function surfaceNormal(point: ShaderValue, height: (p: ShaderValue) => ShaderValue) {
  // Explicit height samples preserve procedural bump gradients without texture lookups.
  const delta = 0.002;
  const dx = height(point.add(vec2(delta, 0))).sub(height(point.sub(vec2(delta, 0)))).div(delta * 2);
  const dy = height(point.add(vec2(0, delta))).sub(height(point.sub(vec2(0, delta)))).div(delta * 2);
  return normalMap(vec3(dx.negate(), dy.negate(), 1).normalize().mul(0.5).add(0.5));
}

export function createFloorMaterial(room: Room): THREE.MeshStandardNodeMaterial {
  if (room.renderQuality === 'hyperrealistic') return architecturalFloor(room);
  const realistic = room.renderQuality === 'realistic';
  const material = realistic
    ? new THREE.MeshPhysicalNodeMaterial({ color: room.floorColor, roughness: 0.5, clearcoat: room.floorFinish === 'concrete' ? 0 : 0.22, clearcoatRoughness: 0.28 })
    : new THREE.MeshStandardNodeMaterial({ color: room.floorColor, roughness: 0.78 });
  const point = uv();
  const pattern = floorPattern(point, room.floorFinish, realistic);
  material.colorNode = mix(color('#b8b6ae'), color(room.floorColor).mul(pattern.tone), pattern.body);
  if (material instanceof THREE.MeshPhysicalNodeMaterial) {
    material.roughnessNode = pattern.roughness;
    material.normalNode = surfaceNormal(point, p => floorPattern(p, room.floorFinish, true).height);
    material.clearcoatNormalNode = material.normalNode;
    if (room.floorFinish.startsWith('tile-')) material.clearcoatNode = pattern.body.mul(0.22);
  }
  return material;
}

export function createWallMaterial(hex: string, quality: Quality): THREE.MeshStandardNodeMaterial {
  if (quality === 'standard') return new THREE.MeshStandardNodeMaterial({ color: hex, roughness: 0.95, side: THREE.DoubleSide });
  if (quality === 'hyperrealistic') {
    const material = architecturalMaterial(hex, 'plaster', uv().div(surfaceScale.plaster), 0.07, [0.78, 0.97]);
    material.side = THREE.DoubleSide;
    material.clearcoat = 0.025;
    material.clearcoatRoughness = 0.8;
    material.clearcoatNormalNode = material.normalNode;
    return material;
  }
  const material = new THREE.MeshPhysicalNodeMaterial({ color: hex, roughness: 0.9, clearcoat: 0.025, clearcoatRoughness: 0.8, side: THREE.DoubleSide });
  const point = uv();
  material.roughnessNode = noise(point.mul(210)).mul(0.07).add(0.87);
  material.normalNode = surfaceNormal(point, p => noise(p.mul(210)).mul(0.00015));
  material.clearcoatNormalNode = material.normalNode;
  return material;
}

export function createCeilingMaterial(hex: string, quality: Quality): THREE.MeshStandardNodeMaterial {
  const material = createWallMaterial(hex, quality);
  material.roughness = 0.97;
  if (quality === 'hyperrealistic') material.roughnessNode = texture(material.roughnessMap!, uv()).g.max(0.94);
  return material;
}

export function createWoodMaterial(hex: string, quality: Quality): THREE.MeshStandardNodeMaterial {
  if (quality === 'standard') return new THREE.MeshStandardNodeMaterial({ color: hex, roughness: 0.8 });
  if (quality === 'hyperrealistic') {
    const material = architecturalMaterial(hex, 'wood', uv().div(surfaceScale.wood), 0.45, [0.27, 0.8]);
    material.clearcoat = 0.25;
    material.clearcoatRoughness = 0.32;
    material.clearcoatNormalNode = material.normalNode;
    return material;
  }
  const material = new THREE.MeshPhysicalNodeMaterial({ color: hex, roughness: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.35 });
  const point = uv().yx;
  const grain = woodGrain(point);
  material.colorNode = color(hex).mul(grain.mul(0.16).add(0.84));
  material.roughnessNode = grain.mul(0.12).add(0.43);
  material.normalNode = surfaceNormal(uv(), p => woodGrain(p.yx).mul(0.00025));
  material.clearcoatNormalNode = material.normalNode;
  return material;
}

export function createFabricMaterial(hex: string, quality: Quality): THREE.MeshStandardNodeMaterial {
  if (quality !== 'hyperrealistic') return new THREE.MeshStandardNodeMaterial({ color: hex, roughness: 1 });
  const material = architecturalMaterial(hex, 'fabric', uv().div(surfaceScale.fabric), 0.45, [0.8, 1]);
  material.sheen = 0.5;
  material.sheenColor.set(hex);
  material.sheenRoughness = 0.9;
  return material;
}
