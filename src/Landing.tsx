import { t, useLocale } from './i18n';
import { lazy, Suspense, useState } from 'react';
import { ArrowLeft, ArrowRight, LoaderCircle } from 'lucide-react';
import { BrandMark } from './Brand';
import NumberInput from './NumberInput';
import ColorPicker from './ColorPicker';
import { projectColors, useColorPreview } from './colorPreview';
import { createLandingProject, LANDING_WARDROBE_ID, updateLandingWardrobe } from './landingModel';
import { projectToRoom, updateProjectRoom } from './projectDocument';
import type { FurnitureItem, FurnitureMaterial, Selection } from './types';
import LanguageSelector from './LanguageSelector';
import InformationMenu from './InformationMenu';
import './landing.css';

const RoomScene = lazy(() => import('./RoomScene'));
const STEPS = [
  { label: 'Ver el cuarto', caption: 'Gira la vista del cuarto.' },
  { label: 'Editar el ropero', caption: 'Mueve el ropero y cambia sus acabados.' },
  { label: 'Recorrer el cuarto', caption: 'Recorre el cuarto. Prueba la puerta y la luz.' },
];

function DemoDimension({ label, value, min, max, onChange, onNotice }: { label: string; value: number; min: number; max: number; onChange: (value: number) => boolean; onNotice: (message: string) => void }) {
  return <label className="demo-field"><span>{label}</span><div className="demo-number"><NumberInput label={t('{{label}} del ropero', { label })} value={value} min={min} max={max} onChange={onChange} onEdit={() => onNotice('')} onInvalid={() => onNotice(t('Usa un valor entre {{min}} y {{max}} m.', { min, max }))} /><span>{t("m")}</span></div></label>;
}

export default function Landing() {
  useLocale();
  const [step, setStep] = useState(0);
  const [project, setProject] = useState(createLandingProject);
  const { shownProject, previewProject } = useColorPreview(project);
  const room = projectToRoom(project);
  const setRoom = (next: typeof room) => setProject(current => updateProjectRoom(current, current.activeLevelId, next));
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
      setNotice(cause instanceof Error ? cause.message : t("Revisa el valor."));
      return false;
    }
  };

  return <div className="landing">
    <header className="landing-header">
      <a className="landing-logo" href="/" aria-label={t("3D Space")}><BrandMark /></a>
      <div className="landing-header-actions">
        <LanguageSelector />
        <a className="landing-enter" href="/login">{t("Entrar o crear cuenta")}<ArrowRight size={18} /></a>
        <InformationMenu />
      </div>
    </header>
    <main className="landing-main">
      <h1 className="landing-title">{t("Diseña tu espacio en 3D. ¡Totalmente gratis!")}</h1>
      <section className="landing-demo" aria-label={t("Demo de 3D Space")} aria-roledescription={t("presentación")}>
        <div className="landing-stage">
          <button type="button" className="landing-arrow landing-previous" aria-label={t("Demo anterior")} disabled={step === 0} onClick={() => changeStep(step - 1)}><ArrowLeft size={23} /></button>
          <div className="demo-card">
            <div className="demo-viewport">
              <Suspense fallback={<div className="demo-loading"><LoaderCircle size={24} /><span>{t("Cargando…")}</span></div>}>
                <RoomScene project={shownProject} activeLevelId={project.activeLevelId} onProjectChange={setProject} room={shownProject === project ? room : projectToRoom(shownProject)} mode={step === 2 ? 'walk' : 'orbit'} animateView selection={selection} onSelect={next => { if (editing && next?.kind === 'furniture' && next.id === LANDING_WARDROBE_ID) setSelection(next); }} onChange={setRoom} readOnly={step === 0} transformMode="translate" resetKey={0} />
              </Suspense>
            </div>
            <aside className={'demo-properties' + (editing ? ' is-visible' : '')} aria-label={t("Ropero del demo")} aria-hidden={!editing} inert={!editing}>
              <h2>{t("Ropero")}</h2>
              <div className="demo-property-tabs" aria-label={t("Propiedades del ropero")}><button type="button" aria-pressed={property === 'position'} onClick={() => { setNotice(''); setProperty('position'); }}>{t("Posición")}</button><button type="button" aria-pressed={property === 'size'} onClick={() => { setNotice(''); setProperty('size'); }}>{t("Tamaño")}</button><button type="button" aria-pressed={property === 'finish'} onClick={() => { setNotice(''); setProperty('finish'); }}>{t("Acabado")}</button></div>
              {property !== 'finish' ? <div className="demo-fields">
                {property === 'size' ? <>
                  <DemoDimension label={t("Ancho")} value={wardrobe.width} min={0.2} max={3} onChange={width => editWardrobe({ width })} onNotice={setNotice} />
                  <DemoDimension label={t("Fondo")} value={wardrobe.depth} min={0.2} max={3} onChange={depth => editWardrobe({ depth })} onNotice={setNotice} />
                  <DemoDimension label={t("Altura")} value={wardrobe.height} min={0.3} max={Math.round((room.height - 0.1) * 100) / 100} onChange={height => editWardrobe({ height })} onNotice={setNotice} />
                </> : <>
                  <DemoDimension label={t("Horizontal")} value={wardrobe.x} min={-3} max={3} onChange={x => editWardrobe({ x })} onNotice={setNotice} />
                  <DemoDimension label={t("Profundidad")} value={wardrobe.z} min={-3} max={3} onChange={z => editWardrobe({ z })} onNotice={setNotice} />
                </>}
              </div> : <div className="demo-fields demo-finishes">
                <label className="demo-field"><span>{t("Material")}</span><select aria-label={t("Material del ropero")} value={wardrobe.material ?? 'wood'} onChange={event => editWardrobe({ material: event.target.value as FurnitureMaterial })}><option value="wood">{t("Madera")}</option><option value="plastic">{t("Plástico")}</option><option value="metal">{t("Metal")}</option></select></label>
                <ColorPicker label={t('Color')} value={wardrobe.color ?? '#ba9773'} onChange={color => editWardrobe({ color })} onPreview={color => previewProject(color ? updateProjectRoom(project, project.activeLevelId, updateLandingWardrobe(room, { color })) : null)} revision={project} colors={projectColors(project)} />
              </div>}
              {notice && <p className="demo-notice" role="status">{t(notice)}</p>}
            </aside>
          </div>
          <button type="button" className="landing-arrow landing-next" aria-label={t("Demo siguiente")} disabled={step === STEPS.length - 1} onClick={() => changeStep(step + 1)}><ArrowRight size={23} /></button>
        </div>
        <p className="landing-caption" aria-live="polite">{t(current.caption)}</p>
        <nav className="landing-dots" aria-label={t("Demos")}>{STEPS.map((item, index) => <button key={item.label} type="button" className={index === step ? 'active' : ''} aria-label={t(item.label)} aria-current={index === step ? 'step' : undefined} onClick={() => changeStep(index)}><span /></button>)}</nav>
      </section>
    </main>
  </div>;
}
