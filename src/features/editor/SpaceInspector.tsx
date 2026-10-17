import { Grid2X2, Ruler } from 'lucide-react';
import { t, useLocale } from '../../shared/i18n/i18n';
import { bounds, polygonArea, resizeRoom, fitRoom } from '../../domain/project/model';
import type { Room, Selection } from '../../domain/project/types';
import type { ProjectDocument } from '../../domain/project/projectDocument';
import ConstructionPanel from '../construction/ConstructionPanel';
import { NumberField, Section } from './propertyControls';

type Props = {
  room: Room;
  project: ProjectDocument;
  activeLevelId: string;
  selection: Selection | null;
  readOnly: boolean;
  drawing: boolean;
  onProjectChange: (project: ProjectDocument) => boolean;
  previewProject: (project: ProjectDocument | null) => void;
  onSelect: (selection: Selection | null) => void;
  change: (next: Room | (() => Room)) => boolean;
  editPlan: () => Promise<void>;
};

export default function SpaceInspector({ room, project, activeLevelId, selection, readOnly, drawing, onProjectChange, previewProject, onSelect, change, editPlan }: Props) {
  useLocale();
  const size = bounds(room.vertices), area = polygonArea(room.vertices);
  return <><ConstructionPanel project={project} activeLevelId={activeLevelId} onChange={onProjectChange} onPreview={previewProject} selection={selection} onSelect={onSelect} readOnly={readOnly || drawing} only="roof" /><fieldset disabled={readOnly || drawing} className="property-fields">
    <Section title={t("Dimensiones")}><div className="dimensions-grid"><NumberField label={t("Ancho del cuarto")} value={size.width} min={0.5} max={50} onChange={width => change(() => resizeRoom(room, width, size.depth))} /><NumberField label={t("Largo del cuarto")} value={size.depth} min={0.5} max={50} onChange={depth => change(() => resizeRoom(room, size.width, depth))} /><NumberField label={t("Altura del cuarto")} value={room.height} min={1.8} max={8} onChange={height => change(() => fitRoom({ ...room, height }))} /></div><div className="area-tag"><Ruler size={16} />{area.toFixed(2)} m²</div><button className="outline-button full-width" onClick={() => void editPlan()}><Grid2X2 size={17} />{t("Editar planta")}</button></Section>
    <Section title={t("Más opciones")} defaultOpen={false}><NumberField label={t("Espesor de muro")} value={room.thickness} min={0.05} max={0.6} step={0.01} onChange={thickness => change({ ...room, thickness })} /></Section>
  </fieldset></>;
}
