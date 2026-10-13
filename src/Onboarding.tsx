import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { Archive, ArrowLeft, ArrowRight, BedDouble, Check, Copy, DoorClosed, DoorOpen, Grid2X2, Lightbulb, LoaderCircle, Plus, Table2, Trash2 } from 'lucide-react';
import Brand from './Brand';
import PlanEditor from './PlanEditor';
import { parseColor } from './fieldDraft';
import useFieldDraft from './useFieldDraft';
import NameInput from './NameInput';
import NumberInput from './NumberInput';
import OpeningForm, { type OpeningValues } from './OpeningForm';
import { addFurniture, addLight, addOpening, BED_SIZES, bounds, fitRoom, FURNITURE_COLORS, FURNITURE_LABELS, resizeRoom, validateRoom, wallLength } from './model';
import { resetOnboardingStep, type OnboardingStep } from './onboardingModel';
import type { BedSize, FloorFinish, FurnitureItem, FurnitureMaterial, Opening, Room, Selection } from './types';
import './onboarding.css';

const RoomScene = lazy(() => import('./RoomScene'));

type Props = {
  room: Room;
  onChange: (room: Room) => void;
  sketchUrl: string | null;
  onSketchChange: (file: File | null) => Promise<void>;
  onFinish: () => void;
  onCancel: () => void;
  status: 'loading' | 'saving' | 'saved' | 'error';
  error: string;
  onRetry: () => void;
};
const STEPS: { id: OnboardingStep; label: string }[] = [{ id: 'plan', label: 'Croquis' }, { id: 'colors', label: 'Colores' }, { id: 'decoration', label: 'Decoración' }];
const FINISHES: [FloorFinish, string][] = [['wood', 'Madera'], ['tile-grid', 'Loseta'], ['tile-brick', 'Loseta trabada'], ['tile-checker', 'Damero'], ['marble', 'Mármol'], ['concrete', 'Concreto']];
const PALETTE = ['#ffffff', '#f5f5f2', '#e7e3d9', '#d7c7b1', '#9cae98', '#acbabc', '#c4967c', '#646d64'];
const ICONS = { bed: BedDouble, wardrobe: DoorClosed, vanity: Table2, nightstand: Archive };
const furnitureName = (item: FurnitureItem) => item.type === 'bed' ? 'Cama ' + BED_SIZES[item.bedSize ?? 'double'].label.toLowerCase() : FURNITURE_LABELS[item.type];

function Dimension({ label, value, min, max, unit = 'm', step = 0.1, onChange }: { label: string; value: number; min: number; max: number; unit?: string; step?: number; onChange: (value: number) => boolean | void }) {
  const [feedback, setFeedback] = useState('');
  return <label className="setup-field"><span>{label}</span><div className="setup-unit"><NumberInput label={label} value={value} min={min} max={max} step={step} onChange={onChange} onInvalid={() => setFeedback('Usa un valor entre ' + min + ' y ' + max + '. Se conservó el anterior.')} onEdit={() => setFeedback('')} /><span>{unit}</span></div>{feedback && <small className="field-feedback" role="status">{feedback}</small>}</label>;
}

function ColorField({ label, value, onChange, onNotice, disabled }: { label: string; value: string; onChange: (color: string) => boolean | void; onNotice: (message: string) => void; disabled: boolean }) {
  const id = useId(), input = useRef<HTMLInputElement>(null);
  const { inputProps } = useFieldDraft({ value, parse: parseColor, format: next => next.toUpperCase(), onCommit: next => disabled ? false : onChange(next), onInvalid: () => onNotice('Escribe un código de color de 3 o 6 dígitos. Se conservó el anterior.') });
  return <div className="setup-color-field"><label htmlFor={id}>{label}</label><div><input aria-label={'Elegir ' + label.toLowerCase()} type="color" disabled={disabled} value={value} onChange={event => onChange(event.target.value)} /><input {...inputProps} ref={input} id={id} aria-label={'Código de ' + label.toLowerCase()} className="setup-hex" disabled={disabled} required spellCheck={false} autoCapitalize="characters" maxLength={9} /><button type="button" disabled={disabled} aria-label={'Copiar ' + label.toLowerCase()} onClick={async () => {
    try { await navigator.clipboard.writeText(value.toUpperCase()); onNotice('Código copiado.'); }
    catch { input.current?.select(); onNotice('Selecciona el código para copiarlo.'); }
  }}><Copy size={19} /></button></div></div>;
}

export default function Onboarding({ room, onChange, sketchUrl, onSketchChange, onFinish, onCancel, status, error, onRetry }: Props) {
  const step = room.setupStep ?? 0;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [surface, setSurface] = useState('all'), [bedSize, setBedSize] = useState<BedSize>('double');
  const [addType, setAddType] = useState<FurnitureItem['type'] | Opening['type'] | 'light'>('bed');
  const [addingOpening, setAddingOpening] = useState<Opening['type'] | null>(null);
  const [busy, setBusy] = useState(false), [drawing, setDrawing] = useState(false), [planKey, setPlanKey] = useState(0);
  const [localError, setLocalError] = useState(''), [notice, setNotice] = useState('');
  const disabled = busy || status === 'loading';
  const size = bounds(room.vertices), current = STEPS[step];
  const color = surface === 'floor' ? room.floorColor : surface === 'ceiling' ? room.ceilingColor : room.wallColors[surface === 'all' ? 0 : Number(surface)] ?? room.wallColors[0];
  const furniture = selection?.kind === 'furniture' ? room.furniture.find(item => item.id === selection.id) : undefined;
  const opening = selection?.kind === 'opening' ? room.openings.find(item => item.id === selection.id) : undefined;
  const light = selection?.kind === 'light' ? room.lights.find(item => item.id === selection.id) : undefined;
  const usedColors = [...new Set([...room.wallColors, room.floorColor, room.ceilingColor].map(value => value.toLowerCase()))];
  const sceneSelection: Selection | null = step === 1 ? surface === 'floor' || surface === 'ceiling' ? { kind: surface } : surface === 'all' ? null : { kind: 'wall', index: Number(surface) } : selection;

  useEffect(() => {
    if (!['all', 'floor', 'ceiling'].includes(surface) && Number(surface) >= room.wallColors.length) setSurface('all');
  }, [surface, room.wallColors.length]);

  function change(next: Room | (() => Room)) {
    if (disabled) return false;
    try { onChange(validateRoom(typeof next === 'function' ? next() : next)); setLocalError(''); setNotice(''); return true; }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'No se pudo aplicar este cambio.'); return false; }
  }
  function advance() {
    if (disabled || drawing) return;
    setLocalError(''); setNotice(''); setSelection(null); setAddingOpening(null);
    if (step < STEPS.length - 1) change({ ...room, setupStep: (step + 1) as 1 | 2 }); else onFinish();
  }
  async function skip() {
    if (disabled) return;
    setBusy(true); setLocalError(''); setNotice('');
    try {
      const next = resetOnboardingStep(room, current.id);
      if (current.id === 'plan') {
        if (sketchUrl) await onSketchChange(null);
        setDrawing(false); setPlanKey(value => value + 1);
      }
      onChange(step < STEPS.length - 1 ? { ...next, setupStep: (step + 1) as 1 | 2 } : next); setSelection(null); setAddingOpening(null);
      if (step === STEPS.length - 1) onFinish();
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'No se pudo omitir este paso.'); }
    finally { setBusy(false); }
  }
  async function sketch(file: File | null) {
    setBusy(true);
    try { await onSketchChange(file); }
    finally { setBusy(false); }
  }
  function paint(value: string) {
    return change(surface === 'floor' ? { ...room, floorColor: value } : surface === 'ceiling' ? { ...room, ceilingColor: value } : { ...room, wallColors: room.wallColors.map((previous, index) => surface === 'all' || index === Number(surface) ? value : previous) });
  }
  function selectScene(next: Selection | null) {
    if (step === 1 && next) {
      if (next.kind === 'wall') setSurface(String(next.index));
      else if (next.kind === 'floor' || next.kind === 'ceiling') setSurface(next.kind);
    } else if (step === 2) setSelection(next && ['furniture', 'opening', 'light'].includes(next.kind) ? next : null);
  }
  function add() {
    if (addType === 'door' || addType === 'window') { setAddingOpening(addType); setSelection(null); return; }
    try {
      const next = addType === 'light' ? addLight(room) : addFurniture(room, addType, bedSize);
      if (change(next)) setSelection(addType === 'light' ? { kind: 'light', id: next.lights.at(-1)!.id } : { kind: 'furniture', id: next.furniture.at(-1)!.id });
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'No se pudo agregar el elemento.'); }
  }
  function createOpening(values: OpeningValues) {
    if (!addingOpening) return false;
    const next = addOpening(room, addingOpening, values.wall, values);
    if (!change(next)) return false;
    setSelection({ kind: 'opening', id: next.openings.at(-1)!.id }); setAddingOpening(null);
    return true;
  }
  function updateOpening(patch: Partial<Opening>) {
    return opening ? change(() => fitRoom({ ...room, openings: room.openings.map(item => item.id === opening.id ? { ...item, ...patch } : item) })) : false;
  }
  function remove(item: Selection) {
    const next = item.kind === 'furniture' ? { ...room, furniture: room.furniture.filter(value => value.id !== item.id) } : item.kind === 'opening' ? { ...room, openings: room.openings.filter(value => value.id !== item.id) } : item.kind === 'light' ? { ...room, lights: room.lights.filter(value => value.id !== item.id) } : room;
    if (change(next) && JSON.stringify(selection) === JSON.stringify(item)) setSelection(null);
  }
  function styleFurniture(patch: { material?: FurnitureMaterial; color?: string }) {
    return furniture ? change({ ...room, furniture: room.furniture.map(item => item.id === furniture.id ? { ...item, ...patch } : item) }) : false;
  }
  const items = [
    ...room.openings.map((item, index) => ({ selection: { kind: 'opening', id: item.id } as Selection, name: (item.type === 'door' ? 'Puerta' : 'Ventana') + ' ' + (index + 1), Icon: item.type === 'door' ? DoorOpen : Grid2X2 })),
    ...room.furniture.map(item => ({ selection: { kind: 'furniture', id: item.id } as Selection, name: furnitureName(item), Icon: ICONS[item.type] })),
    ...room.lights.map(item => ({ selection: { kind: 'light', id: item.id } as Selection, name: item.name, Icon: Lightbulb })),
  ];

  return <div className="setup-page">
    <header className="setup-header"><Brand /><button type="button" className="setup-secondary" disabled={disabled} onClick={onCancel}><ArrowLeft size={18} />Mis diseños</button></header>
    <div className="setup-heading"><h1>Nuevo diseño</h1><ol className="setup-steps" aria-label="Pasos del nuevo diseño">{STEPS.map((item, index) => <li key={item.id} className={index === step ? 'current' : index < step ? 'complete' : ''} aria-current={index === step ? 'step' : undefined}><span>{index < step ? <Check size={17} /> : index + 1}</span>{item.label}</li>)}</ol></div>
    <main className={'setup-content setup-step-' + current.id}>
      <fieldset className="setup-controls" disabled={disabled}>
        <h2>{current.label}</h2>
        {step === 0 && <><label className="setup-field"><span>Nombre del diseño</span><NameInput label="Nombre del diseño" value={room.name} readOnly={disabled} onChange={name => change({ ...room, name })} notify={setNotice} /></label><div className="setup-dimensions"><Dimension label="Ancho" value={size.width} min={0.5} max={50} onChange={width => change(() => resizeRoom(room, width, size.depth))} /><Dimension label="Largo" value={size.depth} min={0.5} max={50} onChange={depth => change(() => resizeRoom(room, size.width, depth))} /><Dimension label="Altura" value={room.height} min={1.8} max={8} onChange={height => change(() => fitRoom({ ...room, height }))} /></div>{drawing && <p className="setup-hint">Cierra o cancela la planta para continuar.</p>}</>}
        {step === 1 && <>
          <label className="setup-field"><span>Superficie</span><select aria-label="Superficie a pintar" value={surface} onChange={event => setSurface(event.target.value)}><option value="all">Todas las paredes</option>{room.wallColors.map((_, index) => <option key={index} value={index}>Pared {index + 1}</option>)}<option value="ceiling">Techo</option><option value="floor">Piso</option></select></label>
          <ColorField key={surface} label="Color" value={color} onChange={paint} onNotice={setNotice} disabled={disabled} />
          <label className="setup-field"><span>Material del piso</span><select aria-label="Material del piso" value={room.floorFinish} onChange={event => change({ ...room, floorFinish: event.target.value as FloorFinish })}>{FINISHES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <details className="setup-more"><summary>Paleta</summary><div><div className="setup-swatches" aria-label="Colores">{PALETTE.map(value => <button key={value} type="button" aria-label={'Usar color ' + value} aria-pressed={color.toLowerCase() === value} style={{ background: value }} onClick={() => paint(value)}>{color.toLowerCase() === value && <Check size={20} />}</button>)}</div><div className="setup-used-colors"><span>En este cuarto</span><div>{usedColors.map(value => <button key={value} type="button" title={value.toUpperCase()} aria-label={'Reutilizar color ' + value} style={{ background: value }} onClick={() => paint(value)} />)}</div></div></div></details>
          <details className="setup-more"><summary>Calidad visual</summary><div><label className="setup-field"><span>Vista</span><select aria-label="Calidad de vista previa" value={room.renderQuality} onChange={event => change({ ...room, renderQuality: event.target.value as Room['renderQuality'] })}><option value="standard">Estándar</option><option value="realistic">Realista</option><option value="hyperrealistic">Hiperrealista</option></select></label></div></details>
        </>}
        {step === 2 && <>
          {addingOpening ? <OpeningForm key={addingOpening} room={room} type={addingOpening} onCreate={createOpening} onCancel={() => setAddingOpening(null)} /> : <>
            <label className="setup-field"><span>Elemento</span><select aria-label="Elemento a agregar" value={addType} onChange={event => setAddType(event.target.value as typeof addType)}><option value="door">Puerta</option><option value="window">Ventana</option>{Object.entries(FURNITURE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}<option value="light">Foco</option></select></label>
            {addType === 'bed' && <label className="setup-field"><span>Tamaño de cama</span><select aria-label="Tamaño de cama" value={bedSize} onChange={event => setBedSize(event.target.value as BedSize)}>{Object.entries(BED_SIZES).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>}
            <button type="button" className="setup-secondary" onClick={add}><Plus size={18} />Agregar</button>
          </>}
          {items.length > 0 && <ul className="setup-item-list">{items.map(item => <li key={JSON.stringify(item.selection)}><button type="button" className={JSON.stringify(selection) === JSON.stringify(item.selection) ? 'active' : ''} onClick={() => { setSelection(item.selection); setAddingOpening(null); }} aria-pressed={JSON.stringify(selection) === JSON.stringify(item.selection)}><item.Icon size={19} /><span>{item.name}</span></button><button type="button" aria-label={'Quitar ' + item.name} onClick={() => remove(item.selection)}><Trash2 size={19} /></button></li>)}</ul>}
          {furniture && <div className="setup-furniture-style" key={furniture.id}><h3>{furnitureName(furniture)}</h3><label className="setup-field"><span>Material</span><select aria-label="Material del mueble" value={furniture.material ?? 'wood'} onChange={event => styleFurniture({ material: event.target.value as FurnitureMaterial })}><option value="wood">Madera</option><option value="plastic">Plástico</option><option value="metal">Metal</option></select></label><ColorField label="Color del mueble" value={furniture.color ?? FURNITURE_COLORS[furniture.type]} onChange={value => styleFurniture({ color: value })} onNotice={setNotice} disabled={disabled} /></div>}
          {opening && <div className="setup-furniture-style" key={opening.id}><h3>{opening.type === 'door' ? 'Puerta' : 'Ventana'}</h3><label className="setup-field"><span>Pared</span><select aria-label="Pared del elemento" value={opening.wall} onChange={event => updateOpening({ wall: Number(event.target.value) })}>{room.vertices.map((_, index) => <option key={index} value={index}>Pared {index + 1}</option>)}</select></label>{opening.type === 'door' && <label className="setup-field"><span>Apertura</span><select aria-label="Apertura de la puerta" value={opening.doorStyle ?? 'right'} onChange={event => updateOpening({ doorStyle: event.target.value as Opening['doorStyle'] })}><option value="right">Derecha</option><option value="left">Izquierda</option><option value="frame">Sólo marco</option></select></label>}<div className="setup-item-dimensions"><Dimension label="Ancho" value={opening.width} min={0.3} max={wallLength(room, opening.wall)} onChange={width => updateOpening({ width })} /><Dimension label="Altura" value={opening.height} min={0.3} max={opening.type === 'window' ? room.height - opening.sill : room.height} onChange={height => updateOpening({ height })} />{opening.type === 'window' && <Dimension label="Altura desde piso" value={opening.sill} min={0} max={room.height - opening.height} onChange={sill => updateOpening({ sill })} />}</div><details className="setup-more"><summary>Posición</summary><div><Dimension label="Desde el inicio de la pared" value={opening.offset} min={0} max={wallLength(room, opening.wall) - opening.width} onChange={offset => updateOpening({ offset })} /></div></details></div>}
          {light && <div className="setup-furniture-style" key={light.id}><h3>{light.name}</h3><label className="setup-light-toggle"><input type="checkbox" checked={light.enabled} onChange={event => change({ ...room, lights: room.lights.map(item => item.id === light.id ? { ...item, enabled: event.target.checked } : item) })} />Encendido</label><div className="setup-item-dimensions"><Dimension label="Intensidad" value={light.lumens} min={0} max={20000} step={50} unit="lm" onChange={lumens => change({ ...room, lights: room.lights.map(item => item.id === light.id ? { ...item, lumens } : item) })} /><Dimension label="Temperatura" value={light.temperature} min={1000} max={12000} step={100} unit="K" onChange={temperature => change({ ...room, lights: room.lights.map(item => item.id === light.id ? { ...item, temperature } : item) })} /></div></div>}
        </>}
      </fieldset>
      <section className="setup-preview" aria-label={step === 0 ? 'Croquis del diseño' : 'Vista previa del diseño'}>{step === 0 ? <PlanEditor key={planKey} room={room} onChange={change} selection={selection} onSelect={setSelection} sketchUrl={sketchUrl} onSketchChange={sketch} onDrawingChange={setDrawing} hideSurfaceControls readOnly={status === 'loading'} /> : <><Suspense fallback={<div className="setup-preview-loading" role="status"><LoaderCircle size={25} className="setup-spinner" /><span>Cargando vista…</span></div>}><RoomScene room={room} mode="orbit" selection={sceneSelection} onSelect={selectScene} onChange={change} readOnly={disabled || step === 1} transformMode="translate" showFurniture={room.showFurniture} resetKey={step} /></Suspense><span className="setup-preview-label">Vista previa</span></>}</section>
    </main>
    <footer className="setup-footer"><div className="setup-feedback" aria-live="polite">{(localError || error) ? <div className="setup-error" role="alert"><span>{localError || error}</span>{status === 'error' && <button type="button" onClick={onRetry}>Reintentar</button>}</div> : <><span className="setup-save-state">{status === 'saving' || busy ? <><LoaderCircle size={17} className="setup-spinner" />Guardando…</> : status === 'saved' ? <><Check size={17} />Guardado</> : null}</span>{notice && <span>{notice}</span>}</>}<nav className="setup-legal" aria-label="Información legal"><a className="privacy-link" href="/privacy" target="_blank" rel="noopener">Aviso de privacidad</a><a className="privacy-link" href="/terms" target="_blank" rel="noopener">Condiciones de uso</a></nav></div><div className="setup-actions"><button type="button" className="setup-secondary setup-back" aria-label="Atrás" disabled={disabled || step === 0 || drawing} onClick={() => { change({ ...room, setupStep: (step - 1) as 0 | 1 }); setLocalError(''); setNotice(''); setSelection(null); }}><ArrowLeft size={18} /><span>Atrás</span></button><div><button type="button" className="setup-skip" disabled={disabled} onClick={() => void skip()}>Omitir</button><button type="button" className="setup-primary" disabled={disabled || drawing || status === 'error'} onClick={advance}>{step === 2 ? 'Entrar al editor' : 'Continuar'}<ArrowRight size={18} /></button></div></div></footer>
  </div>;
}
