import * as THREE from 'three';
import { setWorkshopMaterial } from './modelWorkshopGeometry';
import type { FurnitureMaterial } from '../../domain/project/types';

export type WorkshopPieceShape = 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'wedge';
export type WorkshopPiecePreset = { id: string; label: string; category: 'primitives' | 'prefabs'; shape: WorkshopPieceShape; width: number; height: number; depth: number; material?: FurnitureMaterial };

export const WORKSHOP_PIECES: readonly WorkshopPiecePreset[] = [
  { id: 'cube', label: 'Cubo', category: 'primitives', shape: 'box', width: .5, height: .5, depth: .5 },
  { id: 'cylinder', label: 'Cilindro', category: 'primitives', shape: 'cylinder', width: .5, height: .5, depth: .5 },
  { id: 'sphere', label: 'Esfera', category: 'primitives', shape: 'sphere', width: .5, height: .5, depth: .5 },
  { id: 'cone', label: 'Cono', category: 'primitives', shape: 'cone', width: .5, height: .5, depth: .5 },
  { id: 'torus', label: 'Aro', category: 'primitives', shape: 'torus', width: .54, height: .54, depth: .14 },
  { id: 'wedge', label: 'Cuña', category: 'primitives', shape: 'wedge', width: .5, height: .5, depth: .5 },
  { id: 'board', label: 'Tabla', category: 'prefabs', shape: 'box', width: 1.2, height: .024, depth: .6 },
  { id: 'shelf', label: 'Repisa', category: 'prefabs', shape: 'box', width: 1, height: .035, depth: .3 },
  { id: 'square-rod', label: 'Barra rectangular', category: 'prefabs', shape: 'box', width: .04, height: 1, depth: .04 },
  { id: 'round-rod', label: 'Barra redonda', category: 'prefabs', shape: 'cylinder', width: .04, height: 1, depth: .04, material: 'metal' },
  { id: 'square-leg', label: 'Pata cuadrada', category: 'prefabs', shape: 'box', width: .055, height: .72, depth: .055 },
  { id: 'round-leg', label: 'Pata redonda', category: 'prefabs', shape: 'cylinder', width: .06, height: .72, depth: .06 },
  { id: 'tapered-leg', label: 'Pata cónica', category: 'prefabs', shape: 'cone', width: .08, height: .6, depth: .08 },
  { id: 'handle', label: 'Jaladera', category: 'prefabs', shape: 'cylinder', width: .16, height: .016, depth: .016, material: 'metal' },
  { id: 'knob', label: 'Perilla', category: 'prefabs', shape: 'sphere', width: .035, height: .035, depth: .035, material: 'metal' },
  { id: 'disk', label: 'Disco', category: 'prefabs', shape: 'cylinder', width: .3, height: .02, depth: .3 },
  { id: 'molding', label: 'Moldura', category: 'prefabs', shape: 'box', width: .8, height: .04, depth: .05 },
  { id: 'rosette', label: 'Roseta', category: 'prefabs', shape: 'cylinder', width: .08, height: .02, depth: .08 },
];

function moldingGeometry(preset: WorkshopPiecePreset) {
  const h = preset.height, d = preset.depth, profile = new THREE.Shape();
  profile.moveTo(-d / 2, -h / 2); profile.lineTo(d / 2, -h / 2); profile.lineTo(d / 2, -h * .22);
  profile.lineTo(d * .25, -h * .22); profile.lineTo(d * .25, h * .22); profile.lineTo(0, h * .22);
  profile.lineTo(0, h / 2); profile.lineTo(-d / 2, h / 2); profile.closePath();
  const geometry = new THREE.ExtrudeGeometry(profile, { depth: preset.width, bevelEnabled: false });
  geometry.rotateY(Math.PI / 2); geometry.translate(-preset.width / 2, 0, 0);
  return geometry;
}

function rosetteGeometry(preset: WorkshopPiecePreset) {
  const profile = new THREE.Shape();
  for (let i = 0; i < 24; i++) {
    const angle = i * Math.PI / 12, radius = preset.width / 2 * (i % 2 ? .6 : 1), x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    if (!i) profile.moveTo(x, y); else profile.lineTo(x, y);
  }
  profile.closePath();
  const geometry = new THREE.ExtrudeGeometry(profile, { depth: preset.height, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, -preset.height / 2, 0);
  return geometry;
}

/** Every entry is one closed solid; its transform can be fed directly into a CSG brush. */
export function createWorkshopPiece(id: string): THREE.Mesh {
  const preset = WORKSHOP_PIECES.find(piece => piece.id === id);
  if (!preset) throw new Error('Selecciona una pieza válida.');
  const { width, height, depth } = preset;
  let geometry: THREE.BufferGeometry;
  if (id === 'molding') geometry = moldingGeometry(preset);
  else if (id === 'rosette') geometry = rosetteGeometry(preset);
  else if (id === 'handle') { geometry = new THREE.CylinderGeometry(depth / 2, depth / 2, width, 32); geometry.rotateZ(Math.PI / 2); }
  else if (id === 'tapered-leg') geometry = new THREE.CylinderGeometry(width * .2, width / 2, height, 32);
  else if (preset.shape === 'box') geometry = new THREE.BoxGeometry(width, height, depth);
  else if (preset.shape === 'cylinder') geometry = new THREE.CylinderGeometry(width / 2, width / 2, height, 32);
  else if (preset.shape === 'sphere') { geometry = new THREE.SphereGeometry(.5, 32, 24); geometry.scale(width, height, depth); }
  else if (preset.shape === 'cone') geometry = new THREE.ConeGeometry(width / 2, height, 32);
  else if (preset.shape === 'torus') geometry = new THREE.TorusGeometry((width - depth) / 2, depth / 2, 16, 48);
  else {
    const shape = new THREE.Shape(); shape.moveTo(-width / 2, -height / 2); shape.lineTo(width / 2, -height / 2); shape.lineTo(-width / 2, height / 2); shape.closePath();
    geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }); geometry.translate(0, 0, -depth / 2);
  }
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial(), mesh = new THREE.Mesh(geometry, material);
  setWorkshopMaterial(mesh, preset.material ?? 'wood', preset.material === 'metal' ? '#8b8d88' : '#b8a084');
  mesh.name = preset.label; mesh.position.y = -geometry.boundingBox!.min.y; mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}
