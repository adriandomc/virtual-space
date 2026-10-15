import { Component, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { getAppOfflineState, subscribeAppOffline } from './appOffline';

export function AppFrame({ children }: { children: ReactNode }) {
  const state = useSyncExternalStore(subscribeAppOffline, getAppOfflineState);
  useEffect(() => {
    if (!state.updating) return;
    const block = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    const events = ['keydown', 'pointerdown', 'pointermove', 'pointerup', 'input', 'change'];
    events.forEach(name => window.addEventListener(name, block, true));
    return () => events.forEach(name => window.removeEventListener(name, block, true));
  }, [state.updating]);
  return <><div style={{ display: 'contents' }} inert={state.updating}>{children}</div>{state.updating && <div className="app-update-overlay" role="alert" aria-busy="true"><LoaderCircle className="saving-spinner" size={28} /><p>Guardando cambios…</p></div>}</>;
}
export default class AppRecovery extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="project-loading"><p>No se pudo abrir esta vista.</p><p>Si faltan recursos, conecta el dispositivo y vuelve a intentarlo. Tus copias locales se conservan.</p><button className="primary-button" onClick={() => window.location.reload()}>Reintentar</button><a href="/designs">Mis diseños</a></main>;
    return this.props.children;
  }
}
