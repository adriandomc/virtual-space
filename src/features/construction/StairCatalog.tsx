import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import type { ProjectDocument, ProjectStair } from '../../domain/project/projectDocument';
import { addStair } from '../../domain/project/projectOperations';
import type { Selection } from '../../domain/project/types';
import { t, useLocale } from '../../shared/i18n/i18n';
import '../models/furnitureCatalog.css';

export const STAIR_TYPES = [['straight', 'Recta'], ['landing', 'Recta con descanso'], ['l', 'En L'], ['u', 'En U'], ['spiral', 'En caracol']] as const;

const outlines: Record<ProjectStair['type'], string> = {
  straight: 'M45 98V82H57V68H69V54H81V40H93V26H115V98Z',
  landing: 'M30 98V83H43V68H56V53H82V38H95V23H125V98Z',
  l: 'M35 98V42H115V65H59V98Z M35 54H59 M35 66H59 M35 78H59 M35 90H59 M71 42V65 M83 42V65 M95 42V65 M107 42V65',
  u: 'M33 99V28H127V99H102V53H58V99Z M33 40H58 M33 53H58 M33 66H58 M33 79H58 M33 91H58 M102 40H127 M102 53H127 M102 66H127 M102 79H127 M102 91H127 M69 28V53 M84 28V53',
  spiral: 'M80 18A43 43 0 1 1 37 61H68A12 12 0 1 0 80 49Z M80 18V49 M102 24L86 50 M117 40L90 55 M123 61H92 M117 82L90 67 M102 98L86 72 M80 104V73 M58 98L74 72 M43 82L70 67',
};

type Props = {
  project: ProjectDocument;
  activeLevelId: string;
  onChange: (project: ProjectDocument) => boolean | void;
  onSelect: (selection: Selection) => void;
  readOnly?: boolean;
  onBack?: () => void;
};

export default function StairCatalog({ project, activeLevelId, onChange, onSelect, readOnly = false, onBack }: Props) {
  useLocale();
  const [error, setError] = useState('');
  const index = project.levels.findIndex(level => level.id === activeLevelId);
  const from = project.levels[index < project.levels.length - 1 ? index : index - 1];
  const to = from && project.levels[project.levels.indexOf(from) + 1];
  const connected = !!from && !!to;
  function create(type: ProjectStair['type']) {
    if (readOnly || !from || !to) return;
    try {
      const next = addStair(project, { fromLevelId: from.id, toLevelId: to.id, type });
      if (onChange(next) === false) return;
      setError('');
      onSelect({ kind: 'stair', id: next.stairs.at(-1)!.id });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo añadir la escalera.'); }
  }
  return <section className="furniture-catalog stair-catalog" aria-label={t('Catálogo de escaleras')}>
    {onBack && <div className="catalog-navigation"><button type="button" className="catalog-back" onClick={onBack}><ChevronLeft size={18} />{t('Elementos')}</button></div>}
    {!connected && <p className="catalog-notice" role="status">{t('Añade un nivel superior para conectar una escalera.')}</p>}
    {connected && <p className="catalog-notice">{t('{{from}} → {{to}}', { from: from.name, to: to.name })}</p>}
    <div className="catalog-models">{STAIR_TYPES.map(([type, label]) => <button type="button" className="catalog-model" key={type} disabled={readOnly || !connected} onClick={() => create(type)} aria-label={t('Agregar {{name}}', { name: t(label) })}>
      <svg className="furniture-thumbnail" viewBox="0 0 160 118" aria-hidden="true"><path d={outlines[type]} fill="#dce5d2" stroke="#637b55" strokeWidth="2" strokeLinejoin="round" /></svg><span className="catalog-model-name">{t(label)}</span>
    </button>)}</div>
    {error && <p className="construction-error" role="alert">{t(error)}</p>}
  </section>;
}
