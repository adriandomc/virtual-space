import type { ProjectDocument } from '../../domain/project/projectDocument';
import type { PaintTarget } from '../../domain/project/projectPaint';

type PlanMarker = { planSurface?: string; planWall?: string; planItem?: string; planStair?: string; planHole?: string };

export function planPaintTarget(project: ProjectDocument, levelId: string, marker: PlanMarker, wallSide: 'left' | 'right'): PaintTarget | null {
  const level = project.levels.find(level => level.id === levelId);
  if (!level || marker.planHole) return null;
  if (marker.planSurface && level.surfaces.some(surface => surface.id === marker.planSurface && surface.kind === 'floor')) return { levelId, selection: { kind: 'floor', id: marker.planSurface } };
  if (marker.planWall) {
    const index = level.walls.findIndex(wall => wall.id === marker.planWall);
    return index < 0 ? null : { levelId, selection: { kind: 'wall', index, id: marker.planWall }, wallSide };
  }
  if (marker.planItem) {
    const id = marker.planItem;
    if (level.furniture.some(item => item.id === id)) return { levelId, selection: { kind: 'furniture', id } };
    if (level.openings.some(item => item.id === id)) return { levelId, selection: { kind: 'opening', id } };
    if (level.lights.some(item => item.id === id)) return { levelId, selection: { kind: 'light', id } };
  }
  if (marker.planStair && project.stairs.some(stair => stair.id === marker.planStair && (stair.fromLevelId === levelId || stair.toLevelId === levelId))) return { levelId, selection: { kind: 'stair', id: marker.planStair } };
  return null;
}
