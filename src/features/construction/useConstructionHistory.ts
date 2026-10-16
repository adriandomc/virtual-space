import { useRef } from 'react';
import type { ProjectDocument } from '../../domain/project/projectDocument';
import { sameData } from '../../shared/sameData';

type Entry = { before: ProjectDocument; after: ProjectDocument };

// A remote structural edit invalidates local undo rather than overwriting someone else's work.
export default function useConstructionHistory(project: ProjectDocument, onChange: (next: ProjectDocument) => boolean | void) {
  const undo = useRef<Entry[]>([]), redo = useRef<Entry[]>([]);
  const latest = useRef(project); latest.current = project;
  const same = sameData;
  const apply = (next: ProjectDocument) => {
    const before = latest.current;
    if (same(before, next)) return true;
    if (onChange(next) === false) return false;
    undo.current.push({ before, after: next });
    if (undo.current.length > 30) undo.current.shift();
    redo.current = []; latest.current = next;
    return true;
  };
  const travel = (from: Entry[], to: Entry[], backwards: boolean) => {
    const entry = from.at(-1);
    if (!entry || !same(latest.current, backwards ? entry.after : entry.before)) { undo.current = []; redo.current = []; return false; }
    const next = backwards ? entry.before : entry.after;
    if (onChange(next) === false) return false;
    from.pop(); to.push(entry); latest.current = next;
    return true;
  };
  return { apply, undo: () => travel(undo.current, redo.current, true), redo: () => travel(redo.current, undo.current, false), canUndo: !!undo.current.length && same(project, undo.current.at(-1)!.after), canRedo: !!redo.current.length && same(project, redo.current.at(-1)!.before) };
}
