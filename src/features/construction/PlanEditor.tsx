import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { Check, ImageOff, Maximize2, Minus, MousePointer2, Plus, Redo2, Scissors, Trash2, Undo2, Upload, X } from 'lucide-react';
import { bounds, FURNITURE_LABELS, furnitureCorners, invalidFurnitureIds, itemWorldPosition, moveSceneItem, roomWallEndpoints, snapPlanPoint, wallLength } from '../../domain/project/model';
import { projectLevel, wallEndpoints, type ProjectDocument } from '../../domain/project/projectDocument';
import type { PaintTarget } from '../../domain/project/projectPaint';
import { addRoom, addWall, addHole, deleteHole, movePoint, splitWall, deleteWall } from '../../domain/project/projectOperations';
import type { Point, Room, Selection } from '../../domain/project/types';
import NumberInput from '../../shared/ui/NumberInput';
import { buildStairGeometry } from '../../domain/project/projectGeometry';
import { parseNumber } from '../../shared/ui/fieldDraft';
import { t, useLocale } from '../../shared/i18n/i18n';
import { registerAppActivity, registerBeforeAppUpdate } from '../../client/pwa/appOffline';
import { applyPlanMove, containingFloor, planUpdateActivityReason, samePlanBase, type PlanMoveIntent } from './planDraft';
import { planFloorRegions, planVisibleHoles } from './planSurfaces';
import { planPaintTarget } from './planPaint';
import { planGestureView, planGrabPosition, planPointerWorld, type PlanGesture, type PlanPointerFrame } from './planPointer';
import Popover from '../../shared/ui/Popover';
import './plan.css';
import './planDraft.css';

type Props = { project: ProjectDocument; activeLevelId: string; onProjectChange: (project: ProjectDocument) => boolean | void; room: Room; onChange: (room: Room) => boolean | void; selection: Selection | null; onSelect: (selection: Selection | null) => void; large?: boolean; sketchUrl?: string | null; onSketchChange?: (file: File | null) => Promise<void>; onDrawingChange?: (drawing: boolean) => void; hideSurfaceControls?: boolean; readOnly?: boolean; onUndo?: () => void; onRedo?: () => void; canUndo?: boolean; canRedo?: boolean; paintActive?: boolean; paintWallSide?: 'left' | 'right'; onPaint?: (target: PaintTarget) => boolean | void };
type Tool = 'select' | 'wall' | 'rectangle' | 'room' | 'hole';
type View = { scale: number; cx: number; cz: number };
type Drag = { kind: 'point'; id: string; origin: Point; offset: Point } | { kind: 'wall'; id: string; origin: Point; anchor: Point } | { kind: 'item'; selection: Selection; offset: Point } | { kind: 'stair'; id: string; offset: Point } | { kind: 'hole'; surfaceId: string; holeId: string; index: number; offset: Point };
type Pointer = { x: number; y: number };

export default function PlanEditor({ project, activeLevelId, onProjectChange, room, onChange, selection, onSelect, large = false, sketchUrl, onSketchChange, onDrawingChange, hideSurfaceControls = false, readOnly = false, onUndo, onRedo, canUndo, canRedo, paintActive = false, paintWallSide = 'left', onPaint }: Props) {
  useLocale();
  const level = projectLevel(project, activeLevelId), svg = useRef<SVGSVGElement>(null), input = useRef<HTMLInputElement>(null);
  const [tool, setTool] = useState<Tool>('select'), [points, setPoints] = useState<Point[]>([]), [hover, setHover] = useState<Point | null>(null);
  const [error, setError] = useState(''), [uploading, setUploading] = useState(false), [angles, setAngles] = useState(true), [angleStep, setAngleStep] = useState(15), [length, setLength] = useState('');
  const [viewport, setViewport] = useState<View | null>(null), [selectedPoint, setSelectedPoint] = useState<string | null>(null), [selectedHole, setSelectedHole] = useState<{ surfaceId: string; holeId: string } | null>(null);
  const [previewProject, setPreviewProject] = useState<ProjectDocument | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [screenUnit, setScreenUnit] = useState(1);
  const drawingBase = useRef<ProjectDocument | null>(null), pendingIntent = useRef<PlanMoveIntent | null>(null);
  const previousLevel = useRef(activeLevelId);
  const [archivedDrafts, setArchivedDrafts] = useState<{ levelId: string; tool: Tool; points: Point[]; movement: PlanMoveIntent | null }[]>([]);
  const drag = useRef<Drag | null>(null), dragBase = useRef(project), pending = useRef<ProjectDocument | null>(null), pendingRoom = useRef<Room | null>(null);
  const dragFrame = useRef<PlanPointerFrame | null>(null), dragPointer = useRef<number | null>(null);
  const pointers = useRef(new Map<number, Pointer>()), gesture = useRef<PlanGesture | null>(null), down = useRef<Pointer | null>(null);
  const paintTap = useRef<{ pointerId: number; origin: Pointer; target: PaintTarget } | null>(null);
  const visible = bounds([...level.points, ...room.furniture.flatMap(furnitureCorners), ...room.lights]);
  const view = viewport ?? { scale: Math.min(540 / Math.max(visible.width, 1), 330 / Math.max(visible.depth, 1)), cx: (visible.minX + visible.maxX) / 2, cz: (visible.minZ + visible.maxZ) / 2 };
  const currentView = useRef(view); currentView.current = view;
  const shownLevel = previewProject?.levels.find(level => level.id === activeLevelId) ?? level;
  const floorRegions = useMemo(() => planFloorRegions(shownLevel), [shownLevel]);
  const visibleHoles = useMemo(() => planVisibleHoles(shownLevel), [shownLevel]);
  const screen = (p: Point) => ({ x: 340 + (p.x - view.cx) * view.scale, y: 230 + (p.z - view.cz) * view.scale });
  const linePoints = (values: Point[]) => values.map(p => { const value = screen(p); return `${value.x},${value.y}`; }).join(' ');
  const ringPath = (values: Point[]) => values.map((point, index) => { const p = screen(point); return (index ? 'L' : 'M') + p.x + ' ' + p.y; }).join(' ') + 'Z';
  const invalid = useMemo(() => invalidFurnitureIds(room), [room]);
  const selectedWallId = selection?.kind === 'wall' ? selection.id ?? level.walls[selection.index]?.id : null;
  const vertex = level.points.find(point => point.id === selectedPoint);
  const hole = selectedHole && level.surfaces.find(surface => surface.id === selectedHole.surfaceId)?.holes.find(hole => hole.id === selectedHole.holeId);
  const drawing = tool !== 'select';
  const baseChanged = points.length > 0 && drawingBase.current !== null && !samePlanBase(drawingBase.current, project, activeLevelId) || pendingIntent.current !== null && !samePlanBase(dragBase.current, project, activeLevelId, pendingIntent.current);
  const draftBlocked = readOnly || interrupted || baseChanged;
  const updateState = useRef({ points: points.length, uploading, archived: archivedDrafts.length, blocked: draftBlocked });
  updateState.current = { points: points.length, uploading, archived: archivedDrafts.length, blocked: draftBlocked };
  useEffect(() => registerAppActivity(() => planUpdateActivityReason({ ...updateState.current, pointers: pointers.current.size, dragging: !!drag.current, pending: !!pendingIntent.current })), []);

  useEffect(() => {
    const element = svg.current; if (!element) return;
    const measure = () => { paintTap.current = null; const rect = element.getBoundingClientRect(), scale = Math.min(rect.width / 680, rect.height / 460); if (scale > 0) setScreenUnit(1 / scale); };
    // React's delegated wheel listener is passive: preventDefault there lets the containing panel scroll as well.
    const wheel = (event: WheelEvent) => { event.preventDefault(); event.stopPropagation(); if (pointers.current.size) return; const previous = currentView.current, matrix = element.getScreenCTM(); if (!matrix) return; const frame = { inverse: matrix.inverse(), view: previous }, anchor = planPointerWorld(event, frame), scale = Math.max(4, Math.min(400, previous.scale * Math.exp(-event.deltaY * .001))); setViewport({ scale, cx: anchor.x - (anchor.x - previous.cx) * previous.scale / scale, cz: anchor.z - (anchor.z - previous.cz) * previous.scale / scale }); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element); element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener('wheel', wheel); };
  }, []);

  useEffect(() => { if (previousLevel.current !== activeLevelId && (points.length || pendingIntent.current)) { const archived = { levelId: previousLevel.current, tool, points: structuredClone(points), movement: structuredClone(pendingIntent.current) }; setArchivedDrafts(drafts => [...drafts, archived]); } clearPointers(); previousLevel.current = activeLevelId; setPoints([]); setHover(null); setSelectedPoint(null); setSelectedHole(null); setViewport(null); setPreviewProject(null); drag.current = null; pending.current = null; pendingRoom.current = null; pendingIntent.current = null; drawingBase.current = null; setInterrupted(false); }, [activeLevelId]);
  useEffect(() => { if (readOnly) { if (points.length || pendingIntent.current) setInterrupted(true); drag.current = null; clearPointers(); } }, [readOnly, points.length]);
  useEffect(() => { paintTap.current = null; if (paintActive && !points.length && !pendingIntent.current) { setTool('select'); setSelectedPoint(null); setSelectedHole(null); } }, [paintActive]);
  useEffect(() => { const blur = () => { paintTap.current = null; if (!drag.current) clearPointers(); }; window.addEventListener('blur', blur); return () => window.removeEventListener('blur', blur); }, []);
  useEffect(() => { onDrawingChange?.(points.length > 0); return () => onDrawingChange?.(false); }, [points.length, onDrawingChange]);
  useEffect(() => registerBeforeAppUpdate(async () => {
    if (points.length || uploading || archivedDrafts.length) throw new Error('Termina, recupera o cancela el borrador antes de continuar.');
    if (pendingIntent.current && (draftBlocked || !flushPending())) throw new Error('El movimiento pendiente se conserva. Revísalo antes de continuar.');
  }), [points.length, uploading, onProjectChange, onChange, project, draftBlocked, archivedDrafts]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (points.length || pendingIntent.current || archivedDrafts.length) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [points.length, previewProject, interrupted, archivedDrafts]);

  const fail = (cause: unknown) => setError(cause instanceof Error ? cause.message : 'No se pudo aplicar la construcción.');
  function commit(operation: () => ProjectDocument) { if (draftBlocked) return false; try { const next = operation(); if (onProjectChange(next) === false) return false; setError(''); return true; } catch (cause) { fail(cause); return false; } }
  function world(event: { clientX: number; clientY: number }): Point | null {
    const matrix = svg.current?.getScreenCTM(); if (!matrix) return null;
    // Selection can resize the canvas; keep the world view, but follow its current screen mapping.
    return planPointerWorld(event, { inverse: matrix.inverse(), view: drag.current && dragFrame.current ? dragFrame.current.view : view });
  }
  function snap(raw: Point, previous: Point | null = null, excluded = new Set<string>()) {
    const candidate = snapPlanPoint(previous, raw, { grid: room.editing.snap, step: room.editing.step, angles: previous !== null && angles, angleStep });
    if (!room.editing.snap) return candidate;
    const tolerance = Math.min(.3, 16 * screenUnit / view.scale);
    let nearest = tolerance, result = candidate;
    for (const p of level.points) { if (excluded.has(p.id)) continue; const distance = Math.hypot(raw.x - p.x, raw.z - p.z); if (distance < nearest) { nearest = distance; result = { x: p.x, z: p.z }; } }
    if (nearest < tolerance) return result;
    for (const wall of level.walls) {
      const [a, b] = wallEndpoints(level, wall), dx = b.x - a.x, dz = b.z - a.z, u = Math.max(0, Math.min(1, ((candidate.x - a.x) * dx + (candidate.z - a.z) * dz) / (dx * dx + dz * dz)));
      if (excluded.has(a.id) || excluded.has(b.id)) continue;
      const p = { x: a.x + dx * u, z: a.z + dz * u }, distance = Math.hypot(candidate.x - p.x, candidate.z - p.z);
      if (distance < nearest) { nearest = distance; result = p; }
    }
    return result;
  }
  function discardMovement() { if (pendingIntent.current?.kind === 'item') previewItem(room, pendingIntent.current.selection); pending.current = null; pendingRoom.current = null; pendingIntent.current = null; drag.current = null; dragFrame.current = null; dragPointer.current = null; setPreviewProject(null); }
  function clearPointers() { paintTap.current = null; dragPointer.current = null; for (const id of pointers.current.keys()) if (svg.current?.hasPointerCapture(id)) svg.current.releasePointerCapture(id); pointers.current.clear(); gesture.current = null; down.current = null; }
  function cancel() { discardMovement(); clearPointers(); setPoints([]); setHover(null); setLength(''); setError(''); setTool('select'); drawingBase.current = null; setInterrupted(false); }
  function switchTool(value: Tool) { if (points.length || pendingIntent.current) { setError('Termina o cancela el trazado antes de cambiar de herramienta.'); return; } setTool(value); setSelectedPoint(null); setSelectedHole(null); onSelect(null); setError(''); }
  function finish(values = points) {
    if (draftBlocked) return;
    const minimum = tool === 'wall' ? 2 : 3;
    if (values.length < minimum) { setError('Añade más puntos para terminar el trazado.'); return; }
    const okay = commit(() => {
      if (tool === 'hole') { const surface = containingFloor(project, activeLevelId, values); if (!surface) throw new Error('Dibuja el hueco dentro de una sola zona del piso.'); return addHole(project, activeLevelId, surface.id, values); }
      if (tool !== 'wall') return addRoom(project, activeLevelId, values);
      let next = project; for (let i = 1; i < values.length; i++) next = addWall(next, activeLevelId, values[i - 1], values[i]); return next;
    });
    if (okay) { setPoints([]); setHover(null); setLength(''); drawingBase.current = null; }
  }
  function addPoint(raw: Point) {
    if (draftBlocked) return;
    drawingBase.current ??= project;
    let p = snap(raw, points.at(-1) ?? null);
    if (length && points.length) {
      const distance = parseNumber(length, .05, 50); if (distance === null) { setError('Escribe una longitud entre 0.05 y 50 m.'); return; }
      const previous = points.at(-1)!, angle = Math.atan2(p.z - previous.z, p.x - previous.x);
      p = { x: previous.x + Math.cos(angle) * distance, z: previous.z + Math.sin(angle) * distance };
    }
    if (tool === 'rectangle' && points.length) {
      const a = points[0]; finish([a, { x: p.x, z: a.z }, p, { x: a.x, z: p.z }]); return;
    }
    if (points.length >= 3 && tool !== 'wall' && Math.hypot(p.x - points[0].x, p.z - points[0].z) * view.scale < 18) { finish(); return; }
    if (points.length >= 128) { setError('Termina el trazado antes de añadir más puntos.'); return; }
    if (points.length && Math.hypot(p.x - points.at(-1)!.x, p.z - points.at(-1)!.z) < .05) return;
    setPoints([...points, p]); setError('');
  }
  function previewItem(next: Room, item: Selection) {
    if (!('id' in item) || !item.id) return;
    const node = [...(svg.current?.querySelectorAll<SVGGElement>('[data-plan-item]') ?? [])].find(node => node.dataset.planItem === item.id);
    if (!node) return;
    if (item.kind === 'furniture') {
      const value = next.furniture.find(value => value.id === item.id); if (!value) return;
      const p = screen(value); node.setAttribute('transform', 'translate(' + p.x + ',' + p.y + ') rotate(' + -value.rotation + ')');
    } else if (item.kind === 'light') {
      const value = next.lights.find(value => value.id === item.id); if (value) { const p = screen(value); node.setAttribute('transform', 'translate(' + p.x + ',' + p.y + ')'); }
    } else if (item.kind === 'opening') {
      const value = next.openings.find(value => value.id === item.id); if (!value) return;
      const [a,b] = roomWallEndpoints(next, value.wall), distance = wallLength(next, value.wall);
      const start = screen({ x: a.x + (b.x - a.x) * value.offset / distance, z: a.z + (b.z - a.z) * value.offset / distance }), end = screen({ x: a.x + (b.x - a.x) * (value.offset + value.width) / distance, z: a.z + (b.z - a.z) * (value.offset + value.width) / distance });
      node.setAttribute('transform', 'translate(' + (start.x + end.x) / 2 + ',' + (start.y + end.y) / 2 + ')');
      for (const line of node.querySelectorAll('line')) { line.setAttribute('x1', String((start.x - end.x) / 2)); line.setAttribute('y1', String((start.y - end.y) / 2)); line.setAttribute('x2', String((end.x - start.x) / 2)); line.setAttribute('y2', String((end.y - start.y) / 2)); }
    }
  }
  function capture(event: PointerEvent<SVGElement>, value: Drag) {
    if (readOnly || paintActive || drawing || pendingIntent.current || interrupted || pointers.current.size !== 1 || gesture.current) return;
    const matrix = svg.current?.getScreenCTM(); if (!matrix) return;
    dragFrame.current = { inverse: matrix.inverse(), view: { ...view } };
    event.preventDefault(); event.stopPropagation(); drag.current = value; dragPointer.current = event.pointerId; dragBase.current = project; setViewport(view);
    svg.current?.setPointerCapture(event.pointerId);
  }
  function grabOffset(event: PointerEvent<SVGElement>, point: Point) { const pointer = world(event); return pointer ? { x: point.x - pointer.x, z: point.z - pointer.z } : { x: 0, z: 0 }; }
  function startItem(event: PointerEvent<SVGElement>, item: Selection) {
    if (paintActive || drawing || gesture.current) return; onSelect(item); setSelectedPoint(null); setSelectedHole(null);
    const p = world(event), position = itemWorldPosition(room, item); if (!p || !position) return;
    capture(event, { kind: 'item', selection: item, offset: { x: position.x - p.x, z: position.z - p.z } });
  }
  function startStair(event: PointerEvent<SVGElement>, id: string) {
    if (paintActive || drawing || gesture.current) return;
    const stair = project.stairs.find(stair => stair.id === id); if (!stair) return;
    onSelect({ kind: 'stair', id }); setSelectedPoint(null); setSelectedHole(null);
    capture(event, { kind: 'stair', id, offset: grabOffset(event, stair) });
  }
  function flushPending() {
    const intent = pendingIntent.current;
    if (!intent) return true;
    if (readOnly || !samePlanBase(dragBase.current, project, activeLevelId, intent)) { setInterrupted(true); setError('La base o el acceso cambió. El borrador se conserva para recuperarlo.'); return false; }
    try {
      const next = applyPlanMove(project, activeLevelId, intent);
      if (onProjectChange(next) === false) { setInterrupted(true); return false; }
      pending.current = null; pendingRoom.current = null; pendingIntent.current = null; drag.current = null; setPreviewProject(null); setInterrupted(false); setError(''); return true;
    } catch (cause) { fail(cause); setInterrupted(true); return false; }
  }
  function release() {
    if (pendingIntent.current && !flushPending()) { drag.current = null; dragFrame.current = null; dragPointer.current = null; return; }
    drag.current = null; dragFrame.current = null; dragPointer.current = null;
  }
  async function changeSketch(file: File | null) {
    if (readOnly || !onSketchChange || uploading) return;
    setUploading(true); setError(''); try { await onSketchChange(file); } catch (cause) { fail(cause); } finally { setUploading(false); }
  }
  const chosen = (item: Selection) => selection?.kind === item.kind && ('id' in item ? selection.id === item.id : true);
  function paintTarget(node: EventTarget | null) {
    const element = node instanceof Element ? node.closest<SVGElement>('[data-plan-surface],[data-plan-wall],[data-plan-item],[data-plan-stair],[data-plan-hole]') : null;
    return element && svg.current?.contains(element) ? planPaintTarget(project, activeLevelId, element.dataset, paintWallSide) : null;
  }
  function canPaint() { return !readOnly && !draftBlocked && !points.length && !pendingIntent.current && !uploading && !archivedDrafts.length; }
  const outline = shownLevel.outline.map(id => shownLevel.points.find(p => p.id === id)!);
  return <div className={`plan-editor${large ? ' plan-editor-large' : ''}${paintActive ? ' plan-painting' : ''}`}>
    {(!paintActive || drawing) && <div className="plan-toolbar" role="toolbar" aria-label={t('Herramientas de construcción')}>
      <button type="button" disabled={paintActive} aria-pressed={tool === 'select' && !paintActive} className={tool === 'select' && !paintActive ? 'active' : ''} onClick={() => switchTool('select')}><MousePointer2 size={16} />{t('Seleccionar')}</button>
      <button type="button" disabled={readOnly || paintActive} aria-pressed={tool === 'wall' && !paintActive} className={tool === 'wall' && !paintActive ? 'active' : ''} onClick={() => switchTool('wall')}>{t('Pared')}</button>
      <Popover rootClassName="plan-room-menu" label={t('Habitación')} trigger={t('Habitación')} disabled={paintActive} className="plan-room-options" role="menu">{close => <>{(['rectangle', 'room', 'hole'] as const).map((value, index) => <button key={value} role="menuitem" type="button" disabled={readOnly || paintActive} onClick={() => { switchTool(value); close(); }}>{t(['Rectángulo', 'Trazado libre', 'Hueco'][index])}</button>)}</>}</Popover>
      <button type="button" aria-label={t('Deshacer construcción')} disabled={readOnly || (!points.length && !canUndo)} onClick={() => points.length ? setPoints(points.slice(0, -1)) : onUndo?.()}><Undo2 size={17} /></button>
      <button type="button" aria-label={t('Rehacer construcción')} disabled={readOnly || points.length > 0 || !canRedo} onClick={onRedo}><Redo2 size={17} /></button>
      <button type="button" disabled={readOnly || uploading || !onSketchChange} onClick={() => input.current?.click()}><Upload size={16} />{t('Croquis')}</button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void changeSketch(file); }} />
      {sketchUrl && <button type="button" aria-label={t('Quitar croquis')} disabled={readOnly || uploading} onClick={() => void changeSketch(null)}><ImageOff size={17} /></button>}
      {!hideSurfaceControls && <button type="button" onClick={() => onSelect({ kind: 'floor' })}>{t('Piso')}</button>}
    </div>}
    {drawing && <div className="plan-drawing-controls"><p>{t(tool === 'rectangle' ? 'Toca dos esquinas opuestas.' : tool === 'wall' ? 'Toca el inicio y los extremos de las paredes.' : 'Toca las esquinas y termina el trazado.')}</p><div className="plan-draw-options"><label><input type="checkbox" disabled={draftBlocked} checked={room.editing.snap} onChange={event => onChange({ ...room, editing: { ...room.editing, snap: event.target.checked } })} />{t('Ajustar a cuadrícula')}</label><label><input type="checkbox" disabled={draftBlocked} checked={angles} onChange={event => setAngles(event.target.checked)} />{t('Líneas rectas')}</label><label>{t('Ángulo')}<select disabled={draftBlocked} aria-label={t('Paso angular del trazo')} value={angleStep} onChange={event => setAngleStep(Number(event.target.value))}>{[15, 30, 45, 90].map(value => <option key={value} value={value}>{value}°</option>)}</select></label><label>{t('Longitud')}<input disabled={draftBlocked} aria-label={t('Longitud del siguiente segmento')} inputMode="decimal" value={length} onChange={event => setLength(event.target.value)} placeholder={t('Libre')} /></label></div><div className="plan-toolbar"><button type="button" disabled={draftBlocked || points.length < (tool === 'wall' ? 2 : 3)} onClick={() => finish()}><Check size={17} />{t('Terminar')}</button><button type="button" onClick={cancel}><X size={17} />{t('Cancelar')}</button></div></div>}
    {!drawing && !paintActive && vertex && <div className="plan-point-properties"><span>{t('Esquina')}</span>{(['x', 'z'] as const).map(axis => <label key={axis}>{axis.toUpperCase()}<NumberInput label={t('Coordenada {{axis}} de la esquina', { axis: axis.toUpperCase() })} value={vertex[axis]} min={-50} max={50} onChange={value => commit(() => movePoint(project, activeLevelId, vertex.id, { ...vertex, [axis]: value }))} onInvalid={() => setError('Se conservó la última posición válida.')} onEdit={() => setError('')} /></label>)}</div>}
    {!drawing && !paintActive && selectedWallId && <div className="plan-toolbar"><button type="button" disabled={readOnly} onClick={() => commit(() => splitWall(project, activeLevelId, selectedWallId, .5))}><Scissors size={16} />{t('Dividir pared')}</button><button type="button" disabled={readOnly} onClick={() => { if (commit(() => deleteWall(project, activeLevelId, selectedWallId))) onSelect(null); }}><Trash2 size={16} />{t('Eliminar pared')}</button></div>}
    {!drawing && !paintActive && selectedHole && <button type="button" className="outline-button" disabled={readOnly} onClick={() => { if (commit(() => deleteHole(project, activeLevelId, selectedHole.surfaceId, selectedHole.holeId))) setSelectedHole(null); }}><Trash2 size={16} />{t('Eliminar hueco')}</button>}
    <div className="plan-canvas"><svg ref={svg} viewBox="0 0 680 460" tabIndex={0} role="group" aria-label={t(paintActive ? 'Plano editable; toca superficies y elementos para pintar' : 'Plano editable; selecciona y arrastra objetos o esquinas')} className={drawing ? 'drawing' : ''} style={paintActive ? { cursor: 'crosshair' } : undefined} onPointerDownCapture={event => {
      if (event.pointerType === 'mouse' && event.button !== 0) { if (paintActive) event.stopPropagation(); return; }
      svg.current?.focus({ preventScroll: true }); down.current = { x: event.clientX, y: event.clientY }; pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      svg.current?.setPointerCapture(event.pointerId);
      if (pointers.current.size >= 2) {
        event.stopPropagation(); down.current = null; paintTap.current = null;
        if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()], matrix = svg.current?.getScreenCTM(); if (matrix) { if (drag.current) discardMovement(); gesture.current = { first: { clientX: a.x, clientY: a.y }, second: { clientX: b.x, clientY: b.y }, frame: { inverse: matrix.inverse(), view: { ...view } } }; } }
      }
      if (paintActive) {
        event.stopPropagation();
        const target = paintTarget(event.target);
        paintTap.current = !gesture.current && pointers.current.size === 1 && event.isPrimary && event.button === 0 && canPaint() && target ? { pointerId: event.pointerId, origin: { x: event.clientX, y: event.clientY }, target } : null;
      }
    }} onPointerMove={event => {
      if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (gesture.current) { if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; setViewport(planGestureView({ clientX: a.x, clientY: a.y }, { clientX: b.x, clientY: b.y }, gesture.current)); } return; }
      if (paintActive) { if (paintTap.current && Math.hypot(event.clientX - paintTap.current.origin.x, event.clientY - paintTap.current.origin.y) >= 10) paintTap.current = null; return; }
      const p = world(event); if (!p) return;
      if (drawing) { if (!draftBlocked) setHover(snap(p, points.at(-1) ?? null)); return; }
      if (draftBlocked || !drag.current) return;
      try {
        const active = drag.current, base = dragBase.current;
        if (active.kind === 'item') { const intent: PlanMoveIntent = { kind: 'item', selection: active.selection, position: { x: p.x + active.offset.x, z: p.z + active.offset.z } }; if (!samePlanBase(base, project, activeLevelId, intent)) { setInterrupted(true); setError('La base o el acceso cambió. El borrador se conserva para recuperarlo.'); return; } const next = moveSceneItem(room, active.selection, intent.position); pendingIntent.current = intent; pendingRoom.current = next; previewItem(next, active.selection); return; }
        let intent: PlanMoveIntent;
        if (active.kind === 'point') intent = { kind: 'point', id: active.id, position: snap({ x: p.x + active.offset.x, z: p.z + active.offset.z }, null, new Set([active.id])) };
        else if (active.kind === 'wall') { const source = projectLevel(base, activeLevelId), endpoints = wallEndpoints(source, source.walls.find(wall => wall.id === active.id)!); const target = snap(planGrabPosition(active.anchor, active.origin, p), null, new Set(endpoints.map(point => point.id))); intent = { kind: 'wall', id: active.id, delta: { x: target.x - active.anchor.x, z: target.z - active.anchor.z } }; }
        else if (active.kind === 'stair') intent = { kind: 'stair', id: active.id, position: snap({ x: p.x + active.offset.x, z: p.z + active.offset.z }) };
        else intent = { kind: 'hole', surfaceId: active.surfaceId, holeId: active.holeId, vertices: projectLevel(base, activeLevelId).surfaces.find(s => s.id === active.surfaceId)!.holes.find(h => h.id === active.holeId)!.vertices.map((vertex, index) => index === active.index ? snap({ x: p.x + active.offset.x, z: p.z + active.offset.z }) : vertex) };
        if (!samePlanBase(base, project, activeLevelId, intent)) { setInterrupted(true); return; }
        if (active.kind === 'stair') pendingIntent.current = intent;
        const next = applyPlanMove(base, activeLevelId, intent); pendingIntent.current = intent;
        pending.current = next; setPreviewProject(next); setError('');
      } catch (cause) { fail(cause); }
    }} onPointerUp={event => {
      const wasGesture = !!gesture.current; pointers.current.delete(event.pointerId);
      if (wasGesture) { if (!pointers.current.size) gesture.current = null; down.current = null; return; }
      if (paintActive) {
        const tap = paintTap.current; paintTap.current = null; down.current = null;
        if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId);
        const target = paintTarget(document.elementFromPoint(event.clientX, event.clientY));
        if (tap?.pointerId === event.pointerId && event.isPrimary && canPaint() && Math.hypot(event.clientX - tap.origin.x, event.clientY - tap.origin.y) < 10 && JSON.stringify(target) === JSON.stringify(tap.target)) onPaint?.(tap.target);
        return;
      }
      if (drawing && !draftBlocked && down.current && Math.hypot(event.clientX - down.current.x, event.clientY - down.current.y) < 12) { const p = world(event); if (p) addPoint(p); }
      release(); down.current = null; if (svg.current?.hasPointerCapture(event.pointerId)) svg.current.releasePointerCapture(event.pointerId);
    }} onPointerCancel={event => { paintTap.current = null; pointers.current.delete(event.pointerId); if (pendingIntent.current) setInterrupted(true); drag.current = null; dragPointer.current = null; dragFrame.current = null; down.current = null; if (!pointers.current.size) gesture.current = null; }} onLostPointerCapture={event => { if (paintActive || paintTap.current?.pointerId === event.pointerId) { paintTap.current = null; down.current = null; pointers.current.delete(event.pointerId); if (!pointers.current.size) gesture.current = null; } if (dragPointer.current === event.pointerId) { if (pendingIntent.current) setInterrupted(true); drag.current = null; dragPointer.current = null; dragFrame.current = null; down.current = null; pointers.current.delete(event.pointerId); } }} onKeyDownCapture={event => {
      if (!paintActive) return;
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); const target = paintTarget(event.target); if (target && canPaint() && !pointers.current.size && !event.repeat) onPaint?.(target); }
      else if (event.key.startsWith('Arrow')) event.stopPropagation();
    }} onKeyDown={event => {
      if (readOnly) return;
      if (event.key === 'Escape') { event.preventDefault(); cancel(); }
      else if (event.key === 'Enter' && drawing) { event.preventDefault(); finish(); }
      else if (event.key === 'Backspace' && points.length) { event.preventDefault(); setPoints(points.slice(0, -1)); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) onRedo?.(); else onUndo?.(); }
    }}>
      <defs><pattern id={large ? 'building-grid-large' : 'building-grid'} x={340 - view.cx * view.scale} y={230 - view.cz * view.scale} width={room.editing.step * view.scale} height={room.editing.step * view.scale} patternUnits="userSpaceOnUse"><path d={`M ${room.editing.step * view.scale} 0 L 0 0 0 ${room.editing.step * view.scale}`} fill="none" stroke="#69736c" strokeOpacity=".15" /></pattern></defs>
      <rect width="680" height="460" fill="#e8ede7" /><rect width="680" height="460" fill={`url(#${large ? 'building-grid-large' : 'building-grid'})`} />
      {sketchUrl && <image href={sketchUrl} x="35" y="25" width="610" height="400" preserveAspectRatio="xMidYMid meet" opacity=".5" onError={() => setError('No se pudo cargar el croquis guardado.')} />}
      <g style={{ pointerEvents: drawing ? 'none' : undefined }}>
        <polygon points={linePoints(outline)} fill="#fffdfa" fillOpacity={sketchUrl ? .5 : .9} pointerEvents="none" />
        {floorRegions.map(({ surface, outline, holes }, index) => <path key={surface.id} data-plan-surface={surface.id} d={[ringPath(outline), ...holes.map(ringPath)].join(' ')} fill={surface.finish.color} fillOpacity={sketchUrl ? .5 : .9} fillRule="evenodd" stroke={selection?.kind === 'floor' && selection.id === surface.id ? '#315e44' : '#c3cdbd'} strokeWidth={selection?.kind === 'floor' && selection.id === surface.id ? 2 : 1} role="button" tabIndex={0} aria-label={t('Zona del piso {{number}}', { number: index + 1 })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect({ kind: 'floor', id: surface.id }); setSelectedPoint(null); setSelectedHole(null); } }} onPointerDown={event => { if (drawing) return; event.stopPropagation(); onSelect({ kind: 'floor', id: surface.id }); setSelectedPoint(null); setSelectedHole(null); }} />)}
        {visibleHoles.map(({ surfaceId, hole, polygons }, holeIndex) => <g key={hole.id} data-plan-hole={hole.id} role="button" tabIndex={0} aria-label={t('Hueco {{number}}', { number: holeIndex + 1 })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedHole({ surfaceId, holeId: hole.id }); onSelect(null); } }} onPointerDown={event => { event.stopPropagation(); setSelectedHole({ surfaceId, holeId: hole.id }); onSelect(null); }}>{polygons.map((rings, index) => <path key={"hit-" + index} d={rings.map(ringPath).join(' ')} fill="transparent" stroke="transparent" strokeWidth="44" vectorEffect="non-scaling-stroke" />)}{polygons.map((rings, index) => <path key={index} d={rings.map(ringPath).join(' ')} fill="#d5ded3" fillRule="evenodd" stroke={selectedHole?.holeId === hole.id ? '#315e44' : '#879984'} strokeWidth="2" strokeDasharray="5 3" />)}{selectedHole?.holeId === hole.id && hole.vertices.map((p, index) => { const a = screen(p); return <circle key={index} cx={a.x} cy={a.y} r={22 * screenUnit} fill="transparent" stroke="#315e44" strokeWidth="1" onPointerDown={event => capture(event, { kind: 'hole', surfaceId, holeId: hole.id, index, offset: grabOffset(event, p) })} />; })}</g>)}
        {shownLevel.walls.map((wall, index) => { const [a, b] = wallEndpoints(shownLevel, wall), start = screen(a), end = screen(b), active = selectedWallId === wall.id; return <g key={wall.id} data-plan-wall={wall.id} role="button" tabIndex={0} aria-label={t('Pared {{number}}', { number: index + 1 })} onKeyDown={event => { if (event.key === 'Enter') onSelect({ kind: 'wall', index, id: wall.id }); }} onPointerDown={event => { onSelect({ kind: 'wall', index, id: wall.id }); setSelectedPoint(null); setSelectedHole(null); const origin = world(event); if (origin) capture(event, { kind: 'wall', id: wall.id, origin, anchor: { x: a.x, z: a.z } }); }}><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="transparent" strokeWidth="44" vectorEffect="non-scaling-stroke" /><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={active ? '#315e44' : '#879584'} strokeWidth={paintActive ? 10 : active ? 8 : 5} />{paintActive && <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={wall[paintWallSide].color} strokeWidth={6} pointerEvents="none" />}<text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 9} textAnchor="middle" className="plan-dimension">{Math.hypot(b.x - a.x, b.z - a.z).toFixed(2)} m</text></g>; })}
        {room.openings.map(item => { const [a, b] = roomWallEndpoints(room, item.wall), distance = wallLength(room, item.wall); const start = screen({ x: a.x + (b.x - a.x) * item.offset / distance, z: a.z + (b.z - a.z) * item.offset / distance }), end = screen({ x: a.x + (b.x - a.x) * (item.offset + item.width) / distance, z: a.z + (b.z - a.z) * (item.offset + item.width) / distance }); return <g key={item.id} data-plan-item={item.id} transform={`translate(${(start.x + end.x) / 2},${(start.y + end.y) / 2})`} role="button" tabIndex={0} aria-label={t(item.type === 'door' ? 'Puerta' : 'Ventana')} onPointerDown={event => startItem(event, { kind: 'opening', id: item.id })} onKeyDown={event => { if (event.key === 'Enter') onSelect({ kind: 'opening', id: item.id }); }}><line x1={(start.x - end.x) / 2} y1={(start.y - end.y) / 2} x2={(end.x - start.x) / 2} y2={(end.y - start.y) / 2} stroke="transparent" strokeWidth="44" vectorEffect="non-scaling-stroke" /><line x1={(start.x - end.x) / 2} y1={(start.y - end.y) / 2} x2={(end.x - start.x) / 2} y2={(end.y - start.y) / 2} stroke="#fffdfa" strokeWidth="12" /><line x1={(start.x - end.x) / 2} y1={(start.y - end.y) / 2} x2={(end.x - start.x) / 2} y2={(end.y - start.y) / 2} stroke={item.color ?? (item.type === 'door' ? '#a47750' : '#75a8bf')} strokeWidth="5" /></g>; })}
        {room.furniture.map(item => { const p = screen(item), itemSelection: Selection = { kind: 'furniture', id: item.id }; return <g key={item.id} data-plan-item={item.id} transform={`translate(${p.x},${p.y}) rotate(${-item.rotation})`} role="button" tabIndex={0} aria-label={t(FURNITURE_LABELS[item.type])} onPointerDown={event => startItem(event, itemSelection)} onKeyDown={event => { if (event.key === 'Enter') onSelect(itemSelection); }}><rect x={-Math.max(item.width * view.scale, 44 * screenUnit) / 2} y={-Math.max(item.depth * view.scale, 44 * screenUnit) / 2} width={Math.max(item.width * view.scale, 44 * screenUnit)} height={Math.max(item.depth * view.scale, 44 * screenUnit)} fill="transparent" /><rect x={-item.width * view.scale / 2} y={-item.depth * view.scale / 2} width={item.width * view.scale} height={item.depth * view.scale} rx="3" fill={invalid.has(item.id) ? '#ed404050' : chosen(itemSelection) && !paintActive ? '#dce8ce' : item.color ?? '#ece3d4'} stroke={invalid.has(item.id) ? '#d63f3f' : '#879584'} strokeWidth="2" /><text textAnchor="middle" className="plan-furniture-label" pointerEvents="none">{t(FURNITURE_LABELS[item.type])}</text></g>; })}
        {room.lights.map(light => { const p = screen(light); return <g key={light.id} data-plan-item={light.id} transform={`translate(${p.x},${p.y})`} role="button" tabIndex={0} aria-label={light.name} onPointerDown={event => startItem(event, { kind: 'light', id: light.id })} onKeyDown={event => { if (event.key === 'Enter') onSelect({ kind: 'light', id: light.id }); }}><circle cx="0" cy="0" r={22 * screenUnit} fill="transparent" /><circle cx="0" cy="0" r="10" fill={light.color ?? (light.enabled ? '#f9dc7d' : '#aeb5a9')} stroke="white" strokeWidth="3" /></g>; })}
        {(previewProject ?? project).stairs.filter(stair => stair.fromLevelId === activeLevelId || stair.toLevelId === activeLevelId).map((stair, index) => { const geometry = buildStairGeometry(previewProject ?? project, stair), active = selection?.kind === 'stair' && selection.id === stair.id; return <g key={stair.id} data-plan-stair={stair.id} role="button" tabIndex={0} aria-label={t('Escalera {{number}}', { number: index + 1 })} onPointerDown={event => startStair(event, stair.id)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect({ kind: 'stair', id: stair.id }); } }}>{geometry.surfaces.map(surface => <polygon key={"hit-" + surface.id} points={linePoints(surface.vertices)} fill="transparent" stroke="transparent" strokeWidth="44" vectorEffect="non-scaling-stroke" />)}{geometry.surfaces.map(surface => <polygon key={surface.id} points={linePoints(surface.vertices)} fill={paintActive ? stair.finish.color : active ? '#6f916b88' : '#a8b7a05c'} stroke={active ? '#315e44' : '#617855'} strokeWidth="1" />)}<polyline points={linePoints(geometry.path)} fill="none" stroke="#617855" strokeWidth="2" strokeDasharray="4 3" /></g>; })}
        {shownLevel.points.map((point, index) => { const p = screen(point); return <g key={point.id}><circle cx={p.x} cy={p.y} r={22 * screenUnit} fill="transparent" pointerEvents={paintActive ? 'none' : undefined} role="button" tabIndex={readOnly || paintActive ? -1 : 0} aria-label={t('Esquina {{number}}; flechas para mover', { number: index + 1 })} onPointerDown={event => { setSelectedPoint(point.id); onSelect(null); setSelectedHole(null); capture(event, { kind: 'point', id: point.id, origin: point, offset: grabOffset(event, point) }); }} onKeyDown={event => { const directions: Record<string, Point> = { ArrowLeft: { x: -.1, z: 0 }, ArrowRight: { x: .1, z: 0 }, ArrowUp: { x: 0, z: -.1 }, ArrowDown: { x: 0, z: .1 } }; const delta = directions[event.key]; if (delta) { event.preventDefault(); commit(() => movePoint(project, activeLevelId, point.id, { x: point.x + delta.x, z: point.z + delta.z })); } }} /><circle cx={p.x} cy={p.y} r={selectedPoint === point.id ? 7 : 4} fill="#fffdfa" stroke="#315e44" strokeWidth="2" pointerEvents="none" /></g>; })}
      </g>
      {points.length > 0 && <g pointerEvents="none"><polyline points={linePoints(points)} stroke="#315e44" strokeWidth="4" fill="none" />{points.map((p, index) => <circle key={index} cx={screen(p).x} cy={screen(p).y} r="6" fill="#315e44" stroke="white" strokeWidth="2" />)}{hover && (tool === 'rectangle' ? <rect x={Math.min(screen(points[0]).x, screen(hover).x)} y={Math.min(screen(points[0]).y, screen(hover).y)} width={Math.abs(hover.x - points[0].x) * view.scale} height={Math.abs(hover.z - points[0].z) * view.scale} fill="#315e4420" stroke="#315e44" strokeDasharray="5 3" /> : <line x1={screen(points.at(-1)!).x} y1={screen(points.at(-1)!).y} x2={screen(hover).x} y2={screen(hover).y} stroke="#315e44" strokeWidth="2" strokeDasharray="5 3" />)}</g>}
      <text x="25" y="438" className="plan-scale">{t('Cuadrícula: {{step}} m', { step: room.editing.step })}</text>
    </svg><div className="plan-zoom"><button type="button" aria-label={t('Alejar plano')} onClick={() => setViewport({ ...view, scale: Math.max(4, view.scale / 1.25) })}><Minus size={18} /></button><button type="button" aria-label={t('Centrar plano')} onClick={() => setViewport(null)}><Maximize2 size={18} /></button><button type="button" aria-label={t('Acercar plano')} onClick={() => setViewport({ ...view, scale: Math.min(400, view.scale * 1.25) })}><Plus size={18} /></button></div></div>
    <div className="plan-footer"><span>{t(paintActive ? 'Toca una superficie o un elemento para pintarlo. Usa dos dedos para desplazar y acercar.' : drawing ? 'Lo construido permanece visible mientras dibujas.' : 'Arrastra esquinas o paredes. Usa dos dedos para desplazar y acercar.')}</span></div>
    {(interrupted || baseChanged) && <section className="plan-draft-recovery" aria-label={t('Borrador de construcción')}><p role="status">{t(readOnly ? 'El acceso cambió. Tu borrador sigue aquí; puedes copiarlo o esperar para continuar.' : baseChanged ? 'La construcción cambió. Conservamos el borrador para que puedas recuperarlo sin reemplazar cambios ajenos.' : 'Tu borrador se conserva. Puedes reanudarlo o cancelarlo.')}</p><button type="button" disabled={readOnly || baseChanged} onClick={() => { if (pendingIntent.current) flushPending(); else { setInterrupted(false); setError(''); } }}>{t(pendingIntent.current ? 'Aplicar movimiento pendiente' : 'Reanudar trazado')}</button><button type="button" onClick={cancel}>{t('Cancelar borrador')}</button><details><summary>{t('Recuperar borrador')}</summary><textarea aria-label={t('Datos del borrador de construcción')} readOnly value={JSON.stringify({ levelId: activeLevelId, tool, points, movement: pendingIntent.current }, null, 2)} onFocus={event => event.currentTarget.select()} /></details></section>}
    {archivedDrafts.length > 0 && <section className="plan-draft-recovery" aria-label={t('Borradores de otros niveles')}><p role="status">{t('El nivel cambió. Conservamos sus trazos pendientes para que puedas copiarlos.')}</p><textarea aria-label={t('Datos de borradores de otros niveles')} readOnly value={JSON.stringify(archivedDrafts, null, 2)} onFocus={event => event.currentTarget.select()} /><button type="button" onClick={() => setArchivedDrafts([])}>{t('Descartar borradores recuperados')}</button></section>}
    {error && <p className="plan-error" role="alert">{t(error)}</p>}
  </div>;
}
