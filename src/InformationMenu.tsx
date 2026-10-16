import { useEffect, useId, useRef, useState } from 'react';
import { BookOpen, FileText, Info, Shield } from 'lucide-react';
import { t, useLocale } from './i18n';
import './information.css';

export default function InformationMenu() {
  useLocale();
  const linksId = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  return <div className="information-menu" ref={root}><button ref={trigger} className="icon-button" type="button" aria-label={t('Información')} title={t('Información')} aria-expanded={open} aria-controls={linksId} onClick={() => setOpen(value => !value)}><Info size={20} /></button>{open && <nav id={linksId} className="information-links" aria-label={t('Información')}>
    <a href="/help" target="_blank" rel="noopener" onClick={() => setOpen(false)}><BookOpen size={18} /><span>{t('Ayuda y guía inicial')}</span></a>
    <a href="/privacy" target="_blank" rel="noopener" onClick={() => setOpen(false)}><Shield size={18} /><span>{t('Aviso de privacidad')}</span></a>
    <a href="/terms" target="_blank" rel="noopener" onClick={() => setOpen(false)}><FileText size={18} /><span>{t('Condiciones de uso')}</span></a>
  </nav>}</div>;
}
