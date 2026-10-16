import i18n from 'i18next';
import { initReactI18next, useTranslation } from 'react-i18next';
import { languages, supportedLocale, translationCatalogs, type Locale } from './translations';
import { createMessageTranslator } from './messageLocalization';

export const LANGUAGE_STORAGE_KEY = '3d-space-language';
function initialLanguage(): Locale {
  try {
    const saved = supportedLocale(window.localStorage.getItem(LANGUAGE_STORAGE_KEY));
    if (saved) return saved;
  } catch { /* Language selection still works when device storage is unavailable. */ }
  if (typeof navigator !== 'undefined') {
    for (const language of navigator.languages ?? [navigator.language]) {
      const supported = supportedLocale(language);
      if (supported) return supported;
    }
  }
  return 'es';
}

void i18n.use(initReactI18next).init({
  resources: Object.fromEntries(languages.map(({ code }) => [code, { translation: translationCatalogs[code] }])),
  lng: initialLanguage(), fallbackLng: 'es', supportedLngs: languages.map(({ code }) => code),
  initAsync: false, keySeparator: false, nsSeparator: false,
  interpolation: { escapeValue: false }, react: { useSuspense: false },
});

export const t = createMessageTranslator(translationCatalogs, (key, values) => String(i18n.t(key, values)));
export function useLocale(): Locale {
  const { i18n: current } = useTranslation();
  return supportedLocale(current.resolvedLanguage) ?? 'es';
}
export function setLocale(locale: Locale) {
  if (!supportedLocale(locale)) return;
  void i18n.changeLanguage(locale);
  try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale); } catch { /* Keep the choice for this tab. */ }
}
function updateDocumentLanguage() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = i18n.resolvedLanguage ?? 'es';
  document.querySelector('link[rel="manifest"]')?.setAttribute('href', '/manifest.' + (i18n.resolvedLanguage ?? 'es') + '.webmanifest');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('Creador de espacios 3D gratuito y de código abierto'));
  document.querySelector('meta[property="og:description"]')?.setAttribute('content', t('Creador de espacios 3D gratuito y de código abierto'));
}
i18n.on('languageChanged', updateDocumentLanguage);
updateDocumentLanguage();
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key === LANGUAGE_STORAGE_KEY) void i18n.changeLanguage(supportedLocale(event.newValue) ?? initialLanguage());
});
export { i18n, languages };
