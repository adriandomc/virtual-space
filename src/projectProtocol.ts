import { projectStructure, type ProjectDocument, type ProjectLevel } from './projectDocument.js';

type OpeningRemap = { levelId: string; id: string; fromWallId: string; fromOffset: number; wallId?: string; offset?: number };
export type StructureCommand = { type: 'replace-structure'; project: ProjectDocument; expected: Record<string, number>; expectedStructureRevision?: number; stairIds?: string[]; roofIds?: string[]; openingRemaps?: OpeningRemap[] };
const structural = (project: ProjectDocument) => JSON.parse(projectStructure(project)) as { levels: unknown[]; stairs: unknown[]; roofs: unknown[] };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function structureCommand(previous: ProjectDocument, project: ProjectDocument, revisions: Record<string, number>, structureRevision: number): StructureCommand | null {
  const before = structural(previous), after = structural(project), expected: Record<string, number> = {};
  const ids = new Set([...previous.levels, ...project.levels].map(level => level.id));
  for (const id of ids) if (!same(before.levels.find((level: any) => level.id === id), after.levels.find((level: any) => level.id === id))) expected[id] = revisions[id] ?? 0;
  const global = !same(previous.levels.map(level => level.id), project.levels.map(level => level.id));
  const changedIds = (before: any[], after: any[]) => [...new Set([...before, ...after].map(value => value.id))].filter(id => !same(before.find(value => value.id === id), after.find(value => value.id === id)));
  const stairIds = changedIds(before.stairs, after.stairs), roofIds = changedIds(before.roofs, after.roofs);
  const openingRemaps: OpeningRemap[] = [];
  for (const level of previous.levels) for (const opening of level.openings) {
    const next = project.levels.find(value => value.id === level.id)?.openings.find(value => value.id === opening.id);
    if (!next || next.wallId !== opening.wallId || next.offset !== opening.offset) openingRemaps.push({ levelId: level.id, id: opening.id, fromWallId: opening.wallId, fromOffset: opening.offset, ...(next ? { wallId: next.wallId, offset: next.offset } : {}) });
  }
  // Stairs and roofs depend on their supporting levels even when the plan stayed unchanged.
  for (const item of [...previous.stairs, ...project.stairs].filter(item => stairIds.includes(item.id)).concat([...previous.roofs, ...project.roofs].filter(item => roofIds.includes(item.id)) as any)) {
    for (const key of ['levelId', 'fromLevelId', 'toLevelId'] as const) if (key in item) { const id = (item as any)[key] as string; expected[id] = revisions[id] ?? 0; }
  }
  return Object.keys(expected).length || global ? { type: 'replace-structure', project, expected, stairIds, roofIds, openingRemaps, ...(global ? { expectedStructureRevision: structureRevision } : {}) } : null;
}
/** A structural edit cannot overwrite simultaneous paint, furniture or light changes. */
export function mergeStructure(current: ProjectDocument, command: StructureCommand): ProjectDocument {
  const target = command.project;
  const applyLevel = (next: ProjectLevel) => {
    const old = current.levels.find(level => level.id === next.id);
    if (!old) return next;
    return { ...old, elevation: next.elevation, height: next.height, thickness: next.thickness, points: next.points, outline: next.outline,
      walls: next.walls.map(wall => { const previous = old.walls.find(value => value.id === wall.id); return previous ? { ...wall, left: previous.left, right: previous.right } : wall; }),
      surfaces: next.surfaces.map(surface => { const previous = old.surfaces.find(value => value.id === surface.id); if (!previous) return surface; return surface.kind === 'floor' && previous.kind === 'floor' ? { ...surface, finish: previous.finish, undersideFinish: previous.undersideFinish } : { ...surface, finish: previous.finish }; }),
      openings: old.openings.flatMap(opening => {
        const remap = command.openingRemaps?.find(value => value.levelId === next.id && value.id === opening.id);
        if (remap) {
          if (opening.wallId !== remap.fromWallId || Math.abs(opening.offset - remap.fromOffset) > 1e-7) throw new Error('La abertura cambió en otra sesión. Revisa el diseño.');
          return remap.wallId ? [{ ...opening, wallId: remap.wallId, offset: remap.offset! }] : [];
        }
        return next.walls.some(wall => wall.id === opening.wallId) ? [opening] : [];
      }),
    };
  };
  const global = command.expectedStructureRevision !== undefined;
  const levels = (global ? target.levels : current.levels).map(level => Object.hasOwn(command.expected, level.id) ? applyLevel(target.levels.find(value => value.id === level.id)!) : level);
  const stairs = [...current.stairs.filter(stair => !command.stairIds?.includes(stair.id)), ...target.stairs.filter(stair => command.stairIds?.includes(stair.id)).map(stair => { const old = current.stairs.find(value => value.id === stair.id); return old ? { ...stair, finish: old.finish } : stair; })];
  const roofs = [...current.roofs.filter(roof => !command.roofIds?.includes(roof.id)), ...target.roofs.filter(roof => command.roofIds?.includes(roof.id)).map(roof => { const old = current.roofs.find(value => value.id === roof.id); return old ? { ...roof, finish: old.finish, undersideFinish: old.undersideFinish } : roof; })];
  return { ...current, levels, activeLevelId: levels.some(level => level.id === current.activeLevelId) ? current.activeLevelId : levels[0].id, stairs, roofs };
}
