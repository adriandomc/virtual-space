import { parseName } from './fieldDraft';
import useFieldDraft from './useFieldDraft';

export default function NameInput({ value, label, readOnly = false, onChange, notify }: { value: string; label: string; readOnly?: boolean; onChange: (value: string) => boolean | void; notify: (message: string) => void }) {
  const { inputProps } = useFieldDraft({
    value,
    parse: (raw, final) => final ? parseName(raw) : null,
    onCommit: next => readOnly ? false : onChange(next),
    onInvalid: () => notify('El nombre no puede quedar vacío. Se conservó el anterior.'),
  });
  return <input {...inputProps} type="text" aria-label={label} readOnly={readOnly} required maxLength={80} />;
}
