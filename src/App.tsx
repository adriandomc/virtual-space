import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Archive, ArrowDownToLine, ArrowUpFromLine, BedDouble, Box, Check, ChevronDown, ChevronRight, CircleHelp, Copy, DoorClosed, DoorOpen, Focus, Footprints, Grid2X2, Layers3, Lightbulb, LoaderCircle, Maximize2, Menu, MousePointer2, PanelLeftClose, PanelRightClose, Paintbrush, Plus, RotateCcw, Ruler, Settings2, Share2, Sofa, Sun, Table2, Trash2, X } from 'lucide-react';
import RoomScene from './RoomScene';
import PlanEditor from './PlanEditor';
import { addFurniture, addLight, addOpening, BED_SIZES, bounds, fitRoom, FURNITURE_LABELS, polygonArea, resizeRoom, validateRoom, wallLength } from './model';
import useProject from './useProject';
import type { BedSize, FurnitureItem, Opening, Room, RoomLight, ViewMode } from './types';

const COLORS = [
  { hex: '#9cae98', name: 'Salvia suave' }, { hex: '#e7e3d9', name: 'Lino natural' },
  { hex: '#d7c7b1', name: 'Arena cálida' }, { hex: '#c4967c', name: 'Terracota' },
  { hex: '#acbabc', name: 'Bruma azul' }, { hex: '#7e9390', name: 'Eucalipto' },
  { hex: '#dad1c5', name: 'Piedra' }, { hex: '#b4ad9c', name: 'Oliva gris' },
  { hex: '#d4b4ae', name: 'Rosa arcilla' }, { hex: '#8d9eaf', name: 'Azul pizarra' },
  { hex: '#f3f0e9', name: 'Blanco cálido' }, { hex: '#646d64', name: 'Bosque' },
];
const wallName = (i: number) => `Pared ${String(i + 1).padStart(2, '0')}`;
const FURNITURE_ICONS = { bed: BedDouble, wardrobe: DoorClosed, vanity: Table2, nightstand: Archive };
const furnitureName = (item: FurnitureItem) => item.type === 'bed' ? `Cama ${BED_SIZES[item.bedSize ?? 'double'].label.toLowerCase()}` : FURNITURE_LABELS[item.type];
const timeLabel = (hour: number) => `${String(Math.floor(hour)).padStart(2, '0')}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`;

function NumberField({ label, value, min, max, step = 0.1, unit = 'm', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(2))));
  useEffect(() => setDraft(String(Number(value.toFixed(2)))), [value]);
  return <label className="number-field"><span>{label}</span><div className="number-input"><input aria-label={label} type="number" inputMode="decimal" value={draft} min={min} max={max} step={step} onChange={(event) => {
    setDraft(event.target.value);
    const next = Number(event.target.value);
    if (event.target.value !== '' && Number.isFinite(next) && next >= min && next <= max) onChange(next);
  }} onBlur={() => setDraft(String(Number(value.toFixed(2))))} /><span>{unit}</span></div></label>;
}

function Slider({ label, value, min, max, step = 1, valueLabel, onChange }: { label: string; value: number; min: number; max: number; step?: number; valueLabel: string; onChange: (value: number) => void }) {
  return <label className="slider-field"><span><span>{label}</span><output>{valueLabel}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} style={{ '--progress': `${100 * (value - min) / (max - min)}%` } as React.CSSProperties} onChange={(e) => onChange(Number(e.target.value))} /></label>;
}

function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><span /></button>;
}

function Section({ title, children, caption, defaultOpen = true }: { title: string; children: ReactNode; caption?: string; defaultOpen?: boolean }) {
  return <details className="property-section" open={defaultOpen}><summary><ChevronDown size={14} /><span>{title}</span>{caption && <small>{caption}</small>}</summary><div className="section-body">{children}</div></details>;
}

export default function App() {
  const { room, setRoom, ready, status, error: saveError, readOnly, shareUrl, uploadSketch, sketchUrl, retry } = useProject();
  const [mode, setMode] = useState<ViewMode>('orbit');
  const [selectedWall, setSelectedWall] = useState(0);
  const [activeOpening, setActiveOpening] = useState<string | null>(null);
  const [activeLight, setActiveLight] = useState<string | null>(null);
  const [activeFurniture, setActiveFurniture] = useState<string | null>(null);
  const [tab, setTab] = useState<'space' | 'color' | 'light' | 'furniture'>('color');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [mobilePanel, setMobilePanel] = useState<'scene' | 'properties' | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [notice, setNotice] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
  const shareRef = useRef<HTMLDialogElement>(null);
  const showFurniture = room.showFurniture;
  const size = bounds(room.vertices);
  const area = polygonArea(room.vertices);
  const selectedColor = room.wallColors[selectedWall] ?? room.wallColors[0];
  const paletteColor = COLORS.find((color) => color.hex.toLowerCase() === selectedColor.toLowerCase());

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => setNotice(''), 5500);
    return () => clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    if (helpOpen) helpRef.current?.showModal();
    else helpRef.current?.close();
  }, [helpOpen]);
  useEffect(() => {
    if (shareOpen) shareRef.current?.showModal();
    else shareRef.current?.close();
  }, [shareOpen]);
  useEffect(() => { if (selectedWall >= room.vertices.length) setSelectedWall(0); }, [room.vertices.length, selectedWall]);

  if (!ready) return <main className="project-loading">{status === 'error' ? <><CircleHelp size={22} /><p>{saveError}</p><button className="primary-button" onClick={retry}>Reintentar</button><a href="/">Crear otro proyecto</a></> : <><LoaderCircle size={23} /><span>Cargando proyecto…</span></>}</main>;

  function change(next: Room | (() => Room)) {
    if (readOnly) return;
    try { setRoom(validateRoom(typeof next === 'function' ? next() : next)); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo aplicar el cambio.'); }
  }
  function setShowFurniture(value: boolean) { change({ ...room, showFurniture: value }); }
  function openProperties(nextTab: typeof tab) {
    setTab(nextTab); setRightOpen(true); setMobilePanel(window.matchMedia('(max-width: 640px)').matches ? 'properties' : null);
  }
  function selectWall(index: number) {
    setSelectedWall(index); setActiveOpening(null); setActiveLight(null); setActiveFurniture(null); setTab('color');
  }
  function selectFurniture(id: string, showPanel = true) {
    setActiveFurniture(id); setActiveOpening(null); setActiveLight(null);
    if (showPanel) openProperties('furniture'); else setTab('furniture');
  }
  function insertFurniture(type: FurnitureItem['type'], bedSize: BedSize = 'double') {
    if (readOnly) return;
    try {
      const next = addFurniture(room, type, bedSize);
      change(next); selectFurniture(next.furniture.at(-1)!.id);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No hay espacio para este mueble.'); }
  }
  function updateFurniture(id: string, patch: Partial<FurnitureItem>) {
    change({ ...room, furniture: room.furniture.map((item) => item.id === id ? { ...item, ...patch } : item) });
  }
  const furnitureButtons = <div className="furniture-add-grid">
    {(Object.entries(BED_SIZES) as [BedSize, typeof BED_SIZES[BedSize]][]).map(([key, preset]) => <button key={key} disabled={readOnly} className="outline-button" onClick={() => insertFurniture('bed', key)}><BedDouble size={14} />Cama {preset.label.toLowerCase()}</button>)}
    {(['wardrobe', 'vanity', 'nightstand'] as const).map((type) => { const Icon = FURNITURE_ICONS[type]; return <button key={type} disabled={readOnly} className="outline-button" onClick={() => insertFurniture(type)}><Icon size={14} />{FURNITURE_LABELS[type]}</button>; })}
  </div>;
  function updateOpening(id: string, patch: Partial<Opening>) {
    change(() => fitRoom({ ...room, openings: room.openings.map((opening) => opening.id === id ? { ...opening, ...patch } : opening) }));
  }
  function updateLight(id: string, patch: Partial<RoomLight>) {
    change(() => fitRoom({ ...room, lights: room.lights.map((light) => light.id === id ? { ...light, ...patch } : light) }));
  }
  function insertOpening(type: Opening['type']) {
    try {
      const next = addOpening(room, type, selectedWall);
      change(next); setActiveOpening(next.openings.at(-1)!.id); openProperties('space');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No hay espacio en esta pared.'); }
  }
  function insertLight() {
    try {
      const next = addLight(room);
      change(next); setActiveLight(next.lights.at(-1)!.id); openProperties('light');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo agregar la luz.'); }
  }
  function exportRoom() {
    const blob = new Blob([JSON.stringify(room, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `${room.name.replace(/[^a-zA-Z0-9áéíóúñ _-]/g, '').trim() || 'habitacion'}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('Proyecto descargado. Puedes volver a abrirlo desde Archivo.');
  }
  async function importRoom(file?: File) {
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('El proyecto debe pesar menos de 1 MB.');
      const next = validateRoom(JSON.parse(await file.text()));
      change(next); setSelectedWall(0); setActiveOpening(null); setActiveLight(null); setActiveFurniture(null); setResetKey((v) => v + 1); setNotice('Proyecto abierto.');
    } catch (error) { setNotice(error instanceof SyntaxError ? 'El archivo no es un proyecto válido.' : error instanceof Error ? error.message : 'No se pudo abrir el archivo.'); }
    if (importRef.current) importRef.current.value = '';
  }

  const scenePanel = <>
    <div className="panel-heading"><span>EXPLORADOR</span><button className="icon-button desktop-only" aria-label="Ocultar explorador" onClick={() => setLeftOpen(false)}><PanelLeftClose size={16} /></button><button className="icon-button mobile-only" aria-label="Cerrar explorador" onClick={() => setMobilePanel(null)}><X size={18} /></button></div>
    <div className="room-tree-title"><ChevronDown size={14} /><Box size={16} /><span>{room.name}</span><span className="item-count">{room.vertices.length + room.openings.length + room.lights.length + room.furniture.length}</span></div>
    <div className="tree-group"><div className="tree-label"><ChevronDown size={12} /><Layers3 size={14} /><span>Paredes</span><small>{room.vertices.length}</small></div>
      {room.vertices.map((_, i) => <button key={i} className={`tree-item ${selectedWall === i && !activeOpening && !activeLight ? 'selected' : ''}`} onClick={() => selectWall(i)}><span className="wall-color-dot" style={{ background: room.wallColors[i] }} /><span>{wallName(i)}</span><small>{wallLength(room, i).toFixed(2)} m</small></button>)}
    </div>
    <div className="tree-group"><div className="tree-label"><ChevronDown size={12} /><DoorOpen size={14} /><span>Aberturas</span><small>{room.openings.length}</small><button aria-label="Agregar ventana" className="tiny-button" disabled={readOnly} onClick={() => insertOpening('window')}><Plus size={13} /></button></div>
      {room.openings.map((opening, i) => <button key={opening.id} className={`tree-item ${activeOpening === opening.id ? 'selected' : ''}`} onClick={() => { setActiveOpening(opening.id); setActiveLight(null); setActiveFurniture(null); setSelectedWall(opening.wall); openProperties('space'); }}><span className="tree-item-icon">{opening.type === 'door' ? <DoorOpen size={14} /> : <Grid2X2 size={14} />}</span><span>{opening.type === 'door' ? 'Puerta' : 'Ventana'} {i + 1}</span><small>P{String(opening.wall + 1).padStart(2, '0')}</small></button>)}
      {room.openings.length === 0 && <p className="tree-empty">Agrega una puerta o ventana.</p>}
    </div>
    <div className="tree-group"><div className="tree-label"><ChevronDown size={12} /><Lightbulb size={14} /><span>Iluminación</span><small>{room.lights.length + 1}</small><button aria-label="Agregar foco" className="tiny-button" disabled={readOnly} onClick={insertLight}><Plus size={13} /></button></div>
      <div className="tree-light"><button className="tree-item" onClick={() => { setActiveLight(null); openProperties('light'); }}><Sun size={14} /><span>Luz del sol</span></button><Switch disabled={readOnly} label="Activar luz del sol" checked={room.sun.enabled} onChange={(enabled) => change({ ...room, sun: { ...room.sun, enabled } })} /></div>
      {room.lights.map((light) => <div className={`tree-light ${activeLight === light.id ? 'selected' : ''}`} key={light.id}><button className="tree-item" onClick={() => { setActiveLight(light.id); setActiveOpening(null); setActiveFurniture(null); openProperties('light'); }}><Lightbulb size={14} /><span>{light.name}</span></button><Switch disabled={readOnly} label={`Encender ${light.name}`} checked={light.enabled} onChange={(enabled) => updateLight(light.id, { enabled })} /></div>)}
    </div>
    <div className="tree-group"><div className="tree-label"><ChevronDown size={12} /><BedDouble size={14} /><span>Muebles</span><small>{room.furniture.length}</small><button aria-label="Agregar mueble" className="tiny-button" disabled={readOnly} onClick={() => openProperties('furniture')}><Plus size={13} /></button></div>
      {room.furniture.map((item, i) => { const Icon = FURNITURE_ICONS[item.type]; return <button key={item.id} className={`tree-item ${activeFurniture === item.id ? 'selected' : ''}`} onClick={() => selectFurniture(item.id)}><Icon size={14} /><span>{furnitureName(item)} {i + 1}</span></button>; })}
    </div>
    <div className="add-object"><details><summary><Plus size={15} /> Agregar al espacio <ChevronDown size={13} /></summary><div className="add-menu"><button disabled={readOnly} onClick={() => insertOpening('door')}><DoorOpen size={15} /> Puerta</button><button disabled={readOnly} onClick={() => insertOpening('window')}><Grid2X2 size={15} /> Ventana</button><button disabled={readOnly} onClick={insertLight}><Lightbulb size={15} /> Foco de luz</button><button disabled={readOnly} onClick={() => openProperties('furniture')}><BedDouble size={15} /> Muebles</button></div></details></div>
    <div className="scene-bottom"><div className="mini-plan-heading"><span>PLANTA DEL ESPACIO</span><button className="icon-button" aria-label="Editar planta" onClick={() => { setMode('plan'); setMobilePanel(null); }}><Maximize2 size={14} /></button></div>
      <button className="mini-plan" aria-label="Abrir editor de planta" onClick={() => { setMode('plan'); setMobilePanel(null); }}><svg viewBox={`${size.minX - 0.6} ${size.minZ - 0.6} ${size.width + 1.2} ${size.depth + 1.2}`} role="img" aria-label="Croquis de la habitación"><polygon points={room.vertices.map((v) => `${v.x},${v.z}`).join(' ')} fill="#e8eee5" stroke="#6c7e64" strokeWidth="0.07" />{room.vertices.map((v, i) => <circle key={i} cx={v.x} cy={v.z} r="0.06" fill="#6c7e64" />)}</svg><span>{size.width.toFixed(1)} × {size.depth.toFixed(1)} m</span></button>
      <div className="scene-metrics"><div><span>Superficie</span><strong>{area.toFixed(1)} <small>m²</small></strong></div><div><span>Altura</span><strong>{room.height.toFixed(1)} <small>m</small></strong></div></div>
      <button className="help-link" onClick={() => setHelpOpen(true)}><CircleHelp size={15} /> Guía rápida <span>?</span></button>
    </div>
  </>;

  const propertiesPanel = <>
    <div className="panel-heading"><span>PROPIEDADES</span><button className="icon-button desktop-only" aria-label="Ocultar propiedades" onClick={() => setRightOpen(false)}><PanelRightClose size={16} /></button><button className="icon-button mobile-only" aria-label="Cerrar propiedades" onClick={() => setMobilePanel(null)}><X size={18} /></button></div>
    <div className="inspector-title"><span className="inspector-icon">{tab === 'color' ? <Paintbrush size={19} /> : tab === 'light' ? <Sun size={19} /> : tab === 'furniture' ? <BedDouble size={19} /> : <Box size={19} />}</span><div><h2>{tab === 'color' ? 'Colores y materiales' : tab === 'light' ? 'Iluminación' : tab === 'furniture' ? 'Muebles' : 'Tu habitación'}</h2></div></div>
    <div className="inspector-tabs" role="tablist" aria-label="Propiedades del espacio">{([['space', Ruler, 'Espacio'], ['color', Paintbrush, 'Color'], ['light', Sun, 'Luz'], ['furniture', BedDouble, 'Muebles']] as const).map(([key, Icon, label]) => <button key={key} role="tab" id={`tab-${key}`} aria-controls={`panel-${key}`} aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}><Icon size={14} />{label}</button>)}</div>
    <fieldset disabled={readOnly} className="inspector-content" id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
      {tab === 'furniture' && <>
        <Section title="Agregar mueble">{furnitureButtons}</Section>
        <Section title="Muebles del cuarto" caption={String(room.furniture.length)}>
          <div className="opening-list">{room.furniture.map((item, i) => { const Icon = FURNITURE_ICONS[item.type]; return <div key={item.id} className={`opening-card ${activeFurniture === item.id ? 'active' : ''}`}>
            <button className="opening-card-title" onClick={() => setActiveFurniture(activeFurniture === item.id ? null : item.id)}><Icon size={16} /><span>{furnitureName(item)} {i + 1}<small>{item.width.toFixed(2)} × {item.depth.toFixed(2)} m</small></span><ChevronDown size={14} /></button>
            {activeFurniture === item.id && <div className="opening-fields">
              {item.type === 'bed' && <label className="select-field">Tamaño de cama<select aria-label="Tamaño de cama" value={item.bedSize} onChange={(event) => { const bedSize = event.target.value as BedSize; const preset = BED_SIZES[bedSize]; updateFurniture(item.id, { bedSize, width: preset.width, depth: preset.depth }); }}>{(Object.entries(BED_SIZES) as [BedSize, typeof BED_SIZES[BedSize]][]).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}</select></label>}
              <div className="dimensions-grid"><NumberField label="Ancho del mueble" value={item.width} min={0.1} max={10} onChange={(width) => updateFurniture(item.id, { width })} /><NumberField label="Largo del mueble" value={item.depth} min={0.1} max={10} onChange={(depth) => updateFurniture(item.id, { depth })} /><NumberField label="Altura del mueble" value={item.height} min={0.1} max={room.height} onChange={(height) => updateFurniture(item.id, { height })} /><NumberField label="Giro del mueble" value={item.rotation} min={0} max={360} step={15} unit="°" onChange={(rotation) => updateFurniture(item.id, { rotation })} /><NumberField label="Posición X del mueble" value={item.x} min={size.minX} max={size.maxX} onChange={(x) => updateFurniture(item.id, { x })} /><NumberField label="Posición Z del mueble" value={item.z} min={size.minZ} max={size.maxZ} onChange={(z) => updateFurniture(item.id, { z })} /></div>
              <button className="outline-button full-width furniture-plan-button" onClick={() => { setMode('plan'); setMobilePanel(null); }}><Grid2X2 size={14} />Mover en planta</button>
              <button className="delete-button" onClick={() => { change({ ...room, furniture: room.furniture.filter((f) => f.id !== item.id) }); setActiveFurniture(null); }}><Trash2 size={13} />Eliminar mueble</button>
            </div>}
          </div>; })}</div>
        </Section>
      </>}
      {tab === 'space' && <>
        <Section title="Dimensiones" caption="METROS"><div className="dimensions-grid"><NumberField label="Ancho" value={size.width} min={0.5} max={50} onChange={(width) => change(() => resizeRoom(room, width, size.depth))} /><NumberField label="Largo" value={size.depth} min={0.5} max={50} onChange={(depth) => change(() => resizeRoom(room, size.width, depth))} /><NumberField label="Altura" value={room.height} min={1.8} max={8} onChange={(height) => change(() => fitRoom({ ...room, height }))} /><NumberField label="Espesor de muro" value={room.thickness} min={0.05} max={0.6} step={0.01} onChange={(thickness) => change({ ...room, thickness })} /></div><div className="area-tag"><Ruler size={13} />{area.toFixed(2)} m² de superficie</div><button className="outline-button full-width" onClick={() => { setMode('plan'); setMobilePanel(null); }}><Grid2X2 size={14} /> Editar planta / cargar croquis <ChevronRight size={14} /></button></Section>
        <Section title="Puertas y ventanas" caption={String(room.openings.length)}><p className="field-description">Selecciona una abertura para cambiar sus medidas.</p><div className="opening-list">{room.openings.map((opening, i) => <div key={opening.id} className={`opening-card ${activeOpening === opening.id ? 'active' : ''}`}><button className="opening-card-title" onClick={() => setActiveOpening(activeOpening === opening.id ? null : opening.id)}>{opening.type === 'door' ? <DoorOpen size={16} /> : <Grid2X2 size={16} />}<span>{opening.type === 'door' ? 'Puerta' : 'Ventana'} {i + 1}<small>{wallName(opening.wall)} · {opening.width.toFixed(1)} × {opening.height.toFixed(1)} m</small></span><ChevronDown size={14} /></button>{activeOpening === opening.id && <div className="opening-fields"><label className="select-field">Ubicación<select aria-label="Pared de la abertura" value={opening.wall} onChange={(e) => updateOpening(opening.id, { wall: Number(e.target.value) })}>{room.vertices.map((_, w) => <option key={w} value={w}>{wallName(w)}</option>)}</select></label><div className="dimensions-grid"><NumberField label="Ancho de abertura" value={opening.width} min={0.3} max={wallLength(room, opening.wall)} onChange={(width) => updateOpening(opening.id, { width })} /><NumberField label="Alto de abertura" value={opening.height} min={0.3} max={room.height} onChange={(height) => updateOpening(opening.id, { height })} /><NumberField label="Desde el inicio" value={opening.offset} min={0} max={wallLength(room, opening.wall) - opening.width} step={0.05} onChange={(offset) => updateOpening(opening.id, { offset })} />{opening.type === 'window' && <NumberField label="Altura del antepecho" value={opening.sill} min={0} max={room.height - opening.height} step={0.05} onChange={(sill) => updateOpening(opening.id, { sill })} />}</div><button className="delete-button" onClick={() => { change({ ...room, openings: room.openings.filter((o) => o.id !== opening.id) }); setActiveOpening(null); }}><Trash2 size={13} /> Eliminar abertura</button></div>}</div>)}</div><div className="two-buttons"><button className="outline-button" onClick={() => insertOpening('door')}><Plus size={14} /> Puerta</button><button className="outline-button" onClick={() => insertOpening('window')}><Plus size={14} /> Ventana</button></div><p className="small-note">Se agregan a {wallName(selectedWall).toLowerCase()}.</p></Section>
        <Section title="Visualización"><div className="setting-row"><div><span>Mobiliario de referencia</span><small>Una referencia de escala</small></div><Switch disabled={readOnly || room.furniture.length > 0} label="Mostrar mobiliario de referencia" checked={showFurniture} onChange={setShowFurniture} /></div><p className="small-note">Las paredes exteriores se ocultan según la cámara. En el recorrido, el cuarto se muestra cerrado.</p></Section>
      </>}
      {tab === 'color' && <>
        <Section title="Pared seleccionada"><div className="wall-chips">{room.vertices.map((_, i) => <button key={i} className={selectedWall === i ? 'active' : ''} onClick={() => selectWall(i)}><span style={{ background: room.wallColors[i] }} />{String(i + 1).padStart(2, '0')}</button>)}</div><p className="small-note">También puedes seleccionar una pared en el visor.</p></Section>
        <Section title="Paleta de color" caption="MATE"><div className="selected-paint"><span style={{ background: selectedColor }} /><div><strong>{paletteColor?.name ?? 'Color personalizado'}</strong><small>{selectedColor.toUpperCase()}</small></div><span className="paint-badge">P{String(selectedWall + 1).padStart(2, '0')}</span></div><div className="color-palette">{COLORS.map((color) => <button key={color.hex} aria-label={`Pintar ${wallName(selectedWall)}: ${color.name}`} aria-pressed={selectedColor.toLowerCase() === color.hex} title={color.name} className={selectedColor.toLowerCase() === color.hex ? 'selected' : ''} style={{ background: color.hex }} onClick={() => change({ ...room, wallColors: room.wallColors.map((c, i) => i === selectedWall ? color.hex : c) })}>{selectedColor.toLowerCase() === color.hex && <Check size={18} />}</button>)}</div><label className="custom-color">Color personalizado<div><input type="color" aria-label="Color personalizado de pared" value={selectedColor} onChange={(e) => change({ ...room, wallColors: room.wallColors.map((c, i) => i === selectedWall ? e.target.value : c) })} /><span>{selectedColor.toUpperCase()}</span><Paintbrush size={14} /></div></label><button className="outline-button full-width" onClick={() => { change({ ...room, wallColors: room.wallColors.map(() => selectedColor) }); setNotice('Color aplicado a todas las paredes.'); }}><Layers3 size={14} /> Aplicar a todas las paredes</button></Section>
        <Section title="Suelo de madera"><div className="floor-swatches">{[['#b8956b', 'Roble natural'], ['#d2bd97', 'Roble claro'], ['#82624b', 'Nogal']] .map(([hex, name]) => <button key={hex} aria-label={`Suelo ${name}`} aria-pressed={room.floorColor === hex} onClick={() => change({ ...room, floorColor: hex })}><span style={{ background: hex }}>{room.floorColor === hex && <Check size={14} />}</span><small>{name}</small></button>)}</div></Section>
        
      </>}
      {tab === 'light' && <>
        <Section title="Luz natural"><div className="setting-row"><div className="setting-title"><Sun size={17} /><span>Luz del sol</span></div><Switch disabled={readOnly} label="Simular luz solar" checked={room.sun.enabled} onChange={(enabled) => change({ ...room, sun: { ...room.sun, enabled } })} /></div><div className={`sun-settings ${room.sun.enabled ? '' : 'disabled-look'}`}><div className="time-card"><Sun size={24} /><div><strong>{timeLabel(room.sun.hour)}</strong><span>{room.sun.hour < 6 || room.sun.hour >= 19 ? 'Noche' : room.sun.hour < 12 ? 'Luz de la mañana' : room.sun.hour < 17 ? 'Luz de la tarde' : 'Atardecer'}</span></div><span>HORA DEL DÍA</span></div><Slider label="Hora" value={room.sun.hour} min={0} max={24} step={0.25} valueLabel={timeLabel(room.sun.hour)} onChange={(hour) => change({ ...room, sun: { ...room.sun, hour } })} /><div className="range-labels"><span>00:00</span><span>12:00</span><span>24:00</span></div><Slider label="Orientación del sol" value={room.sun.azimuth} min={0} max={360} valueLabel={`${room.sun.azimuth}°`} onChange={(azimuth) => change({ ...room, sun: { ...room.sun, azimuth } })} /><Slider label="Intensidad solar" value={room.sun.intensity} min={0} max={10} step={0.1} valueLabel={`${room.sun.intensity.toFixed(1)}×`} onChange={(intensity) => change({ ...room, sun: { ...room.sun, intensity } })} /></div><p className="small-note">Trayectoria solar aproximada: 6:00–18:00. La orientación indica de dónde llega la luz.</p></Section>
        <Section title="Luz artificial" caption={`${room.lights.length} FOCOS`}><div className="light-card-list">{room.lights.map((light, i) => <div key={light.id} className={`light-card ${activeLight === light.id ? 'active' : ''}`}><div className="light-card-header"><button className="light-select" onClick={() => setActiveLight(activeLight === light.id ? null : light.id)}><span className={`bulb-icon ${light.enabled ? 'lit' : ''}`}><Lightbulb size={17} /></span><span>{light.name}<small>{light.lumens} lm · {light.temperature} K</small></span><ChevronDown size={13} /></button><Switch disabled={readOnly} label={`Interruptor de ${light.name}`} checked={light.enabled} onChange={(enabled) => updateLight(light.id, { enabled })} /></div>{(activeLight === light.id || (activeLight === null && room.lights.length === 1)) && <div className="light-fields"><Slider label={`Intensidad del foco ${i + 1}`} value={light.lumens} min={0} max={Math.max(3000, light.lumens)} step={50} valueLabel={`${light.lumens} lm`} onChange={(lumens) => updateLight(light.id, { lumens })} /><Slider label={`Temperatura del foco ${i + 1}`} value={light.temperature} min={1000} max={12000} step={100} valueLabel={`${light.temperature} K`} onChange={(temperature) => updateLight(light.id, { temperature })} /><div className="temperature-bar" /><div className="range-labels"><span>Cálida</span><span>Fría</span></div><div className="dimensions-grid"><NumberField label={`Posición X del foco ${i + 1}`} value={light.x} min={size.minX} max={size.maxX} onChange={(x) => updateLight(light.id, { x })} /><NumberField label={`Posición Z del foco ${i + 1}`} value={light.z} min={size.minZ} max={size.maxZ} onChange={(z) => updateLight(light.id, { z })} /><NumberField label={`Altura del foco ${i + 1}`} value={light.y} min={0.1} max={room.height} onChange={(y) => updateLight(light.id, { y })} /></div><button className="delete-button" onClick={() => { change({ ...room, lights: room.lights.filter((l) => l.id !== light.id) }); setActiveLight(null); }}><Trash2 size={13} /> Eliminar foco</button></div>}</div>)}</div><button className="outline-button full-width" onClick={insertLight}><Plus size={14} /> Agregar foco de luz</button></Section>
        
      </>}
    </fieldset>
    <div className="inspector-footer"><span className="status-dot" /> {readOnly ? 'Solo lectura' : 'Cambios en tiempo real'}</div>
  </>;

  return <div className={`studio ${leftOpen ? '' : 'left-collapsed'} ${rightOpen ? '' : 'right-collapsed'}`}>
    <header className="app-header">
      <div className="brand" aria-label="Espacio"><span className="brand-mark"><Box size={24} strokeWidth={1.5} /></span><strong>espacio<span>.</span></strong></div>
      <div className="header-divider" />
      <details className="file-menu"><summary>Archivo <ChevronDown size={12} /></summary><div>
        <button disabled={readOnly} onClick={() => importRef.current?.click()}><ArrowUpFromLine size={15} /> Abrir proyecto</button>
        <button onClick={exportRoom}><ArrowDownToLine size={15} /> Descargar copia</button>
        <a href="/"><Plus size={15} /> Nuevo espacio</a>
      </div></details>
      <div className="project-name"><span className="project-dot" /><input readOnly={readOnly} aria-label="Nombre del proyecto" value={room.name} maxLength={80} onChange={(e) => { if (e.target.value.trim()) change({ ...room, name: e.target.value }); }} /></div>
      <div className="header-actions">
        <span className="saved-status" role="status">{readOnly ? 'Solo lectura' : status === 'saving' ? <><LoaderCircle size={13} className="saving-spinner" />Guardando…</> : status === 'error' ? <><CircleHelp size={13} />No guardado</> : <><Check size={13} />Cambios guardados</>}</span>
        <button className="header-help icon-button" aria-label="Abrir guía rápida" onClick={() => setHelpOpen(true)}><CircleHelp size={18} /></button>
        <button className="save-button" disabled={status === 'saving' || status === 'error'} onClick={() => setShareOpen(true)}><Share2 size={15} /><span>Compartir</span></button>
      </div>
      <input ref={importRef} hidden type="file" accept="application/json,.json" onChange={(e) => void importRoom(e.target.files?.[0])} />
    </header>
    <div className="workspace-bar"><div className="workspace-label"><Box size={14} /><span>Mi espacio</span><ChevronRight size={12} /><strong>{room.name}</strong></div><div className="workspace-right"><span className="unit-label">{readOnly ? 'Solo lectura · metros' : 'Unidades: metros'}</span><button className="icon-button" aria-label="Restablecer vista" title="Restablecer vista" onClick={() => setResetKey((v) => v + 1)}><RotateCcw size={14} /></button></div></div>
    <aside className={`scene-panel ${mobilePanel === 'scene' ? 'mobile-open' : ''}`}>{scenePanel}</aside>
    <main className="viewport"><div className="viewport-top"><button className="icon-button tablet-only" aria-label="Mostrar explorador" aria-expanded={mobilePanel === 'scene'} onClick={() => setMobilePanel('scene')}><Menu size={17} /></button><div className="view-tabs" role="tablist" aria-label="Modo del visor"><button role="tab" aria-selected={mode !== 'plan'} className={mode !== 'plan' ? 'active' : ''} onClick={() => setMode('orbit')}><Box size={15} /> Vista 3D</button><button role="tab" aria-selected={mode === 'plan'} className={mode === 'plan' ? 'active' : ''} onClick={() => setMode('plan')}><Grid2X2 size={14} /> Planta 2D</button></div><button className={`walk-button ${mode === 'walk' ? 'active' : ''}`} onClick={() => setMode(mode === 'walk' ? 'orbit' : 'walk')}><Footprints size={15} />{mode === 'walk' ? 'Salir del recorrido' : 'Recorrer espacio'}</button></div>
      <div className="viewport-body">{mode === 'plan' ? <div className="large-plan"><PlanEditor room={room} onChange={change} selectedWall={selectedWall} onSelectWall={selectWall} selectedFurniture={activeFurniture} onSelectFurniture={(id) => selectFurniture(id, false)} large sketchUrl={sketchUrl} onSketchChange={uploadSketch} readOnly={readOnly} /></div> : <RoomScene room={room} mode={mode} selectedWall={selectedWall} onSelectWall={selectWall} selectedFurniture={activeFurniture} onFurnitureSelect={selectFurniture} showFurniture={showFurniture} resetKey={resetKey} />}
        {mode !== 'plan' && <><div className="view-title"><span className="view-title-dot" /><span>{mode === 'walk' ? 'Vista interior' : 'Perspectiva'}</span></div><div className="viewport-tools"><button className={tab === 'color' ? 'active' : ''} aria-label="Seleccionar y pintar pared" title="Seleccionar y pintar pared" onClick={() => openProperties('color')}><MousePointer2 size={18} /></button><button aria-label="Editar dimensiones" title="Dimensiones" onClick={() => openProperties('space')}><Ruler size={18} /></button><button aria-label="Editar colores" title="Colores" onClick={() => openProperties('color')}><Paintbrush size={18} /></button><span /><button aria-label="Editar iluminación" title="Iluminación" onClick={() => openProperties('light')}><Sun size={18} /></button><button aria-label="Editar muebles" title="Muebles" className={tab === 'furniture' ? 'active' : ''} onClick={() => openProperties('furniture')}><BedDouble size={18} /></button></div><div className="view-cube" aria-hidden="true"><svg viewBox="0 0 64 64"><path d="M32 7 55 20 32 34 9 20Z" fill="#fafbf8" /><path d="M9 20 32 34 32 58 9 44Z" fill="#e1e6dd" /><path d="M32 34 55 20 55 44 32 58Z" fill="#f0f2ed" /><path d="M32 7 55 20 55 44 32 58 9 44 9 20Z M9 20 32 34 55 20 M32 34V58" fill="none" stroke="#9aa390" strokeWidth="1" /><text x="32" y="23" textAnchor="middle">TOP</text></svg><span>Y</span></div><div className="viewport-bottom"><div className="navigation-hint"><MousePointer2 size={14} /><span>{mode === 'walk' ? 'Arrastra para mirar' : 'Arrastra para girar · Desliza para acercar'}</span></div><button className="focus-button" onClick={() => setResetKey((v) => v + 1)} aria-label="Centrar cámara"><Focus size={16} /><span>Centrar</span></button></div></>}
      </div>
      <div className="viewport-status"><div><span className="status-dot" /><span>{mode === 'walk' ? 'Vista interior' : mode === 'plan' ? 'Planta' : 'Vista exterior'}</span></div><span>{area.toFixed(1)} m² <span className="status-separator">·</span> {room.vertices.length} paredes</span></div>
      {!leftOpen && <button className="restore-panel restore-left desktop-only" aria-label="Mostrar explorador" onClick={() => setLeftOpen(true)}><Menu size={17} /></button>}{!rightOpen && <button className="restore-panel restore-right desktop-only" aria-label="Mostrar propiedades" onClick={() => setRightOpen(true)}><Settings2 size={17} /></button>}
    </main>
    <aside className={`properties-panel ${mobilePanel === 'properties' ? 'mobile-open' : ''}`}>{propertiesPanel}</aside>
    <nav className="mobile-nav" aria-label="Herramientas móviles"><button className={mobilePanel === 'scene' ? 'active' : ''} onClick={() => setMobilePanel(mobilePanel === 'scene' ? null : 'scene')}><Layers3 size={19} /><span>Escena</span></button><button className={mode === 'plan' ? 'active' : ''} onClick={() => { setMode(mode === 'plan' ? 'orbit' : 'plan'); setMobilePanel(null); }}><Grid2X2 size={19} /><span>Planta</span></button><button className={mode === 'walk' ? 'active' : ''} onClick={() => { setMode(mode === 'walk' ? 'orbit' : 'walk'); setMobilePanel(null); }}><Footprints size={19} /><span>Recorrer</span></button><button className={mobilePanel === 'properties' ? 'active' : ''} onClick={() => setMobilePanel(mobilePanel === 'properties' ? null : 'properties')}><Settings2 size={19} /><span>Propiedades</span></button></nav>
    {mobilePanel && <button className="mobile-backdrop" aria-label="Cerrar panel" onClick={() => setMobilePanel(null)} />}
    {ready && status === 'error' && <div className="save-error" role="alert"><CircleHelp size={17} /><span>{saveError}</span><button onClick={retry}>Reintentar</button><button aria-label="Descargar cambios sin guardar" onClick={exportRoom}><ArrowDownToLine size={15} /></button></div>}
    {notice && <div className="toast" role="status"><CircleHelp size={17} /><span>{notice}</span><button aria-label="Cerrar aviso" onClick={() => setNotice('')}><X size={15} /></button></div>}
    <dialog ref={shareRef} className="share-dialog" onCancel={() => setShareOpen(false)}>
      <button autoFocus className="icon-button dialog-close" aria-label="Cerrar compartir" onClick={() => setShareOpen(false)}><X size={20} /></button>
      <h2>Compartir proyecto</h2><p>Enlace de lectura</p>
      <input className="share-url" aria-label="Enlace del proyecto" readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
      <button className="primary-button" onClick={async () => { try { await navigator.clipboard.writeText(shareUrl); setNotice('Enlace copiado.'); setShareOpen(false); } catch { setNotice('Selecciona el enlace para copiarlo.'); } }}><Copy size={15} />Copiar enlace</button>
    </dialog>
    <dialog ref={helpRef} className="help-dialog" onCancel={() => setHelpOpen(false)}>
      <button autoFocus className="icon-button dialog-close" aria-label="Cerrar guía" onClick={() => setHelpOpen(false)}><X size={20} /></button>
      <h2>Controles</h2>
      <ol>
        <li><Ruler size={20} /><div><strong>Dimensiones</strong><span>Cambia las medidas en Espacio. En Planta 2D, carga un croquis y marca sus esquinas.</span></div></li>
        <li><DoorOpen size={20} /><div><strong>Puertas y ventanas</strong><span>Selecciona una pared, agrega una abertura y ajusta sus medidas y posición.</span></div></li>
        <li><Paintbrush size={20} /><div><strong>Color</strong><span>Selecciona una pared y elige su color.</span></div></li>
        <li><Sun size={20} /><div><strong>Luz</strong><span>Cambia la hora y orientación del sol. Agrega focos y ajusta su intensidad, temperatura e interruptor.</span></div></li>
        <li><Footprints size={20} /><div><strong>Recorrido</strong><span>Arrastra para mirar y mueve el joystick para caminar. Con teclado, usa WASD o las flechas para caminar, Q/E para girar y R/F para mirar arriba o abajo. En vista exterior, arrastra para girar y usa la rueda o dos dedos para acercar.</span></div></li>
      </ol>
      <div className="help-footnote">Los cambios se guardan automáticamente. Conserva la dirección de esta página para volver a editar. Los colores y la luz son aproximaciones visuales.</div>
      <button className="primary-button" onClick={() => setHelpOpen(false)}>Cerrar guía</button>
    </dialog>
  </div>;
}
