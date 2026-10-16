export type OfflineStore = 'projects' | 'levels' | 'assets' | 'blobs' | 'meta';
export type OfflineAccess = { accountId: string; allowed: boolean };

const stores: OfflineStore[] = ['projects', 'levels', 'assets', 'blobs', 'meta'];
const access = new Map<string, OfflineAccess>();
const purgeListeners = new Set<() => void>();
let database: Promise<IDBDatabase> | undefined;
let accountId: string | undefined;
const channel = typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('3d-space-v3') : undefined;
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
    const request = indexedDB.open('3d-space-v3', 1);
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
  if (store === 'projects') return (await readProjectRecords<T>(key))[0];
  const value = await run<T | undefined>([store], 'readonly', tx => tx.objectStore(store).get(key));
  if (store === 'meta' && key === 'identity') identity(value);
  return hydrate<T>(store, value);
}
async function hydrate<T>(store: OfflineStore, value: unknown): Promise<T | undefined> {
  if (!value || typeof value !== 'object') return value as T | undefined;
  const record = value as Record<string, unknown>;
  if (store === 'blobs' && record.bytes instanceof ArrayBuffer && typeof record.type === 'string') {
    const { bytes, type, ...metadata } = record;
    return { ...metadata, blob: new Blob([bytes], { type }) } as T;
  }
  if (store === 'assets' && typeof record.blobKey === 'string') {
    const binary = await readOffline<{ blob: Blob }>('blobs', record.blobKey);
    if (!binary?.blob) throw storageError(new Error('Faltan los archivos del modelo.'));
    return { ...record, blob: binary.blob } as T;
  }
  return value as T;
}
/** Metadata and its mutable level slots must come from the same committed snapshot. */
async function readProjectRecords<T>(key?: string): Promise<T[]> {
  const db = await open();
  return new Promise((accept, reject) => {
    const tx = db.transaction(['projects', 'levels'], 'readonly'), store = tx.objectStore('projects');
    const request = key === undefined ? store.getAll() : store.get(key);
    let records: any[] = [], failure: unknown;
    const levels = new Map<string, IDBRequest<{ level: unknown } | undefined>>();
    request.onsuccess = () => {
      records = key === undefined ? request.result : request.result === undefined ? [] : [request.result];
      try {
        for (const record of records) if (record?.levelRefs) {
          if (typeof record.levelRefs !== 'object' || Array.isArray(record.levelRefs)) throw new Error('Falta un nivel guardado en este dispositivo.');
          for (const [slot, keys] of Object.entries(record.levelRefs)) {
            if (!['snapshot', 'draft', 'inflight'].includes(slot) || !Array.isArray(keys) || keys.length > 12 || keys.some(key => typeof key !== 'string')) throw new Error('Falta un nivel guardado en este dispositivo.');
            for (const ref of keys) if (!levels.has(ref)) levels.set(ref, tx.objectStore('levels').get(ref));
          }
        }
      } catch (cause) { failure = cause; tx.abort(); }
    };
    tx.oncomplete = () => {
      try {
        accept(records.map(record => {
          if (!record?.levelRefs) return record;
          const copy = { ...record };
          for (const [slot, keys] of Object.entries(record.levelRefs) as [string, string[]][]) {
            const rows = keys.map(ref => levels.get(ref)?.result);
            if (rows.some(row => !row?.level)) throw new Error('Falta un nivel guardado en este dispositivo.');
            const project = slot === 'snapshot' ? copy.snapshot?.project : slot === 'draft' ? copy.draft : copy.inflight?.project;
            if (!project) throw new Error('Falta un nivel guardado en este dispositivo.');
            const hydrated = { ...project, levels: rows.map(row => row!.level) };
            if (slot === 'snapshot') copy.snapshot = { ...copy.snapshot, project: hydrated };
            else if (slot === 'draft') copy.draft = hydrated;
            else copy.inflight = { ...copy.inflight, project: hydrated };
          }
          return copy;
        }));
      } catch (cause) { reject(storageError(cause)); }
    };
    tx.onabort = () => reject(storageError(failure ?? tx.error));
    tx.onerror = () => { /* onabort reports the failed snapshot read. */ };
  });
}
export async function readOfflineEntries<T>(store: OfflineStore, keys: string[]): Promise<(T | undefined)[]> {
  const db = await open();
  return new Promise((accept, reject) => {
    const tx = db.transaction(store, 'readonly'), requests = keys.map(key => tx.objectStore(store).get(key));
    tx.oncomplete = () => accept(requests.map(request => request.result)); tx.onabort = () => reject(storageError(tx.error));
  });
}
export async function writeOffline<T>(store: OfflineStore, key: string, value: T): Promise<void> {
  const owner = value && typeof value === 'object' && 'accountId' in value ? value.accountId : undefined;
  if (store !== 'meta' && typeof owner === 'string') {
    await atomicOffline(owner, [{ store, key, value }]);
  } else await run([store], 'readwrite', tx => tx.objectStore(store).put(value, key));
  if (store === 'meta' && key === 'identity') { identity(value); channel?.postMessage({ kind: 'identity', id: accountId }); }
}
export async function removeOffline(store: OfflineStore, key: string): Promise<void> {
  if (store === 'meta' && key === 'identity') { setAccount(undefined); channel?.postMessage({ kind: 'identity' }); }
  await run(store === 'assets' ? ['assets', 'blobs'] : [store], 'readwrite', tx => {
    tx.objectStore(store).delete(key);
    if (store === 'assets') tx.objectStore('blobs').delete('asset:' + key);
  });
}
export async function listOffline<T>(store: OfflineStore): Promise<T[]> {
  if (store === 'projects') return readProjectRecords<T>();
  const values = await run<unknown[]>([store], 'readonly', tx => tx.objectStore(store).getAll());
  return Promise.all(values.map(value => hydrate<T>(store, value) as Promise<T>));
}
export function listOfflineMetadata<T>(store: OfflineStore): Promise<T[]> {
  return run([store], 'readonly', tx => tx.objectStore(store).getAll());
}
export function listOfflineKeys(store: OfflineStore): Promise<IDBValidKey[]> {
  return run([store], 'readonly', tx => tx.objectStore(store).getAllKeys());
}
export type OfflineWrite = { store: OfflineStore; key: string; value?: unknown; remove?: boolean; protectPending?: boolean; guardKey?: string };
async function encodeWrites(writes: OfflineWrite[]): Promise<OfflineWrite[]> {
  const encoded: OfflineWrite[] = [];
  for (const write of writes) {
    const value = write.value && typeof write.value === 'object' ? write.value as Record<string, unknown> : null;
    if (write.store === 'assets' && write.remove) encoded.push({ store: 'blobs', key: 'asset:' + write.key, remove: true });
    if (write.store === 'assets' && value?.blob instanceof Blob) {
      const { blob, ...metadata } = value, blobKey = 'asset:' + write.key;
      encoded.push({ store: 'blobs', key: blobKey, guardKey: write.protectPending ? write.key : undefined, value: { accountId: value.accountId, roomId: value.roomId, key: blobKey, bytes: await blob.arrayBuffer(), type: blob.type } });
      encoded.push({ ...write, value: { ...metadata, blobKey } });
    } else if (write.store === 'blobs' && value?.blob instanceof Blob) {
      const { blob, ...metadata } = value;
      encoded.push({ ...write, value: { ...metadata, bytes: await blob.arrayBuffer(), type: blob.type } });
    } else encoded.push(write);
  }
  return encoded;
}
export async function cacheOfflineAsset<T extends { accountId: string }>(key: string, value: T): Promise<void> {
  await atomicOffline(value.accountId, [{ store: 'assets', key, value, protectPending: true }]);
}
export async function updateOffline<T>(store: OfflineStore, key: string, accountId: string, update: (current: T | undefined) => T | undefined): Promise<void> {
  await run([store, 'meta'], 'readwrite', (tx, fail) => {
    const identity = tx.objectStore('meta').get('identity');
    identity.onsuccess = () => {
      if (identity.result?.id !== accountId) { fail(new Error('La cuenta activa cambió.')); return; }
      const current = tx.objectStore(store).get(key);
      current.onsuccess = () => {
        try {
          const next = update(current.result);
          if (next && typeof next === 'object' && 'blob' in next && next.blob instanceof Blob) throw new Error('Los archivos se guardan por separado.');
          if (next !== undefined) tx.objectStore(store).put(next, key);
        }
        catch (cause) { fail(cause); }
      };
    };
  });
}
export async function atomicOffline(accountId: string, writes: OfflineWrite[]): Promise<void> {
  writes = await encodeWrites(writes);
  await run([...new Set<OfflineStore>(['meta', ...writes.map(write => write.store)])], 'readwrite', (tx, fail) => {
    const current = tx.objectStore('meta').get('identity');
    current.onsuccess = () => {
      if (current.result?.id !== accountId) { fail(new Error('La cuenta activa cambió.')); return; }
      const guards = writes.filter(write => write.protectPending);
      const blocked = new Set<string>();
      const apply = () => { try { for (const write of writes) {
        if (blocked.has(write.guardKey ?? (write.protectPending ? write.key : ''))) continue;
        const store = tx.objectStore(write.store);
        if (write.remove) store.delete(write.key); else store.put(write.value, write.key);
      } } catch (cause) { fail(cause); } };
      if (!guards.length) { apply(); return; }
      let remaining = guards.length;
      for (const guard of guards) {
        const request = tx.objectStore('assets').get(guard.key);
        request.onsuccess = () => {
          if (request.result?.pending || request.result?.deleted) blocked.add(guard.key);
          if (!--remaining) apply();
        };
      }
    };
  });
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('space-offline-data'));
}
export async function clearOfflineAccount(accountId: string): Promise<void> {
  const active = (await readOffline<{ id: string }>('meta', 'identity'))?.id === accountId;
  await run(stores, 'readwrite', tx => {
    for (const name of stores) {
      const cursor = tx.objectStore(name).openCursor();
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) return;
        if (entry.value?.accountId === accountId || name === 'meta' && entry.key === 'identity' && entry.value?.id === accountId) entry.delete();
        entry.continue();
      };
    }
  });
  if (!active) return;
  setAccount(undefined); channel?.postMessage({ kind: 'identity' });
}
export async function clearOffline(): Promise<void> {
  setAccount(undefined);
  access.clear();
  for (const listener of purgeListeners) listener();
  channel?.postMessage({ kind: 'clear' });
  await run(stores, 'readwrite', tx => { for (const name of stores) tx.objectStore(name).clear(); });
}
