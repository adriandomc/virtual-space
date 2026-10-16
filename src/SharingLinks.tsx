import { t, useLocale } from './i18n';
import { useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { embedAddress, embedCode } from './routes';

export default function SharingLinks({ id, shareUrl, notify }: { id: string; shareUrl: string; notify: (message: string) => void }) {
  useLocale();
  const [view, setView] = useState<'link' | 'embed'>('link');
  const [feedback, setFeedback] = useState('');
  const linkField = useRef<HTMLInputElement>(null);
  const codeField = useRef<HTMLTextAreaElement>(null);
  const source = new URL(shareUrl);
  const address = view === 'embed' ? embedAddress(source, id) : shareUrl;
  const code = embedCode(source, id, t('Visor 3D'));
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); setFeedback('Copiado.'); notify(t('Copiado.')); }
    catch {
      const field = value === code ? codeField.current : linkField.current;
      field?.focus(); field?.select(); setFeedback('Selecciona el texto para copiarlo.');
    }
  };
  return <div className="sharing-links">
    <div className="sharing-tabs" role="group" aria-label={t('Compartir')}><button type="button" aria-pressed={view === 'link'} onClick={() => { setView('link'); setFeedback(''); }}>{t('Enlace')}</button><button type="button" aria-pressed={view === 'embed'} onClick={() => { setView('embed'); setFeedback(''); }}>{t('Insertar')}</button></div>
    <label className="sharing-field"><span>{view === 'embed' ? t('Enlace del visor') : t('Enlace de lectura')}</span><input ref={linkField} className="share-url" aria-label={view === 'embed' ? t('Enlace del visor') : t('Enlace del proyecto')} readOnly value={address} onFocus={event => event.target.select()} /></label>
    <button type="button" className="primary-button" onClick={() => void copy(address)}><Copy size={15} />{t('Copiar enlace')}</button>
    {view === 'embed' && <><label className="sharing-field"><span>{t('Código para insertar')}</span><textarea ref={codeField} aria-label={t('Código para insertar')} readOnly value={code} rows={4} onFocus={event => event.target.select()} /></label><button type="button" className="outline-button full-width" onClick={() => void copy(code)}><Copy size={15} />{t('Copiar código')}</button></>}
    {feedback && <p role="status">{t(feedback)}</p>}
  </div>;
}
