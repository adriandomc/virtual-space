export type OfflineStore = 'projects' | 'assets' | 'meta';
export type OfflineAccess = { accountId: string; allowed: boolean };

const stores: OfflineStore[] = ['projects', 'assets', 'meta'];
const access = new Map<string, OfflineAccess>();
const purgeListeners = new Set<() => void>();
let database: Promise<IDBDatabase> | undefined;
let accountId: string | undefined;
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('3d-space-offline') : undefined;
function setAccount(id: string | undefined) {
  if (accountId === id) return;
  accountId = id;
  access.clear();
  for (const listener of purgeListeners) listener();
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('space-offline-identity', { detail: { accountId } }));
}
if (channel) channel.onmessage = event => {
  if (event.data?.kind === 'identity') setAccount(typeof event.data.id === 'string' ? event.data.id : undefined);
  if (event.data?.kind === 'clear') { setAccount(undefined); for (const listener of purgeListeners) listener(); }
};
function identity(value: unknown) {
  setAccount(value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' ? value.id : undefined);
}

export function setOfflineAccess(roomId: string, value: OfflineAccess | null) {
  if (value) access.set(roomId, { ...value });
  else access.delete(roomId);
}
export function getOfflineAccess(roomId: string): OfflineAccess | undefined {
  const value = access.get(roomId);
  return value && value.accountId === accountId ? { ...value } : undefined;
}
export function onOfflinePurge(listener: () => void): () => void {
  purgeListeners.add(listener);
  return () => { purgeListeners.delete(listener); };
}

function storageError(cause: unknown): Error {
  return new Error(cause instanceof DOMException && cause.name === 'QuotaExceededError'
    ? 'No hay espacio suficiente para guardar sin conexión. Libera espacio y vuelve a intentarlo.'
    : 'No se pudo guardar la copia sin conexión. Revisa el almacenamiento del navegador.', { cause });
}

function open(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(storageError(undefined)); return; }
    const request = indexedDB.open('3d-space-offline', 1);
    request.onupgradeneeded = () => {
      for (const store of stores) if (!request.result.objectStoreNames.contains(store)) request.result.createObjectStore(store);
    };
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => reject(storageError(new Error('Cierra las otras pestañas para actualizar el almacenamiento.')));
    request.onsuccess = () => {
      const value = request.result;
      value.onversionchange = () => { value.close(); database = undefined; };
      resolve(value);
    };
  }).catch(error => { database = undefined; throw error; });
  return database;
}

async function run<T>(names: OfflineStore[], mode: IDBTransactionMode, operation: (transaction: IDBTransaction, fail: (cause: unknown) => void) => IDBRequest<T> | void): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(names, mode);
    let request: IDBRequest<T> | void;
    let failure: unknown;
    const fail = (cause: unknown) => { failure = cause; transaction.abort(); };
    try { request = operation(transaction, fail); }
    catch (error) { transaction.abort(); reject(storageError(error)); return; }
    // A successful request is not durable until its transaction commits.
    transaction.oncomplete = () => resolve(request ? request.result : undefined as T);
    transaction.onabort = () => reject(storageError(failure ?? transaction.error ?? request?.error));
    transaction.onerror = () => { /* onabort reports the final transaction failure. */ };
  });
}

export async function readOffline<T>(store: OfflineStore, key: string): Promise<T | undefined> {
  const value = await run<T | undefined>([store], 'readonly', tx => tx.objectStore(store).get(key));
  if (store === 'meta' && key === 'identity') identity(value);
  return value;
}
export async function writeOffline<T>(store: OfflineStore, key: string, value: T): Promise<void> {
  const owner = value && typeof value === 'object' && 'accountId' in value ? value.accountId : undefined;
  if (store !== 'meta' && typeof owner === 'string') {
    await run([store, 'meta'], 'readwrite', (tx, fail) => {
      const current = tx.objectStore('meta').get('identity');
      current.onsuccess = () => {
        if (current.result?.id !== owner || accountId !== owner) tx.abort();
        else try { tx.objectStore(store).put(value, key); } catch (error) { fail(error); }
      };
    });
  } else await run([store], 'readwrite', tx => tx.objectStore(store).put(value, key));
  if (store === 'meta' && key === 'identity') { identity(value); channel?.postMessage({ kind: 'identity', id: accountId }); }
}
export async function removeOffline(store: OfflineStore, key: string): Promise<void> {
  if (store === 'meta' && key === 'identity') { setAccount(undefined); channel?.postMessage({ kind: 'identity' }); }
  await run([store], 'readwrite', tx => tx.objectStore(store).delete(key));
}
export function listOffline<T>(store: OfflineStore): Promise<T[]> {
  return run([store], 'readonly', tx => tx.objectStore(store).getAll());
}
export async function clearOffline(): Promise<void> {
  setAccount(undefined);
  access.clear();
  for (const listener of purgeListeners) listener();
  channel?.postMessage({ kind: 'clear' });
  await run(stores, 'readwrite', tx => { for (const name of stores) tx.objectStore(name).clear(); });
}
