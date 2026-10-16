import { t, useLocale } from './i18n';
import { Component, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { LoaderCircle, RefreshCw, X } from 'lucide-react';
import { getAppOfflineState, subscribeAppOffline, updateAppOffline } from './appOffline';
import { offlineForced, subscribeOfflineMode } from './offlineMode';

function AppUpdateNotice() {
  useLocale();
  const state = useSyncExternalStore(subscribeAppOffline, getAppOfflineState);
  const forced = useSyncExternalStore(subscribeOfflineMode, offlineForced);
  const [dismissed, setDismissed] = useState(false), [pending, setPending] = useState(false);
  if (!state.update || forced || dismissed) return null;
  async function update() {
    if (pending || state.updating || offlineForced()) return;
    setPending(true);
    try { await updateAppOffline(); }
    finally { setPending(false); }
  }
  return <aside className="app-update-notice" role="status" aria-label={t('Actualización disponible')} aria-busy={pending || state.updating}>
    <div className="app-update-notice-actions"><span>{t('Actualización disponible')}</span><button type="button" className="outline-button" disabled={pending || state.updating} onClick={() => void update()}>{pending ? <LoaderCircle size={17} className="saving-spinner" /> : <RefreshCw size={17} />}{t('Actualizar ahora')}</button><button type="button" className="icon-button" aria-label={t('Recordar más tarde')} disabled={pending || state.updating} onClick={() => setDismissed(true)}><X size={18} /></button></div>
    {state.error && <p role="alert">{t(state.error)}</p>}
  </aside>;
}

export function AppFrame({ children }: { children: ReactNode }) {
  useLocale();
  const state = useSyncExternalStore(subscribeAppOffline, getAppOfflineState);
  useEffect(() => {
    if (!state.updating) return;
    const block = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const events = ['keydown', 'pointerdown', 'pointermove', 'pointerup', 'input', 'change'];
    events.forEach(name => window.addEventListener(name, block, true));
    return () => events.forEach(name => window.removeEventListener(name, block, true));
  }, [state.updating]);
  return <><div style={{ display: 'contents' }} inert={state.updating}>{children}<AppUpdateNotice /></div>{state.updating && <div className="app-update-overlay" role="alert" aria-busy="true"><LoaderCircle className="saving-spinner" size={28} /><p>{t("Guardando cambios…")}</p></div>}</>;
}
export default class AppRecovery extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <RecoveryScreen />;
    return this.props.children;
  }
}
function RecoveryScreen() {
  useLocale();
  return <AppFrame><main className="project-loading"><p>{t('No se pudo abrir esta vista.')}</p><p>{t('Si faltan recursos, conecta el dispositivo y vuelve a intentarlo. Tus copias locales se conservan.')}</p><button className="primary-button" onClick={() => window.location.reload()}>{t('Reintentar')}</button><a href="/designs">{t('Mis diseños')}</a></main></AppFrame>;
}
