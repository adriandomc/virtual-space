import type { ProjectDocument } from './projectDocument';
import { t, useLocale } from './i18n';

export default function RecoveryPanel({ project, onDownload, onDiscard, onError }: { project: ProjectDocument | null; onDownload: () => Promise<void>; onDiscard: () => Promise<void>; onError: (message: string) => void }) {
  useLocale();
  if (!project) return null;
  return <section className="project-recovery" aria-label={t('Cambios recuperados')}>
    <strong>{t('Cambios recuperados')}</strong><p>{t('Tus cambios no se pudieron aplicar. Descarga la copia o copia los datos del borrador antes de descartarlos.')}</p>
    <details><summary>{t('Recuperar borrador')}</summary><textarea readOnly aria-label={t('Datos del diseño recuperado')} value={JSON.stringify(project, null, 2)} onFocus={event => event.currentTarget.select()} /></details>
    <div><button type="button" onClick={() => void onDownload().catch(cause => onError(cause.message))}>{t('Descargar copia')}</button><button type="button" onClick={() => { if (window.confirm(t('¿Descartar la copia recuperada? Esta acción no se puede deshacer.'))) void onDiscard().catch(cause => onError(cause.message)); }}>{t('Descartar copia recuperada')}</button></div>
  </section>;
}
