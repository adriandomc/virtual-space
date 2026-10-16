import { refreshOfflineMode, offlineFetch } from './offlineMode';
import { retireTestStorage } from './retiredStorage';

type AppOfflineState = { ready: boolean; update: boolean; updating: boolean; error: string; installable: boolean; installed: boolean };
type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> };
let state: AppOfflineState = { ready: false, update: false, updating: false, error: '', installable: false, installed: false };
let registration: ServiceWorkerRegistration | undefined;
let started: Promise<void> | undefined;
let prompt: InstallPrompt | undefined;
let freeze: { kind: 'update' | 'mode'; id: string } | undefined;
let modeFreeze: { id: string; worker?: ServiceWorker } | undefined;
const listeners = new Set<() => void>();
const guards = new Map<() => Promise<void>, 'flush' | 'durable'>();
const publish = (patch: Partial<AppOfflineState>) => { state = { ...state, ...patch }; listeners.forEach(listener => listener()); };
export const getAppOfflineState = () => state;
export function subscribeAppOffline(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function registerBeforeAppUpdate(guard: () => Promise<void>, phase: 'flush' | 'durable' = 'flush') { guards.set(guard, phase); return () => { guards.delete(guard); }; }
export async function confirmLocalSaved() {
  for (const phase of ['flush', 'durable']) await Promise.all([...guards].filter(([, value]) => value === phase).map(([guard]) => guard()));
}
function unfreeze(kind: 'update' | 'mode', id: string) {
  if (freeze?.kind !== kind || freeze.id !== id) return;
  freeze = undefined; publish({ updating: false });
}
function message(worker: ServiceWorker, type: string, id: string = crypto.randomUUID()): Promise<{ ready?: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => { channel.port1.close(); reject(new Error('No se pudo verificar la aplicación. Cierra las otras pestañas y vuelve a intentarlo.')); }, type === 'SPACE_PREPARE' || type === 'SPACE_UPDATE' ? 120000 : 25000);
    channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
    worker.postMessage({ type, id }, [channel.port2]);
  });
}
export function registerAppOffline() {
  if (started) return started;
  started = (async () => {
    if (!import.meta.env?.PROD) { publish({ ready: true }); return; }
    if (!('serviceWorker' in navigator)) throw new Error('Este navegador no permite preparar la aplicación sin conexión.');
    publish({ installed: window.matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone });
    window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt = event as InstallPrompt; publish({ installable: true }); });
    window.addEventListener('appinstalled', () => { prompt = undefined; publish({ installed: true, installable: false }); });
    navigator.serviceWorker.addEventListener('message', event => {
      const id = event.data?.id;
      if (typeof id !== 'string') return;
      if (event.data?.type === 'SPACE_CANCEL_UPDATE') { unfreeze('update', id); return; }
      if (event.data?.type === 'SPACE_RELEASE_MODE') {
        void refreshOfflineMode().then(() => unfreeze('mode', id)).catch(() => window.location.reload());
        return;
      }
      if (!['SPACE_SAVE_UPDATE', 'SPACE_SAVE_MODE'].includes(event.data?.type) || !event.ports[0]) return;
      const kind = event.data.type === 'SPACE_SAVE_MODE' ? 'mode' : 'update';
      if (freeze && (freeze.kind !== kind || freeze.id !== id)) { event.ports[0].postMessage({ ready: false }); return; }
      freeze = { kind, id };
      publish({ updating: true, error: '' });
      void confirmLocalSaved().then(() => event.ports[0].postMessage({ ready: true })).catch(cause => {
        unfreeze(kind, id); publish({ error: cause instanceof Error ? cause.message : 'Guarda los cambios antes de continuar.' });
        event.ports[0].postMessage({ ready: false });
      });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (freeze?.kind === 'update') window.location.reload();
      else if (navigator.serviceWorker.controller) void message(navigator.serviceWorker.controller, 'SPACE_STATUS').then(result => publish({ ready: !!result.ready })).catch(() => {});
    });
    registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/', updateViaCache: 'none' });
    const verify = async () => {
      const active = registration?.active;
      if (!active) return;
      const result = await message(active, 'SPACE_STATUS');
      publish({ ready: !!result.ready, ...(result.ready ? { error: '' } : {}) });
    };
    const check = () => {
      publish({ update: !!registration?.waiting });
      const worker = registration?.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed') { publish({ update: !!registration?.waiting }); void verify(); }
        if (worker.state === 'redundant') publish({ error: 'No se pudo descargar la aplicación completa. Inténtalo de nuevo con conexión.' });
      });
    };
    registration.addEventListener('updatefound', check); check();
    await verify();
    // The server publishes this gate only after its explicit one-time test-data reset.
    // Forced mode and failed requests leave every old database untouched.
    try {
      if (navigator.onLine) {
        const response = await offlineFetch('/api/release?public=1', { cache: 'no-store', credentials: 'omit' });
        if (response.ok) await retireTestStorage(await response.json());
      }
    } catch (cause) {
      if (cause instanceof Error && cause.message.includes('datos de prueba')) publish({ error: cause.message });
    }
  })().catch(cause => { started = undefined; publish({ error: cause instanceof Error ? cause.message : 'No se pudo preparar la aplicación.' }); });
  return started;
}
export async function waitForAppOffline(): Promise<void> {
  await registerAppOffline();
  if (!import.meta.env?.PROD) return;
  if (!registration?.active) await navigator.serviceWorker.ready;
  const worker = registration?.active;
  if (!worker) throw new Error('La aplicación aún no está lista. Comprueba la conexión e inténtalo de nuevo.');
  const result = await message(worker, 'SPACE_PREPARE'); publish({ ready: !!result.ready, error: result.error ?? '' });
  if (!result.ready) throw new Error(result.error || 'Faltan recursos de la aplicación. Vuelve a preparar la copia con conexión.');
}
export async function checkAppUpdate() { await registration?.update(); }
export async function confirmAllLocalSaved() {
  await registerAppOffline();
  if (state.updating) throw new Error('Espera a que termine la operación actual.');
  const id = crypto.randomUUID();
  const worker = typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller ?? registration?.active ?? undefined : undefined;
  modeFreeze = { id, worker }; freeze = { kind: 'mode', id }; publish({ updating: true, error: '' });
  try {
    if (!import.meta.env?.PROD) await confirmLocalSaved();
    else {
      if (!worker) throw new Error('Espera a que la aplicación esté preparada antes de cambiar de modo.');
      const result = await message(worker, 'SPACE_SAVE_ALL', id);
      if (!result.ready) throw new Error(result.error || 'Guarda los cambios de las otras pestañas antes de cambiar de modo.');
    }
  } catch (cause) { await releaseLocalSaveFreeze(); throw cause; }
}
export async function releaseLocalSaveFreeze() {
  const held = modeFreeze;
  if (!held) return;
  modeFreeze = undefined;
  try { if (held.worker) await message(held.worker, 'SPACE_RELEASE_SAVED', held.id); }
  finally { try { await refreshOfflineMode(); } finally { unfreeze('mode', held.id); } }
}
export async function updateAppOffline() {
  const worker = registration?.waiting;
  if (!worker || state.updating) return;
  publish({ error: '' });
  try {
    const result = await message(worker, 'SPACE_UPDATE');
    if (result.error) throw new Error(result.error);
  } catch (cause) { publish({ updating: false, error: cause instanceof Error ? cause.message : 'No se pudo actualizar.' }); }
}
export async function installApp() {
  if (!prompt) return;
  await prompt.prompt(); await prompt.userChoice;
  prompt = undefined; publish({ installable: false });
}
