import { Check, Layers3 } from 'lucide-react';
import { t, useLocale } from '../../shared/i18n/i18n';
import ColorPicker from '../../shared/ui/ColorPicker';
import { wallCount } from '../../domain/project/model';
import type { FloorFinish, Room, Selection } from '../../domain/project/types';
import type { ProjectDocument } from '../../domain/project/projectDocument';
import type { SurfaceSelection } from './editorSelection';
import { Section } from './propertyControls';
import { wallName } from './editorLabels';

const COLORS = [
  ['#9cae98', 'Salvia suave'], ['#e7e3d9', 'Lino natural'], ['#d7c7b1', 'Arena'], ['#c4967c', 'Terracota'],
  ['#acbabc', 'Bruma azul'], ['#7e9390', 'Eucalipto'], ['#dad1c5', 'Piedra'], ['#b4ad9c', 'Oliva gris'],
  ['#d4b4ae', 'Rosa arcilla'], ['#8d9eaf', 'Azul pizarra'], ['#f3f0e9', 'Blanco cálido'], ['#646d64', 'Bosque'],
];
const FINISHES: [FloorFinish, string][] = [['wood', 'Madera'], ['tile-grid', 'Loseta'], ['tile-brick', 'Loseta trabada'], ['tile-checker', 'Damero'], ['marble', 'Mármol'], ['concrete', 'Concreto']];

type Props = {
  room: Room;
  project: ProjectDocument;
  selection: Selection | null;
  target: SurfaceSelection;
  wallSide: 'left' | 'right';
  setWallSide: (side: 'left' | 'right') => void;
  usedColors: string[];
  readOnly: boolean;
  select: (selection: Selection) => void;
  paint: (color: string) => boolean;
  paintedProject: (color: string) => ProjectDocument;
  previewProject: (project: ProjectDocument | null) => void;
  finishSurface: (material: FloorFinish) => boolean;
  applyAllWalls: () => boolean;
  finishFloor: (material: FloorFinish) => boolean;
};

export default function SurfaceInspector({ room, project, selection, target, wallSide, setWallSide, usedColors, readOnly, select, paint, paintedProject, previewProject, finishSurface, applyAllWalls, finishFloor }: Props) {
  useLocale();
  const { level, selectedWall, selectedSurface, selectedCeiling, ceilings, surface, surfaceName, selectedColor } = target;
  return <>
    <Section title={t("Superficie")}>{surface === 'wall' && <label className="select-field">{t('Cara de la pared')}<select aria-label={t('Cara de la pared')} value={wallSide} onChange={event => setWallSide(event.target.value as 'left' | 'right')}><option value="left">{t('Lado izquierdo')}</option><option value="right">{t('Lado derecho')}</option></select></label>}<label className="select-field">{t("Superficie")}<select aria-label={t("Superficie a pintar")} value={surface === 'wall' ? String(selectedWall) : surface} onChange={event => select(event.target.value === 'floor' || event.target.value === 'ceiling' ? { kind: event.target.value } : { kind: 'wall', index: Number(event.target.value), id: room.wallIds?.[Number(event.target.value)] })}>{Array.from({ length: wallCount(room) }, (_, index) => <option key={index} value={index}>{wallName(index)}</option>)}<option value="floor">{t("Piso")}</option><option value="ceiling">{t("Techo")}</option></select></label>
      <ColorPicker key={JSON.stringify(selection) + wallSide} value={selectedColor} onChange={paint} onPreview={color => previewProject(color ? paintedProject(color) : null)} revision={project} colors={usedColors} disabled={readOnly} label={t("Color")} />
      {surface !== 'floor' && <label className="select-field">{t('Material de la superficie')}<select aria-label={t('Material de la superficie')} disabled={readOnly} value={surface === 'wall' ? level.walls[selectedWall]?.[wallSide].material ?? 'concrete' : selectedCeiling?.finish.material ?? 'concrete'} onChange={event => finishSurface(event.target.value as FloorFinish)}>{FINISHES.map(([finish, name]) => <option key={finish} value={finish}>{t(name)}</option>)}</select></label>}
      {surface === 'wall' && <button disabled={readOnly} className="outline-button full-width" onClick={() => applyAllWalls()}><Layers3 size={14} />{t("Aplicar a todas las paredes")}</button>}
      {surface === 'floor' && level.surfaces.filter(item => item.kind === 'floor').length > 1 && <label className="select-field">{t('Zona del piso')}<select aria-label={t('Zona del piso')} value={selectedSurface?.id ?? ''} onChange={event => select({ kind: 'floor', id: event.target.value })}>{level.surfaces.filter(item => item.kind === 'floor').map((item, index) => <option key={item.id} value={item.id}>{t('Zona {{number}}', { number: index + 1 })}</option>)}</select></label>}
      {surface === 'ceiling' && ceilings.length > 1 && <label className="select-field">{t('Zona del techo')}<select aria-label={t('Zona del techo')} value={selectedCeiling?.id ?? ''} onChange={event => select({ kind: 'ceiling', id: event.target.value })}>{ceilings.map((item, index) => <option key={item.id} value={item.id}>{t('Zona {{number}}', { number: index + 1 })}</option>)}</select></label>}
      {surface === 'floor' && <label className="select-field">{t("Material del piso")}<select aria-label={t("Material del piso")} disabled={readOnly} value={selectedSurface?.finish.material ?? room.floorFinish} onChange={event => finishFloor(event.target.value as FloorFinish)}>{FINISHES.map(([finish, name]) => <option key={finish} value={finish}>{t(name)}</option>)}</select></label>}
    </Section>
    <Section title={t("Paleta")} defaultOpen={false}>
      <div className="color-palette">{COLORS.map(([hex, name]) => <button key={hex} disabled={readOnly} aria-label={t('Pintar {{surface}}: {{color}}', { surface: surfaceName, color: t(name) })} title={t(name)} aria-pressed={selectedColor.toLowerCase() === hex} className={selectedColor.toLowerCase() === hex ? 'selected' : ''} style={{ background: hex }} onClick={() => paint(hex)}>{selectedColor.toLowerCase() === hex && <Check size={18} />}</button>)}</div>
      <span className="field-label palette-used-label">{t("En este cuarto")}</span><div className="used-colors">{usedColors.map(hex => <button key={hex} disabled={readOnly} aria-label={t('Usar color {{color}}', { color: hex })} title={hex.toUpperCase()} style={{ background: hex }} onClick={() => paint(hex)}>{selectedColor.toLowerCase() === hex && <Check size={14} />}</button>)}</div>
    </Section>
  </>;
}
