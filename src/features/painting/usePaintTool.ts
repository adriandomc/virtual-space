import { useEffect, useRef, useState } from 'react';
import { confirmLocalSaved } from '../../client/pwa/appOffline';
import { appActivityReason, assertCurrentAppVersion } from '../../client/pwa/appActivity';
import type { ProjectDocument } from '../../domain/project/projectDocument';
import { paintProjectTarget, type PaintTarget } from '../../domain/project/projectPaint';

type Props = { project: ProjectDocument; onChange: (project: ProjectDocument) => boolean | void; disabled: boolean; notify: (message: string) => void };

export default function usePaintTool(props: Props) {
  const [active, setActive] = useState(false), [color, setColor] = useState('#9cae98');
  const [switching, setSwitching] = useState(false);
  const latest = useRef({ ...props, active, color }); latest.current = { ...props, active, color };
  const changing = useRef(false);
  useEffect(() => { if (props.disabled) setActive(false); }, [props.disabled]);
  async function chooseMode(next: boolean) {
    if (changing.current || next === latest.current.active || next && latest.current.disabled) return;
    changing.current = true; setSwitching(true);
    try {
      await confirmLocalSaved();
      if (next && latest.current.disabled) return;
      setActive(next); latest.current.active = next;
    } catch (cause) { latest.current.notify(cause instanceof Error ? cause.message : 'No se pudo guardar el borrador.'); }
    finally { changing.current = false; setSwitching(false); }
  }
  function paint(target: PaintTarget) {
    const current = latest.current;
    if (!current.active || current.disabled) return false;
    try {
      assertCurrentAppVersion();
      const pending = appActivityReason(); if (pending) throw new Error(pending);
      const next = paintProjectTarget(current.project, target, current.color);
      if (next !== current.project && current.onChange(next) === false) return false;
      latest.current.project = next;
      return true;
    } catch (cause) { current.notify(cause instanceof Error ? cause.message : 'No se pudo aplicar el color.'); return false; }
  }
  return { active: active && !props.disabled, color, setColor, chooseMode, paint, switching };
}
