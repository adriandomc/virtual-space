import useFieldDraft from '../../shared/ui/useFieldDraft';
import { parseName, parseNumber } from '../../shared/ui/fieldDraft';
import type { WorkshopPiecePreset } from './workshopPieces';

const numberFormat = (value: number) => Number(value.toFixed(4)).toString();

export function NumberControl({ label, value, onChange, min = -10000, max = 10000, integer = false }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; integer?: boolean }) {
  const field = useFieldDraft({ value, format: numberFormat, parse: raw => { const next = parseNumber(raw, min, max); return next !== null && (!integer || Number.isInteger(next)) ? next : null; }, onCommit: onChange });
  return <label className="workshop-number"><span>{label}</span><input inputMode={integer ? 'numeric' : 'decimal'} {...field.inputProps} /></label>;
}

export function NameControl({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const field = useFieldDraft({ value, parse: raw => parseName(raw), onCommit: onChange });
  return <label className="workshop-field"><span>{label}</span><input maxLength={80} {...field.inputProps} /></label>;
}

export function PieceThumbnail({ preset }: { preset: WorkshopPiecePreset }) {
  const longest = Math.max(preset.width, preset.height, preset.depth), w = Math.max(6, preset.width / longest * 45), h = Math.max(4, preset.height / longest * 48), d = Math.max(5, preset.depth / longest * 22);
  const x = 60 - (w + d) / 2, y = 44 + h / 2;
  return <svg viewBox="0 0 120 90" aria-hidden="true" className="workshop-piece-thumbnail" fill="#c5b49a" stroke="#98876f" strokeWidth="1.2">
    {preset.id === 'handle' ? <><rect x="27" y="38" width="66" height="13" rx="6" /><ellipse cx="88" cy="44.5" rx="5" ry="6.5" fill="#b5a186" /></> : preset.shape === 'wedge' ? <><path d="M34 64V22L80 64Z" /><path d="M34 22L49 14L95 56L80 64Z" fill="#dfcfb8" /><path d="M80 64L95 56V61L80 69Z" fill="#b5a186" /></> : preset.id === 'rosette' ? <path d="M60 18 66 29 80 24 78 38 91 44 78 50 80 65 66 59 60 71 54 59 40 65 42 50 29 44 42 38 40 24 54 29Z" /> : preset.shape === 'sphere' ? <><circle cx="60" cy="44" r="25" /><ellipse cx="60" cy="44" rx="13" ry="25" fill="none" /><path d="M36 42Q60 54 84 42" fill="none" /></> : preset.shape === 'torus' ? <><ellipse cx="60" cy="44" rx="32" ry="25" /><ellipse cx="60" cy="44" rx="19" ry="13" fill="#fcfdf9" /></> : preset.shape === 'cylinder' ? <g transform={preset.id === 'handle' ? 'rotate(90 60 44)' : undefined}><path d={`M${60 - w / 2} ${y - h}v${h}a${w / 2} ${d / 3} 0 0 0 ${w} 0v-${h}`} /><ellipse cx="60" cy={y - h} rx={w / 2} ry={d / 3} fill="#dfcfb8" /></g> : preset.shape === 'cone' ? <><path d={`M60 ${y - h}L${60 - w / 2} ${y}Q60 ${y + d / 2} ${60 + w / 2} ${y}Z`} /><path d={`M${60 - w / 2} ${y}Q60 ${y - d / 2} ${60 + w / 2} ${y}`} fill="none" /></> : <><path d={`M${x} ${y - h}l${d} -${d / 2} ${w} ${d / 2}v${h}l-${d} ${d / 2} -${w} -${d / 2}Z`} /><path d={`M${x} ${y - h}l${w} ${d / 2} ${d} -${d / 2} -${w} -${d / 2}Z`} fill="#dfcfb8" /><path d={`M${x + w} ${y - h + d / 2}v${h}l${d} -${d / 2}v-${h}Z`} fill="#b5a186" /></>}
  </svg>;
}
