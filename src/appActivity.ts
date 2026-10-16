type Check = () => boolean | string;
const checks = new Set<Check>();
type AppVersion = 'current' | 'checking' | 'outdated';
let version: AppVersion = 'current';
const versionListeners = new Set<() => void>();
export const appVersion = () => version;
export function subscribeAppVersion(listener: () => void) { versionListeners.add(listener); return () => { versionListeners.delete(listener); }; }
export function setAppVersion(value: AppVersion) { if (version !== value) { version = value; versionListeners.forEach(listener => listener()); } }
export function assertCurrentAppVersion() { if (version !== 'current') throw new Error(version === 'checking' ? 'Espera a que termine la operación actual.' : 'Actualiza la aplicación antes de seguir editando. Tus cambios anteriores se conservan.'); }
let touched = false;
if (typeof window !== 'undefined') {
  try {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    touched = navigation?.type !== 'reload' && sessionStorage.getItem('3d-space-session-active') === '1';
    if (navigation?.type === 'reload') sessionStorage.removeItem('3d-space-session-active');
  } catch { /* Storage restrictions must not prevent opening the application. */ }
}
let ready = false;
const listeners = new Set<() => void>();
export function registerAppActivity(check: Check) { checks.add(check); return () => { checks.delete(check); }; }
export function beginAppActivity(reason = 'Espera a que termine la operación actual.') {
  const release = registerAppActivity(() => reason);
  return release;
}
export function appActivityReason(): string {
  for (const check of checks) { const value = check(); if (value) return typeof value === 'string' ? value : 'Termina o cancela la edición pendiente antes de continuar.'; }
  return '';
}
export const appStartupIdle = () => ready && !touched && !appActivityReason();
export function setAppUpdateReady(value: boolean) { ready = value; listeners.forEach(listener => listener()); }
export function markAppInteraction() { touched = true; try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('3d-space-session-active', '1'); } catch { /* The in-memory guard still protects this page. */ } }
export function subscribeAppStartup(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
if (typeof window !== 'undefined') {
  for (const type of ['pointerdown', 'keydown', 'beforeinput', 'compositionstart', 'wheel']) window.addEventListener(type, markAppInteraction, { capture: true, passive: true });
  window.addEventListener('pageshow', event => { if (event.persisted) markAppInteraction(); });
  window.addEventListener('pagehide', markAppInteraction);
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') markAppInteraction(); });
}
