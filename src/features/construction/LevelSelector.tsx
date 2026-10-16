import { useState } from 'react';
import { ChevronDown, Plus, Redo2, Trash2, Undo2 } from 'lucide-react';
import { t, useLocale } from '../../shared/i18n/i18n';
import NameInput from '../../shared/ui/NameInput';
import { addLevel, removeLevel, renameLevel, setLevelHeight } from '../../domain/project/projectOperations';
import { projectLevel, type ProjectDocument } from '../../domain/project/projectDocument';
import NumberInput from '../../shared/ui/NumberInput';
import Popover from '../../shared/ui/Popover';
import './construction.css';

type Props = { project: ProjectDocument; activeLevelId: string; onSelect: (id: string) => void; onChange: (project: ProjectDocument) => boolean | void; readOnly?: boolean; navigationDisabled?: boolean; onUndo?: () => void; onRedo?: () => void; canUndo?: boolean; canRedo?: boolean };
export default function LevelSelector({ project, activeLevelId, onSelect, onChange, readOnly = false, navigationDisabled = false, onUndo, onRedo, canUndo, canRedo }: Props) {
  useLocale(); const level = projectLevel(project, activeLevelId), [error, setError] = useState('');
  const apply = (operation: () => ProjectDocument) => { if (readOnly) return false; try { const next = operation(); if (onChange(next) === false) return false; setError(''); return true; } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo modificar el nivel.'); return false; } };
  const create = (copy: boolean) => {
    try { const next = addLevel(project, { copy, name: t('Nivel {{number}}', { number: project.levels.length + 1 }) }); if (apply(() => next)) onSelect(next.levels.at(-1)!.id); } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo añadir el nivel.'); }
  };
  return <div className="level-controls">
    <label className="level-select"><span>{t('Nivel')}</span><select disabled={navigationDisabled} aria-label={t('Nivel activo')} value={level.id} onChange={event => { onSelect(event.target.value); setError(''); }}>{project.levels.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <Popover rootClassName="level-menu" triggerClassName="icon-button" label={t('Opciones del nivel')} trigger={<ChevronDown size={17} />} className="level-menu-content">{close => <>
      <label>{t('Nombre del nivel')}<NameInput value={level.name} label={t('Nombre del nivel')} readOnly={readOnly} onChange={name => apply(() => renameLevel(project, level.id, name))} notify={setError} /></label>
      <label>{t('Altura del nivel')}<NumberInput label={t('Altura del nivel')} readOnly={readOnly} value={level.height} min={1.8} max={8} onChange={height => apply(() => setLevelHeight(project, level.id, height))} onInvalid={() => setError('Se conservó la última altura válida.')} onEdit={() => setError('')} /></label>
      <output>{t('Elevación: {{height}} m', { height: Number(level.elevation.toFixed(2)) })}</output>
      <button type="button" disabled={readOnly || project.levels.length >= 12} onClick={() => { create(false); close(); }}><Plus size={17} />{t('Nivel vacío')}</button>
      <button type="button" disabled={readOnly || project.levels.length >= 12} onClick={() => { create(true); close(); }}><Plus size={17} />{t('Copiar estructura inferior')}</button>
      <button type="button" disabled={readOnly || project.levels.length === 1} onClick={() => { if (window.confirm(t('¿Eliminar el nivel «{{name}}» y sus conexiones?', { name: level.name }))) { if (apply(() => removeLevel(project, level.id))) close(); } }}><Trash2 size={17} />{t('Eliminar nivel')}</button>
    </>}</Popover>
    {onUndo && <button type="button" className="icon-button" aria-label={t('Deshacer construcción')} disabled={readOnly || !canUndo} onClick={onUndo}><Undo2 size={18} /></button>}
    {onRedo && <button type="button" className="icon-button" aria-label={t('Rehacer construcción')} disabled={readOnly || !canRedo} onClick={onRedo}><Redo2 size={18} /></button>}
    {error && <span className="construction-error" role="alert">{t(error)}</span>}
  </div>;
}
