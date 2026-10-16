import { Languages } from 'lucide-react';
import { languages, setLocale, t, useLocale } from '../i18n/i18n';
import type { Locale } from '../i18n/translations';

export default function LanguageSelector() {
  const locale = useLocale();
  return <label className="language-selector"><Languages size={18} aria-hidden="true" /><span className="visually-hidden">{t('Idioma')}</span><select aria-label={t('Idioma')} value={locale} onChange={event => setLocale(event.target.value as Locale)}>{languages.map(language => <option key={language.code} value={language.code} lang={language.code}>{language.name}</option>)}</select></label>;
}
