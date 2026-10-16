import { itemWorldPosition, moveSceneItem } from './model';
import { pointInRing, projectLevel, projectStructure, projectToRoom, updateProjectRoom, type ProjectDocument } from './projectDocument';
import { movePoint, moveWall, updateHole } from './projectOperations';
import { sameData } from './sameData';
import type { Point, Selection } from './types';

export type PlanMoveIntent = { kind: 'point'; id: string; position: Point } | { kind: 'wall'; id: string; delta: Point } | { kind: 'hole'; surfaceId: string; holeId: string; vertices: Point[] } | { kind: 'item'; selection: Selection; position: Point & { y?: number; rotation?: number } };

export function planUpdateActivityReason(state: { points: number; uploading: boolean; archived: number; pointers: number; dragging: boolean; pending: boolean; blocked: boolean }) {
  if (state.points || state.uploading || state.archived || state.pointers || state.dragging) return 'Termina, recupera o cancela el borrador antes de continuar.';
  return state.pending && state.blocked ? 'El movimiento pendiente se conserva. Revísalo antes de continuar.' : '';
}

function scope(project: ProjectDocument, levelId: string) {
  return JSON.parse(projectStructure({ ...project, levels: project.levels.filter(level => level.id === levelId), roofs: project.roofs.filter(roof => roof.levelId === levelId), stairs: project.stairs.filter(stair => stair.fromLevelId === levelId || stair.toLevelId === levelId) }));
}
export function samePlanBase(before: ProjectDocument, after: ProjectDocument, levelId: string, intent?: PlanMoveIntent | null) {
  if (before.id !== after.id || !after.levels.some(level => level.id === levelId) || !sameData(scope(before, levelId), scope(after, levelId))) return false;
  if (intent?.kind === 'item') {
    const first = projectToRoom(before, levelId), second = projectToRoom(after, levelId);
    if (!sameData(itemWorldPosition(first, intent.selection), itemWorldPosition(second, intent.selection))) return false;
    const items = (room: typeof first) => intent.selection.kind === 'furniture' ? room.furniture : intent.selection.kind === 'opening' ? room.openings : room.lights;
    const a = items(first).find(item => 'id' in intent.selection && item.id === intent.selection.id), b = items(second).find(item => 'id' in intent.selection && item.id === intent.selection.id);
    if (!a || !b) return false;
    for (const key of ['width', 'depth', 'height', 'rotation', 'wall', 'offset', 'sill'] as const) if ((a as unknown as Record<string, unknown>)[key] !== (b as unknown as Record<string, unknown>)[key]) return false;
  }
  return true;
}
export function applyPlanMove(project: ProjectDocument, levelId: string, intent: PlanMoveIntent) {
  if (intent.kind === 'point') return movePoint(project, levelId, intent.id, intent.position);
  if (intent.kind === 'wall') return moveWall(project, levelId, intent.id, intent.delta);
  if (intent.kind === 'hole') return updateHole(project, levelId, intent.surfaceId, intent.holeId, intent.vertices);
  return updateProjectRoom(project, levelId, moveSceneItem(projectToRoom(project, levelId), intent.selection, intent.position));
}
export function containingFloor(project: ProjectDocument, levelId: string, vertices: Point[]) {
  const level = projectLevel(project, levelId);
  return level.surfaces.find(surface => surface.kind === 'floor' && vertices.every(point => pointInRing(point, surface.outline.map(id => level.points.find(vertex => vertex.id === id)!))));
}
