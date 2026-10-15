import { lazy, Suspense, useId, useState } from 'react';
import { ArrowLeft, ArrowRight, LoaderCircle } from 'lucide-react';
import { BrandMark } from './Brand';
import NumberInput from './NumberInput';
import { parseColor } from './fieldDraft';
import useFieldDraft from './useFieldDraft';
import { createLandingRoom, LANDING_WARDROBE_ID, updateLandingWardrobe } from './landingModel';
import type { FurnitureItem, FurnitureMaterial, Selection } from './types';
import './landing.css';

const RoomScene = lazy(() => import('./RoomScene'));
const STEPS = [
  { label: 'Ver el cuarto', caption: 'Gira la vista del cuarto.' },
  { label: 'Editar el ropero', caption: 'Mueve el ropero y cambia sus acabados.' },
  { label: 'Recorrer el cuarto', caption: 'Recorre el cuarto. Prueba la puerta y la luz.' },
];

function DemoDimension({ label, value, min, max, onChange, onNotice }: { label: string; value: number; min: number; max: number; onChange: (value: number) => boolean; onNotice: (message: string) => void }) {
  return <label className="demo-field"><span>{label}</span><div className="demo-number"><NumberInput label={label + ' del ropero'} value={value} min={min} max={max} onChange={onChange} onEdit={() => onNotice('')} onInvalid={() => onNotice('Usa un valor entre ' + min + ' y ' + max + ' m.')} /><span>m</span></div></label>;
}

function DemoColor({ value, onChange, onNotice }: { value: string; onChange: (value: string) => boolean; onNotice: (message: string) => void }) {
  const id = useId();
  const { inputProps } = useFieldDraft({ value, parse: parseColor, format: next => next.toUpperCase(), onCommit: onChange, onInvalid: () => onNotice('Escribe un código de color de 3 o 6 dígitos.') });
  return <div className="demo-field"><label htmlFor={id}>Color</label><div className="demo-color"><input type="color" aria-label="Elegir color del ropero" value={value} onChange={event => { onNotice(''); onChange(event.target.value); }} /><input {...inputProps} id={id} aria-label="Código de color del ropero" spellCheck={false} autoCapitalize="characters" maxLength={9} onChange={event => { onNotice(''); inputProps.onChange(event); }} /></div></div>;
}

export default function Landing() {
  const [step, setStep] = useState(0);
  const [room, setRoom] = useState(createLandingRoom);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [property, setProperty] = useState<'position' | 'size' | 'finish'>('position');
  const [notice, setNotice] = useState('');
  const wardrobe = room.furniture.find(item => item.id === LANDING_WARDROBE_ID)!;
  const editing = step === 1;
  const current = STEPS[step];
  const changeStep = (next: number) => {
    setNotice('');
    setSelection(next === 1 ? { kind: 'furniture', id: LANDING_WARDROBE_ID } : null);
    setStep(next);
  };
  const editWardrobe = (patch: Partial<Pick<FurnitureItem, 'x' | 'z' | 'width' | 'depth' | 'height' | 'color' | 'material'>>) => {
    try {
      const next = updateLandingWardrobe(room, patch);
      setRoom(next);
      setNotice('');
      return true;
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : 'Revisa el valor.');
      return false;
    }
  };

  return <div className="landing">
    <header className="landing-header">
      <a className="landing-logo" href="/" aria-label="3D Space"><BrandMark /></a>
      <a className="landing-enter" href="/login">Entrar o crear cuenta<ArrowRight size={18} /></a>
    </header>
    <main className="landing-main">
      <h1 className="landing-title">Diseña tu espacio en 3D. ¡Totalmente gratis!</h1>
      <section className="landing-demo" aria-label="Demo de 3D Space" aria-roledescription="presentación">
        <div className="landing-stage">
          <button type="button" className="landing-arrow landing-previous" aria-label="Demo anterior" disabled={step === 0} onClick={() => changeStep(step - 1)}><ArrowLeft size={23} /></button>
          <div className="demo-card">
            <div className="demo-viewport">
              <Suspense fallback={<div className="demo-loading"><LoaderCircle size={24} /><span>Cargando…</span></div>}>
                <RoomScene room={room} mode={step === 2 ? 'walk' : 'orbit'} animateView selection={selection} onSelect={next => { if (editing && next?.kind === 'furniture' && next.id === LANDING_WARDROBE_ID) setSelection(next); }} onChange={setRoom} readOnly={step === 0} transformMode="translate" resetKey={0} />
              </Suspense>
            </div>
            <aside className={'demo-properties' + (editing ? ' is-visible' : '')} aria-label="Ropero del demo" aria-hidden={!editing} inert={!editing}>
              <h2>Ropero</h2>
              <div className="demo-property-tabs" aria-label="Propiedades del ropero"><button type="button" aria-pressed={property === 'position'} onClick={() => { setNotice(''); setProperty('position'); }}>Posición</button><button type="button" aria-pressed={property === 'size'} onClick={() => { setNotice(''); setProperty('size'); }}>Tamaño</button><button type="button" aria-pressed={property === 'finish'} onClick={() => { setNotice(''); setProperty('finish'); }}>Acabado</button></div>
              {property !== 'finish' ? <div className="demo-fields">
                {property === 'size' ? <>
                  <DemoDimension label="Ancho" value={wardrobe.width} min={0.2} max={3} onChange={width => editWardrobe({ width })} onNotice={setNotice} />
                  <DemoDimension label="Fondo" value={wardrobe.depth} min={0.2} max={3} onChange={depth => editWardrobe({ depth })} onNotice={setNotice} />
                  <DemoDimension label="Altura" value={wardrobe.height} min={0.3} max={Math.round((room.height - 0.1) * 100) / 100} onChange={height => editWardrobe({ height })} onNotice={setNotice} />
                </> : <>
                  <DemoDimension label="Horizontal" value={wardrobe.x} min={-3} max={3} onChange={x => editWardrobe({ x })} onNotice={setNotice} />
                  <DemoDimension label="Profundidad" value={wardrobe.z} min={-3} max={3} onChange={z => editWardrobe({ z })} onNotice={setNotice} />
                </>}
              </div> : <div className="demo-fields demo-finishes">
                <label className="demo-field"><span>Material</span><select aria-label="Material del ropero" value={wardrobe.material ?? 'wood'} onChange={event => editWardrobe({ material: event.target.value as FurnitureMaterial })}><option value="wood">Madera</option><option value="plastic">Plástico</option><option value="metal">Metal</option></select></label>
                <DemoColor value={wardrobe.color ?? '#ba9773'} onChange={color => editWardrobe({ color })} onNotice={setNotice} />
              </div>}
              {notice && <p className="demo-notice" role="status">{notice}</p>}
            </aside>
          </div>
          <button type="button" className="landing-arrow landing-next" aria-label="Demo siguiente" disabled={step === STEPS.length - 1} onClick={() => changeStep(step + 1)}><ArrowRight size={23} /></button>
        </div>
        <p className="landing-caption" aria-live="polite">{current.caption}</p>
        <nav className="landing-dots" aria-label="Demos">{STEPS.map((item, index) => <button key={item.label} type="button" className={index === step ? 'active' : ''} aria-label={item.label} aria-current={index === step ? 'step' : undefined} onClick={() => changeStep(index)}><span /></button>)}</nav>
      </section>
    </main>
    <footer className="landing-footer"><a className="privacy-link" href="/privacy">Aviso de privacidad</a><a className="privacy-link" href="/terms">Condiciones de uso</a></footer>
  </div>;
}
