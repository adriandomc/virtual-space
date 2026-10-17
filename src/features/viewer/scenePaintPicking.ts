import type * as THREE from 'three/webgpu';
import { ceilingFinishTargets, type ProjectDocument } from '../../domain/project/projectDocument';
import { paintTargetColor, type PaintTarget } from '../../domain/project/projectPaint';
import type { Selection } from '../../domain/project/types';

export function selectedScenePaintTarget(project: ProjectDocument, activeLevelId: string, selection: Selection | null, wallSide: 'left' | 'right' = 'left'): PaintTarget | null {
  if (!selection) return null;
  const level = project.levels.find(level => level.id === activeLevelId);
  if (!level) return null;
  let target: PaintTarget = { levelId: level.id, selection, ...(selection.kind === 'wall' ? { wallSide } : {}) };
  if (selection.kind === 'wall') {
    const wall = selection.id ? level.walls.find(wall => wall.id === selection.id) : level.walls[selection.index];
    if (!wall) return null;
    target = { ...target, selection: { kind: 'wall', index: level.walls.indexOf(wall), id: wall.id } };
  } else if (selection.kind === 'floor') {
    const floor = level.surfaces.find(surface => surface.kind === 'floor' && (!selection.id || surface.id === selection.id));
    if (!floor) return null;
    target = { ...target, selection: { kind: 'floor', id: floor.id } };
  } else if (selection.kind === 'ceiling') {
    const ceiling = ceilingFinishTargets(project, level.id).find(target => !selection.id || target.id === selection.id);
    if (!ceiling) return null;
    target = { ...target, selection: { kind: 'ceiling', id: ceiling.id } };
  }
  try { paintTargetColor(project, target); return target; } catch { return null; }
}

/** Resolve the visible mesh face, rather than the active level's flat selection list. */
export function scenePaintTarget(project: ProjectDocument, activeLevelId: string, hit: THREE.Intersection, fallbackWallSide: 'left' | 'right' = 'left'): PaintTarget | null {
  let object: THREE.Object3D | null = hit.object, selected: Selection | null = null;
  while (object) { if (object.userData.selection) { selected = object.userData.selection as Selection; break; } object = object.parent; }
  if (!selected) return null;
  if (selected.kind === 'floor' && hit.face?.materialIndex === 1 && selected.id) {
    const id = selected.id, below = project.levels.find(level => ceilingFinishTargets(project, level.id).some(target => target.id === id && target.side === 'undersideFinish'));
    return below ? { levelId: below.id, selection: { kind: 'ceiling', id } } : null;
  }
  if (selected.kind === 'roof') {
    const roof = project.roofs.find(roof => roof.id === selected.id);
    return roof ? { levelId: roof.levelId, selection: selected, roofSide: hit.face?.materialIndex === 1 ? 'undersideFinish' : 'finish' } : null;
  }
  if (selected.kind === 'stair') {
    const stair = project.stairs.find(stair => stair.id === selected.id);
    return stair ? { levelId: activeLevelId === stair.toLevelId ? stair.toLevelId : stair.fromLevelId, selection: selected } : null;
  }
  const selection = selected;
  const level = project.levels.find(level => selection.kind === 'wall' ? level.walls.some(wall => wall.id === selection.id) : selection.kind === 'floor' || selection.kind === 'ceiling' ? level.surfaces.some(surface => surface.id === selection.id && surface.kind === selection.kind) : selection.kind === 'furniture' ? level.furniture.some(item => item.id === selection.id) : selection.kind === 'opening' ? level.openings.some(item => item.id === selection.id) : level.lights.some(item => item.id === selection.id));
  return level ? selectedScenePaintTarget(project, level.id, selection, selection.kind === 'wall' && hit.face?.materialIndex !== undefined ? hit.face.materialIndex === 1 ? 'right' : 'left' : fallbackWallSide) : null;
}

export function visiblePaintHit(hit: THREE.Intersection, camera: THREE.Camera): boolean {
  if (!hit.object.layers.test(camera.layers)) return false;
  let object: THREE.Object3D | null = hit.object;
  while (object) { if (!object.visible) return false; object = object.parent; }
  return true;
}
