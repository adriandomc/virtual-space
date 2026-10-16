import { useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { t, useLocale } from '../../shared/i18n/i18n';
import NumberInput from '../../shared/ui/NumberInput';

export function NumberField({ label, value, min, max, step = 0.1, unit = 'm', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (value: number) => boolean | void }) {
  useLocale();
  const [feedback, setFeedback] = useState(false);
  return <label className="number-field"><span>{label}</span><div className="number-input"><NumberInput label={label} value={value} min={min} max={max} step={step} onChange={onChange} onInvalid={() => setFeedback(true)} onEdit={() => setFeedback(false)} /><span>{unit}</span></div>{feedback && <small className="field-feedback" role="status">{t('Usa un valor entre {{min}} y {{max}}. Se conservó el anterior.', { min, max })}</small>}</label>;
}
export function Slider({ label, value, min, max, step = 1, unit, onChange }: { label: string; value: number; min: number; max: number; step?: number; unit: string; onChange: (value: number) => void }) {
  return <label className="slider-field"><span><span>{label}</span><output>{Number(value.toFixed(2))} {unit}</output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} style={{ '--progress': (100 * (value - min) / (max - min)) + '%' } as CSSProperties} onChange={event => onChange(Number(event.target.value))} /></label>;
}
export function Switch({ checked, label, onChange, disabled = false }: { checked: boolean; label: string; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} className={'switch ' + (checked ? 'on' : '')} onClick={() => onChange(!checked)}><span /></button>;
}
export function Section({ title, children, defaultOpen = true }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  return <details className="property-section" open={defaultOpen}><summary><ChevronDown size={14} /><span>{title}</span></summary><div className="section-body">{children}</div></details>;
}
