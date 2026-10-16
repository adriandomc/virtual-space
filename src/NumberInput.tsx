import { parseNumber } from './fieldDraft';
import useFieldDraft from './useFieldDraft';

export default function NumberInput({ label, value, min, max, step = 0.1, readOnly = false, onChange, onInvalid, onEdit }: { label: string; value: number; min: number; max: number; step?: number; readOnly?: boolean; onChange: (value: number) => boolean | void; onInvalid: () => void; onEdit: () => void }) {
  const { inputProps, edit } = useFieldDraft({ value, format: next => String(Number(next.toFixed(4))), parse: raw => parseNumber(raw, min, max), onCommit: next => readOnly ? false : onChange(next), onInvalid });
  return <input {...inputProps} readOnly={readOnly} type="text" role="spinbutton" inputMode="decimal" aria-label={label} aria-valuenow={parseNumber(inputProps.value, min, max) ?? undefined} aria-valuemin={min} aria-valuemax={max} required onChange={event => { if (!readOnly) { onEdit(); inputProps.onChange(event); } }} onKeyDown={event => {
    if (readOnly) return;
    if (!event.nativeEvent.isComposing && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault();
      const current = parseNumber(inputProps.value, min, max) ?? value;
      const next = Math.min(max, Math.max(min, Math.round((current + (event.key === 'ArrowUp' ? step : -step)) * 1e6) / 1e6));
      onEdit(); edit(String(next));
    } else inputProps.onKeyDown(event);
  }} />;
}
