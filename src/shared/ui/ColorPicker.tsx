import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { Copy } from 'lucide-react';
import { t, useLocale } from '../i18n/i18n';
import { hexToHsv, hexToRgb, hsvToHex, normalizeHex, rgbToHex } from './color';
import { registerBeforeAppUpdate, registerAppActivity } from '../../client/pwa/appOffline';
import { colorRevision } from './colorPreview';
import Popover from './Popover';
import './colorPicker.css';

type Props = { value: string; label?: string; disabled?: boolean; colors?: string[]; revision?: unknown; onChange: (color: string) => boolean | void; onPreview?: (color: string | null) => void };

export default function ColorPicker({ value, label = t('Color'), disabled = false, colors = [], revision, onChange, onPreview }: Props) {
  useLocale();
  revision = colorRevision(revision);
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(value), [hex, setHex] = useState(value.toUpperCase()), [rgb, setRgb] = useState(() => hexToRgb(value).map(String)), [hsv, setHsv] = useState(() => hexToHsv(value)), [message, setMessage] = useState('');
  const latest = useRef({ onPreview, open, draft, value }); latest.current = { onPreview, open, draft, value };
  const closer = useRef<() => void>(() => {}), source = useRef({ value, revision });
  const hexInput = useRef<HTMLInputElement>(null);
  const dirty = open && (draft !== value || hex !== draft.toUpperCase() || rgb.some((channel, index) => channel !== String(hexToRgb(draft)[index])));
  useEffect(() => registerBeforeAppUpdate(async () => { if (latest.current.open) throw new Error('Aplica o cancela el color antes de continuar.'); }), []);
  useEffect(() => registerAppActivity(() => latest.current.open ? 'Aplica o cancela el color antes de continuar.' : false), []);
  useEffect(() => {
    if (open && (disabled || source.current.value !== value || source.current.revision !== revision)) closer.current();
  }, [value, revision, disabled, open]);
  useEffect(() => () => { if (latest.current.open) latest.current.onPreview?.(null); }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function edit(next: string, nextHsv = hexToHsv(next)) {
    setDraft(next); setHex(next.toUpperCase()); setRgb(hexToRgb(next).map(String)); setHsv(nextHsv); setMessage(''); latest.current.onPreview?.(next);
  }
  function toggle(next: boolean) {
    if (next) { source.current = { value, revision }; setDraft(value); setHex(value.toUpperCase()); setRgb(hexToRgb(value).map(String)); setHsv(hexToHsv(value)); setMessage(''); }
    else latest.current.onPreview?.(null);
    setOpen(next);
  }
  function saturation(event: PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('input')) return;
    if (event.type === 'pointermove' && !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (event.type === 'pointerdown') { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); }
    const box = event.currentTarget.getBoundingClientRect(), s = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), v = 1 - Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
    edit(hsvToHex(hsv[0], s, v), [hsv[0], s, v]);
  }
  const validHex = normalizeHex(hex), validRgb = rgb.every(channel => /^\d{1,3}$/.test(channel) && Number(channel) <= 255), valid = !!validHex && validRgb;
  return <div className="color-control"><span className="color-control-label">{label}</span><Popover label={label} trigger={<><span className="color-trigger-swatch" style={{ background: value }} /><span>{value.toUpperCase()}</span></>} triggerClassName="color-trigger" className="color-popover" disabled={disabled} onOpenChange={toggle}>
    {close => { closer.current = close; return <div className="color-picker" onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <div className="color-picker-heading"><strong>{label}</strong><button type="button" className="color-copy" aria-label={t('Copiar código hexadecimal')} onClick={async () => { try { await navigator.clipboard.writeText(draft.toUpperCase()); setMessage('Código copiado.'); } catch { hexInput.current?.focus(); hexInput.current?.select(); setMessage('Selecciona el código para copiarlo.'); } }}><Copy size={18} /></button></div>
      <div className="color-sv" style={{ '--hue-color': hsvToHex(hsv[0], 1, 1) } as CSSProperties} onPointerDown={saturation} onPointerMove={saturation} onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}>
        <span className="color-sv-thumb" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: draft }} />
        <label className="color-sr-only">{t('Saturación')}<input type="range" min={0} max={100} value={Math.round(hsv[1] * 100)} onChange={event => { const s = Number(event.target.value) / 100; edit(hsvToHex(hsv[0], s, hsv[2]), [hsv[0], s, hsv[2]]); }} /></label>
        <label className="color-sr-only">{t('Brillo')}<input type="range" min={0} max={100} value={Math.round(hsv[2] * 100)} onChange={event => { const v = Number(event.target.value) / 100; edit(hsvToHex(hsv[0], hsv[1], v), [hsv[0], hsv[1], v]); }} /></label>
      </div>
      <label className="color-hue"><span>{t('Tono')}</span><input type="range" min={0} max={360} step={1} value={hsv[0]} onChange={event => { const h = Number(event.target.value); edit(hsvToHex(h, hsv[1], hsv[2]), [h, hsv[1], hsv[2]]); }} /></label>
      <div className="color-values"><label><span>{t('Código hexadecimal')}</span><input ref={hexInput} aria-label={t('Código hexadecimal')} value={hex} maxLength={7} spellCheck={false} autoCapitalize="characters" onChange={event => { const text = event.target.value; setHex(text); const next = normalizeHex(text); if (next) { const normalized = text.replace(/^#/, ''); if (normalized.length === 6) edit(next); } }} onBlur={() => { const next = normalizeHex(hex); if (next) edit(next); }} aria-invalid={!validHex} /></label><div className="color-rgb">{['R', 'G', 'B'].map((channel, index) => <label key={channel}><span>{t(channel)}</span><input inputMode="numeric" aria-label={t('Canal {{channel}}', { channel })} value={rgb[index]} maxLength={3} onChange={event => { const next = rgb.map((value, i) => i === index ? event.target.value : value); setRgb(next); if (next.every(value => /^\d{1,3}$/.test(value) && Number(value) <= 255)) edit(rgbToHex(next.map(Number))); }} aria-invalid={!/^\d{1,3}$/.test(rgb[index]) || Number(rgb[index]) > 255} /></label>)}</div></div>
      <div className="color-comparison"><button type="button" onClick={() => edit(source.current.value)}><span style={{ background: source.current.value }} />{t('Anterior')}</button><div><span style={{ background: draft }} />{t('Nuevo')}</div></div>
      {!!colors.length && <div className="color-picker-palette"><span>{t('En este cuarto')}</span><div>{[...new Set(colors)].map(color => <button key={color} type="button" aria-label={t('Reutilizar color {{color}}', { color })} title={color.toUpperCase()} style={{ background: color }} aria-pressed={color === draft} onClick={() => edit(color)} />)}</div></div>}
      {message && <p className="color-message" role="status">{t(message)}</p>}
      {!valid && <p className="color-message" role="status">{t('Escribe un código hexadecimal válido o valores RGB de 0 a 255.')}</p>}
      <div className="color-actions"><button type="button" onClick={close}>{t('Cancelar')}</button><button type="button" className="primary-button" disabled={!valid} onClick={() => { const next = normalizeHex(hex); if (!next || disabled || source.current.value !== value || source.current.revision !== revision) { close(); return; } if (next === value || onChange(next) !== false) close(); }}>{t('Aplicar')}</button></div>
    </div>; }}
  </Popover></div>;
}
