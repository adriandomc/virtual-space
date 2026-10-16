import commonEs from './locales/es/common.json';
import commonEn from './locales/en/common.json';
import editorEs from './locales/es/editor.json';
import editorEn from './locales/en/editor.json';
import modelsEs from './locales/es/models.json';
import modelsEn from './locales/en/models.json';
import helpEs from './locales/es/help.json';
import helpEn from './locales/en/help.json';
import legalEs from './locales/es/legal.json';
import legalEn from './locales/en/legal.json';
import errorsEs from './locales/es/errors.json';
import errorsEn from './locales/en/errors.json';
import messagesEs from './locales/es/messages.json';
import messagesEn from './locales/en/messages.json';

export const languages = [{ code: 'es', name: 'Español' }, { code: 'en', name: 'English' }] as const;
export type Locale = typeof languages[number]['code'];
export function supportedLocale(value: string | null | undefined): Locale | null {
  const base = value?.toLowerCase().split('-')[0];
  return languages.find(language => language.code === base)?.code ?? null;
}
export const translationCatalogs = {
  es: { ...commonEs, ...editorEs, ...modelsEs, ...helpEs, ...legalEs, ...errorsEs, ...messagesEs },
  en: { ...commonEn, ...editorEn, ...modelsEn, ...helpEn, ...legalEn, ...errorsEn, ...messagesEn },
};
