import { Archive, ArrowUpRight, ArrowDownToLine, ArrowUpFromLine, BedDouble, Box, Check, ChevronDown, CircleHelp, DoorClosed, DoorOpen, Focus, Footprints, Grid2X2, Layers3, Lightbulb, LoaderCircle, MousePointer2, Move, Paintbrush, PanelLeftClose, PanelRightClose, Plus, RotateCcw, Ruler, Settings2, Share2, Shield, Sun, Table2, Trash2, WifiOff, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { parseProjectBackup } from '../../client/projects/projectBackup';
import { confirmLocalSaved, registerAppActivity } from '../../client/pwa/appOffline';
import type { FurnitureCategory } from '../../domain/models/furnitureCatalog';
import type { ModelAsset } from '../../domain/models/glbValidation';
import { addCustomFurniture, addFurniture, addLight, addOpening, BED_SIZES, fitRoom, FURNITURE_LABELS, moveSceneItem, polygonArea, validateRoom, wallCount } from '../../domain/project/model';
import { projectToRoom, updateCeilingFinish, validateProjectDocument } from '../../domain/project/projectDocument';
import type { BedSize, FloorFinish, FurnitureItem, Opening, Room, RoomLight, Selection, ViewMode } from '../../domain/project/types';
import { t, useLocale } from '../../shared/i18n/i18n';
import { DESIGNS_PATH } from '../../shared/routes';
import Brand from '../../shared/ui/Brand';
import { projectColors, useColorPreview } from '../../shared/ui/colorPreview';
import InformationMenu from '../../shared/ui/InformationMenu';
import NameInput from '../../shared/ui/NameInput';
import CollaborationPanel from '../collaboration/CollaborationPanel';
import Notifications from '../collaboration/Notifications';
import SharingLinks from '../collaboration/SharingLinks';
import LevelSelector from '../construction/LevelSelector';
import ConstructionPanel from '../construction/ConstructionPanel';
import StairCatalog from '../construction/StairCatalog';
import { deleteStair } from '../../domain/project/projectOperations';
import OpeningForm, { type OpeningValues } from '../construction/OpeningForm';
import PlanEditor from '../construction/PlanEditor';
import useConstructionHistory from '../construction/useConstructionHistory';
import FurnitureCatalog from '../models/FurnitureCatalog.tsx';
import ModelLibrary from '../models/ModelLibrary';
import OfflineSettings, { useOfflineMode } from '../settings/OfflineSettings';
import RoomScene from '../viewer/RoomScene';
import { furnitureName, wallName } from './editorLabels';
import { describeSurfaceSelection } from './editorSelection';
import EditorViewOptions from './EditorViewOptions';
import ItemInspector from './ItemInspector';
import LightingInspector from './LightingInspector';
import RecoveryPanel from './RecoveryPanel';
import SpaceInspector from './SpaceInspector';
import SurfaceInspector from './SurfaceInspector';
import useProject from './useProject';

const ModelWorkshop = lazy(() => import('../workshop/ModelWorkshop'));
const FURNITURE_ICONS = { bed: BedDouble, wardrobe: DoorClosed, vanity: Table2, nightstand: Archive, custom: Box };
const sameSelection = (a: Selection | null, b: Selection) => JSON.stringify(a) === JSON.stringify(b);

export default function App({ onHome = () => window.location.assign(DESIGNS_PATH) }: { onHome?: () => void }) {
  useLocale();
  const { project, setProject, activeLevelId, setActiveLevelId, room, setRoom, ready, status, error: saveError, readOnly: projectReadOnly, canManage, role, connected, roomId, shareUrl, shared, setSharing, uploadSketch, sketchUrl, retry, offlineAllowed, pendingOffline, discardOffline, downloadOfflineBackup, importProject, recoveryProject } = useProject();
  const construction = useConstructionHistory(project, setProject);
  const { shownProject, previewProject } = useColorPreview(project);
  const [wallSide, setWallSide] = useState<'left' | 'right'>('left');
  const [presentation, setPresentation] = useState<{ walls: 'full' | 'cut' | 'hidden'; roofs: boolean; levels: 'active' | 'below' | 'all' }>({ walls: 'cut', roofs: false, levels: 'active' });
  const forced = useOfflineMode();
  const [importing, setImporting] = useState(false);
  const [changingLevel, setChangingLevel] = useState(false);
  const levelNavigation = useRef(false);
  const importBusy = useRef(false);
  const activeFiles = useRef(new Set<symbol>());
  useEffect(() => registerAppActivity(() => activeFiles.current.size ? 'Espera a que termine la operación actual.' : false), []);
  const readOnly = projectReadOnly || importing || changingLevel;
  const [mode, setMode] = useState<ViewMode>('orbit');
  const [drawing, setDrawing] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate'>('translate');
  const [tab, setTab] = useState<'item' | 'space' | 'color' | 'light'>('space');
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'scene' | 'properties' | null>(null);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1000px)').matches);
  const [resetKey, setResetKey] = useState(0);
  const [notice, setNotice] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharingBusy] = useState(false);
  const [shareError, setShareError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addingOpening, setAddingOpening] = useState<Opening['type'] | null>(null);
  const [addError, setAddError] = useState('');
  const [category, setCategory] = useState<FurnitureCategory | 'stairs' | null>(null);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [workshop, setWorkshop] = useState<{ item?: FurnitureItem } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const shareRef = useRef<HTMLDialogElement>(null);
  const addRef = useRef<HTMLDialogElement>(null);
  const optionsRef = useRef<HTMLDetailsElement>(null);
  const fileRef = useRef<HTMLDetailsElement>(null);
  const area = polygonArea(room.vertices);
  const furniture = selection?.kind === 'furniture' ? room.furniture.find(item => item.id === selection.id) : undefined;
  const opening = selection?.kind === 'opening' ? room.openings.find(item => item.id === selection.id) : undefined;
  const light = selection?.kind === 'light' ? room.lights.find(item => item.id === selection.id) : undefined;
  const surfaceTarget = describeSurfaceSelection(project, activeLevelId, room, selection, wallSide);
  const { level, selectedWall, selectedSurface, selectedCeiling, surface, surfaceName, selectedColor } = surfaceTarget;
  const selectedName = selection?.kind === 'stair' ? t('Escalera') : selection?.kind === 'roof' ? t('Cubierta') : furniture ? furnitureName(furniture) : opening ? opening.type === 'door' ? t("Puerta") : t("Ventana") : light ? light.name : selection ? surfaceName : '';
  const usedColors = projectColors(project);
  const propertiesVisible = compact ? mobilePanel === 'properties' : rightOpen;
  const elementsVisible = compact ? mobilePanel === 'scene' : leftOpen;
  const saving = importing || status === 'saving' || status === 'syncing';
  const statusLabel = importing ? t("Importando…") : status === 'conflict' ? t("Revisar cambios") : status === 'offline' ? pendingOffline ? t("Guardado en este dispositivo") : t("Sin conexión") : !connected ? t("Sin conexión") : readOnly ? t("Solo lectura") : saving ? t("Guardando…") : status === 'error' ? t("No guardado") : t("Guardado");

  useEffect(() => {
    const query = window.matchMedia('(max-width: 1000px)');
    function resize() { setCompact(query.matches); setMobilePanel(null); }
    query.addEventListener('change', resize);
    return () => query.removeEventListener('change', resize);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const offlineError = (event: Event) => { const message = (event as CustomEvent).detail; if (typeof message === 'string') setNotice(message); };
    window.addEventListener('space-offline-error', offlineError);
    return () => window.removeEventListener('space-offline-error', offlineError);
  }, []);
  useEffect(() => { if (shareOpen) shareRef.current?.showModal(); else shareRef.current?.close(); }, [shareOpen]);
  useEffect(() => { if (forced || !connected) setShareOpen(false); }, [forced, connected]);
  useEffect(() => { if (addOpen) addRef.current?.showModal(); else addRef.current?.close(); }, [addOpen]);
  useEffect(() => {
    function closeMenus(event: PointerEvent | KeyboardEvent) {
      for (const menu of [optionsRef.current, fileRef.current]) {
        if (menu?.open && (event instanceof KeyboardEvent ? event.key === 'Escape' : !menu.contains(event.target as Node))) menu.open = false;
      }
    }
    document.addEventListener('pointerdown', closeMenus);
    document.addEventListener('keydown', closeMenus);
    return () => { document.removeEventListener('pointerdown', closeMenus); document.removeEventListener('keydown', closeMenus); };
  }, []);
  useEffect(() => {
    if (!selection) return;
    if (selection.kind === 'wall' && (selectedWall < 0 || selectedWall >= wallCount(room)) || selection.kind === 'floor' && selection.id && !selectedSurface || selection.kind === 'ceiling' && selection.id && !selectedCeiling || selection.kind === 'furniture' && !furniture || selection.kind === 'opening' && !opening || selection.kind === 'light' && !light || selection.kind === 'stair' && !project.stairs.some(item => item.id === selection.id && (item.fromLevelId === activeLevelId || item.toLevelId === activeLevelId)) || selection.kind === 'roof' && !project.roofs.some(item => item.id === selection.id && item.levelId === activeLevelId)) { setSelection(null); setTab('space'); }
  }, [selection, room, furniture, opening, light, selectedWall, selectedSurface, selectedCeiling, project, activeLevelId]);

  const recoveryPanel = <RecoveryPanel project={recoveryProject} onDownload={downloadOfflineBackup} onDiscard={discardOffline} onError={setNotice} />;
  if (!ready) return <main className="project-loading">{recoveryPanel}{status === 'error' ? <><CircleHelp size={22} /><p>{t(saveError)}</p><button className="primary-button" onClick={retry}>{t("Reintentar")}</button><button className="outline-button" onClick={() => void downloadPending()}>{t("Descargar copia local")}</button><OfflineSettings /><a href={DESIGNS_PATH}>{t("Mis diseños")}</a>{notice && <p role="alert">{t(notice)}</p>}</> : <><LoaderCircle size={23} /><span>{t("Cargando proyecto…")}</span></>}</main>;

  async function changeSharing(enabled: boolean) {
    if (sharing) return;
    setSharingBusy(true); setShareError('');
    try { await setSharing(enabled); }
    catch (cause) { setShareError(cause instanceof Error ? cause.message : "No se pudo cambiar el enlace."); }
    finally { setSharingBusy(false); }
  }

  function change(next: Room | (() => Room)) {
    if (readOnly) return false;
    try {
      const validated = validateRoom(typeof next === 'function' ? next() : next);
      if (JSON.stringify(validated) !== JSON.stringify(room)) return setRoom(validated);
      return true;
    } catch (error) { setNotice(error instanceof Error ? error.message : "No se pudo aplicar el cambio."); return false; }
  }
  function showProperties(nextTab: typeof tab = tab, target: Selection | null = selection) {
    if (nextTab === 'color' && (!target || !['wall', 'floor', 'ceiling'].includes(target.kind)) && level.walls[0]) setSelection({ kind: 'wall', index: 0, id: level.walls[0].id });
    if (optionsRef.current) optionsRef.current.open = false;
    setTab(nextTab); setRightOpen(true); setMobilePanel(compact ? 'properties' : null);
  }
  async function changeView(next: ViewMode) {
    try { if (mode === 'plan' && next !== mode) await confirmLocalSaved(); setMode(next); setMobilePanel(null); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'No se pudo guardar el borrador.'); }
  }
  async function changeLevel(levelId: string) {
    if (levelNavigation.current) return;
    levelNavigation.current = true; setChangingLevel(true);
    try { await confirmLocalSaved(); setSelection(null); setActiveLevelId(levelId); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : 'No se pudo guardar el borrador.'); }
    finally { levelNavigation.current = false; setChangingLevel(false); }
  }
  function toggleElements() {
    if (optionsRef.current) optionsRef.current.open = false;
    if (compact) setMobilePanel(panel => panel === 'scene' ? null : 'scene');
    else setLeftOpen(open => !open);
  }
  function showAdd() {
    if (optionsRef.current) optionsRef.current.open = false;
    setAddingOpening(null); setCategory(null); setModelsOpen(false); setAddError(''); setAddOpen(true); setMobilePanel(null);
  }
  function select(next: Selection | null, properties = false) {
    if (next?.kind === 'wall' && !next.id) next = { ...next, id: level.walls[next.index]?.id };
    setSelection(next); setTransformMode('translate');
    const nextTab = next?.kind === 'roof' ? 'space' : next && ['wall', 'floor', 'ceiling'].includes(next.kind) ? 'color' : 'item';
    setTab(nextTab);
    if (next && (properties || (!compact && mode !== 'plan'))) showProperties(nextTab, next);
  }
  function setBounds(enabled: boolean) {
    change(() => enabled ? fitRoom({ ...room, editing: { ...room.editing, bounds: true } }) : { ...room, editing: { ...room.editing, bounds: false } });
  }
  function paintedProject(hex: string) {
    if (selection?.kind === 'ceiling') return updateCeilingFinish(project, activeLevelId, { color: hex }, selectedCeiling?.id);
    return validateProjectDocument({ ...project, levels: project.levels.map(value => value.id !== activeLevelId ? value : { ...value, walls: value.walls.map((wall, index) => surface === 'wall' && index === selectedWall ? { ...wall, [wallSide]: { ...wall[wallSide], color: hex } } : wall), surfaces: value.surfaces.map(item => item.id === selectedSurface?.id ? { ...item, finish: { ...item.finish, color: hex } } : item) }) });
  }
  function previewFurniture(next: FurnitureItem | null) {
    previewProject(next ? { ...project, levels: project.levels.map(level => level.id !== activeLevelId ? level : { ...level, furniture: level.furniture.map(item => item.id === next.id ? { ...next, levelId: level.id } : item) }) } : null);
  }
  function paint(hex: string) {
    if (readOnly || !selection || !['wall', 'floor', 'ceiling'].includes(selection.kind) || selection.kind === 'wall' && selectedWall < 0 || selection.kind === 'floor' && selection.id && !selectedSurface || selection.kind === 'ceiling' && !selectedCeiling) return false;
    try {
      return setProject(paintedProject(hex));
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'No se pudo aplicar el color.'); return false; }
  }
  function finishSurface(material: FloorFinish) {
    if (readOnly || !selection || !['wall', 'floor', 'ceiling'].includes(selection.kind) || selection.kind === 'wall' && selectedWall < 0 || selection.kind === 'floor' && selection.id && !selectedSurface || selection.kind === 'ceiling' && !selectedCeiling) return false;
    if (selection.kind === 'ceiling') return setProject(updateCeilingFinish(project, activeLevelId, { material }, selectedCeiling?.id));
    return setProject(validateProjectDocument({ ...project, levels: project.levels.map(value => value.id !== activeLevelId ? value : { ...value, walls: value.walls.map((wall, index) => surface === 'wall' && index === selectedWall ? { ...wall, [wallSide]: { ...wall[wallSide], material } } : wall), surfaces: value.surfaces.map(item => item.id === selectedSurface?.id ? { ...item, finish: { ...item.finish, material } } : item) }), roofs: surface === 'ceiling' && !selectedSurface ? project.roofs.map(roof => roof.levelId === activeLevelId ? { ...roof, undersideFinish: { ...roof.undersideFinish, material } } : roof) : project.roofs }));
  }
  function updateFurniture(patch: Partial<FurnitureItem>) {
    if (!furniture) return false;
    if ('x' in patch || 'z' in patch || 'rotation' in patch) return change(() => moveSceneItem(room, { kind: 'furniture', id: furniture.id }, { x: patch.x ?? furniture.x, z: patch.z ?? furniture.z, rotation: patch.rotation ?? furniture.rotation }));
    return change({ ...room, furniture: room.furniture.map(item => item.id === furniture.id ? { ...item, ...patch } : item) });
  }
  function updateOpening(patch: Partial<Opening>) {
    return opening ? change(() => fitRoom({ ...room, openings: room.openings.map(item => item.id === opening.id ? { ...item, ...patch, ...('doorStyle' in patch ? { open: patch.doorStyle === 'frame' ? undefined : item.open ?? false } : {}) } : item).map(item => { if (item.doorStyle === 'frame') { const { open: _open, ...frame } = item; return frame; } return item; }) })) : false;
  }
  function updateLight(patch: Partial<RoomLight>) {
    if (!light) return false;
    if ('x' in patch || 'z' in patch || 'y' in patch) return change(() => moveSceneItem(room, { kind: 'light', id: light.id }, { x: patch.x ?? light.x, z: patch.z ?? light.z, y: patch.y ?? light.y }));
    return change({ ...room, lights: room.lights.map(item => item.id === light.id ? { ...item, ...patch } : item) });
  }
  function removeSelected() {
    if (readOnly || !selection) return;
    if (selection.kind === 'furniture') change({ ...room, furniture: room.furniture.filter(item => item.id !== selection.id) });
    if (selection.kind === 'opening') change({ ...room, openings: room.openings.filter(item => item.id !== selection.id) });
    if (selection.kind === 'light') change({ ...room, lights: room.lights.filter(item => item.id !== selection.id) });
    if (selection.kind === 'stair') { try { if (!construction.apply(deleteStair(project, selection.id))) return; } catch (cause) { setNotice(cause instanceof Error ? cause.message : 'No se pudo aplicar la construcción.'); return; } }
    setSelection(null);
  }
  function insert(type: FurnitureItem['type'] | 'light', bedSize: BedSize = 'double', variant?: string) {
    if (readOnly) return;
    try {
      const next = type === 'light' ? addLight(room, t('Luz {{number}}', { number: room.lights.length + 1 })) : addFurniture(room, type, bedSize, variant);
      if (!change(next)) { if (addOpen) setAddError("No se pudo agregar el elemento."); return; }
      setAddOpen(false);
      const nextSelection: Selection = type === 'light' ? { kind: 'light', id: next.lights.at(-1)!.id } : { kind: 'furniture', id: next.furniture.at(-1)!.id };
      select(nextSelection); setMobilePanel(null);
    } catch (error) { const message = error instanceof Error ? error.message : t("No se pudo agregar el elemento."); if (addOpen) setAddError(message); else setNotice(message); }
  }
  function openWorkshop(item?: FurnitureItem) {
    setAddOpen(false); setMobilePanel(null); setWorkshop({ item });
  }
  function insertModel(asset: ModelAsset) {
    try {
      const next = addCustomFurniture(room, asset);
      if (!change(next)) { setAddError("No se pudo agregar el modelo."); return false; }
      setWorkshop(null); setAddOpen(false);
      select({ kind: 'furniture', id: next.furniture.at(-1)!.id }); setMobilePanel(null);
      return true;
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "No se pudo agregar el modelo."); return false; }
  }
  function createOpening(values: OpeningValues) {
    if (!addingOpening || readOnly) return false;
    const next = addOpening(room, addingOpening, values.wall, values);
    if (!change(next)) return false;
    setAddOpen(false); setAddingOpening(null);
    select({ kind: 'opening', id: next.openings.at(-1)!.id }); setMobilePanel(null);
    return true;
  }
  function exportRoom() { void downloadPending(); }
  async function downloadPending() {
    const activity = Symbol();
    try { await confirmLocalSaved(); activeFiles.current.add(activity); await downloadOfflineBackup(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "No se pudo descargar la copia."); }
    finally { activeFiles.current.delete(activity); }
  }
  async function useServerVersion() {
    if (!window.confirm(t("¿Usar la versión del servidor? Los cambios pendientes de este dispositivo se descartarán. Puedes descargarlos antes."))) return;
    try { await discardOffline(); }
    catch (cause) { setNotice(cause instanceof Error ? cause.message : "No se pudo abrir la versión guardada."); }
  }
  async function importRoom(file?: File) {
    if (!file || readOnly || importBusy.current) return;
    const activity = Symbol();
    importBusy.current = true; setImporting(true);
    try {
      if (file.size > 225 * 1024 * 1024) throw new Error("La copia debe pesar menos de 225 MB.");
      await confirmLocalSaved();
      activeFiles.current.add(activity);
      const backup = await parseProjectBackup(file);
      await importProject(backup);
      select(null); setResetKey(value => value + 1); setNotice("Proyecto abierto.");
    } catch (error) { setNotice(error instanceof SyntaxError ? "El archivo no es un proyecto válido." : error instanceof Error ? error.message : "No se pudo abrir el archivo."); }
    finally { activeFiles.current.delete(activity); importBusy.current = false; setImporting(false); if (importRef.current) importRef.current.value = ''; }
  }
  async function changeSketch(file: File | null) {
    const activity = Symbol(); activeFiles.current.add(activity);
    try { await uploadSketch(file); }
    finally { activeFiles.current.delete(activity); }
  }
  const items: { selection: Selection; name: string; Icon: typeof Box }[] = [
    ...room.furniture.map((item, index) => ({ selection: { kind: 'furniture', id: item.id } as Selection, name: furnitureName(item) + ' ' + (index + 1), Icon: FURNITURE_ICONS[item.type] })),
    ...room.openings.map((item, index) => ({ selection: { kind: 'opening', id: item.id } as Selection, name: (item.type === 'door' ? t("Puerta") : t("Ventana")) + ' ' + (index + 1), Icon: item.type === 'door' ? DoorOpen : Grid2X2 })),
    ...room.lights.map(item => ({ selection: { kind: 'light', id: item.id } as Selection, name: item.name, Icon: Lightbulb })),
    ...project.stairs.filter(stair => stair.fromLevelId === activeLevelId || stair.toLevelId === activeLevelId).map((stair, index) => ({ selection: { kind: 'stair', id: stair.id } as Selection, name: t('Escalera {{number}}', { number: index + 1 }), Icon: ArrowUpRight })),
    ...Array.from({ length: wallCount(room) }, (_, index) => ({ selection: { kind: 'wall', index, id: level.walls[index].id } as Selection, name: wallName(index), Icon: Layers3 })),
    { selection: { kind: 'floor' }, name: t("Piso"), Icon: Grid2X2 }, { selection: { kind: 'ceiling' }, name: t("Techo"), Icon: Box },
  ];

  const scenePanel = <>
    <div className="panel-heading"><span>{t("Elementos")}</span><div className="panel-heading-actions"><button className="scene-add-button" aria-label={t("Agregar elemento")} title={t("Agregar elemento")} disabled={readOnly} onClick={showAdd}><Plus size={18} /><span>{t("Agregar")}</span></button><button className="icon-button desktop-only" aria-label={t("Ocultar elementos")} onClick={() => setLeftOpen(false)}><PanelLeftClose size={18} /></button><button className="icon-button mobile-only" aria-label={t("Cerrar elementos")} onClick={() => setMobilePanel(null)}><X size={20} /></button></div></div>
    {readOnly && <p className="panel-access-status">{connected ? t("Solo lectura") : t("Sin conexión")}</p>}
    <div className="room-tree-title"><Box size={16} /><span>{room.name}</span><span className="item-count">{items.length}</span></div>
    <div className="unified-item-list">{items.map(item => <button key={JSON.stringify(item.selection)} className={'tree-item ' + (sameSelection(selection, item.selection) ? 'selected' : '')} onClick={() => select(item.selection, true)}><item.Icon size={15} /><span>{item.name}</span>{item.selection.kind === 'wall' && <span className="wall-color-dot" style={{ background: room.wallColors[item.selection.index] }} />}</button>)}</div>
  </>;

  const itemPanel = selection?.kind === 'stair' ? <ConstructionPanel project={project} activeLevelId={activeLevelId} onChange={construction.apply} onPreview={previewProject} selection={selection} onSelect={next => select(next)} readOnly={readOnly || drawing} only="stairs" /> : <ItemInspector room={room} selection={selection} surfaceName={surfaceName} project={project} roomId={roomId} usedColors={usedColors} readOnly={readOnly} showAdd={showAdd} editMaterial={() => setTab('color')} editPlan={() => changeView('plan')} updateFurniture={updateFurniture} updateOpening={updateOpening} updateLight={updateLight} previewFurniture={previewFurniture} setNotice={setNotice} removeSelected={removeSelected} openWorkshop={openWorkshop} />;

  const colorPanel = <SurfaceInspector room={room} project={project} selection={selection} target={surfaceTarget} wallSide={wallSide} setWallSide={setWallSide} usedColors={usedColors} readOnly={readOnly} select={next => select(next)} paint={paint} paintedProject={paintedProject} previewProject={previewProject} finishSurface={finishSurface} applyAllWalls={() => setProject(validateProjectDocument({ ...project, levels: project.levels.map(value => value.id === activeLevelId ? { ...value, walls: value.walls.map(wall => ({ ...wall, [wallSide]: { ...wall[wallSide], color: selectedColor } })) } : value) }))} finishFloor={material => setProject(validateProjectDocument({ ...project, levels: project.levels.map(value => value.id === activeLevelId ? { ...value, surfaces: value.surfaces.map(item => item.id === selectedSurface?.id ? { ...item, finish: { ...item.finish, material: material } } : item) } : value) }))} />;

  const spacePanel = <SpaceInspector room={room} project={project} activeLevelId={activeLevelId} selection={selection} readOnly={readOnly} drawing={drawing} onProjectChange={construction.apply} previewProject={previewProject} onSelect={next => select(next)} change={change} editPlan={() => changeView('plan')} />;

  const lightPanel = <LightingInspector room={room} readOnly={readOnly} change={change} select={select} addLight={() => insert('light')} />;

  const propertiesPanel = <>
    <div className="panel-heading"><span>{t("Propiedades")}</span><button className="icon-button desktop-only" aria-label={t("Ocultar propiedades")} onClick={() => setRightOpen(false)}><PanelRightClose size={18} /></button><button className="icon-button mobile-only" aria-label={t("Cerrar propiedades")} onClick={() => setMobilePanel(null)}><X size={20} /></button></div>
    <div className="inspector-title"><span className="inspector-icon">{tab === 'color' ? <Paintbrush size={19} /> : tab === 'light' ? <Sun size={19} /> : tab === 'space' ? <Ruler size={19} /> : <Box size={19} />}</span><h2>{tab === 'item' ? selectedName || t("Elemento") : tab === 'space' ? t("Cuarto") : tab === 'color' ? t("Materiales") : t("Iluminación")}</h2></div>
    <div className="inspector-content" key={JSON.stringify([tab, selection])} id={'panel-' + tab}>{tab === 'item' ? itemPanel : tab === 'space' ? spacePanel : tab === 'color' ? colorPanel : lightPanel}</div>
  </>;

  return <div className={'studio editor-ui ' + (leftOpen ? '' : 'left-collapsed') + ' ' + (rightOpen ? '' : 'right-collapsed')}>
    {recoveryPanel}
    <header className="app-header"><Brand className="brand" /><div className="header-divider" />
      <details ref={fileRef} className="file-menu desktop-only"><summary onClick={() => setMobilePanel(null)}>{t("Archivo")} <ChevronDown size={16} /></summary><div><button disabled={readOnly} onClick={() => { importRef.current?.click(); if (fileRef.current) fileRef.current.open = false; }}><ArrowUpFromLine size={17} />{t("Abrir proyecto")}</button><button onClick={() => { exportRoom(); if (fileRef.current) fileRef.current.open = false; }}><ArrowDownToLine size={17} />{t("Descargar copia")}</button></div></details>
      <button className="editor-home" aria-label={t("Mis diseños")} title={t("Mis diseños")} onClick={() => void confirmLocalSaved().then(onHome).catch(cause => setNotice(cause.message))}><Layers3 size={19} /><span>{t("Mis diseños")}</span></button>
      <div className="project-name"><span className="project-dot" /><NameInput label={t("Nombre del proyecto")} readOnly={readOnly} value={room.name} onChange={name => change({ ...room, name })} notify={setNotice} /></div>
      <div className="header-actions"><span className={'saved-status ' + (readOnly ? 'readonly-status' : '')} role="status" title={statusLabel}>{status === 'offline' ? <WifiOff size={16} /> : !connected || status === 'conflict' || status === 'error' ? <CircleHelp size={16} /> : readOnly ? <Shield size={16} /> : saving ? <LoaderCircle size={16} className="saving-spinner" /> : <Check size={16} />}<span>{statusLabel}</span></span>{role !== 'public' && connected && !forced && <Notifications onOpen={() => { setMobilePanel(null); if (optionsRef.current) optionsRef.current.open = false; }} />}<OfflineSettings /><InformationMenu /><button className="save-button" aria-label={t("Compartir diseño")} disabled={forced || !connected || saving || pendingOffline || status === 'error' || status === 'conflict'} onClick={() => setShareOpen(true)}><Share2 size={18} /><span>{t("Compartir")}</span></button></div>
      <input ref={importRef} hidden type="file" accept=".3dspace,application/vnd.3dspace+zip,application/zip" onChange={event => void importRoom(event.target.files?.[0])} />
    </header>
    <div className="workspace-bar">
      <nav className="workspace-tools" aria-label={t("Herramientas del cuarto")}><button aria-expanded={elementsVisible} className={elementsVisible ? 'active' : ''} onClick={toggleElements}><Layers3 size={18} /><span>{t("Elementos")}</span></button>{([['space', Ruler, t("Cuarto")], ['color', Paintbrush, t("Materiales")], ['light', Sun, t("Luz")]] as const).map(([key, Icon, name]) => <button key={key} aria-controls={'panel-' + key} aria-expanded={tab === key && propertiesVisible} className={tab === key && propertiesVisible ? 'active' : ''} onClick={() => { if (tab === key && propertiesVisible) { if (compact) setMobilePanel(null); else setRightOpen(false); } else showProperties(key); }}><Icon size={18} /><span>{name}</span></button>)}</nav>
      <details ref={optionsRef} className="view-options"><summary aria-label={t("Opciones de vista")} title={t("Opciones de vista")} onClick={() => setMobilePanel(null)}><Settings2 size={20} /><span className="mobile-only">{t("Ajustes")}</span></summary><EditorViewOptions room={room} readOnly={readOnly} presentation={presentation} setPresentation={setPresentation} change={change} setBounds={setBounds} onImport={() => { importRef.current?.click(); if (optionsRef.current) optionsRef.current.open = false; }} onExport={() => { exportRoom(); if (optionsRef.current) optionsRef.current.open = false; }} /></details>
    </div>
    <aside aria-label={t("Elementos del diseño")} className={'scene-panel ' + (mobilePanel === 'scene' ? 'mobile-open' : '')}>{scenePanel}</aside>
    <main className="viewport">
      <div className="editor-level-bar"><LevelSelector project={project} activeLevelId={activeLevelId} onSelect={levelId => void changeLevel(levelId)} navigationDisabled={changingLevel} onChange={construction.apply} readOnly={readOnly || drawing} onUndo={construction.undo} onRedo={construction.redo} canUndo={construction.canUndo} canRedo={construction.canRedo} /></div>
      <div className="viewport-top editor-toolbar">
        <div className="view-tabs" role="tablist" aria-label={t("Vista")}><button role="tab" aria-selected={mode !== 'plan'} className={mode !== 'plan' ? 'active' : ''} onClick={() => void changeView('orbit')}><Box size={18} />3D</button><button role="tab" aria-selected={mode === 'plan'} className={mode === 'plan' ? 'active' : ''} onClick={() => void changeView('plan')}><Grid2X2 size={18} />{t("Planta")}</button></div>
        <button className="add-toolbar-button" aria-label={t("Agregar elemento")} title={t("Agregar elemento")} disabled={readOnly} onClick={showAdd}><Plus size={18} /><span>{t("Agregar")}</span></button>
        <button className={'walk-button ' + (mode === 'walk' ? 'active' : '')} onClick={() => void changeView(mode === 'walk' ? 'orbit' : 'walk')}><Footprints size={18} />{mode === 'walk' ? t("Salir") : t("Recorrer")}</button>
      </div>
    {(status === 'error' || status === 'conflict') && <div className="save-error" role="alert"><CircleHelp size={17} /><span>{t(saveError)}</span><button onClick={retry}>{t("Reintentar")}</button><button aria-label={t("Descargar cambios sin guardar")} onClick={offlineAllowed || pendingOffline ? () => void downloadPending() : exportRoom}><ArrowDownToLine size={15} /></button>{status === 'conflict' && <button onClick={() => void useServerVersion()}>{t("Usar versión guardada")}</button>}</div>}
      <div className="viewport-body">
        {mode === 'plan' ? <div className="large-plan"><PlanEditor project={shownProject} activeLevelId={activeLevelId} onProjectChange={construction.apply} onUndo={construction.undo} onRedo={construction.redo} canUndo={construction.canUndo} canRedo={construction.canRedo} room={shownProject === project ? room : projectToRoom(shownProject, activeLevelId)} onChange={change} selection={selection} onSelect={next => select(next)} large onDrawingChange={setDrawing} sketchUrl={sketchUrl} onSketchChange={changeSketch} readOnly={readOnly} /></div> : <RoomScene project={shownProject} activeLevelId={activeLevelId} onProjectChange={construction.apply} onActiveLevelChange={setActiveLevelId} presentation={presentation} paused={!!workshop} room={shownProject === project ? room : projectToRoom(shownProject, activeLevelId)} roomId={roomId} onModelError={setNotice} mode={mode} selection={selection} onSelect={next => select(next)} onChange={change} readOnly={readOnly} transformMode={transformMode} resetKey={resetKey} />}
        {mode !== 'plan' && <><div className="view-title"><span className="view-title-dot" />{mode === 'walk' ? t("Vista interior") : t("Perspectiva")}</div><div className="viewport-bottom"><div className="navigation-hint"><MousePointer2 size={13} />{mode === 'walk' ? t("Arrastra para mirar") : !readOnly && selection && (furniture || opening || light || selection.kind === 'stair') ? t("Arrastra el elemento o sus controles") : t("Toca para seleccionar · Arrastra para girar")}</div><button className="focus-button" aria-label={t("Restablecer vista")} onClick={() => setResetKey(value => value + 1)}><Focus size={16} /></button></div></>}
        {selection && mode !== 'walk' && <div className="selection-dock"><span>{selectedName}</span>{(furniture || opening || light || mode === 'orbit' && selection.kind === 'stair') && !readOnly && <><button className={transformMode === 'translate' ? 'active' : ''} aria-label={t("Mover elemento")} title={t("Mover elemento")} aria-pressed={transformMode === 'translate'} onClick={() => setTransformMode('translate')}><Move size={18} /><span>{t("Mover")}</span></button>{(furniture || mode === 'orbit' && selection.kind === 'stair') && <button className={transformMode === 'rotate' ? 'active' : ''} aria-label={t("Girar elemento")} title={t("Girar elemento")} aria-pressed={transformMode === 'rotate'} onClick={() => setTransformMode('rotate')}><RotateCcw size={18} /><span>{t("Girar")}</span></button>}</>}<button className="selection-properties" aria-label={t("Propiedades del elemento")} onClick={() => showProperties(selection.kind === 'wall' || selection.kind === 'floor' || selection.kind === 'ceiling' ? 'color' : selection.kind === 'roof' ? 'space' : 'item')}><Settings2 size={19} /><span>{t("Editar")}</span></button>{(furniture || opening || light || selection.kind === 'stair') && !readOnly && <button className="desktop-only" aria-label={t("Eliminar elemento seleccionado")} onClick={removeSelected}><Trash2 size={18} /></button>}<button aria-label={t("Deseleccionar elemento")} onClick={() => select(null)}><X size={18} /></button></div>}
      </div>
      <div className="viewport-status"><span>{statusLabel}</span><span>{t('{{area}} m² · {{count}} paredes', { area: area.toFixed(1), count: wallCount(room) })}</span></div>
    </main>
    <aside aria-label={t("Propiedades del diseño")} className={'properties-panel ' + (mobilePanel === 'properties' ? 'mobile-open' : '')}>{propertiesPanel}</aside>
    {mobilePanel && <button className="mobile-backdrop" aria-label={t("Cerrar panel")} onClick={() => setMobilePanel(null)} />}
    {status === 'offline' && offlineAllowed && <div className="offline-note" role="status"><WifiOff size={17} /><span>{pendingOffline ? t("Sin conexión · Cambios guardados en este dispositivo") : t("Sin conexión · Puedes seguir editando")}</span><button aria-label={t("Reintentar conexión")} onClick={retry}>{t("Reconectar")}</button></div>}
    {notice && <div className="toast" role="status"><CircleHelp size={17} /><span>{t(notice)}</span><button aria-label={t("Cerrar aviso")} onClick={() => setNotice('')}><X size={15} /></button></div>}
    <dialog ref={addRef} className="add-dialog catalog-dialog" onCancel={() => setAddOpen(false)}><header className="dialog-header"><button autoFocus className="icon-button dialog-close" aria-label={t("Cerrar agregar")} onClick={() => setAddOpen(false)}><X size={20} /></button><h2>{addingOpening ? addingOpening === 'door' ? t("Agregar puerta") : t("Agregar ventana") : modelsOpen ? t("Modelos propios") : category === 'stairs' ? t("Escaleras") : category ? t(FURNITURE_LABELS[category]) : t("Agregar elemento")}</h2></header><fieldset className="property-fields" disabled={readOnly}>{addingOpening ? <OpeningForm key={addingOpening} room={room} type={addingOpening} initialWall={selectedWall} onCreate={createOpening} onCancel={() => setAddingOpening(null)} /> : category === 'stairs' ? <StairCatalog project={project} activeLevelId={activeLevelId} onChange={construction.apply} readOnly={readOnly || drawing} onBack={() => setCategory(null)} onSelect={next => { setAddOpen(false); select(next); setMobilePanel(null); }} /> : category ? <FurnitureCatalog category={category} onBack={() => setCategory(null)} onSelect={preset => insert(preset.type, 'double', preset.id)} /> : modelsOpen ? <ModelLibrary roomId={roomId} canManage={canManage} disabled={readOnly} onSelect={insertModel} onCreate={() => openWorkshop()} onBack={() => setModelsOpen(false)} /> : <div className="add-item-grid"><button onClick={() => setAddingOpening('door')}><DoorOpen size={24} /><span>{t("Puerta")}</span></button><button onClick={() => setAddingOpening('window')}><Grid2X2 size={24} /><span>{t("Ventana")}</span></button><button onClick={() => insert('light')}><Lightbulb size={24} /><span>{t("Foco")}</span></button>{Object.entries(BED_SIZES).map(([key, preset]) => <button key={key} onClick={() => insert('bed', key as BedSize)}><BedDouble size={25} /><span>{t('Cama {{size}}', { size: t(preset.label).toLowerCase() })}</span></button>)}{(['wardrobe', 'vanity', 'nightstand'] as const).map(type => { const Icon = FURNITURE_ICONS[type]; return <button key={type} onClick={() => setCategory(type)}><Icon size={24} /><span>{t(FURNITURE_LABELS[type])}</span></button>; })}<button onClick={() => setCategory('stairs')}><ArrowUpRight size={24} /><span>{t("Escaleras")}</span></button><button onClick={() => openWorkshop()}><Plus size={24} /><span>{t("Crear elemento")}</span></button><button onClick={() => setModelsOpen(true)}><Box size={24} /><span>{t("Modelos propios")}</span></button></div>}</fieldset>{!addingOpening && addError && <p className="add-error field-feedback" role="alert">{t(addError)}</p>}</dialog>
    <dialog ref={shareRef} className="share-dialog" onCancel={() => setShareOpen(false)}><header className="dialog-header"><button autoFocus className="icon-button dialog-close" aria-label={t("Cerrar compartir")} onClick={() => setShareOpen(false)}><X size={20} /></button><h2>{t("Compartir diseño")}</h2></header>{shared ? <><SharingLinks id={roomId} shareUrl={shareUrl} notify={setNotice} />{canManage && <button className="outline-button full-width share-disable" disabled={sharing} onClick={() => void changeSharing(false)}>{t("Desactivar enlace")}</button>}</> : canManage && <button className="primary-button" disabled={sharing} onClick={() => void changeSharing(true)}>{sharing ? <LoaderCircle size={16} className="saving-spinner" /> : <Share2 size={16} />}{t("Crear enlace")}</button>}{shareError && <p className="share-error" role="alert">{t(shareError)}</p>}{shareOpen && connected && !forced && canManage && <CollaborationPanel roomId={roomId} />}{!canManage && !shared && <p>{t("Solo el propietario puede dar acceso.")}</p>}</dialog>
    {workshop && <Suspense fallback={<div className="project-loading" role="status"><LoaderCircle className="saving-spinner" />{t("Cargando modelo…")}</div>}><ModelWorkshop item={workshop.item} roomId={roomId} onSaved={insertModel} onClose={() => setWorkshop(null)} /></Suspense>}
  </div>;
}
