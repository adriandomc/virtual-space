import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Archive, ArrowLeft, ArrowRight, BedDouble, Box, Check, DoorClosed, DoorOpen, Grid2X2, Lightbulb, LoaderCircle, Plus, Table2, Trash2, WifiOff, X } from 'lucide-react';
import Brand from './Brand';
import { t, useLocale } from './i18n';
import InformationMenu from './InformationMenu';
import OfflineSettings from './OfflineSettings';
import PlanEditor from './PlanEditor';
import LevelSelector from './LevelSelector';
import ConstructionPanel from './ConstructionPanel';
import useConstructionHistory from './useConstructionHistory';
import { ceilingFinishTargets, updateCeilingFinish, projectLevel, projectToRoom, validateProjectDocument, type ProjectDocument } from './projectDocument';
import { beginAppActivity, confirmLocalSaved } from './appOffline';
import ColorPicker from './ColorPicker';
import { projectColors, useColorPreview } from './colorPreview';
import NameInput from './NameInput';
import NumberInput from './NumberInput';
import OpeningForm, { type OpeningValues } from './OpeningForm';
import { addCustomFurniture, addFurniture, addLight, addOpening, BED_SIZES, bounds, fitRoom, FURNITURE_COLORS, FURNITURE_LABELS, resizeRoom, validateRoom, wallLength, wallCount } from './model';
import FurnitureCatalog from './FurnitureCatalog.tsx';
import { getFurniturePreset, type FurnitureCategory, type FurniturePreset } from './furnitureCatalog';
import type { ModelAsset } from './customModel';
import { skipOnboardingStep, type OnboardingStep } from './onboardingModel';
import type { BedSize, FloorFinish, FurnitureItem, FurnitureMaterial, Opening, Room, Selection } from './types';
import './onboarding.css';

const RoomScene = lazy(() => import('./RoomScene'));
const ModelWorkshop = lazy(() => import('./ModelWorkshop'));
const ModelLibrary = lazy(() => import('./ModelLibrary'));

type Props = {
  project: ProjectDocument;
  activeLevelId: string;
  onLevelChange: (id: string) => void;
  onProjectChange: (project: ProjectDocument) => boolean | void;
  room: Room;
  onChange: (room: Room) => boolean | void;
  sketchUrl: string | null;
  onSketchChange: (file: File | null) => Promise<void>;
  onFinish: () => void;
  onCancel: () => void;
  status: 'loading' | 'saving' | 'saved' | 'error' | 'offline' | 'syncing' | 'conflict';
  error: string;
  onRetry: () => void;
  roomId?: string;
  canManage?: boolean;
  disabled?: boolean;
  pendingOffline?: boolean;
  onDownload?: () => Promise<void>;
  onDiscard?: () => Promise<void>;
};
const STEPS: { id: OnboardingStep; label: string }[] = [{ id: 'plan', label: 'Croquis' }, { id: 'roof', label: 'Cubierta' }, { id: 'colors', label: 'Colores' }, { id: 'decoration', label: 'Decoración' }];
const FINISHES: [FloorFinish, string][] = [['wood', 'Madera'], ['tile-grid', 'Loseta'], ['tile-brick', 'Loseta trabada'], ['tile-checker', 'Damero'], ['marble', 'Mármol'], ['concrete', 'Concreto']];
const PALETTE = ['#ffffff', '#f5f5f2', '#e7e3d9', '#d7c7b1', '#9cae98', '#acbabc', '#c4967c', '#646d64'];
const ICONS = { bed: BedDouble, wardrobe: DoorClosed, vanity: Table2, nightstand: Archive, custom: Box };
const furnitureName = (item: FurnitureItem) => item.type === 'custom' ? item.name ?? t("Modelo propio") : item.type === 'bed' ? t('Cama {{size}}', { size: t(BED_SIZES[item.bedSize!].label).toLowerCase() }) : t(FURNITURE_LABELS[item.type]) + (item.variant ? ' · ' + t(getFurniturePreset(item.type, item.variant)?.label ?? '') : '');

function Dimension({ label, value, min, max, unit = 'm', step = 0.1, onChange }: { label: string; value: number; min: number; max: number; unit?: string; step?: number; onChange: (value: number) => boolean | void }) {
  useLocale();
  const [feedback, setFeedback] = useState(false);
  return <label className="setup-field"><span>{label}</span><div className="setup-unit"><NumberInput label={label} value={value} min={min} max={max} step={step} onChange={onChange} onInvalid={() => setFeedback(true)} onEdit={() => setFeedback(false)} /><span>{unit}</span></div>{feedback && <small className="field-feedback" role="status">{t('Usa un valor entre {{min}} y {{max}}. Se conservó el anterior.', { min, max })}</small>}</label>;
}

export default function Onboarding({ project, activeLevelId, onLevelChange, onProjectChange, room, onChange, sketchUrl, onSketchChange, onFinish, onCancel, status, error, onRetry, roomId, canManage = false, disabled: editingDisabled = false, pendingOffline = false, onDownload, onDiscard }: Props) {
  useLocale();
  const step = room.setupStep ?? 0;
  const construction = useConstructionHistory(project, onProjectChange);
  const { shownProject, previewProject } = useColorPreview(project);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [surface, setSurface] = useState('all'), [bedSize, setBedSize] = useState<BedSize>('double');
  const [floorId, setFloorId] = useState<string | null>(null), [wallSide, setWallSide] = useState<'left' | 'right'>('left');
  const [addType, setAddType] = useState<FurnitureItem['type'] | Opening['type'] | 'light'>('bed');
  const [addingOpening, setAddingOpening] = useState<Opening['type'] | null>(null);
  const [busy, setBusy] = useState(false), [drawing, setDrawing] = useState(false), [planKey] = useState(0);
  const levelNavigation = useRef(false);
  const [localError, setLocalError] = useState(''), [notice, setNotice] = useState('');
  const [catalog, setCatalog] = useState<FurnitureCategory | 'custom' | null>(null);
  const [workshop, setWorkshop] = useState<FurnitureItem | 'new' | null>(null);
  const catalogDialog = useRef<HTMLDialogElement>(null);
  const activeRoomId = roomId ?? new URL(window.location.href).searchParams.get('room') ?? '';
  const disabled = editingDisabled || busy || status === 'loading';
  const size = bounds(room.vertices), current = STEPS[step];
  const level = projectLevel(project, activeLevelId), floors = level.surfaces.filter(item => item.kind === 'floor');
  const floor = floorId ? floors.find(item => item.id === floorId) : floors[0];
  const [ceilingId, setCeilingId] = useState<string | null>(null);
  const ceilings = ceilingFinishTargets(project, activeLevelId);
  const ceiling = ceilingId ? ceilings.find(item => item.id === ceilingId) : ceilings[0];
  const wall = surface === 'all' ? level.walls[0] : level.walls.find(item => item.id === surface);
  const color = surface === 'floor' ? floor?.finish.color ?? '#ffffff' : surface === 'ceiling' ? ceiling?.finish.color ?? '#ffffff' : wall?.[wallSide].color ?? '#ffffff';
  const furniture = selection?.kind === 'furniture' ? room.furniture.find(item => item.id === selection.id) : undefined;
  const opening = selection?.kind === 'opening' ? room.openings.find(item => item.id === selection.id) : undefined;
  const light = selection?.kind === 'light' ? room.lights.find(item => item.id === selection.id) : undefined;
  const usedColors = projectColors(project);
  const sceneSelection: Selection | null = step === 2 ? surface === 'floor' ? { kind: 'floor', id: floor?.id } : surface === 'ceiling' ? { kind: 'ceiling', id: ceiling?.id } : surface === 'all' || !wall ? null : { kind: 'wall', index: level.walls.indexOf(wall), id: wall.id } : selection;


  useEffect(() => {
    if (!['all', 'floor', 'ceiling'].includes(surface) && !level.walls.some(item => item.id === surface)) setSurface('all');
    if (floorId && !floors.some(item => item.id === floorId)) setFloorId(null);
    if (ceilingId && !ceilings.some(item => item.id === ceilingId)) setCeilingId(null);
  }, [surface, level, floorId, floors, ceilingId, ceilings]);
  useEffect(() => {
    const dialog = catalogDialog.current;
    if (catalog && !disabled && dialog && !dialog.open) dialog.showModal();
    else if ((!catalog || disabled) && dialog?.open) dialog.close();
  }, [catalog, disabled]);

  function change(next: Room | (() => Room)) {
    if (disabled) return false;
    try { if (onChange(validateRoom(typeof next === 'function' ? next() : next)) === false) return false; setLocalError(''); setNotice(''); return true; }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : "No se pudo aplicar este cambio."); return false; }
  }
  async function changeLevel(id: string) {
    if (levelNavigation.current) return;
    levelNavigation.current = true; setBusy(true);
    try { await confirmLocalSaved(); setSelection(null); setSurface('all'); setFloorId(null); setCeilingId(null); onLevelChange(id); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'No se pudo guardar el borrador.'); }
    finally { levelNavigation.current = false; setBusy(false); }
  }
  function advance() {
    if (disabled || drawing) return;
    setLocalError(''); setNotice(''); setSelection(null); setAddingOpening(null);
    if (step < STEPS.length - 1) change({ ...room, setupStep: (step + 1) as 1 | 2 | 3 }); else onFinish();
  }
  async function skip() {
    if (disabled) return;
    setBusy(true); setLocalError(''); setNotice('');
    try {
      if (drawing) return;
      const next = skipOnboardingStep(room);
      onChange(step < STEPS.length - 1 ? { ...next, setupStep: (step + 1) as 1 | 2 | 3 } : next); setSelection(null); setAddingOpening(null);
      if (step === STEPS.length - 1) onFinish();
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "No se pudo omitir este paso."); }
    finally { setBusy(false); }
  }
  async function sketch(file: File | null) {
    const release = beginAppActivity();
    setBusy(true);
    try { await onSketchChange(file); }
    finally { release(); setBusy(false); }
  }
  function paintedProject(value: string) {
    if (surface === 'ceiling') return ceiling ? updateCeilingFinish(project, activeLevelId, { color: value }, ceiling.id) : project;
    return validateProjectDocument({ ...project, levels: project.levels.map(item => item.id !== activeLevelId ? item : { ...item, walls: item.walls.map(item => surface === 'all' || item.id === surface ? { ...item, [wallSide]: { ...item[wallSide], color: value } } : item), surfaces: item.surfaces.map(item => surface === 'floor' && item.id === floor?.id ? { ...item, finish: { ...item.finish, color: value } } : item) }) });
  }
  function previewFurniture(color: string | null) {
    previewProject(color && furniture ? { ...project, levels: project.levels.map(level => level.id !== activeLevelId ? level : { ...level, furniture: level.furniture.map(item => item.id === furniture.id ? { ...item, color } : item) }) } : null);
  }
  function paint(value: string) {
    if (disabled) return false;
    try {
      return onProjectChange(paintedProject(value)) !== false;
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'No se pudo aplicar el color.'); return false; }
  }
  function floorMaterial(material: FloorFinish) {
    if (disabled || !floor) return false;
    return onProjectChange(validateProjectDocument({ ...project, levels: project.levels.map(item => item.id === activeLevelId ? { ...item, surfaces: item.surfaces.map(item => item.id === floor.id ? { ...item, finish: { ...item.finish, material } } : item) } : item) }));
  }
  function finishSurface(material: FloorFinish) {
    if (disabled) return false;
    if (surface === 'ceiling') return ceiling ? onProjectChange(updateCeilingFinish(project, activeLevelId, { material }, ceiling.id)) : false;
    return onProjectChange(validateProjectDocument({ ...project, levels: project.levels.map(item => item.id !== activeLevelId ? item : { ...item, walls: item.walls.map(item => surface === 'all' || item.id === surface ? { ...item, [wallSide]: { ...item[wallSide], material } } : item), surfaces: item.surfaces.map(item => surface === 'ceiling' && item.id === ceiling?.id ? { ...item, finish: { ...item.finish, material } } : item) }), roofs: surface === 'ceiling' && !ceiling ? project.roofs.map(item => item.levelId === activeLevelId ? { ...item, undersideFinish: { ...item.undersideFinish, material } } : item) : project.roofs }));
  }
  function selectScene(next: Selection | null) {
    if (step === 2 && next) {
      if (next.kind === 'wall') setSurface(next.id ?? level.walls[next.index]?.id ?? 'all');
      else if (next.kind === 'floor' || next.kind === 'ceiling') { setSurface(next.kind); if (next.kind === 'floor') setFloorId(next.id ?? null); else setCeilingId(next.id ?? null); }
    } else if (step === 3) setSelection(next && ['furniture', 'opening', 'light'].includes(next.kind) ? next : null);
  }
  function add() {
    if (disabled) return;
    if (addType === 'wardrobe' || addType === 'vanity' || addType === 'nightstand' || addType === 'custom') { setCatalog(addType); return; }
    if (addType === 'door' || addType === 'window') { setAddingOpening(addType); setSelection(null); return; }
    try {
      const next = addType === 'light' ? addLight(room, t('Luz {{number}}', { number: room.lights.length + 1 })) : addFurniture(room, addType, bedSize);
      if (change(next)) setSelection(addType === 'light' ? { kind: 'light', id: next.lights.at(-1)!.id } : { kind: 'furniture', id: next.furniture.at(-1)!.id });
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "No se pudo agregar el elemento."); }
  }
  function addPreset(preset: FurniturePreset) {
    try {
      const next = addFurniture(room, preset.type, bedSize, preset.id);
      if (change(next)) { setSelection({ kind: 'furniture', id: next.furniture.at(-1)!.id }); setCatalog(null); }
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "No se pudo agregar el mueble."); }
  }
  function addModel(asset: ModelAsset) {
    try {
      const next = addCustomFurniture(room, asset);
      if (change(next)) { setSelection({ kind: 'furniture', id: next.furniture.at(-1)!.id }); setCatalog(null); setWorkshop(null); return true; }
      return false;
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : "No se pudo agregar el modelo."); return false; }
  }
  function openWorkshop(item?: FurnitureItem) {
    if (disabled || !activeRoomId) return;
    catalogDialog.current?.close(); setCatalog(null); setWorkshop(item ?? 'new');
  }
  function createOpening(values: OpeningValues) {
    if (!addingOpening) return false;
    const next = addOpening(room, addingOpening, values.wall, values);
    if (!change(next)) return false;
    setSelection({ kind: 'opening', id: next.openings.at(-1)!.id }); setAddingOpening(null);
    return true;
  }
  function updateOpening(patch: Partial<Opening>) {
    return opening ? change(() => fitRoom({ ...room, openings: room.openings.map(item => item.id === opening.id ? { ...item, ...patch, ...('doorStyle' in patch ? { open: patch.doorStyle === 'frame' ? undefined : item.open ?? false } : {}) } : item).map(item => { if (item.doorStyle === 'frame') { const { open: _open, ...frame } = item; return frame; } return item; }) })) : false;
  }
  function remove(item: Selection) {
    const next = item.kind === 'furniture' ? { ...room, furniture: room.furniture.filter(value => value.id !== item.id) } : item.kind === 'opening' ? { ...room, openings: room.openings.filter(value => value.id !== item.id) } : item.kind === 'light' ? { ...room, lights: room.lights.filter(value => value.id !== item.id) } : room;
    if (change(next) && JSON.stringify(selection) === JSON.stringify(item)) setSelection(null);
  }
  function styleFurniture(patch: { material?: FurnitureMaterial | null; color?: string | null }) {
    return furniture ? change({ ...room, furniture: room.furniture.map(item => item.id === furniture.id ? { ...item, ...patch } : item) }) : false;
  }
  const items = [
    ...room.openings.map((item, index) => ({ selection: { kind: 'opening', id: item.id } as Selection, name: (item.type === 'door' ? t("Puerta") : t("Ventana")) + ' ' + (index + 1), Icon: item.type === 'door' ? DoorOpen : Grid2X2 })),
    ...room.furniture.map(item => ({ selection: { kind: 'furniture', id: item.id } as Selection, name: furnitureName(item), Icon: ICONS[item.type] })),
    ...room.lights.map(item => ({ selection: { kind: 'light', id: item.id } as Selection, name: item.name, Icon: Lightbulb })),
  ];

  return <div className="setup-page">
    <header className="setup-header"><Brand /><div className="setup-header-actions"><OfflineSettings /><InformationMenu /><button type="button" className="setup-secondary" disabled={disabled} onClick={() => void confirmLocalSaved().then(onCancel).catch(cause => setNotice(cause.message))}><ArrowLeft size={18} />{t("Mis diseños")}</button></div></header>
    <div className="setup-heading"><h1>{t("Nuevo diseño")}</h1><ol className="setup-steps" aria-label={t("Pasos del nuevo diseño")}>{STEPS.map((item, index) => <li key={item.id} className={index === step ? 'current' : index < step ? 'complete' : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Check size={17} /> : index + 1}</span>{t(item.label)}</li>)}</ol></div>
    <div className="setup-level-bar"><LevelSelector project={project} activeLevelId={activeLevelId} onSelect={id => void changeLevel(id)} navigationDisabled={busy} onChange={construction.apply} readOnly={disabled || drawing} onUndo={construction.undo} onRedo={construction.redo} canUndo={construction.canUndo} canRedo={construction.canRedo} /></div>
    <main className={'setup-content setup-step-' + current.id}>
      <fieldset className="setup-controls" disabled={disabled}>
        <h2>{t(current.label)}</h2>
        {step === 0 && <><label className="setup-field"><span>{t("Nombre del diseño")}</span><NameInput label={t("Nombre del diseño")} value={room.name} readOnly={disabled} onChange={name => change({ ...room, name })} notify={setNotice} /></label><div className="setup-dimensions"><Dimension label={t("Ancho")} value={size.width} min={0.5} max={50} onChange={width => change(() => resizeRoom(room, width, size.depth))} /><Dimension label={t("Largo")} value={size.depth} min={0.5} max={50} onChange={depth => change(() => resizeRoom(room, size.width, depth))} /><Dimension label={t("Altura")} value={room.height} min={1.8} max={8} onChange={height => change(() => fitRoom({ ...room, height }))} /></div>{drawing && <p className="setup-hint">{t("Cierra o cancela la planta para continuar.")}</p>}</>}
        {step === 0 && <ConstructionPanel project={project} activeLevelId={activeLevelId} onChange={construction.apply} onPreview={previewProject} selection={selection} onSelect={setSelection} readOnly={disabled} only="stairs" />}
        {step === 1 && <ConstructionPanel project={project} activeLevelId={activeLevelId} onChange={construction.apply} onPreview={previewProject} selection={selection} onSelect={setSelection} readOnly={disabled} only="roof" />}
        {step === 2 && <>
          <label className="setup-field"><span>{t("Superficie")}</span><select aria-label={t("Superficie a pintar")} value={surface} onChange={event => setSurface(event.target.value)}><option value="all">{t("Todas las paredes")}</option>{level.walls.map((item, index) => <option key={item.id} value={item.id}>{t('Pared {{number}}', { number: index + 1 })}</option>)}<option value="ceiling">{t("Techo")}</option><option value="floor">{t("Piso")}</option></select></label>
          {!['floor', 'ceiling'].includes(surface) && <label className="setup-field"><span>{t('Cara de la pared')}</span><select aria-label={t('Cara de la pared')} value={wallSide} onChange={event => setWallSide(event.target.value as 'left' | 'right')}><option value="left">{t('Lado izquierdo')}</option><option value="right">{t('Lado derecho')}</option></select></label>}
          {floors.length > 1 && <label className="setup-field"><span>{t('Zona del piso')}</span><select aria-label={t('Zona del piso')} value={floor?.id ?? ''} onChange={event => { setFloorId(event.target.value); setSurface('floor'); }}>{floors.map((item, index) => <option key={item.id} value={item.id}>{t('Zona {{number}}', { number: index + 1 })}</option>)}</select></label>}
          {surface === 'ceiling' && ceilings.length > 1 && <label className="setup-field"><span>{t('Zona del techo')}</span><select aria-label={t('Zona del techo')} value={ceiling?.id ?? ''} onChange={event => setCeilingId(event.target.value)}>{ceilings.map((item, index) => <option key={item.id} value={item.id}>{t('Zona {{number}}', { number: index + 1 })}</option>)}</select></label>}
          <ColorPicker key={surface + (surface === 'ceiling' ? ceiling?.id ?? '' : floor?.id ?? '') + wallSide} label={t("Color")} value={color} onChange={paint} onPreview={value => previewProject(value ? paintedProject(value) : null)} revision={project} colors={usedColors} disabled={disabled} />
          {surface !== 'floor' && <label className="setup-field"><span>{t('Material de la superficie')}</span><select aria-label={t('Material de la superficie')} value={surface === 'ceiling' ? ceiling?.finish.material ?? 'concrete' : wall?.[wallSide].material ?? 'concrete'} onChange={event => finishSurface(event.target.value as FloorFinish)}>{FINISHES.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>}
          <label className="setup-field"><span>{t("Material del piso")}</span><select aria-label={t("Material del piso")} value={floor?.finish.material ?? 'concrete'} onChange={event => floorMaterial(event.target.value as FloorFinish)}>{FINISHES.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
          <details className="setup-more"><summary>{t("Paleta")}</summary><div><div className="setup-swatches" aria-label={t("Colores")}>{PALETTE.map(value => <button key={value} type="button" aria-label={t('Usar color {{color}}', { color: value })} aria-pressed={color.toLowerCase() === value} style={{ background: value }} onClick={() => paint(value)}>{color.toLowerCase() === value && <Check size={20} />}</button>)}</div><div className="setup-used-colors"><span>{t("En este cuarto")}</span><div>{usedColors.map(value => <button key={value} type="button" title={value.toUpperCase()} aria-label={t('Reutilizar color {{color}}', { color: value })} style={{ background: value }} onClick={() => paint(value)} />)}</div></div></div></details>
          <details className="setup-more"><summary>{t("Calidad visual")}</summary><div><label className="setup-field"><span>{t("Vista")}</span><select aria-label={t("Calidad de vista previa")} value={room.renderQuality} onChange={event => change({ ...room, renderQuality: event.target.value as Room['renderQuality'] })}><option value="standard">{t("Estándar")}</option><option value="realistic">{t("Realista")}</option><option value="hyperrealistic">{t("Hiperrealista")}</option></select></label></div></details>
        </>}
        {step === 3 && <>
          {addingOpening ? <OpeningForm key={addingOpening} room={room} type={addingOpening} onCreate={createOpening} onCancel={() => setAddingOpening(null)} /> : <>
            <label className="setup-field"><span>{t("Elemento")}</span><select aria-label={t("Elemento a agregar")} value={addType} onChange={event => setAddType(event.target.value as typeof addType)}><option value="door">{t("Puerta")}</option><option value="window">{t("Ventana")}</option><option value="bed">{t("Cama")}</option><option value="wardrobe">{t("Roperos")}</option><option value="vanity">{t("Tocadores")}</option><option value="nightstand">{t("Burós")}</option><option value="custom">{t("Modelos propios")}</option><option value="light">{t("Foco")}</option></select></label>
            {addType === 'bed' && <label className="setup-field"><span>{t("Tamaño de cama")}</span><select aria-label={t("Tamaño de cama")} value={bedSize} onChange={event => setBedSize(event.target.value as BedSize)}>{Object.entries(BED_SIZES).map(([value, item]) => <option key={value} value={value}>{t(item.label)}</option>)}</select></label>}
            <button type="button" className="setup-secondary" onClick={add}><Plus size={18} />{addType === 'wardrobe' || addType === 'vanity' || addType === 'nightstand' || addType === 'custom' ? t("Ver modelos") : t("Agregar")}</button>{addType === 'custom' && <button type="button" className="setup-secondary" disabled={!activeRoomId} onClick={() => openWorkshop()}><Plus size={18} />{t("Crear elemento")}</button>}
          </>}
          {items.length > 0 && <ul className="setup-item-list">{items.map(item => <li key={JSON.stringify(item.selection)}><button type="button" className={JSON.stringify(selection) === JSON.stringify(item.selection) ? 'active' : ''} onClick={() => { setSelection(item.selection); setAddingOpening(null); }} aria-pressed={JSON.stringify(selection) === JSON.stringify(item.selection)}><item.Icon size={19} /><span>{item.name}</span></button><button type="button" aria-label={t('Quitar {{name}}', { name: item.name })} onClick={() => remove(item.selection)}><Trash2 size={19} /></button></li>)}</ul>}
          {furniture && <div className="setup-furniture-style" key={furniture.id}><h3>{furnitureName(furniture)}</h3><label className="setup-field"><span>{t("Material")}</span><select aria-label={t("Material del mueble")} value={furniture.material ?? 'original'} onChange={event => styleFurniture({ material: event.target.value === 'original' ? null : event.target.value as FurnitureMaterial })}>{furniture.type === 'custom' && <option value="original">{t("Del modelo")}</option>}<option value="wood">{t("Madera")}</option><option value="plastic">{t("Plástico")}</option><option value="metal">{t("Metal")}</option></select></label>{furniture.type === 'custom' && <label className="setup-light-toggle"><input type="checkbox" checked={furniture.color === null} onChange={event => styleFurniture({ color: event.target.checked ? null : '#ffffff' })} />{t("Colores originales")}</label>}{(furniture.type !== 'custom' || furniture.color !== null) && <ColorPicker label={t("Color del mueble")} value={furniture.color ?? FURNITURE_COLORS[furniture.type]} onChange={value => styleFurniture({ color: value })} onPreview={previewFurniture} revision={project} colors={usedColors} disabled={disabled} />}<button type="button" className="setup-secondary" disabled={disabled || !activeRoomId} onClick={() => openWorkshop(furniture)}>{t("Editar modelo")}</button></div>}
          {opening && <div className="setup-furniture-style" key={opening.id}><h3>{opening.type === 'door' ? t("Puerta") : t("Ventana")}</h3><label className="setup-field"><span>{t("Pared")}</span><select aria-label={t("Pared del elemento")} value={opening.wall} onChange={event => updateOpening({ wall: Number(event.target.value) })}>{Array.from({ length: wallCount(room) }, (_, index) => <option key={index} value={index}>{t('Pared {{number}}', { number: index + 1 })}</option>)}</select></label>{opening.type === 'door' && <label className="setup-field"><span>{t("Apertura")}</span><select aria-label={t("Apertura de la puerta")} value={opening.doorStyle} onChange={event => updateOpening({ doorStyle: event.target.value as Opening['doorStyle'] })}><option value="right">{t("Derecha")}</option><option value="left">{t("Izquierda")}</option><option value="frame">{t("Sólo marco")}</option></select></label>}<div className="setup-item-dimensions"><Dimension label={t("Ancho")} value={opening.width} min={0.3} max={wallLength(room, opening.wall)} onChange={width => updateOpening({ width })} /><Dimension label={t("Altura")} value={opening.height} min={0.3} max={opening.type === 'window' ? room.height - opening.sill : room.height} onChange={height => updateOpening({ height })} />{opening.type === 'window' && <Dimension label={t("Altura desde piso")} value={opening.sill} min={0} max={room.height - opening.height} onChange={sill => updateOpening({ sill })} />}</div><details className="setup-more"><summary>{t("Posición")}</summary><div><Dimension label={t("Desde el inicio de la pared")} value={opening.offset} min={0} max={wallLength(room, opening.wall) - opening.width} onChange={offset => updateOpening({ offset })} /></div></details></div>}
          {light && <div className="setup-furniture-style" key={light.id}><h3>{light.name}</h3><label className="setup-light-toggle"><input type="checkbox" checked={light.enabled} onChange={event => change({ ...room, lights: room.lights.map(item => item.id === light.id ? { ...item, enabled: event.target.checked } : item) })} />{t("Encendido")}</label><div className="setup-item-dimensions"><Dimension label={t("Intensidad")} value={light.lumens} min={0} max={20000} step={50} unit="lm" onChange={lumens => change({ ...room, lights: room.lights.map(item => item.id === light.id ? { ...item, lumens } : item) })} /><Dimension label={t("Temperatura")} value={light.temperature} min={1000} max={12000} step={100} unit="K" onChange={temperature => change({ ...room, lights: room.lights.map(item => item.id === light.id ? { ...item, temperature } : item) })} /></div></div>}
        </>}
      </fieldset>
      <section className="setup-preview" aria-label={step === 0 ? t("Croquis del diseño") : t("Vista previa del diseño")}>{step === 0 ? <PlanEditor key={planKey} project={shownProject} activeLevelId={activeLevelId} onProjectChange={construction.apply} onUndo={construction.undo} onRedo={construction.redo} canUndo={construction.canUndo} canRedo={construction.canRedo} room={shownProject === project ? room : projectToRoom(shownProject, activeLevelId)} onChange={change} selection={selection} onSelect={setSelection} sketchUrl={sketchUrl} onSketchChange={sketch} onDrawingChange={setDrawing} hideSurfaceControls readOnly={disabled} /> : <><Suspense fallback={<div className="setup-preview-loading" role="status"><LoaderCircle size={25} className="setup-spinner" /><span>{t("Cargando vista…")}</span></div>}><RoomScene project={shownProject} activeLevelId={activeLevelId} onProjectChange={onProjectChange} presentation={{ walls: 'cut', roofs: step === 1, levels: 'active' }} paused={!!workshop} room={shownProject === project ? room : projectToRoom(shownProject, activeLevelId)} roomId={activeRoomId} mode="orbit" selection={sceneSelection} onSelect={selectScene} onChange={change} readOnly={disabled || step !== 3} transformMode="translate" resetKey={step} /></Suspense><span className="setup-preview-label">{t("Vista previa")}</span></>}</section>
    </main>
    <footer className="setup-footer"><div className="setup-feedback" aria-live="polite">{(localError || error) ? <div className="setup-error" role="alert"><span>{t(localError || error)}</span>{(status === 'error' || status === 'conflict') && <button type="button" onClick={onRetry}>{t("Reintentar")}</button>}{(pendingOffline || status === 'conflict') && onDownload && <button type="button" onClick={() => void onDownload().catch(cause => setLocalError(cause.message))}>{t("Descargar copia")}</button>}{status === 'conflict' && onDiscard && <button type="button" onClick={() => { if (window.confirm(t("¿Usar la versión del servidor? Descarga antes los cambios que quieras conservar."))) void onDiscard().catch(cause => setLocalError(cause.message)); }}>{t("Usar versión guardada")}</button>}</div> : <><span className="setup-save-state">{status === 'saving' || status === 'syncing' || busy ? <><LoaderCircle size={17} className="setup-spinner" />{t("Guardando…")}</> : status === 'saved' ? <><Check size={17} />{t("Guardado")}</> : status === 'offline' ? <><WifiOff size={17} />{pendingOffline ? t("Guardado en este dispositivo") : t("Sin conexión")}</> : null}</span>{notice && <span>{t(notice)}</span>}</>}</div><div className="setup-actions"><button type="button" className="setup-secondary setup-back" aria-label={t("Atrás")} disabled={disabled || step === 0 || drawing} onClick={() => { change({ ...room, setupStep: (step - 1) as 0 | 1 | 2 }); setLocalError(''); setNotice(''); setSelection(null); }}><ArrowLeft size={18} /><span>{t("Atrás")}</span></button><div><button type="button" className="setup-skip" disabled={disabled || drawing} onClick={() => void skip()}>{t("Omitir")}</button><button type="button" className="setup-primary" disabled={disabled || drawing || status === 'error' || status === 'conflict'} onClick={advance}>{step === 3 ? t("Abrir editor") : t("Continuar")}<ArrowRight size={18} /></button></div></div></footer>
    <dialog ref={catalogDialog} className="add-dialog setup-catalog-dialog" aria-labelledby="setup-catalog-title" onCancel={() => setCatalog(null)} onClose={() => setCatalog(null)} onClick={event => { if (event.target === event.currentTarget) setCatalog(null); }}><header className="setup-catalog-header"><h2 id="setup-catalog-title">{catalog === 'custom' ? t("Modelos propios") : t("Muebles")}</h2><button type="button" className="icon-button" aria-label={t("Cerrar catálogo")} onClick={() => setCatalog(null)}><X size={21} /></button></header>{catalog === 'custom' ? <Suspense fallback={<p role="status">{t("Cargando modelos…")}</p>}><ModelLibrary roomId={activeRoomId} canManage={canManage} disabled={disabled || !activeRoomId} onSelect={addModel} onCreate={() => openWorkshop()} /></Suspense> : catalog && <FurnitureCatalog category={catalog} onSelect={addPreset} />}{localError && <p className="account-error" role="alert">{t(localError)}</p>}</dialog>
    {workshop && <Suspense fallback={<div className="setup-workshop-loading" role="status"><LoaderCircle size={25} className="setup-spinner" />{t("Cargando editor…")}</div>}><ModelWorkshop item={workshop === 'new' ? undefined : workshop} roomId={activeRoomId} onSaved={addModel} onClose={() => setWorkshop(null)} /></Suspense>}
  </div>;
}
