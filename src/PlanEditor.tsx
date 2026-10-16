import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Check, ImageOff, Pencil, Undo2, Upload, X } from 'lucide-react';
import { bounds, FURNITURE_LABELS, fitRoom, furnitureCorners, invalidFurnitureIds, itemWorldPosition, moveSceneItem, pointInPolygon, polygonArea, snapPlanPoint, wallLength } from './model';
import type { Point, Room, Selection } from './types';
import { parseNumber } from './fieldDraft';
import './plan.css';
import { t, useLocale } from './i18n';
import { registerBeforeAppUpdate } from './appOffline';

type Props = {
  room: Room;
  onChange: (room: Room) => void;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  large?: boolean;
  sketchUrl?: string | null;
  onSketchChange?: (file: File | null) => Promise<void>;
  onDrawingChange?: (drawing: boolean) => void;
  hideSurfaceControls?: boolean;
  readOnly?: boolean;
};
type Viewport = { scale: number; cx: number; cz: number };
type Drag = { kind: 'vertex'; index: number } | { kind: 'item'; selection: Selection; offset: Point } | { kind: 'rotate'; id: string; angle: number; rotation: number };

export default function PlanEditor({ room, onChange, selection: selected, onSelect, large = false, sketchUrl = null, onSketchChange, onDrawingChange, hideSurfaceControls = false, readOnly = false }: Props) {
  useLocale();
  const svg = useRef<SVGSVGElement>(null), input = useRef<HTMLInputElement>(null), drag = useRef<Drag | null>(null);
  const [uploading, setUploading] = useState(false), [drawing, setDrawing] = useState(false);
  const [points, setPoints] = useState<Point[]>([]), [hover, setHover] = useState<Point | null>(null);
  const [grid, setGrid] = useState(room.editing.snap), [angles, setAngles] = useState(true), [angleStep, setAngleStep] = useState(15);
  const [referenceWidth, setReferenceWidth] = useState('5'), [cornerX, setCornerX] = useState('0'), [cornerZ, setCornerZ] = useState('0');
  const [error, setError] = useState(''), [fixedView, setFixedView] = useState<Viewport | null>(null);
  useEffect(() => registerBeforeAppUpdate(async () => {
    if (drawing && points.length || uploading) throw new Error("Termina el croquis antes de cambiar de modo o actualizar.");
  }), [drawing, points.length, uploading]);
  useEffect(() => {
    if (!drawing || !points.length) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [drawing, points.length]);
  const box = bounds(room.vertices);
  const visibleBox = bounds([...room.vertices, ...room.furniture.flatMap(furnitureCorners), ...room.lights]);
  const invalidFurniture = useMemo(() => invalidFurnitureIds(room), [room]);
  const visibleFurniture = selected?.kind === 'furniture' ? [...room.furniture.filter(item => item.id !== selected.id), ...room.furniture.filter(item => item.id === selected.id)] : room.furniture;
  const view = fixedView ?? { scale: Math.min(540 / visibleBox.width, 330 / visibleBox.depth), cx: (visibleBox.minX + visibleBox.maxX) / 2, cz: (visibleBox.minZ + visibleBox.maxZ) / 2 };
  const project = (p: Point) => ({ x: 340 + (p.x - view.cx) * view.scale, y: 230 + (p.z - view.cz) * view.scale });
  const activeFurniture = selected?.kind === 'furniture' ? room.furniture.find(item => item.id === selected.id) : null;
  const activeFurniturePoint = activeFurniture ? project(activeFurniture) : null;
  const furnitureHandleY = activeFurniture ? -activeFurniture.depth * view.scale / 2 : 0;
  const polygon = (drawing ? points : room.vertices).map(p => { const s = project(p); return `${s.x},${s.y}`; }).join(' ');
  const isSelected = (item: Selection) => selected?.kind === item.kind && ('id' in item ? 'id' in selected && selected.id === item.id : item.kind === 'wall' ? selected.kind === 'wall' && selected.index === item.index : true);

  function select(item: Selection) {
    onSelect(item);
  }
  function cancelDrawing() { setDrawing(false); setPoints([]); setHover(null); setFixedView(null); setError(''); }
  function releaseDrag() { drag.current = null; if (!drawing) setFixedView(null); }
  useEffect(() => { if (readOnly) { drag.current = null; setDrawing(false); setPoints([]); setHover(null); setFixedView(null); } }, [readOnly]);
  useEffect(() => {
    onDrawingChange?.(drawing);
    return () => onDrawingChange?.(false);
  }, [drawing, onDrawingChange]);

  async function changeSketch(file: File | null) {
    if (readOnly || !onSketchChange || uploading) return;
    setUploading(true); setError('');
    try { await onSketchChange(file); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el croquis."); }
    finally { setUploading(false); }
  }
  function eventPoint(event: PointerEvent<SVGElement>): Point | null {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: (point.x - 340) / view.scale + view.cx, z: (point.y - 230) / view.scale + view.cz };
  }
  function moveItem(item: Selection, target: Point & { y?: number; rotation?: number }) {
    if (readOnly) return;
    try { const next = moveSceneItem(room, item, target); if (next !== room) onChange(next); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo mover este objeto."); }
  }
  function moveVertex(index: number, point: Point) {
    if (readOnly) return;
    try {
      const snapped = snapPlanPoint(null, point, { grid: room.editing.snap, step: room.editing.step, angles: false });
      onChange(fitRoom({ ...room, vertices: room.vertices.map((p, i) => i === index ? snapped : p) })); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo mover esta esquina."); }
  }
  function capture(event: PointerEvent<SVGElement>) { setFixedView(view); svg.current?.setPointerCapture(event.pointerId); }
  function startItem(event: PointerEvent<SVGElement>, item: Selection) {
    event.stopPropagation(); select(item);
    if (readOnly || drawing) return;
    event.preventDefault();
    const pointer = eventPoint(event), position = itemWorldPosition(room, item);
    if (!pointer || !position) return;
    drag.current = { kind: 'item', selection: item, offset: { x: position.x - pointer.x, z: position.z - pointer.z } }; capture(event);
  }
  function itemKeys(event: KeyboardEvent<SVGElement>, item: Selection) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); select(item); return; }
    if (readOnly) return;
    const position = itemWorldPosition(room, item);
    if (!position) return;
    const step = room.editing.snap ? room.editing.step : 0.05;
    const direction: Record<string, { x?: number; y?: number; z?: number }> = { ArrowLeft: { x: -step }, ArrowRight: { x: step }, ArrowUp: { z: -step }, ArrowDown: { z: step }, PageUp: { y: step }, PageDown: { y: -step } };
    if (direction[event.key]) { event.preventDefault(); event.stopPropagation(); moveItem(item, { x: position.x + (direction[event.key].x ?? 0), z: position.z + (direction[event.key].z ?? 0), ...(direction[event.key].y === undefined ? {} : { y: position.y + direction[event.key].y! }) }); }
  }
  function addCorner(raw: Point) {
    if (readOnly) return;
    try {
      if (points.length >= 24) throw new Error("La planta admite hasta 24 esquinas.");
      const point = snapPlanPoint(points.at(-1) ?? null, raw, { grid, step: room.editing.step, angles, angleStep });
      if (points.length && Math.hypot(point.x - points.at(-1)!.x, point.z - points.at(-1)!.z) < 0.05) throw new Error("Marca una esquina distinta de la anterior.");
      setPoints([...points, point]); setHover(null); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo añadir esta esquina."); }
  }
  function finishDrawing() {
    if (readOnly) return;
    try {
      if (points.length < 3) throw new Error("Marca al menos tres esquinas para cerrar la planta.");
      const width = parseNumber(referenceWidth, 0.5, 50), draft = bounds(points);
      if (width === null || draft.width < 0.01) throw new Error("El ancho trazado debe medir entre 0.5 y 50 m.");
      const scale = width / draft.width;
      const vertices = points.map(p => ({ x: (p.x - (draft.minX + draft.maxX) / 2) * scale, z: (p.z - (draft.minZ + draft.maxZ) / 2) * scale }));
      let candidate = fitRoom({ ...room, vertices, openings: [], wallColors: vertices.map((_, i) => room.wallColors[i] ?? '#eee9df') });
      for (const opening of room.openings) {
        const position = itemWorldPosition(room, { kind: 'opening', id: opening.id })!;
        candidate = moveSceneItem({ ...candidate, openings: [...candidate.openings, { ...opening, wall: 0, offset: 0 }] }, { kind: 'opening', id: opening.id }, position);
      }
      onChange(candidate); select({ kind: 'wall', index: 0 }); cancelDrawing();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo aplicar la planta; se conserva el cuarto actual."); }
  }

  return <div className={`plan-editor${large ? ' plan-editor-large' : ''}${readOnly ? ' plan-readonly' : ''}`}>
    <div className="plan-toolbar">
      <button type="button" onClick={() => input.current?.click()} disabled={readOnly || uploading || !onSketchChange}><Upload size={15} />{uploading ? t("Guardando…") : t("Croquis")}</button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { setError("Usa una imagen PNG, JPG o WebP de hasta 10 MB."); return; } void changeSketch(file); }} />
      <button type="button" className={drawing ? 'active' : ''} disabled={readOnly} onClick={() => { if (drawing) cancelDrawing(); else { onSelect(null); setDrawing(true); setPoints([]); setHover(null); setError(''); setFixedView(view); setReferenceWidth(box.width.toFixed(2)); setGrid(room.editing.snap); } }}><Pencil size={15} />{drawing ? t("Cancelar") : t("Dibujar planta")}</button>
      {sketchUrl && <button type="button" className="plan-icon-button" disabled={readOnly || uploading || !onSketchChange} onClick={() => void changeSketch(null)} aria-label={t("Quitar croquis")}><ImageOff size={15} /></button>}
      {!drawing && !hideSurfaceControls && <><button type="button" className={selected?.kind === 'floor' ? 'active' : ''} onClick={() => select({ kind: 'floor' })}>{t("Piso")}</button><button type="button" className={selected?.kind === 'ceiling' ? 'active' : ''} onClick={() => select({ kind: 'ceiling' })}>{t("Techo")}</button></>}
    </div>
    {drawing && <div className="plan-drawing-controls">
      <p title={t("Enter cierra · Retroceso deshace · Escape cancela")}>{t("Toca las esquinas y vuelve a la primera para cerrar.")}</p>
      <div className="plan-draw-options"><label><input type="checkbox" checked={grid} onChange={event => setGrid(event.target.checked)} />{t("Ajustar a cuadrícula")}</label><label><input type="checkbox" checked={angles} onChange={event => setAngles(event.target.checked)} />{t("Líneas rectas")}</label><label>{t("Ángulo")}<select aria-label={t("Paso angular del trazo")} value={angleStep} onChange={event => setAngleStep(Number(event.target.value))}>{[15, 30, 45, 90].map(value => <option key={value} value={value}>{value}°</option>)}</select></label></div>
      <label>{t("Ancho total trazado")}<span><input aria-label={t("Ancho total de la planta en metros")} type="text" inputMode="decimal" value={referenceWidth} onChange={event => setReferenceWidth(event.target.value)} />m</span></label>
      <details className="plan-coordinates"><summary>{t("Coordenadas")}</summary><div className="plan-toolbar"><label>X<input aria-label={t("Coordenada X de nueva esquina")} type="text" inputMode="decimal" value={cornerX} onChange={event => setCornerX(event.target.value)} /></label><label>Z<input aria-label={t("Coordenada Z de nueva esquina")} type="text" inputMode="decimal" value={cornerZ} onChange={event => setCornerZ(event.target.value)} /></label><button type="button" onClick={() => addCorner({ x: parseNumber(cornerX, -50, 50) ?? NaN, z: parseNumber(cornerZ, -50, 50) ?? NaN })}>{t("Añadir esquina")}</button></div></details>
      <div className="plan-toolbar"><button type="button" onClick={() => { setPoints(points.slice(0, -1)); setHover(null); }} disabled={!points.length}><Undo2 size={14} />{t("Deshacer")}</button><button type="button" onClick={finishDrawing} disabled={points.length < 3}><Check size={14} />{t("Cerrar planta")}</button><button type="button" className="plan-icon-button" aria-label={t("Cancelar planta")} onClick={cancelDrawing}><X size={14} /></button></div>
    </div>}
    <div className="plan-canvas">
      <svg ref={svg} viewBox="0 0 680 460" role="group" tabIndex={0} aria-label={t("Plano editable; selecciona y arrastra objetos o esquinas")} className={drawing ? 'drawing' : ''} onPointerDown={event => {
        if (!drawing || readOnly) return; svg.current?.focus(); const point = eventPoint(event); if (!point) return;
        if (points.length >= 3 && Math.hypot(point.x - points[0].x, point.z - points[0].z) * view.scale < 12) finishDrawing(); else addCorner(point);
      }} onPointerMove={event => {
        if (readOnly) return; const point = eventPoint(event); if (!point) return;
        if (drawing) { try { setHover(snapPlanPoint(points.at(-1) ?? null, point, { grid, step: room.editing.step, angles, angleStep })); } catch { setHover(null); } return; }
        const active = drag.current;
        if (active?.kind === 'vertex') moveVertex(active.index, point);
        else if (active?.kind === 'item') moveItem(active.selection, { x: point.x + active.offset.x, z: point.z + active.offset.z });
        else if (active?.kind === 'rotate') {
          const item = room.furniture.find(p => p.id === active.id); if (!item) return;
          const angle = Math.atan2(-(point.z - item.z), point.x - item.x), delta = Math.atan2(Math.sin(angle - active.angle), Math.cos(angle - active.angle)) * 180 / Math.PI;
          const rotation = active.rotation + delta;
          moveItem({ kind: 'furniture', id: item.id }, { ...item, rotation: room.editing.snap ? Math.round(rotation / 15) * 15 : rotation });
        }
      }} onPointerUp={releaseDrag} onPointerCancel={releaseDrag} onLostPointerCapture={releaseDrag} onPointerLeave={() => { if (!drag.current) setHover(null); }} onKeyDown={event => {
        if (!drawing || readOnly) return;
        if (event.key === 'Enter') { event.preventDefault(); finishDrawing(); }
        else if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); setPoints(points.slice(0, -1)); setHover(null); }
        else if (event.key === 'Escape') { event.preventDefault(); cancelDrawing(); }
      }}>
        <defs><pattern id={large ? 'plan-grid-large' : 'plan-grid-small'} x={340 - view.cx * view.scale} y={230 - view.cz * view.scale} width={room.editing.step * view.scale} height={room.editing.step * view.scale} patternUnits="userSpaceOnUse"><path d={`M ${room.editing.step * view.scale} 0 L 0 0 0 ${room.editing.step * view.scale}`} fill="none" stroke="#69736c" strokeOpacity=".14" strokeWidth="1" /></pattern></defs>
        <rect width="680" height="460" fill="#e8ede7" /><rect width="680" height="460" fill={`url(#${large ? 'plan-grid-large' : 'plan-grid-small'})`} />
        {sketchUrl && <image href={sketchUrl} x="35" y="25" width="610" height="400" preserveAspectRatio="xMidYMid meet" opacity=".55" onError={() => setError("No se pudo cargar el croquis guardado.")} />}
        {drawing ? <>
          {points.length > 1 && <polyline points={polygon} fill="none" stroke="#37634b" strokeWidth="4" />}
          {hover && points.length > 0 && <line x1={project(points.at(-1)!).x} y1={project(points.at(-1)!).y} x2={project(hover).x} y2={project(hover).y} stroke="#37634b" strokeWidth="2" strokeDasharray="5 4" />}
          {points.map((p, i) => <g key={i}><circle cx={project(p).x} cy={project(p).y} r={i === 0 && points.length > 2 ? 9 : 6} fill="#37634b" stroke="white" strokeWidth="2" onPointerDown={event => { if (i === 0 && points.length > 2) { event.stopPropagation(); finishDrawing(); } }} /><text x={project(p).x + 11} y={project(p).y - 10} className="plan-point-label">{i + 1}</text></g>)}
          {!points.length && <text x="340" y="230" textAnchor="middle" className="plan-instruction">{t("Toca la primera esquina para comenzar")}</text>}
        </> : <>
          <polygon points={polygon} fill={selected?.kind === 'floor' ? '#e6eddd' : '#fffdfa'} fillOpacity={sketchUrl ? '.65' : '1'} stroke="#89958b" strokeWidth="1" onClick={() => select({ kind: 'floor' })} />
          {room.vertices.map((p, i) => {
            const next = room.vertices[(i + 1) % room.vertices.length], a = project(p), b = project(next), active = isSelected({ kind: 'wall', index: i });
            return <g key={i} role="button" aria-label={t('Pared {{number}}, {{length}} metros', { number: i + 1, length: wallLength(room, i).toFixed(2) })} tabIndex={0} className="plan-wall" onClick={() => select({ kind: 'wall', index: i })} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select({ kind: 'wall', index: i }); } }}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="22" /><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={active ? '#315e44' : '#8a9789'} strokeWidth={active ? 8 : 5} /><rect x={(a.x + b.x) / 2 - 38} y={(a.y + b.y) / 2 - 13} width="76" height="26" rx="5" fill={active ? '#315e44' : '#e8ede7'} /><text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 + 4} textAnchor="middle" fill={active ? 'white' : '#3b4c3f'} className="plan-dimension">{i + 1} · {wallLength(room, i).toFixed(2)} m</text></g>;
          })}
          {room.openings.map(item => {
            const a = room.vertices[item.wall], b = room.vertices[(item.wall + 1) % room.vertices.length], length = wallLength(room, item.wall), selection: Selection = { kind: 'opening', id: item.id }, active = isSelected(selection);
            const start = project({ x: a.x + (b.x - a.x) * item.offset / length, z: a.z + (b.z - a.z) * item.offset / length }), end = project({ x: a.x + (b.x - a.x) * (item.offset + item.width) / length, z: a.z + (b.z - a.z) * (item.offset + item.width) / length }), center = project(itemWorldPosition(room, selection)!);
            let swing: { hinge: { x: number; y: number }; leaf: { x: number; y: number }; arc: string } | null = null;
            if (item.type === 'door' && item.doorStyle !== 'frame') {
              const inward = { x: -(b.z - a.z) / length, z: (b.x - a.x) / length };
              const midpoint = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
              const inside = pointInPolygon({ x: midpoint.x + inward.x * 0.01, z: midpoint.z + inward.z * 0.01 }, room.vertices) ? 1 : -1;
              const direction = item.doorStyle === 'left' ? -1 : 1, hinge = direction === 1 ? start : end, closed = direction === 1 ? end : start;
              const radius = item.width * view.scale, angle = item.open === false ? 0 : Math.PI * 0.4;
              const leaf = { x: hinge.x + direction * (end.x - start.x) * Math.cos(angle) + inward.x * inside * radius * Math.sin(angle), y: hinge.y + direction * (end.y - start.y) * Math.cos(angle) + inward.z * inside * radius * Math.sin(angle) };
              swing = { hinge, leaf, arc: angle === 0 ? '' : `M ${closed.x} ${closed.y} A ${radius} ${radius} 0 0 ${direction * inside > 0 ? 1 : 0} ${leaf.x} ${leaf.y}` };
            }
            return <g key={item.id} className="plan-opening" role="button" tabIndex={0} aria-pressed={active} aria-label={t('{{item}}, arrastra para mover a otra pared', { item: t(item.type === 'door' ? item.doorStyle === 'frame' ? t("Marco de puerta") : t("Puerta") : t("Ventana")) })} onClick={() => select(selection)} onPointerDown={event => startItem(event, selection)} onKeyDown={event => itemKeys(event, selection)}><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#fffdfa" strokeWidth="16" /><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={active ? '#315e44' : item.type === 'door' ? '#a47750' : '#75a8bf'} strokeWidth={active ? 7 : 5} strokeDasharray={item.type === 'door' ? '5 3' : undefined} />{swing && <g stroke={active ? '#315e44' : '#a47750'} fill="none" strokeWidth="1.5" pointerEvents="none"><line x1={swing.hinge.x} y1={swing.hinge.y} x2={swing.leaf.x} y2={swing.leaf.y} /><path d={swing.arc} strokeOpacity=".65" /></g>}{active && <circle cx={center.x} cy={center.y} r="6" className="plan-move-handle" />}</g>;
          })}
          {visibleFurniture.map(item => {
            const point = project(item), width = item.width * view.scale, depth = item.depth * view.scale, selection: Selection = { kind: 'furniture', id: item.id }, active = isSelected(selection), invalid = invalidFurniture.has(item.id);
            return <g key={item.id} transform={`translate(${point.x},${point.y}) rotate(${-item.rotation})`} className={`plan-furniture${invalid ? ' invalid' : ''}${readOnly ? ' readonly' : ''}`} role="button" tabIndex={0} aria-pressed={active} aria-label={invalid ? t('{{item}}, ubicación no válida, flechas para mover', { item: t(FURNITURE_LABELS[item.type]) }) : t('{{item}}, flechas para mover', { item: t(FURNITURE_LABELS[item.type]) })} onClick={() => select(selection)} onPointerDown={event => startItem(event, selection)} onKeyDown={event => itemKeys(event, selection)}>
              <rect className="plan-furniture-outline" x={-width / 2} y={-depth / 2} width={width} height={depth} rx="3" fill={active ? '#dce8ce' : '#ece3d4'} stroke={invalid ? '#d63f3f' : active ? '#476540' : '#9da38e'} strokeWidth={active || invalid ? 2.5 : 1.5} />
              {item.type === 'bed' && <><rect x={-width * .44} y={-depth * .43} width={width * .88} height={depth * .2} rx="3" fill="#fffdfa" /><rect x={-width * .44} y={-depth * .08} width={width * .88} height={depth * .51} rx="2" fill={active ? '#adc19d' : '#bdc5ae'} /></>}
              {invalid && <rect x={-width / 2} y={-depth / 2} width={width} height={depth} rx="3" fill="#ed4040" fillOpacity=".28" pointerEvents="none" />}
              <text className="plan-furniture-label" y={depth * .12} textAnchor="middle" fontSize={Math.min(12, width / 6)} pointerEvents="none">{t(FURNITURE_LABELS[item.type])}</text>
            </g>;
          })}
          {room.lights.map(item => {
            const point = project(item), selection: Selection = { kind: 'light', id: item.id }, active = isSelected(selection);
            return <g key={item.id} role="button" tabIndex={0} className="plan-light" aria-pressed={active} aria-label={t('{{name}}; flechas para mover, RePág y AvPág para altura', { name: item.name })} onPointerDown={event => startItem(event, selection)} onClick={() => select(selection)} onKeyDown={event => itemKeys(event, selection)}><circle cx={point.x} cy={point.y} r="12" fill={item.enabled ? '#f9dc7d' : '#d0d3cb'} stroke={active ? '#315e44' : '#fffdfa'} strokeWidth="3" /><path d={`M ${point.x - 3} ${point.y + 3} v -4 a 4 4 0 1 1 6 0 v 4 M ${point.x - 2} ${point.y + 6} h 4`} fill="none" stroke="#6d6040" strokeWidth="1.5" /></g>;
          })}
          {room.vertices.map((p, i) => { const point = project(p); return <circle key={i} cx={point.x} cy={point.y} r="7" className="plan-vertex" fill="#fffdfa" stroke="#315e44" strokeWidth="2.5" role="button" tabIndex={readOnly ? -1 : 0} aria-disabled={readOnly} aria-label={t('Esquina {{number}}; flechas para mover', { number: i + 1 })} onPointerDown={event => { if (readOnly) return; event.preventDefault(); event.stopPropagation(); select({ kind: 'wall', index: i }); drag.current = { kind: 'vertex', index: i }; capture(event); }} onKeyDown={event => {
            if (readOnly) return; const step = room.editing.snap ? room.editing.step : 0.05, moves: Record<string, Point> = { ArrowLeft: { x: -step, z: 0 }, ArrowRight: { x: step, z: 0 }, ArrowUp: { x: 0, z: -step }, ArrowDown: { x: 0, z: step } }; if (moves[event.key]) { event.preventDefault(); moveVertex(i, { x: p.x + moves[event.key].x, z: p.z + moves[event.key].z }); }
          }} />; })}
          {activeFurniture && activeFurniturePoint && !readOnly && <g transform={`translate(${activeFurniturePoint.x},${activeFurniturePoint.y}) rotate(${-activeFurniture.rotation})`}>
            <circle r="6" className="plan-move-handle" role="button" tabIndex={0} aria-label={t("Mover mueble; flechas para mover")} onPointerDown={event => startItem(event, { kind: 'furniture', id: activeFurniture.id })} onKeyDown={event => itemKeys(event, { kind: 'furniture', id: activeFurniture.id })} />
            <line y1={furnitureHandleY} y2={furnitureHandleY - 24} stroke="#315e44" strokeWidth="2" pointerEvents="none" />
            <circle cy={furnitureHandleY - 24} r="8" className="plan-rotate-handle" role="button" tabIndex={0} aria-label={t("Girar mueble; flechas izquierda y derecha")} onPointerDown={event => { event.preventDefault(); event.stopPropagation(); const pointer = eventPoint(event); if (!pointer) return; drag.current = { kind: 'rotate', id: activeFurniture.id, angle: Math.atan2(-(pointer.z - activeFurniture.z), pointer.x - activeFurniture.x), rotation: activeFurniture.rotation }; capture(event); }} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); event.stopPropagation(); moveItem({ kind: 'furniture', id: activeFurniture.id }, { ...activeFurniture, rotation: activeFurniture.rotation + (event.key === 'ArrowLeft' ? -15 : 15) }); } }} />
          </g>}
          {!room.furniture.length && <text x="340" y="235" textAnchor="middle" className="plan-area" pointerEvents="none">{polygonArea(room.vertices).toFixed(1)} m²</text>}
        </>}
        <text x="644" y="39" textAnchor="middle" className="plan-north">N</text><path d="M 644 49 L 639 60 L 644 57 L 649 60 Z" fill="#69796b" /><text x="24" y="438" className="plan-scale">{t('Cuadrícula: {{step}} m', { step: room.editing.step })}</text>
      </svg>
    </div>
    <div className="plan-footer"><span>{drawing ? t('{{count}} / 24 esquinas', { count: points.length }) : readOnly ? t("Solo lectura · Toca cualquier objeto") : t("Arrastra objetos · Selecciona para girar")}</span><span className="plan-legend"><i className="door" />{t("Puerta")}<i className="window" />{t("Ventana")}</span></div>
    {error && <p className="plan-error" role="alert">{t(error)}</p>}
  </div>;
}
