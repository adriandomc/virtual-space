export function BrandMark() {
  return <svg className="brand-mark" width="28" height="28" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="24" cy="24" r="21" />
    <path d="M24 12 35 18.5v13L24 38l-11-6.5v-13L24 12ZM13 18.5 24 25l11-6.5M24 25v13" />
  </svg>;
}

export default function Brand({ className = 'account-brand' }: { className?: string }) {
  useLocale();
  return <div className={className}><BrandMark /><strong>{t('3D Space')}</strong></div>;
}
import { t, useLocale } from './i18n';
