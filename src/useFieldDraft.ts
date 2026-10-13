import { useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';

type Options<T> = {
  value: T;
  parse: (raw: string, final: boolean) => T | null;
  format?: (value: T) => string;
  onCommit: (value: T) => boolean | void;
  onInvalid?: () => void;
};

export default function useFieldDraft<T>(options: Options<T>) {
  const latest = useRef(options);
  latest.current = options;
  const focused = useRef(false);
  const cancelled = useRef(false);
  const edited = useRef(false);
  const [draft, setDraft] = useState(() => (options.format ?? String)(options.value));
  const raw = useRef(draft);

  function write(text: string) {
    raw.current = text;
    setDraft(text);
  }
  function reset() {
    edited.current = false;
    const { value, format = String } = latest.current;
    write(format(value));
  }
  useLayoutEffect(() => {
    // Server acknowledgements must not replace text or move the caret during editing.
    if (!focused.current) reset();
  }, [options.value]);

  function finish() {
    // Read the accepted value after React has applied any model constraints.
    queueMicrotask(() => { if (!focused.current) reset(); });
    if (!edited.current) { reset(); return; }
    const { value, parse, format = String, onCommit, onInvalid } = latest.current;
    const next = parse(raw.current, true);
    if (next === null) { reset(); onInvalid?.(); return; }
    if (!Object.is(next, value) && onCommit(next) === false) { reset(); return; }
    write(format(next));
    edited.current = false;
  }

  function edit(text: string) {
    focused.current = true;
    edited.current = true;
    cancelled.current = false;
    write(text);
    const { value, parse, onCommit } = latest.current;
    const next = parse(text, false);
    if (next !== null && !Object.is(next, value)) onCommit(next);
  }

  return {
    draft,
    edit,
    inputProps: {
      value: draft,
      onFocus: () => { focused.current = true; cancelled.current = false; edited.current = false; },
      onChange: (event: ChangeEvent<HTMLInputElement>) => edit(event.target.value),
      onBlur: () => { focused.current = false; if (cancelled.current) reset(); else finish(); },
      onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Enter') { event.preventDefault(); focused.current = false; cancelled.current = false; finish(); }
        else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); focused.current = false; cancelled.current = true; reset(); }
      },
    },
  };
}
