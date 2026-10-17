import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Archive, ArrowUpRight, ArrowLeft, ArrowRight, BedDouble, Box, Check, DoorClosed, DoorOpen, Grid2X2, Lightbulb, LoaderCircle, Move, Plus, RotateCcw, Settings2, Table2, Trash2, WifiOff, X } from 'lucide-react';
import Brand from '../../shared/ui/Brand';
import { t, useLocale } from '../../shared/i18n/i18n';
import InformationMenu from '../../shared/ui/InformationMenu';
import OfflineSettings from '../settings/OfflineSettings';
import PlanEditor from '../construction/PlanEditor';
import LevelSelector from '../construction/LevelSelector';
import ConstructionPanel from '../construction/ConstructionPanel';
import StairCatalog from '../construction/StairCatalog';
import { deleteStair } from '../../domain/project/projectOperations';
import useConstructionHistory from '../construction/useConstructionHistory';
import { ceilingFinishTargets, updateCeilingFinish, projectLevel, projectToRoom, validateProjectDocument, type ProjectDocument } from '../../domain/project/projectDocument';
import { beginAppActivity, confirmLocalSaved } from '../../client/pwa/appOffline';
import ColorPicker from '../../shared/ui/ColorPicker';
import { projectColors, useColorPreview } from '../../shared/ui/colorPreview';
import PaintToolbar from '../painting/PaintToolbar';
import usePaintTool from '../painting/usePaintTool';
import SurfaceNavigator from '../editor/SurfaceNavigator';
import type { PaintTarget } from '../../domain/project/projectPaint';
import NameInput from '../../shared/ui/NameInput';
import NumberInput from '../../shared/ui/NumberInput';
import OpeningForm, { type OpeningValues } from '../construction/OpeningForm';
import { addCustomFurniture, addFurniture, addLight, addOpening, BED_SIZES, bounds, fitRoom, FURNITURE_COLORS, FURNITURE_LABELS, resizeRoom, validateRoom, wallLength, wallCount } from '../../domain/project/model';
import FurnitureCatalog from '../models/FurnitureCatalog.tsx';
import { getFurniturePreset, type FurnitureCategory, type FurniturePreset } from '../../domain/models/furnitureCatalog';
import type { ModelAsset } from '../../domain/models/glbValidation';
import { skipOnboardingStep, type OnboardingStep } from '../../domain/project/onboardingModel';
import type { BedSize, FloorFinish, FurnitureItem, FurnitureMaterial, Opening, Room, Selection } from '../../domain/project/types';
import './onboarding.css';

const RoomScene = lazy(() => import('../viewer/RoomScene'));
const ModelWorkshop = lazy(() => import('../workshop/ModelWorkshop'));
const ModelLibrary = lazy(() => import('../models/ModelLibrary'));

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
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate'>('translate');
  const [surface, setSurface] = useState(() => projectLevel(project, activeLevelId).walls[0]?.id ?? 'floor'), [bedSize, setBedSize] = useState<BedSize>('double');
  const [floorId, setFloorId] = useState<string | null>(null), [wallSide, setWallSide] = useState<'left' | 'right'>('left');
  const [addType, setAddType] = useState<FurnitureItem['type'] | Opening['type'] | 'light' | 'stairs'>('bed');
  const [addingOpening, setAddingOpening] = useState<Opening['type'] | null>(null);
  const [busy, setBusy] = useState(false), [drawing, setDrawing] = useState(false), [planKey] = useState(0);
  const levelNavigation = useRef(false);
  const [localError, setLocalError] = useState(''), [notice, setNotice] = useState('');
  const [catalog, setCatalog] = useState<FurnitureCategory | 'custom' | 'stairs' | null>(null);
  const [workshop, setWorkshop] = useState<FurnitureItem | 'new' | null>(null);
  const catalogDialog = useRef<HTMLDialogElement>(null);
  const controlsRef = useRef<HTMLFieldSetElement>(null), previewRef = useRef<HTMLElement>(null);
  const activeRoomId = roomId ?? new URL(window.location.href).searchParams.get('room') ?? '';
  const disabled = editingDisabled || busy || status === 'loading';
  const paintTool = usePaintTool({ project, onChange: construction.apply, disabled, notify: setNotice });
  const painting = (step === 2 || step === 3) && paintTool.active;
  const size = bounds(room.vertices), current = STEPS[step];
  const level = projectLevel(project, activeLevelId), floors = level.surfaces.filter(item => item.kind === 'floor');
  const floor = floorId ? floors.find(item => item.id === floorId) : floors[0];
  const [ceilingId, setCeilingId] = useState<string | null>(null);
  const ceilings = ceilingFinishTargets(project, activeLevelId);
  const ceiling = ceilingId ? ceilings.find(item => item.id === ceilingId) : ceilings[0];
  const wall = level.walls.find(item => item.id === surface);
  const color = surface === 'floor' ? floor?.finish.color ?? '#ffffff' : surface === 'ceiling' ? ceiling?.finish.color ?? '#ffffff' : wall?.[wallSide].color ?? '#ffffff';
  const furniture = selection?.kind === 'furniture' ? room.furniture.find(item => item.id === selection.id) : undefined;
  const opening = selection?.kind === 'opening' ? room.openings.find(item => item.id === selection.id) : undefined;
  const light = selection?.kind === 'light' ? room.lights.find(item => item.id === selection.id) : undefined;
  const usedColors = projectColors(project);
  const manualSurfaceSelection: Selection | null = surface === 'floor' ? { kind: 'floor', id: floor?.id } : surface === 'ceiling' ? { kind: 'ceiling', id: ceiling?.id } : !wall ? null : { kind: 'wall', index: level.walls.indexOf(wall), id: wall.id };
  const sceneSelection = step === 2 ? painting && selection ? selection : manualSurfaceSelection : selection;
  const movableSelection = furniture || opening || light || selection?.kind === 'stair' && project.stairs.some(stair => stair.id === selection.id);

  useEffect(() => { setTransformMode('translate'); }, [selection?.kind, selection && 'id' in selection ? selection.id : null, activeLevelId, step]);

  useEffect(() => {
    if (!selection) return;
    if (selection.kind === 'wall') {
      const index = selection.id ? level.walls.findIndex(wall => wall.id === selection.id) : selection.index;
      if (!level.walls[index]) setSelection(null);
      else if (index !== selection.index || !selection.id) setSelection({ kind: 'wall', id: level.walls[index].id, index });
      return;
    }
    if (selection.kind === 'stair' && !project.stairs.some(stair => stair.id === selection.id && (stair.fromLevelId === activeLevelId || stair.toLevelId === activeLevelId)) || selection.kind === 'roof' && !project.roofs.some(roof => roof.id === selection.id && roof.levelId === activeLevelId) || selection.kind === 'furniture' && !furniture || selection.kind === 'opening' && !opening || selection.kind === 'light' && !light || selection.kind === 'floor' && selection.id && !floors.some(floor => floor.id === selection.id) || selection.kind === 'ceiling' && selection.id && !ceilings.some(ceiling => ceiling.id === selection.id)) setSelection(null);
  }, [selection, project, activeLevelId, level, furniture, opening, light, floors, ceilings]);

  useEffect(() => {
    if (!['floor', 'ceiling'].includes(surface) && !level.walls.some(item => item.id === surface)) setSurface(level.walls[0]?.id ?? 'floor');
    if (surface === 'ceiling' && !ceilings.length) setSurface(level.walls[0]?.id ?? 'floor');
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
  async function changeLevel(id: string, nextSelection?: Selection) {
    if (levelNavigation.current) return;
    const nextLevel = project.levels.find(level => level.id === id); if (!nextLevel) return;
    levelNavigation.current = true; setBusy(true);
    try {
      await confirmLocalSaved(); setSelection(null); setFloorId(nextSelection?.kind === 'floor' ? nextSelection.id ?? null : null); setCeilingId(nextSelection?.kind === 'ceiling' ? nextSelection.id ?? null : null);
      setSurface(nextSelection?.kind === 'floor' || nextSelection?.kind === 'ceiling' ? nextSelection.kind : nextSelection?.kind === 'wall' ? nextSelection.id ?? nextLevel.walls[nextSelection.index]?.id ?? nextLevel.walls[0]?.id ?? 'floor' : nextLevel.walls[0]?.id ?? 'floor');
      onLevelChange(id);
    }
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
    return validateProjectDocument({ ...project, levels: project.levels.map(item => item.id !== activeLevelId ? item : { ...item, walls: item.walls.map(item => item.id === surface ? { ...item, [wallSide]: { ...item[wallSide], color: value } } : item), surfaces: item.surfaces.map(item => surface === 'floor' && item.id === floor?.id ? { ...item, finish: { ...item.finish, color: value } } : item) }) });
  }
  function previewFurniture(color: string | null) {
    previewProject(color && furniture ? { ...project, levels: project.levels.map(level => level.id !== activeLevelId ? level : { ...level, furniture: level.furniture.map(item => item.id === furniture.id ? { ...item, color } : item) }) } : null);
  }
  function paint(value: string) {
    if (disabled) return false;
    try {
      return construction.apply(paintedProject(value)) !== false;
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'No se pudo aplicar el color.'); return false; }
  }
  function floorMaterial(material: FloorFinish) {
    if (disabled || !floor) return false;
    return construction.apply(validateProjectDocument({ ...project, levels: project.levels.map(item => item.id === activeLevelId ? { ...item, surfaces: item.surfaces.map(item => item.id === floor.id ? { ...item, finish: { ...item.finish, material } } : item) } : item) }));
  }
  function finishSurface(material: FloorFinish) {
    if (disabled) return false;
    if (surface === 'ceiling') return ceiling ? construction.apply(updateCeilingFinish(project, activeLevelId, { material }, ceiling.id)) : false;
    return construction.apply(validateProjectDocument({ ...project, levels: project.levels.map(item => item.id !== activeLevelId ? item : { ...item, walls: item.walls.map(item => item.id === surface ? { ...item, [wallSide]: { ...item[wallSide], material } } : item) }) }));
  }
  function selectScene(next: Selection | null) {
    if (step === 2 && next) {
      setSelection(null);
      if (next.kind === 'wall') setSurface(next.id ?? level.walls[next.index]?.id ?? level.walls[0]?.id ?? 'floor');
      else if (next.kind === 'floor' || next.kind === 'ceiling') { setSurface(next.kind); if (next.kind === 'floor') setFloorId(next.id ?? null); else setCeilingId(next.id ?? null); }
    } else if (step === 3) setSelection(next && ['furniture', 'opening', 'light', 'stair'].includes(next.kind) ? next : null);
  }
  function selectSurface(levelId: string, next: Selection) {
    if (levelId !== activeLevelId) { void changeLevel(levelId, next); return; }
    selectScene(next);
  }
  function paintTarget(target: PaintTarget) {
    if (!paintTool.paint(target)) return false;
    setSelection(target.selection);
    if (target.wallSide) setWallSide(target.wallSide);
    if (target.levelId !== activeLevelId) onLevelChange(target.levelId);
    if (target.selection.kind === 'wall') setSurface(target.selection.id!);
    else if (target.selection.kind === 'floor' || target.selection.kind === 'ceiling') {
      setSurface(target.selection.kind);
      if (target.selection.kind === 'floor') setFloorId(target.selection.id ?? null); else setCeilingId(target.selection.id ?? null);
    }
    return true;
  }
  function applyAllWalls() {
    if (disabled) return false;
    return construction.apply(validateProjectDocument({ ...project, levels: project.levels.map(item => item.id === activeLevelId ? { ...item, walls: item.walls.map(item => ({ ...item, [wallSide]: { ...item[wallSide], color } })) } : item) }));
  }
  function editSelected() {
    const inspector = controlsRef.current?.querySelector<HTMLElement>('.construction-panel, .setup-furniture-style') ?? controlsRef.current;
    inspector?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    inspector?.querySelector<HTMLElement>('select, input, button')?.focus({ preventScroll: true });
  }
  function add() {
    if (disabled) return;
    if (addType === 'wardrobe' || addType === 'vanity' || addType === 'nightstand' || addType === 'custom' || addType === 'stairs') { setCatalog(addType); return; }
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
    if (item.kind === 'stair') {
      if (disabled) return;
      try { if (construction.apply(deleteStair(project, item.id))) setSelection(null); }
      catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'No se pudo aplicar la construcción.'); }
      return;
    }
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
    ...project.stairs.filter(stair => stair.fromLevelId === activeLevelId || stair.toLevelId === activeLevelId).map((stair, index) => ({ selection: { kind: 'stair', id: stair.id } as Selection, name: t('Escalera {{number}}', { number: index + 1 }), Icon: ArrowUpRight })),
  ];

  return <div className="setup-page">
    <header className="setup-header"><Brand /><div className="setup-header-actions"><OfflineSettings /><InformationMenu /><button type="button" className="setup-secondary" disabled={disabled} onClick={() => void confirmLocalSaved().then(onCancel).catch(cause => setNotice(cause.message))}><ArrowLeft size={18} />{t("Mis diseños")}</button></div></header>
    <div className="setup-heading"><h1>{t("Nuevo diseño")}</h1><ol className="setup-steps" aria-label={t("Pasos del nuevo diseño")}>{STEPS.map((item, index) => <li key={item.id} className={index === step ? 'current' : index < step ? 'complete' : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Check size={17} /> : index + 1}</span>{t(item.label)}</li>)}</ol></div>
    <div className="setup-level-bar"><LevelSelector project={project} activeLevelId={activeLevelId} onSelect={id => void changeLevel(id)} navigationDisabled={busy} onChange={construction.apply} readOnly={disabled || drawing} onUndo={construction.undo} onRedo={construction.redo} canUndo={construction.canUndo} canRedo={construction.canRedo} /></div>
    <main className={'setup-content setup-step-' + current.id}>
      <fieldset ref={controlsRef} className="setup-controls" disabled={disabled}>
        <h2>{t(current.label)}</h2>
        {step === 0 && <><label className="setup-field"><span>{t("Nombre del diseño")}</span><NameInput label={t("Nombre del diseño")} value={room.name} readOnly={disabled} onChange={name => change({ ...room, name })} notify={setNotice} /></label><div className="setup-dimensions"><Dimension label={t("Ancho")} value={size.width} min={0.5} max={50} onChange={width => change(() => resizeRoom(room, width, size.depth))} /><Dimension label={t("Largo")} value={size.depth} min={0.5} max={50} onChange={depth => change(() => resizeRoom(room, size.width, depth))} /><Dimension label={t("Altura")} value={room.height} min={1.8} max={8} onChange={height => change(() => fitRoom({ ...room, height }))} /></div>{drawing && <p className="setup-hint">{t("Cierra o cancela la planta para continuar.")}</p>}</>}
        {step === 0 && <button type="button" className="setup-secondary" disabled={disabled || drawing} onClick={() => setCatalog('stairs')}><ArrowUpRight size={18} />{t('Escaleras')}</button>}
        {(step === 0 || step === 3) && selection?.kind === 'stair' && <ConstructionPanel project={project} activeLevelId={activeLevelId} onChange={construction.apply} onPreview={previewProject} selection={selection} onSelect={setSelection} readOnly={disabled || drawing} only="stairs" />}
        {step === 1 && <ConstructionPanel project={project} activeLevelId={activeLevelId} onChange={construction.apply} onPreview={previewProject} selection={selection} onSelect={setSelection} readOnly={disabled} only="roof" defaultOpen />}
        {step === 2 && <>
          <SurfaceNavigator project={project} activeLevelId={activeLevelId} selection={manualSurfaceSelection} wallSide={wallSide} onSelect={selectSurface} />
          {!['floor', 'ceiling'].includes(surface) && <label className="setup-field"><span>{t('Cara de la pared')}</span><select aria-label={t('Cara de la pared')} value={wallSide} onChange={event => setWallSide(event.target.value as 'left' | 'right')}><option value="left">{t('Lado izquierdo')}</option><option value="right">{t('Lado derecho')}</option></select></label>}
          {surface === 'floor' && floors.length > 1 && <label className="setup-field"><span>{t('Zona del piso')}</span><select aria-label={t('Zona del piso')} value={floor?.id ?? ''} onChange={event => { setFloorId(event.target.value); setSurface('floor'); }}>{floors.map((item, index) => <option key={item.id} value={item.id}>{t('Zona {{number}}', { number: index + 1 })}</option>)}</select></label>}
          {surface === 'ceiling' && ceilings.length > 1 && <label className="setup-field"><span>{t('Zona del techo')}</span><select aria-label={t('Zona del techo')} value={ceiling?.id ?? ''} onChange={event => setCeilingId(event.target.value)}>{ceilings.map((item, index) => <option key={item.id} value={item.id}>{t('Zona {{number}}', { number: index + 1 })}</option>)}</select></label>}
          <ColorPicker key={surface + (surface === 'ceiling' ? ceiling?.id ?? '' : floor?.id ?? '') + wallSide} label={t("Color")} value={color} onChange={paint} onPreview={value => previewProject(value ? paintedProject(value) : null)} revision={project} colors={usedColors} disabled={disabled} />
          {wall && <button type="button" className="setup-secondary" onClick={applyAllWalls}>{t('Aplicar a todas las paredes')}</button>}
          {surface !== 'floor' && <label className="setup-field"><span>{t('Material de la superficie')}</span><select aria-label={t('Material de la superficie')} value={surface === 'ceiling' ? ceiling?.finish.material ?? 'concrete' : wall?.[wallSide].material ?? 'concrete'} onChange={event => finishSurface(event.target.value as FloorFinish)}>{FINISHES.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>}
          {surface === 'floor' && <label className="setup-field"><span>{t("Material del piso")}</span><select aria-label={t("Material del piso")} value={floor?.finish.material ?? 'concrete'} onChange={event => floorMaterial(event.target.value as FloorFinish)}>{FINISHES.map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>}
          <details className="setup-more"><summary>{t("Paleta")}</summary><div><div className="setup-swatches" aria-label={t("Colores")}>{PALETTE.map(value => <button key={value} type="button" aria-label={t('Usar color {{color}}', { color: value })} aria-pressed={color.toLowerCase() === value} style={{ background: value }} onClick={() => paint(value)}>{color.toLowerCase() === value && <Check size={20} />}</button>)}</div><div className="setup-used-colors"><span>{t("En este cuarto")}</span><div>{usedColors.map(value => <button key={value} type="button" title={value.toUpperCase()} aria-label={t('Reutilizar color {{color}}', { color: value })} style={{ background: value }} onClick={() => paint(value)} />)}</div></div></div></details>
          <details className="setup-more"><summary>{t("Calidad visual")}</summary><div><label className="setup-field"><span>{t("Vista")}</span><select aria-label={t("Calidad de vista previa")} value={room.renderQuality} onChange={event => change({ ...room, renderQuality: event.target.value as Room['renderQuality'] })}><option value="standard">{t("Estándar")}</option><option value="realistic">{t("Realista")}</option><option value="hyperrealistic">{t("Hiperrealista")}</option></select></label></div></details>
        </>}
        {step === 3 && <>
          {addingOpening ? <OpeningForm key={addingOpening} room={room} type={addingOpening} onCreate={createOpening} onCancel={() => setAddingOpening(null)} /> : <>
            <label className="setup-field"><span>{t("Elemento")}</span><select aria-label={t("Elemento a agregar")} value={addType} onChange={event => setAddType(event.target.value as typeof addType)}><option value="door">{t("Puerta")}</option><option value="window">{t("Ventana")}</option><option value="bed">{t("Cama")}</option><option value="wardrobe">{t("Roperos")}</option><option value="vanity">{t("Tocadores")}</option><option value="nightstand">{t("Burós")}</option><option value="custom">{t("Modelos propios")}</option><option value="light">{t("Foco")}</option><option value="stairs">{t("Escaleras")}</option></select></label>
            {addType === 'bed' && <label className="setup-field"><span>{t("Tamaño de cama")}</span><select aria-label={t("Tamaño de cama")} value={bedSize} onChange={event => setBedSize(event.target.value as BedSize)}>{Object.entries(BED_SIZES).map(([value, item]) => <option key={value} value={value}>{t(item.label)}</option>)}</select></label>}
            <button type="button" className="setup-secondary" onClick={add}><Plus size={18} />{addType === 'wardrobe' || addType === 'vanity' || addType === 'nightstand' || addType === 'custom' || addType === 'stairs' ? t("Ver modelos") : t("Agregar")}</button>{addType === 'custom' && <button type="button" className="setup-secondary" disabled={!activeRoomId} onClick={() => openWorkshop()}><Plus size={18} />{t("Crear elemento")}</button>}
          </>}
          {items.length > 0 && <ul className="setup-item-list">{items.map(item => <li key={JSON.stringify(item.selection)}><button type="button" className={JSON.stringify(selection) === JSON.stringify(item.selection) ? 'active' : ''} onClick={() => { setSelection(item.selection); setAddingOpening(null); }} aria-pressed={JSON.stringify(selection) === JSON.stringify(item.selection)}><item.Icon size={19} /><span>{item.name}</span></button><button type="button" aria-label={t('Quitar {{name}}', { name: item.name })} onClick={() => remove(item.selection)}><Trash2 size={19} /></button></li>)}</ul>}
          {furniture && <div className="setup-furniture-style" key={furniture.id}><h3>{furnitureName(furniture)}</h3><label className="setup-field"><span>{t("Material")}</span><select aria-label={t("Material del mueble")} value={furniture.material ?? 'original'} onChange={event => styleFurniture({ material: event.target.value === 'original' ? null : event.target.value as FurnitureMaterial })}>{furniture.type === 'custom' && <option value="original">{t("Del modelo")}</option>}<option value="wood">{t("Madera")}</option><option value="plastic">{t("Plástico")}</option><option value="metal">{t("Metal")}</option></select></label>{furniture.type === 'custom' && <label className="setup-light-toggle"><input type="checkbox" checked={furniture.color === null} onChange={event => styleFurniture({ color: event.target.checked ? null : '#ffffff' })} />{t("Colores originales")}</label>}{(furniture.type !== 'custom' || furniture.color !== null) && <ColorPicker label={t("Color del mueble")} value={furniture.color ?? FURNITURE_COLORS[furniture.type]} onChange={value => styleFurniture({ color: value })} onPreview={previewFurniture} revision={project} colors={usedColors} disabled={disabled} />}<button type="button" className="setup-secondary" disabled={disabled || !activeRoomId} onClick={() => openWorkshop(furniture)}>{t("Editar modelo")}</button></div>}
          {opening && <div className="setup-furniture-style" key={opening.id}><h3>{opening.type === 'door' ? t("Puerta") : t("Ventana")}</h3><label className="setup-field"><span>{t("Pared")}</span><select aria-label={t("Pared del elemento")} value={opening.wall} onChange={event => updateOpening({ wall: Number(event.target.value) })}>{Array.from({ length: wallCount(room) }, (_, index) => <option key={index} value={index}>{t('Pared {{number}}', { number: index + 1 })}</option>)}</select></label>{opening.type === 'door' && <label className="setup-field"><span>{t("Apertura")}</span><select aria-label={t("Apertura de la puerta")} value={opening.doorStyle} onChange={event => updateOpening({ doorStyle: event.target.value as Opening['doorStyle'] })}><option value="right">{t("Derecha")}</option><option value="left">{t("Izquierda")}</option><option value="frame">{t("Sólo marco")}</option></select></label>}<div className="setup-item-dimensions"><Dimension label={t("Ancho")} value={opening.width} min={0.3} max={wallLength(room, opening.wall)} onChange={width => updateOpening({ width })} /><Dimension label={t("Altura")} value={opening.height} min={0.3} max={opening.type === 'window' ? room.height - opening.sill : room.height} onChange={height => updateOpening({ height })} />{opening.type === 'window' && <Dimension label={t("Altura desde piso")} value={opening.sill} min={0} max={room.height - opening.height} onChange={sill => updateOpening({ sill })} />}</div><details className="setup-more"><summary>{t("Posición")}</summary><div><Dimension label={t("Desde el inicio de la pared")} value={opening.offset} min={0} max={wallLength(room, opening.wall) - opening.width} onChange={offset => updateOpening({ offset })} /></div></details></div>}
          {light && <div className="setup-furniture-style" key={light.id}><h3>{light.name}</h3><label className="setup-light-toggle"><input type="checkbox" checked={light.enabled} onChange={event => change({ ...room, lights: room.lights.map(item => item.id === light.id ? { ...item, enabled: event.target.checked } : item) })} />{t("Encendido")}</label><div className="setup-item-dimensions"><Dimension label={t("Intensidad")} value={light.lumens} min={0} max={20000} step={50} unit="lm" onChange={lumens => change({ ...room, lights: room.lights.map(item => item.id === light.id ? { ...item, lumens } : item) })} /><Dimension label={t("Temperatura")} value={light.temperature} min={1000} max={12000} step={100} unit="K" onChange={temperature => change({ ...room, lights: room.lights.map(item => item.id === light.id ? { ...item, temperature } : item) })} /></div></div>}
        </>}
      </fieldset>
      <section ref={previewRef} className="setup-preview" aria-label={step === 0 ? t("Croquis del diseño") : t("Vista previa del diseño")}>{step === 0 ? <PlanEditor key={planKey} project={shownProject} activeLevelId={activeLevelId} onProjectChange={construction.apply} onUndo={construction.undo} onRedo={construction.redo} canUndo={construction.canUndo} canRedo={construction.canRedo} room={shownProject === project ? room : projectToRoom(shownProject, activeLevelId)} onChange={change} selection={selection} onSelect={setSelection} sketchUrl={sketchUrl} onSketchChange={sketch} onDrawingChange={setDrawing} hideSurfaceControls readOnly={disabled} /> : <><Suspense fallback={<div className="setup-preview-loading" role="status"><LoaderCircle size={25} className="setup-spinner" /><span>{t("Cargando vista…")}</span></div>}><RoomScene project={shownProject} activeLevelId={activeLevelId} onProjectChange={construction.apply} presentation={{ walls: 'cut', roofs: step === 1, levels: 'active' }} paused={!!workshop} room={shownProject === project ? room : projectToRoom(shownProject, activeLevelId)} roomId={activeRoomId} mode="orbit" selection={sceneSelection} onSelect={selectScene} onChange={change} readOnly={disabled || paintTool.switching || step !== 3 && !painting} paintActive={painting} paintWallSide={wallSide} onPaint={paintTarget} transformMode={transformMode} resetKey={step} /></Suspense>{(step === 2 || step === 3) ? <div className="setup-paint-toolbar"><PaintToolbar active={painting} color={paintTool.color} colors={usedColors} disabled={disabled || paintTool.switching} onModeChange={active => void paintTool.chooseMode(active)} onColorChange={paintTool.setColor} /></div> : <span className="setup-preview-label">{t("Vista previa")}</span>}{step === 3 && !painting && selection && movableSelection && !disabled && <div className="selection-dock setup-selection-dock" role="toolbar" aria-label={t("Elemento")}><span>{items.find(item => JSON.stringify(item.selection) === JSON.stringify(selection))?.name}</span><button type="button" className={transformMode === 'translate' ? 'active' : ''} aria-label={t("Mover elemento")} title={t("Mover elemento")} aria-pressed={transformMode === 'translate'} onClick={() => setTransformMode('translate')}><Move size={18} /><span>{t("Mover")}</span></button>{(furniture || selection.kind === 'stair') && <button type="button" className={transformMode === 'rotate' ? 'active' : ''} aria-label={t("Girar elemento")} title={t("Girar elemento")} aria-pressed={transformMode === 'rotate'} onClick={() => setTransformMode('rotate')}><RotateCcw size={18} /><span>{t("Girar")}</span></button>}<button type="button" className="selection-properties" aria-label={t("Propiedades del elemento")} title={t("Propiedades del elemento")} onClick={editSelected}><Settings2 size={18} /><span>{t("Editar")}</span></button><button type="button" aria-label={t("Deseleccionar elemento")} title={t("Deseleccionar elemento")} onClick={() => setSelection(null)}><X size={18} /></button></div>}</>}</section>
    </main>
    <footer className="setup-footer"><div className="setup-feedback" aria-live="polite">{(localError || error) ? <div className="setup-error" role="alert"><span>{t(localError || error)}</span>{(status === 'error' || status === 'conflict') && <button type="button" onClick={onRetry}>{t("Reintentar")}</button>}{(pendingOffline || status === 'conflict') && onDownload && <button type="button" onClick={() => void onDownload().catch(cause => setLocalError(cause.message))}>{t("Descargar copia")}</button>}{status === 'conflict' && onDiscard && <button type="button" onClick={() => { if (window.confirm(t("¿Usar la versión del servidor? Descarga antes los cambios que quieras conservar."))) void onDiscard().catch(cause => setLocalError(cause.message)); }}>{t("Usar versión guardada")}</button>}</div> : <><span className="setup-save-state">{status === 'saving' || status === 'syncing' || busy ? <><LoaderCircle size={17} className="setup-spinner" />{t("Guardando…")}</> : status === 'saved' ? <><Check size={17} />{t("Guardado")}</> : status === 'offline' ? <><WifiOff size={17} />{pendingOffline ? t("Guardado en este dispositivo") : t("Sin conexión")}</> : null}</span>{notice && <span>{t(notice)}</span>}</>}</div><div className="setup-actions"><button type="button" className="setup-secondary setup-back" aria-label={t("Atrás")} disabled={disabled || step === 0 || drawing} onClick={() => { change({ ...room, setupStep: (step - 1) as 0 | 1 | 2 }); setLocalError(''); setNotice(''); setSelection(null); }}><ArrowLeft size={18} /><span>{t("Atrás")}</span></button><div><button type="button" className="setup-skip" disabled={disabled || drawing} onClick={() => void skip()}>{t("Omitir")}</button><button type="button" className="setup-primary" disabled={disabled || drawing || status === 'error' || status === 'conflict'} onClick={advance}>{step === 3 ? t("Abrir editor") : t("Continuar")}<ArrowRight size={18} /></button></div></div></footer>
    <dialog ref={catalogDialog} className="add-dialog setup-catalog-dialog" aria-labelledby="setup-catalog-title" onCancel={() => setCatalog(null)} onClose={() => setCatalog(null)} onClick={event => { if (event.target === event.currentTarget) setCatalog(null); }}><header className="setup-catalog-header"><h2 id="setup-catalog-title">{catalog === 'custom' ? t("Modelos propios") : catalog === 'stairs' ? t("Escaleras") : t("Muebles")}</h2><button type="button" className="icon-button" aria-label={t("Cerrar catálogo")} onClick={() => setCatalog(null)}><X size={21} /></button></header>{catalog === 'stairs' ? <StairCatalog project={project} activeLevelId={activeLevelId} onChange={construction.apply} readOnly={disabled || drawing} onSelect={next => { setSelection(next); setCatalog(null); if (window.matchMedia('(max-width: 700px)').matches) requestAnimationFrame(() => previewRef.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' })); }} /> : catalog === 'custom' ? <Suspense fallback={<p role="status">{t("Cargando modelos…")}</p>}><ModelLibrary roomId={activeRoomId} canManage={canManage} disabled={disabled || !activeRoomId} onSelect={addModel} onCreate={() => openWorkshop()} /></Suspense> : catalog && <FurnitureCatalog category={catalog} onSelect={addPreset} />}{localError && <p className="account-error" role="alert">{t(localError)}</p>}</dialog>
    {workshop && <Suspense fallback={<div className="setup-workshop-loading" role="status"><LoaderCircle size={25} className="setup-spinner" />{t("Cargando editor…")}</div>}><ModelWorkshop item={workshop === 'new' ? undefined : workshop} roomId={activeRoomId} onSaved={addModel} onClose={() => setWorkshop(null)} /></Suspense>}
  </div>;
}
