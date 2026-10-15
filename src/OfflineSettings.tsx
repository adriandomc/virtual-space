import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Download, LoaderCircle, RefreshCw, Settings2, WifiOff, X } from 'lucide-react';
import { checkAppUpdate, confirmAllLocalSaved, confirmLocalSaved, getAppOfflineState, installApp, releaseLocalSaveFreeze, subscribeAppOffline, updateAppOffline, waitForAppOffline } from './appOffline';
import { offlineForced, setOfflineMode, subscribeOfflineMode } from './offlineMode';
import { offlineSummary, prepareOffline, syncOfflineAccount, type OfflineSummary } from './offlineService';
import './offline.css';

export const useOfflineMode = () => useSyncExternalStore(subscribeOfflineMode, offlineForced);
const bytes = (value: number) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(value / 1024 / 1024) + ' MB';

export default function OfflineSettings() {
  const forced = useOfflineMode();
  const app = useSyncExternalStore(subscribeAppOffline, getAppOfflineState);
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<OfflineSummary | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const initialPreparation = useRef(false);
  const inEditor = window.location.pathname === '/editor';
  useEffect(() => {
    if (initialPreparation.current || new URL(window.location.href).searchParams.get('prepare') !== '1') return;
    initialPreparation.current = true; setOpen(true);
    const address = new URL(window.location.href); address.searchParams.delete('prepare'); window.history.replaceState(null, '', address);
    void run(() => prepareOffline());
  }, []);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const refresh = () => { void offlineSummary().then(next => { if (active) setSummary(next); }).catch(cause => { if (active) setError(cause.message); }); };
    refresh(); window.addEventListener('space-offline-data', refresh); window.addEventListener('space-offline-mode', refresh);
    return () => { active = false; window.removeEventListener('space-offline-data', refresh); window.removeEventListener('space-offline-mode', refresh); };
  }, [open]);
  async function run(operation: () => Promise<unknown>) {
    setPending(true); setError('');
    try { await operation(); setSummary(await offlineSummary()); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo completar la operación.'); }
    finally { setPending(false); }
  }
  return <>
    <button type="button" className="icon-button offline-settings-button" aria-label="Ajustes de la aplicación" onClick={() => setOpen(true)}><Settings2 size={20} />{forced && <span className="offline-mode-dot" />}</button>
    <dialog ref={dialog} className="app-dialog offline-settings" onCancel={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}>
      <header className="dialog-heading"><h2>Ajustes</h2><button type="button" className="icon-button" aria-label="Cerrar ajustes" onClick={() => setOpen(false)}><X size={20} /></button></header>
      <section aria-labelledby="offline-heading"><h3 id="offline-heading"><WifiOff size={19} />Sin conexión</h3>
        <p>Prepara tus diseños privados y modelos para usarlos en este dispositivo.</p>
        <div className="offline-setting-row"><span>Modo sin conexión</span><button type="button" role="switch" aria-label="Modo sin conexión" aria-checked={forced} className={'switch ' + (forced ? 'on' : '')} disabled={pending || !summary || (!forced && (!summary.prepared || !app.ready))} onClick={() => void run(async () => {
          if (!forced) await waitForAppOffline();
          await confirmAllLocalSaved();
          try { await setOfflineMode(!forced); } finally { await releaseLocalSaveFreeze(); }
        })}><span /></button></div>
        <p className="offline-setting-note">{forced ? 'Los cambios se guardan aquí. Desactívalo para sincronizar.' : 'Los diseños compartidos necesitan una copia personal para usarlos sin conexión.'}</p>
        <button type="button" className="outline-button full-width" disabled={pending || forced || summary?.preparing || summary?.syncing} onClick={() => void run(async () => { if (inEditor) { await confirmLocalSaved(); window.location.assign('/designs?prepare=1'); } else await prepareOffline(); })}>{summary?.preparing ? <LoaderCircle size={17} className="saving-spinner" /> : <Download size={17} />}{summary?.prepared ? 'Actualizar copia local' : 'Preparar diseños'}</button>
        {inEditor && <p className="offline-setting-note">La preparación guarda el diseño y continúa en Mis diseños.</p>}
        {summary?.progress && <div className="offline-progress" role="status"><progress value={summary.progress.done} max={Math.max(1, summary.progress.total)} /><span>{summary.progress.label} · {summary.progress.done}/{summary.progress.total}</span></div>}
        <dl className="offline-details"><div><dt>Aplicación</dt><dd>{app.ready ? 'Disponible' : 'Preparando…'}</dd></div><div><dt>Diseños y modelos</dt><dd>{summary?.prepared ? 'Preparados' : 'Sin preparar'}</dd></div><div><dt>Cambios pendientes</dt><dd>{summary?.pending ?? '—'}{summary?.syncing ? ' · Sincronizando…' : ''}</dd></div><div><dt>Espacio utilizado</dt><dd>{summary ? bytes(summary.bytes) + (summary.quota ? ' / ' + bytes(summary.quota) : '') : '—'}</dd></div></dl>
        {!!summary?.pending && !forced && <button className="outline-button full-width" disabled={pending || summary.syncing} onClick={() => void run(syncOfflineAccount)}><RefreshCw size={16} />Sincronizar cambios</button>}
        <p className="offline-setting-note">Conserva exportaciones de tu trabajo. El navegador puede eliminar sus datos para liberar espacio.</p>
      </section>
      <section aria-labelledby="install-heading"><h3 id="install-heading">Aplicación</h3>
        {app.installed ? <p>Instalada en este dispositivo.</p> : app.installable ? <button className="outline-button full-width" disabled={pending} onClick={() => void run(installApp)}><Download size={17} />Instalar 3D Space</button> : <p className="offline-setting-note">Para instalarla, usa «Añadir a pantalla de inicio» o «Instalar aplicación» en el menú del navegador. En iPhone o iPad, abre Compartir en Safari.</p>}
        <button className="outline-button full-width" disabled={pending || app.updating || forced} onClick={() => void run(app.update ? updateAppOffline : checkAppUpdate)}><RefreshCw size={16} />{app.update ? 'Actualizar aplicación' : 'Buscar actualizaciones'}</button>
      </section>
      {(error || summary?.error || app.error) && <p className="account-error" role="alert">{error || summary?.error || app.error}</p>}
    </dialog>
  </>;
}
