import { useCallback, useEffect, useRef, useState } from 'react';
import { createDefaultRoom, validateRoom } from './model';
import type { Room } from './types';
import { shareAddress } from './routes';
import { accountRequest, AccountRequestError, isNetworkError } from './accountApi';
import { LiveProject, type ProjectRole, type ProjectSnapshot } from './liveProject';
import { SoloProject, offlineProjectKey, readOfflineProject, validateOfflineProject, type OfflineProjectRecord, type SoloStatus } from './offlineProject';
import { readOffline, writeOffline, listOffline, setOfflineAccess } from './offlineStorage';
import { flushOfflineAssets, type OfflineAssetRecord } from './offlineAssets';

type Status = 'loading' | 'saving' | 'saved' | 'error' | 'offline' | 'conflict' | 'syncing';
const sketchAddress = (id: string, hasSketch: boolean, version: number) => hasSketch ? '/api/rooms/' + id + '/sketch?v=' + version : null;

export default function useProject() {
  const [room, setRoomState] = useState<Room>(createDefaultRoom);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [role, setRole] = useState<ProjectRole>('public');
  const [shared, setShared] = useState(false);
  const [sketchUrl, setSketchUrl] = useState<string | null>(null);
  const [offlineAllowed, setOfflineAllowed] = useState(false);
  const [pendingOffline, setPendingOffline] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const id = new URL(window.location.href).searchParams.get('room') ?? '';
  const client = useRef<LiveProject | null>(null);
  const solo = useRef<SoloProject | null>(null);
  const mounted = useRef(false);
  const sketchSaving = useRef(false);
  const connection = useRef(false);
  const lastError = useRef('');
  const localSketch = useRef<string | null>(null);

  const failure = useCallback((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    lastError.current = message;
    if (mounted.current) { setError(message); setStatus('error'); }
  }, []);
  const finishStatus = useCallback(() => {
    if (!mounted.current) return;
    setStatus(lastError.current || !connection.current ? 'error' : client.current?.hasPending || sketchSaving.current ? 'saving' : 'saved');
  }, []);

  useEffect(() => {
    let active = true;
    let unlock: (() => void) | undefined;
    let sketchBlob: Blob | null | undefined;
    mounted.current = true; setStatus('loading'); setReady(false); setError(''); setCanEdit(false);
    setOfflineAllowed(false); setPendingOffline(false);
    const get = () => accountRequest<ProjectSnapshot>('/api/rooms/' + encodeURIComponent(id));
    const showSketch = (blob: Blob | null | undefined, snapshot: Omit<ProjectSnapshot, 'room'>) => {
      if (blob !== sketchBlob) {
        if (localSketch.current) URL.revokeObjectURL(localSketch.current);
        localSketch.current = blob ? URL.createObjectURL(blob) : null;
        sketchBlob = blob;
      }
      setSketchUrl(blob !== undefined ? localSketch.current : sketchAddress(id, snapshot.hasSketch, snapshot.sketchVersion));
    };
    const metadata = (snapshot: Omit<ProjectSnapshot, 'room'>) => {
      if (!active) return;
      setRole(snapshot.role); setCanEdit(snapshot.canEdit); setCanManage(snapshot.canManage);
      setShared(snapshot.shared); showSketch(undefined, snapshot);
    };
    const live = (snapshot: ProjectSnapshot) => {
      if (!active) return;
      solo.current?.destroy(); solo.current = null;
      unlock?.(); unlock = undefined;
      setOfflineAccess(id, null); setOfflineAllowed(false); setPendingOffline(false);
      metadata(snapshot); setRoomState(validateRoom(snapshot.room)); setReady(true);
      const url = new URL('/api/rooms/' + encodeURIComponent(id) + '/live', window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      let liveEditable = snapshot.canEdit;
      const value = new LiveProject(url.href, {
        room: next => { if (active) { setRoomState(next); setReady(true); } },
        metadata: next => { liveEditable = next.canEdit; metadata(next); },
        state: (online, pending) => {
          if (!active) return;
          connection.current = online; setConnected(online); setCanEdit(online && liveEditable);
          if (online) { lastError.current = ''; setError(''); setStatus(pending || sketchSaving.current ? 'saving' : 'saved'); }
          else { setStatus('error'); setCanEdit(false); }
        },
        error: (message, denied) => { if (active) { if (denied) { setCanEdit(false); setCanManage(false); } failure(message); } },
      });
      client.current = value; value.connect();
    };
    const acquire = async (accountId: string) => {
      if (!navigator.locks) return false;
      const release = new Promise<void>(accept => { unlock = accept; });
      return new Promise<boolean>((accept, reject) => {
        void navigator.locks.request('3d-space-project:' + offlineProjectKey(accountId, id), { ifAvailable: true }, async lock => {
          accept(Boolean(lock)); if (lock) await release;
        }).catch(reject);
      });
    };
    const startSolo = async (record: OfflineProjectRecord, offline: boolean) => {
      let identity = await readOffline<{ id: string; username?: string; verifiedAt?: number }>('meta', 'identity');
      if (!offline && identity?.id !== record.accountId) {
        const { user } = await accountRequest<{ user: { id: string; username: string } | null }>('/api/auth/session');
        if (!user || user.id !== record.accountId) throw new AccountRequestError('Entra con la cuenta de este diseño.', 403);
        identity = { ...user, verifiedAt: Date.now() }; await writeOffline('meta', 'identity', identity);
      }
      if (identity?.id !== record.accountId) throw new AccountRequestError('Entra con la cuenta de este diseño.', 403);
      const locked = await acquire(record.accountId);
      if (!active) { unlock?.(); return; }
      if (!locked) {
        if (!navigator.locks && !offline) { live(record.snapshot); return; }
        metadata(record.snapshot); setRoomState(record.draft ?? record.snapshot.room); setReady(true); setCanEdit(false);
        setStatus('error'); setError(navigator.locks ? 'Este diseño ya está abierto en otra pestaña. Ciérrala para editar aquí.' : 'Este navegador no permite editar sin conexión.');
        return;
      }
      const value = new SoloProject(record, {
        get, persist: async next => {
          const identity = await readOffline<{ id: string }>('meta', 'identity');
          if (identity?.id !== next.accountId) throw new AccountRequestError('La cuenta activa cambió.', 403);
          await writeOffline('projects', offlineProjectKey(next.accountId, id), next);
        },
        assets: next => flushOfflineAssets(id, next),
        put: (next, revision) => accountRequest('/api/rooms/' + encodeURIComponent(id), {
          method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Offline-Write': '1', 'X-Account-Id': record.accountId }, body: JSON.stringify({ room: next, revision }),
        }),
        sketch: (draft, snapshot) => accountRequest('/api/rooms/' + encodeURIComponent(id) + '/sketch', {
          method: draft.blob ? 'PUT' : 'DELETE',
          headers: { ...(draft.blob ? { 'Content-Type': draft.blob.type } : {}), 'X-Offline-Write': '1', 'X-Account-Id': record.accountId, 'X-Sketch-Request-Id': draft.id, 'X-Sketch-Version': String(snapshot.sketchVersion), 'X-Room-Revision': String(snapshot.revision) },
          body: draft.blob ?? undefined,
        }),
        collaborative: live,
        changed: (next, nextStatus: SoloStatus, message, durable) => {
          if (!active) return;
          const allowed = next.authorized && next.snapshot.offlineAllowed === true;
          setRoomState(next.draft ?? next.snapshot.room); setRole(next.snapshot.role); setCanManage(next.snapshot.canManage);
          setShared(next.snapshot.shared); setOfflineAllowed(allowed); setCanEdit(allowed && nextStatus !== 'conflict');
          setOfflineAccess(id, { accountId: next.accountId, allowed: allowed && nextStatus !== 'conflict' });
          setPendingOffline(Boolean(next.draft || next.sketchDraft || next.inflight || next.inflightSketch));
          connection.current = nextStatus !== 'offline' && next.authorized; setConnected(connection.current);
          setStatus(!durable && (nextStatus === 'saved' || nextStatus === 'offline') ? 'saving' : nextStatus); setError(message); setReady(true);
          showSketch(next.sketchDraft ? next.sketchDraft.blob : next.sketchBlob, next.snapshot);
        },
      });
      solo.current = value;
      try { await value.initialize(offline); }
      catch (cause) {
        if (!offline && !value.hasPending) { live(record.snapshot); return; }
        throw cause;
      }
      if (!offline && record.snapshot.hasSketch && !record.sketchBlob && !record.sketchDraft) {
        void fetch(sketchAddress(id, true, record.snapshot.sketchVersion)!, { credentials: 'same-origin', signal: AbortSignal.timeout(15000) })
          .then(async response => { if (response.ok) await value.cacheSketch(await response.blob(), record.snapshot.sketchVersion); }).catch(() => {});
      }
    };
    void (async () => {
      try {
        const snapshot = await get();
        if (!active) return;
        if (!snapshot.accountId) { live(snapshot); return; }
        const cached = validateOfflineProject(await readOffline('projects', offlineProjectKey(snapshot.accountId, id)), snapshot.accountId, id);
        if (!snapshot.offlineAllowed && !cached?.draft && !cached?.inflight && !cached?.sketchDraft && !cached?.inflightSketch) {
          if (cached) { cached.authorized = false; await writeOffline('projects', offlineProjectKey(cached.accountId, id), cached); }
          live(snapshot); return;
        }
        const record: OfflineProjectRecord = cached ?? { id, accountId: snapshot.accountId, snapshot, draft: null, authorized: true, updatedAt: Date.now() };
        if (!cached?.draft && !cached?.inflight && !cached?.sketchDraft && !cached?.inflightSketch) { record.snapshot = snapshot; record.authorized = true; }
        await startSolo(record, false);
      } catch (cause) {
        if (!active) return;
        if (isNetworkError(cause)) {
          try {
            const record = await readOfflineProject(id);
            if (record?.authorized) { await startSolo(record, true); return; }
          } catch { /* Keep the network error when no local copy can be opened. */ }
        } else if (cause instanceof AccountRequestError && [401, 403, 404].includes(cause.status)) {
          setOfflineAccess(id, null);
          const cached = await readOfflineProject(id).catch(() => null);
          if (cached) { cached.authorized = false; await writeOffline('projects', offlineProjectKey(cached.accountId, id), cached).catch(() => {}); }
        }
        failure(cause);
      }
    })();
    const reconnect = () => { if (solo.current) void solo.current.retry(); };
    const disconnect = () => solo.current?.offline();
    const identityChanged = () => {
      if (!solo.current) return;
      const previous = solo.current; previous.destroy(); solo.current = null; setOfflineAccess(id, null); setCanEdit(false); setOfflineAllowed(false);
      setError('La cuenta activa cambió. Vuelve a abrir el diseño.'); setStatus('error'); void previous.settled().finally(() => unlock?.());
    };
    const refresh = setInterval(reconnect, 15000);
    window.addEventListener('online', reconnect); window.addEventListener('focus', reconnect); window.addEventListener('offline', disconnect);
    window.addEventListener('space-offline-identity', identityChanged);
    return () => {
      active = false; mounted.current = false; connection.current = false;
      client.current?.destroy(); client.current = null;
      const previous = solo.current; previous?.destroy(); solo.current = null;
      if (previous) void previous.settled().finally(() => unlock?.()); else unlock?.();
      setOfflineAccess(id, null); if (localSketch.current) URL.revokeObjectURL(localSketch.current); localSketch.current = null;
      clearInterval(refresh); window.removeEventListener('online', reconnect); window.removeEventListener('focus', reconnect); window.removeEventListener('offline', disconnect);
      window.removeEventListener('space-offline-identity', identityChanged);
    };
  }, [id, attempt, failure]);

  const setRoom = useCallback((next: Room) => {
    if (!canEdit) return false;
    try {
      lastError.current = ''; setError('');
      if (solo.current) solo.current.change(next);
      else if (client.current) client.current.change(validateRoom(next), room);
      else return false;
      return true;
    } catch (cause) { failure(cause); return false; }
  }, [room, canEdit, failure]);

  const uploadSketch = useCallback(async (file: File | null) => {
    if (!canEdit) throw new Error('Espera a que se restablezca la conexión.');
    if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)) throw new Error('Usa una imagen PNG, JPG o WebP de hasta 10 MB.');
    if (solo.current) { await solo.current.changeSketch(file); return; }
    if (!connection.current) throw new Error('Espera a que se restablezca la conexión.');
    if (sketchSaving.current) throw new Error('Espera a que termine de guardarse el croquis.');
    sketchSaving.current = true; lastError.current = ''; setError(''); setStatus('saving');
    try {
      const result = await accountRequest<{ hasSketch: boolean; sketchVersion: number }>('/api/rooms/' + id + '/sketch', { method: file ? 'PUT' : 'DELETE', headers: file ? { 'Content-Type': file.type } : undefined, body: file ?? undefined });
      if (mounted.current) setSketchUrl(sketchAddress(id, result.hasSketch, result.sketchVersion));
    } catch (cause) { failure(cause); throw cause; }
    finally { sketchSaving.current = false; finishStatus(); }
  }, [id, canEdit, failure, finishStatus]);
  const setSharing = useCallback(async (enabled: boolean) => {
    if (!canManage) throw new Error('Solo el propietario puede cambiar los permisos.');
    if (solo.current?.hasPending) throw new Error('Espera a que se guarden los cambios antes de compartir.');
    const result = await accountRequest<{ shared: boolean }>('/api/rooms/' + id + '/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
    if (mounted.current) { setShared(result.shared); if (solo.current) void solo.current.retry(); }
  }, [id, canManage]);
  const retry = useCallback(() => {
    lastError.current = ''; setError('');
    if (solo.current) void solo.current.retry(); else if (client.current) client.current.retry(); else setAttempt(value => value + 1);
  }, []);
  const discardOffline = useCallback(async () => { if (solo.current) await solo.current.discard(); else setAttempt(value => value + 1); }, []);
  const downloadOfflineBackup = useCallback(async () => {
    const record = solo.current?.record ?? await readOfflineProject(id);
    const identity = await readOffline<{ id: string }>('meta', 'identity');
    if (!record || identity?.id !== record.accountId) throw new Error('Entra con la cuenta de este diseño para descargar su copia.');
    const encode = async (blob: Blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer()); let result = '';
      for (let index = 0; index < bytes.length; index += 8192) result += String.fromCharCode(...bytes.subarray(index, index + 8192));
      return { type: blob.type, base64: btoa(result) };
    };
    const assets = (await listOffline<OfflineAssetRecord>('assets')).filter(asset => asset.accountId === record.accountId && asset.roomId === id);
    const exportedRoom = record.draft ?? record.snapshot.room;
    const required = new Set(exportedRoom.furniture.filter(item => item.type === 'custom').map(item => item.assetId));
    if ([...required].some(assetId => !assets.some(asset => asset.asset.id === assetId))) throw new Error('Faltan modelos en la copia de este dispositivo. Conéctate y abre el diseño completo antes de descargarlo.');
    if (record.snapshot.hasSketch && !record.sketchDraft && !record.sketchBlob) throw new Error('Falta el croquis en este dispositivo. Conéctate antes de descargar la copia.');
    const data = { format: '3d-space-offline', version: 1, room: exportedRoom,
      sketch: record.sketchDraft ? (record.sketchDraft.blob ? await encode(record.sketchDraft.blob) : null) : record.sketchBlob ? await encode(record.sketchBlob) : null,
      assets: await Promise.all(assets.filter(asset => required.has(asset.asset.id)).map(async asset => ({ asset: asset.asset, data: await encode(asset.blob) }))),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = '3d-space-' + id + '.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [id]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (solo.current ? !solo.current.durable : client.current?.hasPending || sketchSaving.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);

  return { room, setRoom, ready, status, error, readOnly: !canEdit, canManage, role, connected, roomId: id, shareUrl: shareAddress(new URL(window.location.href), id), shared, setSharing, uploadSketch, sketchUrl, retry, offlineAllowed, pendingOffline, discardOffline, downloadOfflineBackup };
}
