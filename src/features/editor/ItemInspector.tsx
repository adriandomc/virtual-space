import { Box, Grid2X2, MousePointer2, Paintbrush, Plus, Trash2 } from 'lucide-react';
import { t, useLocale } from '../../shared/i18n/i18n';
import ColorPicker from '../../shared/ui/ColorPicker';
import CustomModelEditor from '../models/CustomModelEditor';
import { BED_SIZES, FURNITURE_COLORS, wallCount, wallLength } from '../../domain/project/model';
import type { BedSize, FurnitureItem, FurnitureMaterial, Opening, Room, RoomLight, Selection } from '../../domain/project/types';
import type { ProjectDocument } from '../../domain/project/projectDocument';
import { NumberField, Section, Slider, Switch } from './propertyControls';
import { furnitureName, wallName } from './editorLabels';

type Props = {
  room: Room;
  selection: Selection | null;
  surfaceName: string;
  project: ProjectDocument;
  roomId: string;
  usedColors: string[];
  readOnly: boolean;
  showAdd: () => void;
  editMaterial: () => void;
  editPlan: () => Promise<void>;
  updateFurniture: (patch: Partial<FurnitureItem>) => boolean;
  updateOpening: (patch: Partial<Opening>) => boolean;
  updateLight: (patch: Partial<RoomLight>) => boolean;
  previewFurniture: (item: FurnitureItem | null) => void;
  setNotice: (message: string) => void;
  removeSelected: () => void;
  openWorkshop: (item?: FurnitureItem) => void;
};

export default function ItemInspector({ room, selection, surfaceName, project, roomId, usedColors, readOnly, showAdd, editMaterial, editPlan, updateFurniture, updateOpening, updateLight, previewFurniture, setNotice, removeSelected, openWorkshop }: Props) {
  useLocale();
  const furniture = selection?.kind === 'furniture' ? room.furniture.find(item => item.id === selection.id) : undefined;
  const opening = selection?.kind === 'opening' ? room.openings.find(item => item.id === selection.id) : undefined;
  const light = selection?.kind === 'light' ? room.lights.find(item => item.id === selection.id) : undefined;
  return <>
    {!selection && <div className="empty-inspector"><MousePointer2 size={23} /><p>{t("Selecciona un elemento en la escena o en la planta.")}</p><button className="outline-button" disabled={readOnly} onClick={showAdd}><Plus size={14} />{t("Agregar elemento")}</button></div>}
    {selection && !furniture && !opening && !light && <div className="empty-inspector"><Paintbrush size={22} /><p>{surfaceName}</p><button className="outline-button" onClick={() => editMaterial()}>{t("Editar material")}</button></div>}
    {furniture && <Section title={furniture.type === 'bed' ? t("Estructura") : t("Material")}>
      <label className="select-field">{t("Material")}<select aria-label={t("Material del mueble")} disabled={readOnly} value={furniture.material ?? ''} onChange={event => updateFurniture({ material: event.target.value ? event.target.value as FurnitureMaterial : null })}>{furniture.type === 'custom' && <option value="">{t("Del modelo")}</option>}<option value="wood">{t("Madera")}</option><option value="plastic">{t("Plástico")}</option><option value="metal">{t("Metal")}</option></select></label>
      {furniture.type === 'custom' && <label className="check-field"><input type="checkbox" disabled={readOnly} checked={furniture.color === null} onChange={event => updateFurniture({ color: event.target.checked ? null : '#ffffff' })} />{t("Colores originales")}</label>}
      {(furniture.type !== 'custom' || furniture.color !== null) && <ColorPicker key={furniture.id} value={furniture.color ?? FURNITURE_COLORS[furniture.type]} onChange={color => updateFurniture({ color })} onPreview={color => previewFurniture(color ? { ...furniture, color } : null)} revision={project} colors={usedColors} disabled={readOnly} label={t("Color del material")} />}
    </Section>}
    {furniture?.type === 'custom' && <CustomModelEditor item={furniture} roomId={roomId} readOnly={readOnly} onChange={next => updateFurniture({ parts: next.parts })} onPreview={previewFurniture} revision={project} colors={usedColors} notify={setNotice} />}
    <fieldset disabled={readOnly} className="property-fields">
      {furniture && <Section title={furnitureName(furniture)}>
        {furniture.type === 'bed' && <label className="select-field">{t("Tamaño")}<select aria-label={t("Tamaño de cama")} value={furniture.bedSize} onChange={event => { const bedSize = event.target.value as BedSize; updateFurniture({ bedSize, width: BED_SIZES[bedSize].width, depth: BED_SIZES[bedSize].depth }); }}>{Object.entries(BED_SIZES).map(([key, preset]) => <option key={key} value={key}>{t(preset.label)}</option>)}</select></label>}
        <div className="dimensions-grid"><NumberField label={t("Ancho")} value={furniture.width} min={furniture.type === 'custom' ? 0.01 : 0.1} max={10} onChange={width => updateFurniture({ width })} /><NumberField label={t("Largo")} value={furniture.depth} min={furniture.type === 'custom' ? 0.01 : 0.1} max={10} onChange={depth => updateFurniture({ depth })} /><NumberField label={t("Altura")} value={furniture.height} min={furniture.type === 'custom' ? 0.01 : 0.1} max={room.height} onChange={height => updateFurniture({ height })} /></div>
      </Section>}
      {furniture && <Section title={t("Posición y giro")} defaultOpen={false}><div className="dimensions-grid"><NumberField label={t("Giro")} value={furniture.rotation} min={0} max={360} step={15} unit="°" onChange={rotation => updateFurniture({ rotation })} /><NumberField label={t("Posición X")} value={furniture.x} min={-50} max={50} onChange={x => updateFurniture({ x })} /><NumberField label={t("Posición Z")} value={furniture.z} min={-50} max={50} onChange={z => updateFurniture({ z })} /></div></Section>}
      {opening && <Section title={opening.type === 'door' ? t("Puerta") : t("Ventana")}>
        <label className="select-field">{t("Pared")}<select aria-label={t("Pared del elemento")} value={opening.wall} onChange={event => updateOpening({ wall: Number(event.target.value) })}>{Array.from({ length: wallCount(room) }, (_, index) => <option key={index} value={index}>{wallName(index)}</option>)}</select></label>
        {opening.type === 'door' && <label className="select-field">{t("Apertura")}<select aria-label={t("Apertura de la puerta")} value={opening.doorStyle} onChange={event => updateOpening({ doorStyle: event.target.value as Opening['doorStyle'] })}><option value="right">{t("Derecha")}</option><option value="left">{t("Izquierda")}</option><option value="frame">{t("Sólo marco")}</option></select></label>}
        <div className="dimensions-grid"><NumberField label={t("Ancho")} value={opening.width} min={0.3} max={wallLength(room, opening.wall)} onChange={width => updateOpening({ width })} /><NumberField label={t("Altura")} value={opening.height} min={0.3} max={opening.type === 'window' ? room.height - opening.sill : room.height} onChange={height => updateOpening({ height })} />{opening.type === 'window' && <NumberField label={t("Altura desde piso")} value={opening.sill} min={0} max={room.height - opening.height} onChange={sill => updateOpening({ sill })} />}</div>
      </Section>}
      {opening && <Section title={t("Posición")} defaultOpen={false}><NumberField label={t("Desde el inicio de la pared")} value={opening.offset} min={0} max={wallLength(room, opening.wall) - opening.width} onChange={offset => updateOpening({ offset })} /></Section>}
      {light && <Section title={light.name}>
        <div className="setting-row"><span>{t("Encendido")}</span><Switch label={t("Interruptor del foco")} checked={light.enabled} onChange={enabled => updateLight({ enabled })} /></div>
        <Slider label={t("Intensidad")} value={light.lumens} min={0} max={Math.max(3000, light.lumens)} step={50} unit="lm" onChange={lumens => updateLight({ lumens })} /><Slider label={t("Temperatura")} value={light.temperature} min={1000} max={12000} step={100} unit="K" onChange={temperature => updateLight({ temperature })} />
      </Section>}
      {light && <Section title={t("Posición")} defaultOpen={false}><div className="dimensions-grid"><NumberField label={t("Posición X")} value={light.x} min={-50} max={50} onChange={x => updateLight({ x })} /><NumberField label={t("Posición Z")} value={light.z} min={-50} max={50} onChange={z => updateLight({ z })} /><NumberField label={t("Altura")} value={light.y} min={0.1} max={room.height} onChange={y => updateLight({ y })} /></div></Section>}
      {(furniture || opening || light) && <div className="item-actions"><button className="outline-button" onClick={() => void editPlan()}><Grid2X2 size={15} />{t("Editar en planta")}</button><button className="delete-button" onClick={removeSelected}><Trash2 size={14} />{t("Eliminar elemento")}</button></div>}
      {furniture && <button className="outline-button full-width" onClick={() => openWorkshop(furniture)}><Box size={16} />{t("Editar modelo")}</button>}
    </fieldset>
  </>;
}
