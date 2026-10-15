import { offlineIdentity, type OfflineIdentity } from './offlineIdentity';
import { readOffline, writeOffline } from './offlineStorage';

let forced = false;
let activeAccount: string | undefined;
let loaded: Promise<{ identity: OfflineIdentity | null; forced: boolean }> | undefined;
const listeners = new Set<() => void>();
const requests = new Set<AbortController>();
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('3d-space-mode-v2') : undefined;
function publish(next: boolean) {
  if (forced === next) return;
  forced = next;
  if (next) for (const request of requests) request.abort();
  for (const listener of listeners) listener();
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('space-offline-mode'));
}
if (channel) channel.onmessage = event => { if (event.data?.accountId === activeAccount && typeof event.data.forced === 'boolean') publish(event.data.forced); };

export async function bootstrapOfflineMode() {
  if (!loaded) loaded = (async () => {
    if (typeof indexedDB === 'undefined') return { identity: null, forced: false };
    const identity = await offlineIdentity(); activeAccount = identity?.id;
    const setting = identity ? await readOffline<{ accountId: string; forced: boolean }>('meta', 'mode:' + identity.id) : undefined;
    publish(setting?.accountId === identity?.id && setting?.forced === true);
    return { identity, forced };
  })().catch(cause => { loaded = undefined; throw cause; });
  const result = await loaded;
  return { ...result, forced };
}
export function refreshOfflineMode() { loaded = undefined; return bootstrapOfflineMode(); }
export const offlineForced = () => forced;
export function subscribeOfflineMode(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export async function setOfflineMode(enabled: boolean) {
  const identity = await offlineIdentity();
  if (!identity) throw new Error('Entra con tu cuenta para preparar el modo sin conexión.');
  if (enabled) {
    const prepared = await readOffline<{ accountId: string; complete: boolean }>('meta', 'prepared:' + identity.id);
    if (prepared?.accountId !== identity.id || !prepared.complete) throw new Error('Prepara tus diseños antes de activar el modo sin conexión.');
  }
  activeAccount = identity.id;
  await writeOffline('meta', 'mode:' + identity.id, { accountId: identity.id, forced: enabled });
  publish(enabled); channel?.postMessage({ accountId: identity.id, forced: enabled });
}
export function trackOfflineRequest(controller: AbortController) {
  if (forced) controller.abort();
  requests.add(controller); return () => { requests.delete(controller); };
}
export async function assertOnlineMode() {
  await bootstrapOfflineMode();
  if (forced) throw new TypeError('El modo sin conexión está activado.');
}
export async function offlineFetch(input: RequestInfo | URL, options: RequestInit = {}) {
  await assertOnlineMode();
  const controller = new AbortController();
  const release = trackOfflineRequest(controller);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await fetch(input, { ...options, signal: controller.signal });
    // Keep body consumption inside this boundary so mode changes cannot deliver stale resources.
    const bytes = await response.arrayBuffer();
    if (offlineForced() || controller.signal.aborted) throw new TypeError('El modo sin conexión está activado.');
    return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
  } finally { release(); clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
}
if (typeof window !== 'undefined') window.addEventListener('space-offline-identity', () => {
  loaded = undefined;
  void bootstrapOfflineMode().catch(() => publish(false));
});
