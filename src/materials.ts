import * as THREE from 'three/webgpu';
import { color, float, min, mix, normalMap, smoothstep, step, uv, vec2, vec3, type ShaderNodeObject } from 'three/tsl';
import type { FloorFinish, Room } from './types';

type ShaderValue = ShaderNodeObject<THREE.Node>;
type Quality = Room['renderQuality'];

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
  return material;
}

export function createWoodMaterial(hex: string, quality: Quality): THREE.MeshStandardNodeMaterial {
  if (quality === 'standard') return new THREE.MeshStandardNodeMaterial({ color: hex, roughness: 0.8 });
  const material = new THREE.MeshPhysicalNodeMaterial({ color: hex, roughness: 0.5, clearcoat: 0.15, clearcoatRoughness: 0.35 });
  const point = uv().yx;
  const grain = woodGrain(point);
  material.colorNode = color(hex).mul(grain.mul(0.16).add(0.84));
  material.roughnessNode = grain.mul(0.12).add(0.43);
  material.normalNode = surfaceNormal(uv(), p => woodGrain(p.yx).mul(0.00025));
  material.clearcoatNormalNode = material.normalNode;
  return material;
}
