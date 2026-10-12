import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Check, ImageOff, Pencil, Undo2, Upload, X } from 'lucide-react';
import { bounds, FURNITURE_LABELS, fitRoom, interiorPoint, polygonArea, validateRoom, wallLength } from './model';
import type { Point, Room } from './types';
import './plan.css';

type Props = {
  room: Room;
  onChange: (room: Room) => void;
  selectedWall: number;
  onSelectWall: (index: number) => void;
  large?: boolean;
  sketchUrl?: string | null;
  onSketchChange?: (file: File | null) => Promise<void>;
  readOnly?: boolean;
  selectedFurniture?: string | null;
  onSelectFurniture?: (id: string) => void;
};
type Viewport = { scale: number; cx: number; cz: number };

export default function PlanEditor({ room, onChange, selectedWall, onSelectWall, large = false, sketchUrl = null, onSketchChange, readOnly = false, selectedFurniture = null, onSelectFurniture }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const drag = useRef<number | null>(null);
  const furnitureDrag = useRef<{ id: string; x: number; z: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const [referenceWidth, setReferenceWidth] = useState('5');
  const [cornerX, setCornerX] = useState('0');
  const [cornerZ, setCornerZ] = useState('0');
  const [error, setError] = useState('');
  const [fixedView, setFixedView] = useState<Viewport | null>(null);
  const box = bounds(room.vertices);
  const view = fixedView ?? { scale: Math.min(540 / box.width, 330 / box.depth), cx: (box.minX + box.maxX) / 2, cz: (box.minZ + box.maxZ) / 2 };
  const project = (p: Point) => ({ x: 340 + (p.x - view.cx) * view.scale, y: 230 + (p.z - view.cz) * view.scale });
  const polygon = (drawing ? points : room.vertices).map(p => { const s = project(p); return `${s.x},${s.y}`; }).join(' ');

  useEffect(() => {
    if (!readOnly) return;
    drag.current = null; furnitureDrag.current = null; setDrawing(false); setPoints([]); setFixedView(null);
  }, [readOnly]);

  async function changeSketch(file: File | null) {
    if (readOnly || !onSketchChange || uploading) return;
    setUploading(true); setError('');
    try { await onSketchChange(file); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el croquis.'); }
    finally { setUploading(false); }
  }

  function eventPoint(event: PointerEvent<SVGElement>): Point | null {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: Math.round(((point.x - 340) / view.scale + view.cx) * 100) / 100, z: Math.round(((point.y - 230) / view.scale + view.cz) * 100) / 100 };
  }

  function moveVertex(index: number, point: Point) {
    if (readOnly) return;
    try {
      onChange(fitRoom({ ...room, vertices: room.vertices.map((p, i) => i === index ? point : p) }));
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo mover este punto.'); }
  }

  function moveFurniture(id: string, point: Point) {
    if (readOnly) return;
    try {
      onChange(validateRoom({ ...room, furniture: room.furniture.map(item => item.id === id ? { ...item, ...point } : item) }));
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'El mueble debe quedar dentro del cuarto.'); }
  }

  function addCorner(point: Point) {
    if (readOnly) return;
    if (points.length >= 24) { setError('La planta admite hasta 24 esquinas.'); return; }
    if (![point.x, point.z].every(Number.isFinite)) { setError('Escribe ambas coordenadas de la esquina.'); return; }
    setPoints([...points, point]); setError('');
  }

  function finishDrawing() {
    if (readOnly) return;
    try {
      if (points.length < 3) throw new Error('Marca al menos tres esquinas para cerrar la planta.');
      const width = Number(referenceWidth);
      if (!referenceWidth.trim() || !Number.isFinite(width) || width < 0.5 || width > 50) throw new Error('El ancho trazado debe medir entre 0.5 y 50 m.');
      const draft = bounds(points);
      if (draft.width < 0.01) throw new Error('La planta debe tener ancho y fondo.');
      const scale = width / draft.width;
      const vertices = points.map(p => ({ x: (p.x - (draft.minX + draft.maxX) / 2) * scale, z: (p.z - (draft.minZ + draft.maxZ) / 2) * scale }));
      const position = interiorPoint(vertices);
      const candidate = fitRoom({ ...room, vertices, openings: [], lights: room.lights.map(p => ({ ...p, ...position })), wallColors: vertices.map((_, i) => room.wallColors[i] ?? '#eee9df') });
      onChange(candidate);
      onSelectWall(0);
      setDrawing(false); setPoints([]); setFixedView(null); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo aplicar la planta.'); }
  }

  function releaseDrag() { drag.current = null; furnitureDrag.current = null; if (!drawing) setFixedView(null); }

  return <div className={`plan-editor${large ? ' plan-editor-large' : ''}${readOnly ? ' plan-readonly' : ''}`}>
    <div className="plan-toolbar">
      <button type="button" onClick={() => input.current?.click()} disabled={readOnly || uploading || !onSketchChange} title="Guardar una imagen del croquis en el proyecto"><Upload size={15} /> {uploading ? 'Guardando…' : 'Croquis'}</button>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) { setError('Usa una imagen PNG, JPG o WebP de hasta 10 MB.'); return; }
        void changeSketch(file);
      }} />
      <button type="button" className={drawing ? 'active' : ''} disabled={readOnly} onClick={() => {
        setDrawing(!drawing); setPoints([]); setError(''); setFixedView(drawing ? null : view); setReferenceWidth(box.width.toFixed(2));
      }}><Pencil size={15} /> {drawing ? 'Cancelar trazo' : 'Dibujar planta'}</button>
      {sketchUrl && <button type="button" className="plan-icon-button" disabled={readOnly || uploading || !onSketchChange} onClick={() => void changeSketch(null)} title="Quitar imagen de referencia" aria-label="Quitar imagen de referencia"><ImageOff size={15} /></button>}
    </div>
    {drawing && <div className="plan-drawing-controls">
      <p>Marca las esquinas en orden. El contorno se cerrará al aplicar.</p>
      <label>Ancho total trazado <span><input aria-label="Ancho total de la planta trazada en metros" type="number" min="0.5" max="50" step="0.1" value={referenceWidth} onChange={event => setReferenceWidth(event.target.value)} /> m</span></label>
      <div className="plan-toolbar">
        <label>X <input aria-label="Coordenada X de nueva esquina" type="number" step="0.1" value={cornerX} onChange={event => setCornerX(event.target.value)} /></label>
        <label>Z <input aria-label="Coordenada Z de nueva esquina" type="number" step="0.1" value={cornerZ} onChange={event => setCornerZ(event.target.value)} /></label>
        <button type="button" onClick={() => addCorner({ x: cornerX.trim() ? Number(cornerX) : NaN, z: cornerZ.trim() ? Number(cornerZ) : NaN })}>Añadir esquina</button>
      </div>
      <p className="plan-replacement-note">La nueva planta reemplaza las paredes y elimina las puertas y ventanas. Las luces y los muebles se acomodan dentro.</p>
      <div className="plan-toolbar">
        <button type="button" onClick={() => setPoints(points.slice(0, -1))} disabled={!points.length}><Undo2 size={14} /> Deshacer</button>
        <button type="button" onClick={finishDrawing} disabled={points.length < 3}><Check size={14} /> Aplicar planta</button>
        <button type="button" className="plan-icon-button" aria-label="Cancelar planta" onClick={() => { setDrawing(false); setPoints([]); setFixedView(null); setError(''); }}><X size={14} /></button>
      </div>
    </div>}
    <div className="plan-canvas">
      <svg ref={svg} viewBox="0 0 680 460" role="group" aria-label="Plano editable del cuarto. Selecciona paredes o muebles y arrastra para mover muebles o esquinas." className={drawing ? 'drawing' : ''}
        onPointerDown={event => {
          if (!drawing || readOnly) return;
          const point = eventPoint(event);
          if (point) addCorner(point);
        }}
        onPointerMove={event => {
          if (drawing || readOnly) return;
          const point = eventPoint(event);
          if (!point) return;
          if (furnitureDrag.current) moveFurniture(furnitureDrag.current.id, { x: point.x + furnitureDrag.current.x, z: point.z + furnitureDrag.current.z });
          else if (drag.current !== null) moveVertex(drag.current, point);
        }}
        onPointerUp={releaseDrag} onPointerCancel={releaseDrag} onLostPointerCapture={releaseDrag}>
        <defs><pattern id={large ? 'plan-grid-large' : 'plan-grid-small'} width={view.scale / 2} height={view.scale / 2} patternUnits="userSpaceOnUse"><path d={`M ${view.scale / 2} 0 L 0 0 0 ${view.scale / 2}`} fill="none" stroke="#69736c" strokeOpacity=".13" strokeWidth="1" /></pattern></defs>
        <rect width="680" height="460" fill="#e8ede7" />
        <rect width="680" height="460" fill={`url(#${large ? 'plan-grid-large' : 'plan-grid-small'})`} />
        {sketchUrl && <image href={sketchUrl} x="35" y="25" width="610" height="400" preserveAspectRatio="xMidYMid meet" opacity=".55" onError={() => setError('No se pudo cargar el croquis guardado.')} />}
        {drawing ? <>
          {points.length > 1 && <polyline points={polygon} fill="none" stroke="#37634b" strokeWidth="4" />}
          {points.length > 2 && <line x1={project(points[0]).x} y1={project(points[0]).y} x2={project(points[points.length - 1]).x} y2={project(points[points.length - 1]).y} stroke="#37634b" strokeWidth="2" strokeDasharray="6 6" />}
          {points.map((p, i) => <g key={i}><circle cx={project(p).x} cy={project(p).y} r="6" fill="#37634b" stroke="white" strokeWidth="2" /><text x={project(p).x + 11} y={project(p).y - 10} className="plan-point-label">{i + 1}</text></g>)}
          {!points.length && <text x="340" y="230" textAnchor="middle" className="plan-instruction">Toca la primera esquina para comenzar</text>}
        </> : <>
          <polygon points={polygon} fill="#fffdfa" fillOpacity={sketchUrl ? '.62' : '1'} stroke="#89958b" strokeWidth="1" />
          {room.vertices.map((p, i) => {
            const next = room.vertices[(i + 1) % room.vertices.length], a = project(p), b = project(next);
            return <g key={i} role="button" aria-label={`Seleccionar pared ${i + 1}, ${wallLength(room, i).toFixed(2)} metros`} tabIndex={0} className="plan-wall" onClick={() => onSelectWall(i)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectWall(i); } }}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth="22" />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={selectedWall === i ? '#315e44' : '#8a9789'} strokeWidth={selectedWall === i ? 8 : 5} />
              <rect x={(a.x + b.x) / 2 - 38} y={(a.y + b.y) / 2 - 13} width="76" height="26" rx="5" fill={selectedWall === i ? '#315e44' : '#e8ede7'} />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 + 4} textAnchor="middle" fill={selectedWall === i ? 'white' : '#3b4c3f'} className="plan-dimension">{i + 1} · {wallLength(room, i).toFixed(2)} m</text>
            </g>;
          })}
          {room.openings.map(opening => {
            const a = room.vertices[opening.wall], b = room.vertices[(opening.wall + 1) % room.vertices.length], length = wallLength(room, opening.wall);
            const start = project({ x: a.x + (b.x - a.x) * opening.offset / length, z: a.z + (b.z - a.z) * opening.offset / length });
            const end = project({ x: a.x + (b.x - a.x) * (opening.offset + opening.width) / length, z: a.z + (b.z - a.z) * (opening.offset + opening.width) / length });
            return <g key={opening.id} className="plan-opening" onClick={() => onSelectWall(opening.wall)}><title>{opening.type === 'door' ? 'Puerta' : 'Ventana'} · {opening.width.toFixed(2)} m</title><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#fffdfa" strokeWidth="11" /><line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke={opening.type === 'door' ? '#a47750' : '#75a8bf'} strokeWidth="5" strokeDasharray={opening.type === 'door' ? '5 3' : undefined} /></g>;
          })}
          {room.furniture.map(item => {
            const point = project(item), width = item.width * view.scale, depth = item.depth * view.scale;
            const selected = selectedFurniture === item.id;
            return <g key={item.id} transform={`translate(${point.x},${point.y}) rotate(${-item.rotation})`} className={`plan-furniture${readOnly ? ' readonly' : ''}`} role="button" tabIndex={0} aria-pressed={selected} aria-label={`${FURNITURE_LABELS[item.type]}, ${item.width.toFixed(2)} por ${item.depth.toFixed(2)} metros${readOnly ? '' : '; arrastra o usa las flechas para mover'}`} onClick={() => onSelectFurniture?.(item.id)} onPointerDown={event => {
              if (readOnly) return;
              event.preventDefault(); event.stopPropagation();
              onSelectFurniture?.(item.id);
              const origin = eventPoint(event);
              if (!origin) return;
              drag.current = null; furnitureDrag.current = { id: item.id, x: item.x - origin.x, z: item.z - origin.z };
              setFixedView(view); event.currentTarget.setPointerCapture(event.pointerId);
            }} onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectFurniture?.(item.id); return; }
              if (readOnly) return;
              const steps: Record<string, Point> = { ArrowLeft: { x: -0.05, z: 0 }, ArrowRight: { x: 0.05, z: 0 }, ArrowUp: { x: 0, z: -0.05 }, ArrowDown: { x: 0, z: 0.05 } };
              const step = steps[event.key];
              if (step) { event.preventDefault(); event.stopPropagation(); moveFurniture(item.id, { x: item.x + step.x, z: item.z + step.z }); }
            }}>
              <title>{FURNITURE_LABELS[item.type]} · {item.width.toFixed(2)} × {item.depth.toFixed(2)} m</title>
              <rect className="plan-furniture-outline" x={-width / 2} y={-depth / 2} width={width} height={depth} rx="3" fill={selected ? '#dce8ce' : '#ece3d4'} stroke={selected ? '#476540' : '#9da38e'} strokeWidth={selected ? 2.5 : 1.5} />
              {item.type === 'bed' ? <>
                <rect x={-width * 0.45} y={-depth * 0.46} width={width * 0.9} height={depth * 0.06} rx="1" fill="#b3a18a" />
                {Array.from({ length: item.width < 1.3 ? 1 : 2 }, (_, i) => <rect key={i} x={item.width < 1.3 ? -width * 0.37 : (i - 0.5) * width * 0.45 - width * 0.185} y={-depth * 0.34} width={width * (item.width < 1.3 ? 0.74 : 0.37)} height={depth * 0.18} rx="3" fill="#fffdfa" stroke="#cacbb9" strokeWidth="1" />)}
                <rect x={-width * 0.44} y={-depth * 0.08} width={width * 0.88} height={depth * 0.51} rx="2" fill={selected ? '#adc19d' : '#bdc5ae'} />
              </> : item.type === 'wardrobe' ? <>
                <line x1="0" y1={-depth * 0.44} x2="0" y2={depth * 0.44} stroke="#a89d8b" strokeWidth="1" />
                <path d={`M ${-width * 0.08} ${depth * 0.35} h ${width * 0.025} M ${width * 0.055} ${depth * 0.35} h ${width * 0.025}`} stroke="#757c67" strokeWidth="3" />
              </> : item.type === 'vanity' ? <>
                <rect x={-width * 0.35} y={-depth * 0.46} width={width * 0.7} height={depth * 0.1} rx="2" fill="#bfd0ce" stroke="#93aba3" />
                <rect x={-width * 0.45} y={-depth * 0.22} width={width * 0.27} height={depth * 0.63} rx="2" fill="#d8cbb5" />
              </> : <line x1={-width * 0.18} y1={depth * 0.35} x2={width * 0.18} y2={depth * 0.35} stroke="#818774" strokeWidth="3" />}
              <text className="plan-furniture-label" y={item.type === 'bed' ? depth * 0.23 : depth * 0.12} textAnchor="middle" fontSize={Math.min(12, width / 6)} pointerEvents="none">{FURNITURE_LABELS[item.type]}</text>
            </g>;
          })}
          {room.lights.map(light => {
            const point = project(light);
            return <g key={light.id} pointerEvents="none"><title>{light.name} · {light.enabled ? 'encendida' : 'apagada'}</title><circle cx={point.x} cy={point.y} r="12" fill={light.enabled ? '#f9dc7d' : '#d0d3cb'} stroke="#fffdfa" strokeWidth="3" /><path d={`M ${point.x - 3} ${point.y + 3} v -4 a 4 4 0 1 1 6 0 v 4 M ${point.x - 2} ${point.y + 6} h 4`} fill="none" stroke="#6d6040" strokeWidth="1.5" /></g>;
          })}
          {room.vertices.map((p, i) => {
            const point = project(p);
            return <circle key={i} cx={point.x} cy={point.y} r="7" className="plan-vertex" fill="#fffdfa" stroke="#315e44" strokeWidth="2.5" role="button" tabIndex={readOnly ? -1 : 0} aria-disabled={readOnly} aria-label={`Esquina ${i + 1}${readOnly ? '' : '; flechas para mover 5 centímetros'}`} onPointerDown={event => { if (readOnly) return; event.preventDefault(); event.stopPropagation(); drag.current = i; setFixedView(view); event.currentTarget.setPointerCapture(event.pointerId); }} onKeyDown={event => {
              if (readOnly) return;
              const step: Record<string, Point> = { ArrowLeft: { x: -0.05, z: 0 }, ArrowRight: { x: 0.05, z: 0 }, ArrowUp: { x: 0, z: -0.05 }, ArrowDown: { x: 0, z: 0.05 } };
              if (step[event.key]) { event.preventDefault(); moveVertex(i, { x: p.x + step[event.key].x, z: p.z + step[event.key].z }); }
            }} />;
          })}
          {!room.furniture.length && <text x="340" y="235" textAnchor="middle" className="plan-area" pointerEvents="none">{polygonArea(room.vertices).toFixed(1)} m²</text>}
        </>}
        <text x="644" y="39" textAnchor="middle" className="plan-north">N</text><path d="M 644 49 L 639 60 L 644 57 L 649 60 Z" fill="#69796b" />
        <text x="24" y="438" className="plan-scale">Cuadrícula: 0.5 m</text>
      </svg>
    </div>
    <div className="plan-footer"><span>{drawing ? `${points.length} / 24 esquinas` : readOnly ? 'Solo lectura · Toca un objeto' : room.furniture.length ? 'Arrastra muebles o esquinas · Toca para seleccionar' : 'Arrastra las esquinas · Toca una pared'}</span><span className="plan-legend"><i className="door" /> Puerta <i className="window" /> Ventana</span></div>
    {error && <p className="plan-error" role="alert">{error}</p>}
  </div>;
}
