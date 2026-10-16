import { ceilingFinishTargets, projectLevel, type ProjectDocument } from '../../domain/project/projectDocument';
import type { Room, Selection } from '../../domain/project/types';
import { t } from '../../shared/i18n/i18n';
import { wallName } from './editorLabels';

export function describeSurfaceSelection(project: ProjectDocument, activeLevelId: string, room: Room, selection: Selection | null, wallSide: 'left' | 'right') {
  const level = projectLevel(project, activeLevelId);
  const selectedWall = selection?.kind === 'wall' ? selection.id ? room.wallIds?.indexOf(selection.id) ?? -1 : selection.index : 0;
  const selectedSurface = selection?.kind === 'floor' || selection?.kind === 'ceiling' ? selection.id ? level.surfaces.find(surface => surface.id === selection.id && surface.kind === selection.kind) : level.surfaces.find(surface => surface.kind === selection.kind) : undefined;
  const ceilings = ceilingFinishTargets(project, activeLevelId);
  const selectedCeiling = selection?.kind === 'ceiling' ? selection.id ? ceilings.find(item => item.id === selection.id) : ceilings[0] : undefined;
  const surface = selection?.kind === 'floor' ? 'floor' : selection?.kind === 'ceiling' ? 'ceiling' : 'wall';
  const surfaceName = surface === 'floor' ? t("Piso") : surface === 'ceiling' ? t("Techo") : wallName(selectedWall);
  const selectedColor = surface === 'floor' ? selectedSurface?.finish.color ?? room.floorColor : surface === 'ceiling' ? selectedCeiling?.finish.color ?? room.ceilingColor : level.walls[selectedWall]?.[wallSide].color ?? '#ffffff';
  return { level, selectedWall, selectedSurface, ceilings, selectedCeiling, surface, surfaceName, selectedColor };
}

export type SurfaceSelection = ReturnType<typeof describeSurfaceSelection>;
