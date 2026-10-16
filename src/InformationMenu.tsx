import { BookOpen, FileText, Info, Shield } from 'lucide-react';
import { t, useLocale } from './i18n';
import Popover from './Popover';
import './information.css';

export default function InformationMenu() {
  useLocale();
  return <Popover rootClassName="information-menu" triggerClassName="icon-button" trigger={<Info size={20} />} label={t('Información')} className="information-links" role="navigation">{close => <>
    <a href="/help" target="_blank" rel="noopener" onClick={close}><BookOpen size={18} /><span>{t('Ayuda y guía inicial')}</span></a>
    <a href="/privacy" target="_blank" rel="noopener" onClick={close}><Shield size={18} /><span>{t('Aviso de privacidad')}</span></a>
    <a href="/terms" target="_blank" rel="noopener" onClick={close}><FileText size={18} /><span>{t('Condiciones de uso')}</span></a>
  </>}</Popover>;
}
