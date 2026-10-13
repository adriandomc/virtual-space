import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Archive, ArrowDownToLine, ArrowUpFromLine, BedDouble, Box, Check, ChevronDown, CircleHelp, Copy, DoorClosed, DoorOpen, Focus, Footprints, Grid2X2, Layers3, Lightbulb, LoaderCircle, Magnet, MousePointer2, Move, Paintbrush, PanelLeftClose, PanelRightClose, Plus, RotateCcw, Ruler, Settings2, Share2, Shield, Sun, Table2, Trash2, X } from 'lucide-react';
import RoomScene from './RoomScene';
import PlanEditor from './PlanEditor';
import useProject from './useProject';
import { normalizeHex } from './color';
import { addFurniture, addLight, addOpening, BED_SIZES, bounds, fitRoom, FURNITURE_COLORS, FURNITURE_LABELS, moveSceneItem, polygonArea, resizeRoom, validateRoom, wallLength } from './model';
import type { BedSize, FloorFinish, FurnitureItem, FurnitureMaterial, Opening, Room, RoomLight, Selection, ViewMode } from './types';

const COLORS = [
  ['#9cae98', 'Salvia suave'], ['#e7e3d9', 'Lino natural'], ['#d7c7b1', 'Arena'], ['#c4967c', 'Terracota'],
  ['#acbabc', 'Bruma azul'], ['#7e9390', 'Eucalipto'], ['#dad1c5', 'Piedra'], ['#b4ad9c', 'Oliva gris'],
  ['#d4b4ae', 'Rosa arcilla'], ['#8d9eaf', 'Azul pizarra'], ['#f3f0e9', 'Blanco cálido'], ['#646d64', 'Bosque'],
];
const FINISHES: [FloorFinish, string][] = [['wood', 'Madera'], ['tile-grid', 'Loseta'], ['tile-brick', 'Loseta trabada'], ['tile-checker', 'Damero'], ['marble', 'Mármol'], ['concrete', 'Concreto']];
const FURNITURE_ICONS = { bed: BedDouble, wardrobe: DoorClosed, vanity: Table2, nightstand: Archive };
const wallName = (index: number) => 'Pared ' + String(index + 1).padStart(2, '0');
const furnitureName = (item: FurnitureItem) => item.type === 'bed' ? 'Cama ' + BED_SIZES[item.bedSize ?? 'double'].label.toLowerCase() : FURNITURE_LABELS[item.type];
const timeLabel = (hour: number) => String(Math.floor(hour)).padStart(2, '0') + ':' + String(Math.round((hour % 1) * 60)).padStart(2, '0');
const sameSelection = (a: Selection | null, b: Selection) => JSON.stringify(a) === JSON.stringify(b);

function NumberField({ label, value, min, max, step = 0.1, unit = 'm', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(Number(value.toFixed(2))));
  useEffect(() => setDraft(String(Number(value.toFixed(2)))), [value]);
  return <label className="number-field"><span>{label}</span><div className="number-input"><input aria-label={label} type="number" inputMode="decimal" value={draft} min={min} max={max} step={step} onChange={event => {
    setDraft(event.target.value);
    const next = Number(event.target.value);
    if (event.target.value !== '' && Number.isFinite(next) && next >= min && next <= max) onChange(next);
  }} onBlur={() => setDraft(String(Number(value.toFixed(2))))} /><span>{unit}</span></div></label>;
}
function Slider({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (value: number) => void }) {
  return <label className="slider-field"><span><span>{label}</span><output>{Number(value.toFixed(2))} {unit}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} style={{ '--progress': (100 * (value - min) / (max - min)) + '%' } as CSSProperties} onChange={event => onChange(Number(event.target.value))} /></label>;
}
function Switch({ checked, label, onChange, disabled = false }: { checked: boolean; label: string; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className={'switch ' + (checked ? 'on' : '')} onClick={() => onChange(!checked)}><span /></button>;
}
function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return <details className="property-section" open={defaultOpen}><summary><ChevronDown size={14} /><span>{title}</span></summary><div className="section-body">{children}</div></details>;
}
function HexColorField({ value, onChange, readOnly, notify, label = 'Color personalizado' }: { value: string; onChange: (value: string) => void; readOnly: boolean; notify: (text: string) => void; label?: string }) {
  const inputId = useId();
  const [draft, setDraft] = useState(value.toUpperCase());
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(value.toUpperCase()), [value]);
  function apply() {
    if (readOnly) return;
    const normalized = normalizeHex(draft);
    if (normalized) { if (normalized !== value.toLowerCase()) onChange(normalized); setDraft(normalized.toUpperCase()); }
    else { setDraft(value.toUpperCase()); notify('Escribe un código hexadecimal de 3 o 6 dígitos.'); }
  }
  return <div className="hex-field"><label htmlFor={inputId}>{label}</label><div>
    <input type="color" aria-label="Elegir color personalizado" disabled={readOnly} value={value} onChange={event => onChange(event.target.value)} />
    <input ref={input} id={inputId} className="hex-code-input" aria-label="Código hexadecimal" readOnly={readOnly} value={draft} maxLength={9} spellCheck={false} autoCapitalize="characters" onChange={event => {
      setDraft(event.target.value);
      const normalized = normalizeHex(event.target.value);
      if (/^#?[\da-f]{6}$/i.test(event.target.value.trim()) && normalized !== value.toLowerCase()) onChange(normalized!);
    }} onBlur={apply} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }} />
    <button type="button" className="icon-button" aria-label="Copiar código hexadecimal" title="Copiar código" onClick={async () => { try { await navigator.clipboard.writeText(value.toUpperCase()); notify('Código copiado.'); } catch { input.current?.select(); notify('Selecciona el código para copiarlo.'); } }}><Copy size={15} /></button>
  </div></div>;
}

export default function App({ onHome = () => window.location.assign('/') }: { onHome?: () => void }) {
  const { room, setRoom, ready, status, error: saveError, readOnly, shareUrl, shared, setSharing, uploadSketch, sketchUrl, retry } = useProject();
  const [mode, setMode] = useState<ViewMode>('orbit');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [transformMode, setTransformMode] = useState<'translate' | 'rotate'>('translate');
  const [tab, setTab] = useState<'item' | 'space' | 'color' | 'light'>('space');
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'scene' | 'properties' | null>(null);
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 1000px)').matches);
  const [resetKey, setResetKey] = useState(0);
  const [notice, setNotice] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharingBusy] = useState(false);
  const [shareError, setShareError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const helpRef = useRef<HTMLDialogElement>(null);
  const shareRef = useRef<HTMLDialogElement>(null);
  const addRef = useRef<HTMLDialogElement>(null);
  const optionsRef = useRef<HTMLDetailsElement>(null);
  const fileRef = useRef<HTMLDetailsElement>(null);
  const size = bounds(room.vertices);
  const area = polygonArea(room.vertices);
  const furniture = selection?.kind === 'furniture' ? room.furniture.find(item => item.id === selection.id) : undefined;
  const opening = selection?.kind === 'opening' ? room.openings.find(item => item.id === selection.id) : undefined;
  const light = selection?.kind === 'light' ? room.lights.find(item => item.id === selection.id) : undefined;
  const selectedWall = selection?.kind === 'wall' && selection.index < room.vertices.length ? selection.index : 0;
  const surface = selection?.kind === 'floor' ? 'floor' : selection?.kind === 'ceiling' ? 'ceiling' : 'wall';
  const surfaceName = surface === 'floor' ? 'Piso' : surface === 'ceiling' ? 'Techo' : wallName(selectedWall);
  const selectedColor = surface === 'floor' ? room.floorColor : surface === 'ceiling' ? room.ceilingColor : room.wallColors[selectedWall];
  const selectedName = furniture ? furnitureName(furniture) : opening ? opening.type === 'door' ? 'Puerta' : 'Ventana' : light ? light.name : selection ? surfaceName : '';
  const paletteName = COLORS.find(([hex]) => hex === selectedColor.toLowerCase())?.[1] ?? selectedColor.toUpperCase();
  const usedColors = [...new Set([...room.wallColors, room.ceilingColor, room.floorColor].map(hex => hex.toLowerCase()))];
  const propertiesVisible = compact ? mobilePanel === 'properties' : rightOpen;
  const elementsVisible = compact ? mobilePanel === 'scene' : leftOpen;

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
  useEffect(() => { if (helpOpen) helpRef.current?.showModal(); else helpRef.current?.close(); }, [helpOpen]);
  useEffect(() => { if (shareOpen) shareRef.current?.showModal(); else shareRef.current?.close(); }, [shareOpen]);
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
    if (selection.kind === 'wall' && selection.index >= room.vertices.length || selection.kind === 'furniture' && !furniture || selection.kind === 'opening' && !opening || selection.kind === 'light' && !light) setSelection(null);
  }, [selection, room, furniture, opening, light]);

  if (!ready) return <main className="project-loading">{status === 'error' ? <><CircleHelp size={22} /><p>{saveError}</p><button className="primary-button" onClick={retry}>Reintentar</button><a href="/">Mis diseños</a></> : <><LoaderCircle size={23} /><span>Cargando proyecto…</span></>}</main>;

  async function changeSharing(enabled: boolean) {
    if (sharing) return;
    setSharingBusy(true); setShareError('');
    try { await setSharing(enabled); }
    catch (cause) { setShareError(cause instanceof Error ? cause.message : 'No se pudo cambiar el enlace.'); }
    finally { setSharingBusy(false); }
  }

  function change(next: Room | (() => Room)) {
    if (readOnly) return;
    try {
      const validated = validateRoom(typeof next === 'function' ? next() : next);
      if (JSON.stringify(validated) !== JSON.stringify(room)) setRoom(validated);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No se pudo aplicar el cambio.'); }
  }
  function showProperties(nextTab: typeof tab = tab) {
    setTab(nextTab); setRightOpen(true); setMobilePanel(compact ? 'properties' : null);
  }
  function toggleElements() {
    if (compact) setMobilePanel(panel => panel === 'scene' ? null : 'scene');
    else setLeftOpen(open => !open);
  }
  function select(next: Selection | null, properties = false) {
    setSelection(next); setTransformMode('translate');
    const nextTab = next && ['wall', 'floor', 'ceiling'].includes(next.kind) ? 'color' : 'item';
    setTab(nextTab);
    if (next && (properties || (!compact && mode !== 'plan'))) showProperties(nextTab);
  }
  function setBounds(enabled: boolean) {
    change(() => enabled ? fitRoom({ ...room, editing: { ...room.editing, bounds: true } }) : { ...room, editing: { ...room.editing, bounds: false } });
  }
  function paint(hex: string) {
    change(surface === 'floor' ? { ...room, floorColor: hex } : surface === 'ceiling' ? { ...room, ceilingColor: hex } : { ...room, wallColors: room.wallColors.map((value, index) => index === selectedWall ? hex : value) });
  }
  function updateFurniture(patch: Partial<FurnitureItem>) {
    if (!furniture) return;
    if ('x' in patch || 'z' in patch || 'rotation' in patch) change(() => moveSceneItem(room, { kind: 'furniture', id: furniture.id }, { x: patch.x ?? furniture.x, z: patch.z ?? furniture.z, rotation: patch.rotation ?? furniture.rotation }));
    else change({ ...room, furniture: room.furniture.map(item => item.id === furniture.id ? { ...item, ...patch } : item) });
  }
  function updateOpening(patch: Partial<Opening>) {
    if (opening) change(() => fitRoom({ ...room, openings: room.openings.map(item => item.id === opening.id ? { ...item, ...patch } : item) }));
  }
  function updateLight(patch: Partial<RoomLight>) {
    if (!light) return;
    if ('x' in patch || 'z' in patch || 'y' in patch) change(() => moveSceneItem(room, { kind: 'light', id: light.id }, { x: patch.x ?? light.x, z: patch.z ?? light.z, y: patch.y ?? light.y }));
    else change({ ...room, lights: room.lights.map(item => item.id === light.id ? { ...item, ...patch } : item) });
  }
  function removeSelected() {
    if (readOnly || !selection) return;
    if (selection.kind === 'furniture') change({ ...room, furniture: room.furniture.filter(item => item.id !== selection.id) });
    if (selection.kind === 'opening') change({ ...room, openings: room.openings.filter(item => item.id !== selection.id) });
    if (selection.kind === 'light') change({ ...room, lights: room.lights.filter(item => item.id !== selection.id) });
    setSelection(null);
  }
  function insert(type: FurnitureItem['type'] | Opening['type'] | 'light', bedSize: BedSize = 'double') {
    if (readOnly) return;
    try {
      const next = type === 'door' || type === 'window' ? addOpening(room, type, selectedWall) : type === 'light' ? addLight(room) : addFurniture(room, type, bedSize);
      change(next); setAddOpen(false);
      const nextSelection: Selection = type === 'door' || type === 'window' ? { kind: 'opening', id: next.openings.at(-1)!.id } : type === 'light' ? { kind: 'light', id: next.lights.at(-1)!.id } : { kind: 'furniture', id: next.furniture.at(-1)!.id };
      select(nextSelection); setMobilePanel(null);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'No hay espacio para el elemento.'); }
  }
  function exportRoom() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(room, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = (room.name.replace(/[^a-zA-Z0-9áéíóúñ _-]/g, '').trim() || 'habitacion') + '.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importRoom(file?: File) {
    if (!file || readOnly) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('El proyecto debe pesar menos de 1 MB.');
      const next = validateRoom(JSON.parse(await file.text()));
      change(next); select(null); setResetKey(value => value + 1); setNotice('Proyecto abierto.');
    } catch (error) { setNotice(error instanceof SyntaxError ? 'El archivo no es un proyecto válido.' : error instanceof Error ? error.message : 'No se pudo abrir el archivo.'); }
    if (importRef.current) importRef.current.value = '';
  }
  const items: { selection: Selection; name: string; Icon: typeof Box }[] = [
    ...room.vertices.map((_, index) => ({ selection: { kind: 'wall', index } as Selection, name: wallName(index), Icon: Layers3 })),
    { selection: { kind: 'floor' }, name: 'Piso', Icon: Grid2X2 }, { selection: { kind: 'ceiling' }, name: 'Techo', Icon: Box },
    ...room.openings.map((item, index) => ({ selection: { kind: 'opening', id: item.id } as Selection, name: (item.type === 'door' ? 'Puerta' : 'Ventana') + ' ' + (index + 1), Icon: item.type === 'door' ? DoorOpen : Grid2X2 })),
    ...room.lights.map(item => ({ selection: { kind: 'light', id: item.id } as Selection, name: item.name, Icon: Lightbulb })),
    ...room.furniture.map((item, index) => ({ selection: { kind: 'furniture', id: item.id } as Selection, name: furnitureName(item) + ' ' + (index + 1), Icon: FURNITURE_ICONS[item.type] })),
  ];

  const scenePanel = <>
    <div className="panel-heading"><span>Elementos</span><button className="icon-button desktop-only" aria-label="Ocultar elementos" onClick={() => setLeftOpen(false)}><PanelLeftClose size={18} /></button><button className="icon-button mobile-only" aria-label="Cerrar elementos" onClick={() => setMobilePanel(null)}><X size={20} /></button></div>
    <div className="room-tree-title"><Box size={16} /><span>{room.name}</span><span className="item-count">{items.length}</span></div>
    <div className="unified-item-list">{items.map(item => <button key={JSON.stringify(item.selection)} className={'tree-item ' + (sameSelection(selection, item.selection) ? 'selected' : '')} onClick={() => select(item.selection, true)}><item.Icon size={15} /><span>{item.name}</span>{item.selection.kind === 'wall' && <span className="wall-color-dot" style={{ background: room.wallColors[item.selection.index] }} />}</button>)}</div>
  </>;

  const itemPanel = <>
    {!selection && <div className="empty-inspector"><MousePointer2 size={23} /><p>Selecciona un elemento en la escena o en la planta.</p><button className="outline-button" disabled={readOnly} onClick={() => setAddOpen(true)}><Plus size={14} />Agregar elemento</button></div>}
    {selection && !furniture && !opening && !light && <div className="empty-inspector"><Paintbrush size={22} /><p>{surfaceName}</p><button className="outline-button" onClick={() => setTab('color')}>Editar material</button></div>}
    {furniture && <Section title={furniture.type === 'bed' ? 'Estructura' : 'Material'}>
      <label className="select-field">Material<select aria-label="Material del mueble" disabled={readOnly} value={furniture.material ?? 'wood'} onChange={event => updateFurniture({ material: event.target.value as FurnitureMaterial })}><option value="wood">Madera</option><option value="plastic">Plástico</option><option value="metal">Metal</option></select></label>
      <HexColorField value={furniture.color ?? FURNITURE_COLORS[furniture.type]} onChange={color => updateFurniture({ color })} readOnly={readOnly} notify={setNotice} label="Color del material" />
    </Section>}
    <fieldset disabled={readOnly} className="property-fields">
      {furniture && <Section title={furnitureName(furniture)}>
        {furniture.type === 'bed' && <label className="select-field">Tamaño<select aria-label="Tamaño de cama" value={furniture.bedSize} onChange={event => { const bedSize = event.target.value as BedSize; updateFurniture({ bedSize, width: BED_SIZES[bedSize].width, depth: BED_SIZES[bedSize].depth }); }}>{Object.entries(BED_SIZES).map(([key, preset]) => <option key={key} value={key}>{preset.label}</option>)}</select></label>}
        <div className="dimensions-grid"><NumberField label="Ancho" value={furniture.width} min={0.1} max={10} onChange={width => updateFurniture({ width })} /><NumberField label="Largo" value={furniture.depth} min={0.1} max={10} onChange={depth => updateFurniture({ depth })} /><NumberField label="Altura" value={furniture.height} min={0.1} max={room.height} onChange={height => updateFurniture({ height })} /></div>
      </Section>}
      {furniture && <Section title="Posición y giro" defaultOpen={false}><div className="dimensions-grid"><NumberField label="Giro" value={furniture.rotation} min={0} max={360} step={15} unit="°" onChange={rotation => updateFurniture({ rotation })} /><NumberField label="Posición X" value={furniture.x} min={-50} max={50} onChange={x => updateFurniture({ x })} /><NumberField label="Posición Z" value={furniture.z} min={-50} max={50} onChange={z => updateFurniture({ z })} /></div></Section>}
      {opening && <Section title={opening.type === 'door' ? 'Puerta' : 'Ventana'}>
        <label className="select-field">Pared<select aria-label="Pared del elemento" value={opening.wall} onChange={event => updateOpening({ wall: Number(event.target.value) })}>{room.vertices.map((_, index) => <option key={index} value={index}>{wallName(index)}</option>)}</select></label>
        <div className="dimensions-grid"><NumberField label="Ancho" value={opening.width} min={0.3} max={wallLength(room, opening.wall)} onChange={width => updateOpening({ width })} /><NumberField label="Altura" value={opening.height} min={0.3} max={room.height} onChange={height => updateOpening({ height })} />{opening.type === 'window' && <NumberField label="Altura desde piso" value={opening.sill} min={0} max={room.height - opening.height} onChange={sill => updateOpening({ sill })} />}</div>
      </Section>}
      {opening && <Section title="Posición" defaultOpen={false}><NumberField label="Desde el inicio de la pared" value={opening.offset} min={0} max={wallLength(room, opening.wall) - opening.width} onChange={offset => updateOpening({ offset })} /></Section>}
      {light && <Section title={light.name}>
        <div className="setting-row"><span>Encendido</span><Switch label="Interruptor del foco" checked={light.enabled} onChange={enabled => updateLight({ enabled })} /></div>
        <Slider label="Intensidad" value={light.lumens} min={0} max={Math.max(3000, light.lumens)} step={50} unit="lm" onChange={lumens => updateLight({ lumens })} /><Slider label="Temperatura" value={light.temperature} min={1000} max={12000} step={100} unit="K" onChange={temperature => updateLight({ temperature })} />
      </Section>}
      {light && <Section title="Posición" defaultOpen={false}><div className="dimensions-grid"><NumberField label="Posición X" value={light.x} min={-50} max={50} onChange={x => updateLight({ x })} /><NumberField label="Posición Z" value={light.z} min={-50} max={50} onChange={z => updateLight({ z })} /><NumberField label="Altura" value={light.y} min={0.1} max={room.height} onChange={y => updateLight({ y })} /></div></Section>}
      {(furniture || opening || light) && <div className="item-actions"><button className="outline-button" onClick={() => { setMode('plan'); setMobilePanel(null); }}><Grid2X2 size={15} />Editar en planta</button><button className="delete-button" onClick={removeSelected}><Trash2 size={14} />Eliminar elemento</button></div>}
    </fieldset>
  </>;

  const colorPanel = <>
    <Section title="Superficie"><div className="wall-chips">{room.vertices.map((_, index) => <button key={index} className={surface === 'wall' && selectedWall === index ? 'active' : ''} aria-label={'Seleccionar ' + wallName(index)} onClick={() => select({ kind: 'wall', index })}><span style={{ background: room.wallColors[index] }} />{index + 1}</button>)}<button className={surface === 'floor' ? 'active' : ''} onClick={() => select({ kind: 'floor' })}>Piso</button><button className={surface === 'ceiling' ? 'active' : ''} onClick={() => select({ kind: 'ceiling' })}>Techo</button></div></Section>
    <Section title={'Color · ' + surfaceName}><div className="selected-paint"><span style={{ background: selectedColor }} /><div><strong>{paletteName}</strong><small>{selectedColor.toUpperCase()}</small></div></div>
      <div className="color-palette">{COLORS.map(([hex, name]) => <button key={hex} disabled={readOnly} aria-label={'Pintar ' + surfaceName + ': ' + name} title={name} aria-pressed={selectedColor.toLowerCase() === hex} className={selectedColor.toLowerCase() === hex ? 'selected' : ''} style={{ background: hex }} onClick={() => paint(hex)}>{selectedColor.toLowerCase() === hex && <Check size={18} />}</button>)}</div>
      <HexColorField value={selectedColor} onChange={paint} readOnly={readOnly} notify={setNotice} />
      <span className="field-label">En este cuarto</span><div className="used-colors">{usedColors.map(hex => <button key={hex} disabled={readOnly} aria-label={'Usar color ' + hex} title={hex.toUpperCase()} style={{ background: hex }} onClick={() => paint(hex)}>{selectedColor.toLowerCase() === hex && <Check size={14} />}</button>)}</div>
      {surface === 'wall' && <button disabled={readOnly} className="outline-button full-width" onClick={() => change({ ...room, wallColors: room.wallColors.map(() => selectedColor) })}><Layers3 size={14} />Aplicar a todas las paredes</button>}
    </Section>
    {surface === 'floor' && <Section title="Acabado del piso"><div className="finish-grid">{FINISHES.map(([finish, name]) => <button key={finish} disabled={readOnly} aria-pressed={room.floorFinish === finish} aria-label={'Piso ' + name} onClick={() => change({ ...room, floorFinish: finish })}><span className={'finish-preview ' + finish} style={{ '--floor-color': room.floorColor } as CSSProperties}>{room.floorFinish === finish && <Check size={16} />}</span><small>{name}</small></button>)}</div></Section>}
  </>;

  const spacePanel = <fieldset disabled={readOnly} className="property-fields">
    <Section title="Dimensiones"><div className="dimensions-grid"><NumberField label="Ancho del cuarto" value={size.width} min={0.5} max={50} onChange={width => change(() => resizeRoom(room, width, size.depth))} /><NumberField label="Largo del cuarto" value={size.depth} min={0.5} max={50} onChange={depth => change(() => resizeRoom(room, size.width, depth))} /><NumberField label="Altura del cuarto" value={room.height} min={1.8} max={8} onChange={height => change(() => fitRoom({ ...room, height }))} /></div><div className="area-tag"><Ruler size={16} />{area.toFixed(2)} m²</div><button className="outline-button full-width" onClick={() => { setMode('plan'); setMobilePanel(null); }}><Grid2X2 size={17} />Editar planta</button></Section>
    <Section title="Más opciones" defaultOpen={false}><NumberField label="Espesor de muro" value={room.thickness} min={0.05} max={0.6} step={0.01} onChange={thickness => change({ ...room, thickness })} /><div className="setting-row example-furniture"><span>Mobiliario de ejemplo</span><Switch checked={room.showFurniture} disabled={room.furniture.length > 0} label="Mostrar mobiliario de ejemplo" onChange={showFurniture => change({ ...room, showFurniture })} /></div></Section>
  </fieldset>;

  const lightPanel = <>
    <fieldset disabled={readOnly} className="property-fields"><Section title="Sol"><div className="setting-row"><span>Luz del sol</span><Switch label="Activar luz del sol" checked={room.sun.enabled} onChange={enabled => change({ ...room, sun: { ...room.sun, enabled } })} /></div>
      <div className="time-card"><Sun size={23} /><strong>{timeLabel(room.sun.hour)}</strong></div><Slider label="Hora del día" value={room.sun.hour} min={0} max={24} step={0.25} unit="h" onChange={hour => change({ ...room, sun: { ...room.sun, hour } })} />
    </Section><Section title="Ajustes del sol" defaultOpen={false}><Slider label="Orientación" value={room.sun.azimuth} min={0} max={360} unit="°" onChange={azimuth => change({ ...room, sun: { ...room.sun, azimuth } })} /><Slider label="Intensidad solar" value={room.sun.intensity} min={0} max={10} step={0.1} unit="×" onChange={intensity => change({ ...room, sun: { ...room.sun, intensity } })} /></Section></fieldset>
    <Section title="Focos">{room.lights.map(item => <div className="light-list-row" key={item.id}><button onClick={() => select({ kind: 'light', id: item.id }, true)}><Lightbulb size={16} />{item.name}</button><Switch label={'Encender ' + item.name} disabled={readOnly} checked={item.enabled} onChange={enabled => change({ ...room, lights: room.lights.map(value => value.id === item.id ? { ...value, enabled } : value) })} /></div>)}<button disabled={readOnly} className="outline-button full-width" onClick={() => insert('light')}><Plus size={14} />Agregar foco</button></Section>
  </>;

  const propertiesPanel = <>
    <div className="panel-heading"><span>Propiedades</span><button className="icon-button desktop-only" aria-label="Ocultar propiedades" onClick={() => setRightOpen(false)}><PanelRightClose size={18} /></button><button className="icon-button mobile-only" aria-label="Cerrar propiedades" onClick={() => setMobilePanel(null)}><X size={20} /></button></div>
    <div className="inspector-title"><span className="inspector-icon">{tab === 'color' ? <Paintbrush size={19} /> : tab === 'light' ? <Sun size={19} /> : tab === 'space' ? <Ruler size={19} /> : <Box size={19} />}</span><h2>{tab === 'item' ? selectedName || 'Elemento' : tab === 'space' ? 'Cuarto' : tab === 'color' ? 'Materiales' : 'Iluminación'}</h2></div>
    <div className="inspector-content" id={'panel-' + tab}>{tab === 'item' ? itemPanel : tab === 'space' ? spacePanel : tab === 'color' ? colorPanel : lightPanel}</div>
  </>;

  return <div className={'studio editor-ui ' + (leftOpen ? '' : 'left-collapsed') + ' ' + (rightOpen ? '' : 'right-collapsed')}>
    <header className="app-header"><div className="brand"><span className="brand-mark"><Box size={24} strokeWidth={1.5} /></span><strong>espacio<span>.</span></strong></div><div className="header-divider" />
      <details ref={fileRef} className="file-menu"><summary onClick={() => setMobilePanel(null)}>Archivo <ChevronDown size={16} /></summary><div><button disabled={readOnly} onClick={() => { importRef.current?.click(); if (fileRef.current) fileRef.current.open = false; }}><ArrowUpFromLine size={17} />Abrir proyecto</button><button onClick={() => { exportRoom(); if (fileRef.current) fileRef.current.open = false; }}><ArrowDownToLine size={17} />Descargar copia</button></div></details>
      <button className="editor-home" aria-label="Mis diseños" title="Mis diseños" onClick={onHome}><Layers3 size={19} /><span>Mis diseños</span></button>
      <div className="project-name"><span className="project-dot" /><input aria-label="Nombre del proyecto" readOnly={readOnly} value={room.name} maxLength={80} onChange={event => { if (event.target.value.trim()) change({ ...room, name: event.target.value }); }} /></div>
      <div className="header-actions"><span className="saved-status" role="status">{readOnly ? 'Solo lectura' : status === 'saving' ? <><LoaderCircle size={16} className="saving-spinner" />Guardando…</> : status === 'error' ? <><CircleHelp size={16} />No guardado</> : <><Check size={16} />Guardado</>}</span><button className="header-help icon-button" aria-label="Controles" onClick={() => setHelpOpen(true)}><CircleHelp size={20} /></button><button className="save-button" aria-label="Compartir diseño" disabled={status === 'saving' || status === 'error'} onClick={() => setShareOpen(true)}><Share2 size={18} /><span>Compartir</span></button></div>
      <input ref={importRef} hidden type="file" accept="application/json,.json" onChange={event => void importRoom(event.target.files?.[0])} />
    </header>
    <div className="workspace-bar"><nav className="workspace-tools" aria-label="Herramientas del cuarto"><button aria-expanded={elementsVisible} className={elementsVisible ? 'active' : ''} onClick={toggleElements}><Layers3 size={18} /><span>Elementos</span></button>{([['space', Ruler, 'Cuarto'], ['color', Paintbrush, 'Materiales'], ['light', Sun, 'Luz']] as const).map(([key, Icon, name]) => <button key={key} aria-controls={'panel-' + key} aria-expanded={tab === key && propertiesVisible} className={tab === key && propertiesVisible ? 'active' : ''} onClick={() => showProperties(key)}><Icon size={18} /><span>{name}</span></button>)}</nav><details ref={optionsRef} className="view-options"><summary aria-label="Opciones de vista" title="Opciones de vista" onClick={() => setMobilePanel(null)}><Settings2 size={20} /></summary><div className="view-options-content"><fieldset disabled={readOnly} className="property-fields"><Section title="Calidad visual"><div className="quality-switch" role="group" aria-label="Calidad visual">{(['standard', 'realistic', 'hyperrealistic'] as const).map(quality => <button key={quality} aria-pressed={room.renderQuality === quality} className={room.renderQuality === quality ? 'active' : ''} onClick={() => change({ ...room, renderQuality: quality })}>{quality === 'standard' ? 'Estándar' : quality === 'realistic' ? 'Realista' : 'Hiperrealista'}</button>)}</div></Section><Section title="Movimiento" defaultOpen={false}><label className="check-field"><input type="checkbox" checked={room.editing.snap} onChange={event => change({ ...room, editing: { ...room.editing, snap: event.target.checked } })} /><Magnet size={17} />Ajustar a cuadrícula</label><NumberField label="Paso de ajuste" value={room.editing.step} min={0.01} max={1} step={0.01} onChange={step => change({ ...room, editing: { ...room.editing, step } })} /><label className="check-field"><input type="checkbox" checked={room.editing.bounds} onChange={event => setBounds(event.target.checked)} /><Shield size={17} />Respetar límites y colisiones</label></Section></fieldset><button className="view-options-help" onClick={() => { if (optionsRef.current) optionsRef.current.open = false; setHelpOpen(true); }}><CircleHelp size={18} />Controles</button></div></details></div>
    <aside className={'scene-panel ' + (mobilePanel === 'scene' ? 'mobile-open' : '')}>{scenePanel}</aside>
    <main className="viewport">
      <div className="viewport-top editor-toolbar">
        <div className="view-tabs" role="tablist" aria-label="Vista"><button role="tab" aria-selected={mode !== 'plan'} className={mode !== 'plan' ? 'active' : ''} onClick={() => setMode('orbit')}><Box size={18} />3D</button><button role="tab" aria-selected={mode === 'plan'} className={mode === 'plan' ? 'active' : ''} onClick={() => setMode('plan')}><Grid2X2 size={18} />Planta</button></div>
        <button className="add-toolbar-button" aria-label="Agregar elemento" title="Agregar elemento" disabled={readOnly} onClick={() => { setAddOpen(true); setMobilePanel(null); }}><Plus size={18} /><span>Agregar</span></button>
        <button className={'walk-button ' + (mode === 'walk' ? 'active' : '')} onClick={() => { setMode(mode === 'walk' ? 'orbit' : 'walk'); setMobilePanel(null); }}><Footprints size={18} />{mode === 'walk' ? 'Salir' : 'Recorrer'}</button>
      </div>
      <div className="viewport-body">
        {mode === 'plan' ? <div className="large-plan"><PlanEditor room={room} onChange={change} selection={selection} onSelect={next => select(next)} large sketchUrl={sketchUrl} onSketchChange={uploadSketch} readOnly={readOnly} /></div> : <RoomScene room={room} mode={mode} selection={selection} onSelect={next => select(next)} onChange={change} readOnly={readOnly} transformMode={transformMode} showFurniture={room.showFurniture} resetKey={resetKey} />}
        {mode !== 'plan' && <><div className="view-title"><span className="view-title-dot" />{mode === 'walk' ? 'Vista interior' : 'Perspectiva'}</div><div className="viewport-bottom"><div className="navigation-hint"><MousePointer2 size={13} />{mode === 'walk' ? 'Arrastra para mirar' : !readOnly && selection && (furniture || opening || light) ? 'Arrastra el elemento o sus controles' : 'Toca para seleccionar · Arrastra para girar'}</div><button className="focus-button" aria-label="Restablecer vista" onClick={() => setResetKey(value => value + 1)}><Focus size={16} /></button></div></>}
        {selection && mode !== 'walk' && <div className="selection-dock"><span>{selectedName}</span>{(furniture || opening || light) && !readOnly && <><button className={transformMode === 'translate' ? 'active' : ''} aria-label="Mover elemento" title="Mover elemento" aria-pressed={transformMode === 'translate'} onClick={() => setTransformMode('translate')}><Move size={18} /><span>Mover</span></button>{furniture && <button className={transformMode === 'rotate' ? 'active' : ''} aria-label="Girar elemento" title="Girar elemento" aria-pressed={transformMode === 'rotate'} onClick={() => setTransformMode('rotate')}><RotateCcw size={18} /><span>Girar</span></button>}</>}<button aria-label="Propiedades del elemento" onClick={() => showProperties(selection.kind === 'wall' || selection.kind === 'floor' || selection.kind === 'ceiling' ? 'color' : 'item')}><Settings2 size={19} /><span>Propiedades</span></button>{(furniture || opening || light) && !readOnly && <button aria-label="Eliminar elemento seleccionado" onClick={removeSelected}><Trash2 size={18} /></button>}<button aria-label="Deseleccionar elemento" onClick={() => select(null)}><X size={18} /></button></div>}
      </div>
      <div className="viewport-status"><span>{readOnly ? 'Solo lectura' : status === 'saving' ? 'Guardando…' : status === 'error' ? 'No guardado' : 'Guardado'}</span><span>{area.toFixed(1)} m² · {room.vertices.length} paredes</span></div>
    </main>
    <aside className={'properties-panel ' + (mobilePanel === 'properties' ? 'mobile-open' : '')}>{propertiesPanel}</aside>
    {mobilePanel && <button className="mobile-backdrop" aria-label="Cerrar panel" onClick={() => setMobilePanel(null)} />}
    {status === 'error' && <div className="save-error" role="alert"><CircleHelp size={17} /><span>{saveError}</span><button onClick={retry}>Reintentar</button><button aria-label="Descargar cambios sin guardar" onClick={exportRoom}><ArrowDownToLine size={15} /></button></div>}
    {notice && <div className="toast" role="status"><CircleHelp size={17} /><span>{notice}</span><button aria-label="Cerrar aviso" onClick={() => setNotice('')}><X size={15} /></button></div>}
    <dialog ref={addRef} className="add-dialog" onCancel={() => setAddOpen(false)}><button autoFocus className="icon-button dialog-close" aria-label="Cerrar agregar" onClick={() => setAddOpen(false)}><X size={20} /></button><h2>Agregar elemento</h2><div className="add-item-grid"><button onClick={() => insert('door')}><DoorOpen size={24} /><span>Puerta</span></button><button onClick={() => insert('window')}><Grid2X2 size={24} /><span>Ventana</span></button><button onClick={() => insert('light')}><Lightbulb size={24} /><span>Foco</span></button>{Object.entries(BED_SIZES).map(([key, preset]) => <button key={key} onClick={() => insert('bed', key as BedSize)}><BedDouble size={25} /><span>Cama {preset.label.toLowerCase()}</span></button>)}{(['wardrobe', 'vanity', 'nightstand'] as const).map(type => { const Icon = FURNITURE_ICONS[type]; return <button key={type} onClick={() => insert(type)}><Icon size={24} /><span>{FURNITURE_LABELS[type]}</span></button>; })}</div></dialog>
    <dialog ref={shareRef} className="share-dialog" onCancel={() => setShareOpen(false)}><button autoFocus className="icon-button dialog-close" aria-label="Cerrar compartir" onClick={() => setShareOpen(false)}><X size={20} /></button><h2>Compartir diseño</h2>{shared ? <><p>Enlace de lectura</p><input className="share-url" aria-label="Enlace del proyecto" readOnly value={shareUrl} onFocus={event => event.target.select()} /><button className="primary-button" onClick={async () => { try { await navigator.clipboard.writeText(shareUrl); setNotice('Enlace copiado.'); setShareOpen(false); } catch { setNotice('Selecciona el enlace para copiarlo.'); } }}><Copy size={15} />Copiar enlace</button>{!readOnly && <button className="outline-button full-width share-disable" disabled={sharing} onClick={() => void changeSharing(false)}>Desactivar enlace</button>}</> : !readOnly && <button className="primary-button" disabled={sharing} onClick={() => void changeSharing(true)}>{sharing ? <LoaderCircle size={16} className="saving-spinner" /> : <Share2 size={16} />}Crear enlace</button>}{shareError && <p className="share-error" role="alert">{shareError}</p>}</dialog>
    <dialog ref={helpRef} className="help-dialog" onCancel={() => setHelpOpen(false)}><button autoFocus className="icon-button dialog-close" aria-label="Cerrar controles" onClick={() => setHelpOpen(false)}><X size={20} /></button><h2>Controles</h2><ol><li><MousePointer2 size={20} /><div><strong>Seleccionar</strong><span>Toca un elemento en la escena o en la planta.</span></div></li><li><Move size={20} /><div><strong>Mover y girar</strong><span>Arrastra el elemento o los controles de colores. Usa Mover y Girar para cambiar de herramienta. Puertas y ventanas se ajustan a la pared más cercana.</span></div></li><li><Magnet size={20} /><div><strong>Ajuste y límites</strong><span>Ajuste mueve por pasos de cuadrícula. Límites evita salir del cuarto y atravesar otros muebles. Desactívalos para mover libremente.</span></div></li><li><Grid2X2 size={20} /><div><strong>Dibujar</strong><span>En Planta 2D, marca esquinas sobre la cuadrícula. Líneas rectas fija la dirección a los ángulos elegidos. Toca el primer punto para cerrar.</span></div></li><li><Paintbrush size={20} /><div><strong>Materiales</strong><span>Selecciona pared, techo o piso. Escribe o pega un código hexadecimal; los colores del cuarto quedan disponibles en la paleta.</span></div></li><li><Footprints size={20} /><div><strong>Recorrido</strong><span>Arrastra para mirar. Usa el joystick o WASD para caminar; Q/E para girar y R/F para mirar arriba o abajo.</span></div></li></ol><div className="help-footnote">Los cambios se guardan automáticamente en tu cuenta. Los colores y la luz son aproximaciones visuales.</div><button className="primary-button" onClick={() => setHelpOpen(false)}>Cerrar</button></dialog>
  </div>;
}
