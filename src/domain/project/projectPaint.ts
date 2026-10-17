import { ceilingFinishTargets, projectLevel, validateProjectDocument, type ProjectDocument } from './projectDocument.js';
import type { FurnitureItem, Selection } from './types.js';

export type PaintTarget = { levelId: string; selection: Selection; wallSide?: 'left' | 'right'; roofSide?: 'finish' | 'undersideFinish' };
type ColorSlot = { color?: string | null; parts?: FurnitureItem['parts'] };

function targetSlot(project: ProjectDocument, target: PaintTarget): ColorSlot {
  const level = projectLevel(project, target.levelId), selection = target.selection;
  if (target.wallSide !== undefined && target.wallSide !== 'left' && target.wallSide !== 'right' || target.roofSide !== undefined && target.roofSide !== 'finish' && target.roofSide !== 'undersideFinish') throw new Error('La superficie no es válida.');
  if (selection.kind === 'wall') {
    const wall = level.walls.find(wall => wall.id === selection.id);
    if (!wall) throw new Error('La pared no existe.');
    return wall[target.wallSide ?? 'left'];
  }
  if (selection.kind === 'floor') {
    const surface = level.surfaces.find(surface => surface.kind === 'floor' && (selection.id === undefined || surface.id === selection.id));
    if (!surface) throw new Error('La superficie no es válida.');
    return surface.finish;
  }
  if (selection.kind === 'ceiling') {
    const visible = ceilingFinishTargets(project, level.id).find(finish => selection.id === undefined || finish.id === selection.id);
    if (!visible) throw new Error('La superficie no es válida.');
    if (visible.kind === 'roof') return project.roofs.find(roof => roof.id === visible.id)!.undersideFinish;
    const surface = projectLevel(project, visible.levelId).surfaces.find(surface => surface.id === visible.id)!;
    return surface.kind === 'floor' && visible.side === 'undersideFinish' ? surface.undersideFinish : surface.finish;
  }
  if (selection.kind === 'roof') {
    const roof = project.roofs.find(roof => roof.id === selection.id && roof.levelId === level.id);
    if (!roof) throw new Error('La cubierta no existe.');
    return roof[target.roofSide ?? 'finish'];
  }
  if (selection.kind === 'stair') {
    const stair = project.stairs.find(stair => stair.id === selection.id && (stair.fromLevelId === level.id || stair.toLevelId === level.id));
    if (!stair) throw new Error('La escalera no existe.');
    return stair.finish;
  }
  const item = selection.kind === 'furniture' ? level.furniture.find(item => item.id === selection.id) : selection.kind === 'opening' ? level.openings.find(item => item.id === selection.id) : level.lights.find(item => item.id === selection.id);
  if (!item) throw new Error('El elemento ya no existe.');
  return item;
}

/** A paint target always resolves stable IDs; a stale wall index cannot recolor another wall. */
export function paintTargetColor(project: ProjectDocument, target: PaintTarget): string | null {
  return targetSlot(project, target).color ?? null;
}

/** Sample the authored tint, independently of shadows, textures and visual quality. */
export function samplePaintTargetColor(project: ProjectDocument, target: PaintTarget, fallback?: string): string {
  const color = paintTargetColor(project, target);
  if (color) return color.toLowerCase();
  if (fallback && /^#[a-f\d]{6}$/i.test(fallback)) return fallback.toLowerCase();
  if (target.selection.kind === 'opening') {
    const opening = projectLevel(project, target.levelId).openings.find(opening => opening.id === target.selection.id)!;
    return opening.type === 'door' && opening.doorStyle !== 'frame' ? '#c7b297' : '#efece3';
  }
  return target.selection.kind === 'light' ? '#343931' : '#cccccc';
}

export function paintProjectTarget(project: ProjectDocument, target: PaintTarget, color: string): ProjectDocument {
  if (typeof color !== 'string' || !/^#[a-f\d]{6}$/i.test(color)) throw new Error('Usa un color hexadecimal de seis cifras.');
  const next = validateProjectDocument(project), slot = targetSlot(next, target), normalized = color.toLowerCase();
  if (slot.color === normalized && !Object.values(slot.parts ?? {}).some(part => part.color !== undefined && part.color !== normalized)) return project;
  slot.color = normalized;
  // Whole-object paint replaces authored part tints, while retaining their materials and transforms.
  if (target.selection.kind === 'furniture') for (const part of Object.values(slot.parts ?? {})) if (part.color !== undefined) part.color = normalized;
  return next;
}
