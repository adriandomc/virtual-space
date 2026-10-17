import { useEffect, useRef, useState } from 'react';
import { confirmLocalSaved } from '../../client/pwa/appOffline';
import { appActivityReason, assertCurrentAppVersion } from '../../client/pwa/appActivity';
import type { ProjectDocument } from '../../domain/project/projectDocument';
import { paintProjectTarget, samplePaintTargetColor, type PaintTarget } from '../../domain/project/projectPaint';

export type PaintToolMode = 'select' | 'paint' | 'sample';

type Props = { project: ProjectDocument; onChange: (project: ProjectDocument) => boolean | void; disabled: boolean; notify: (message: string) => void };

export default function usePaintTool(props: Props) {
  const [mode, setMode] = useState<PaintToolMode>('select'), [color, setColor] = useState('#9cae98');
  const [switching, setSwitching] = useState(false);
  const latest = useRef({ ...props, mode, color }); latest.current = { ...props, mode, color };
  const changing = useRef(false);
  useEffect(() => { if (props.disabled) setMode('select'); }, [props.disabled]);
  async function chooseMode(next: PaintToolMode) {
    if (changing.current || next === latest.current.mode || next !== 'select' && latest.current.disabled) return;
    changing.current = true; setSwitching(true);
    try {
      await confirmLocalSaved();
      if (next !== 'select' && latest.current.disabled) return;
      setMode(next); latest.current.mode = next;
    } catch (cause) { latest.current.notify(cause instanceof Error ? cause.message : 'No se pudo guardar el borrador.'); }
    finally { changing.current = false; setSwitching(false); }
  }
  function paint(target: PaintTarget, sampledColor?: string) {
    const current = latest.current;
    if (current.mode === 'select' || current.disabled) return false;
    try {
      assertCurrentAppVersion();
      const pending = appActivityReason(); if (pending) throw new Error(pending);
      if (current.mode === 'sample') {
        const fallback = samplePaintTargetColor(current.project, target);
        const sampled = sampledColor && /^#[a-f\d]{6}$/i.test(sampledColor) ? sampledColor.toLowerCase() : fallback;
        setColor(sampled); setMode('paint'); latest.current.color = sampled; latest.current.mode = 'paint';
        return true;
      }
      const next = paintProjectTarget(current.project, target, current.color);
      if (next !== current.project && current.onChange(next) === false) return false;
      latest.current.project = next;
      return true;
    } catch (cause) { current.notify(cause instanceof Error ? cause.message : current.mode === 'sample' ? 'No se pudo tomar el color.' : 'No se pudo aplicar el color.'); return false; }
  }
  return { mode: props.disabled ? 'select' as const : mode, active: mode !== 'select' && !props.disabled, sampling: mode === 'sample' && !props.disabled, color, setColor, chooseMode, paint, switching };
}
