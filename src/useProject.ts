import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createDefaultProject, validateProjectDocument, projectToRoom, updateProjectRoom, type ProjectDocument } from './projectDocument';
import type { Room } from './types';
import { shareAddress } from './routes';
import { accountRequest, AccountRequestError, isNetworkError } from './accountApi';
import { LiveProject, type ProjectRole, type ProjectSnapshot } from './liveProject';
import { SoloProject, offlineProjectKey, readOfflineProject, validateOfflineProject, type OfflineProjectRecord, type SoloStatus } from './offlineProject';
import { atomicOffline, readOffline, removeOffline, writeOffline, setOfflineAccess } from './offlineStorage';
import { bootstrapOfflineMode, offlineForced, offlineFetch, subscribeOfflineMode } from './offlineMode';
import { hydrateOfflineProject } from './offlineProject';
import { assertRoomReadyToShare, exportOfflineProject, importOfflineProject, roomHasOfflineChanges, persistOfflineProject, soloNetworkDependencies } from './offlineService';
import { serializeProjectBackup, type ProjectBackup } from './projectBackup';
import { registerBeforeAppUpdate } from './appOffline';

type Status = 'loading' | 'saving' | 'saved' | 'error' | 'offline' | 'conflict' | 'syncing';
const sketchAddress = (id: string, levelId: string, hasSketch: boolean, version: number) => hasSketch ? '/api/rooms/' + encodeURIComponent(id) + '/levels/' + encodeURIComponent(levelId) + '/sketch?v=' + version : null;

export default function useProject() {
  const [project, setProjectState] = useState<ProjectDocument>(createDefaultProject);
  const [selectedLevelId, selectLevel] = useState(() => new URL(window.location.href).searchParams.get('level') ?? '');
  const activeLevelId = project.levels.some(level => level.id === selectedLevelId) ? selectedLevelId : project.activeLevelId;
  const room = useMemo(() => projectToRoom(project, activeLevelId), [project, activeLevelId]);
  const projectRef = useRef(project); projectRef.current = project;
  const activeLevelRef = useRef(activeLevelId); activeLevelRef.current = activeLevelId;
  const snapshotRef = useRef<Omit<ProjectSnapshot, 'project'> | null>(null);
  const recordRef = useRef<OfflineProjectRecord | null>(null);
  const [sketchEpoch, setSketchEpoch] = useState(0);
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
  const [pendingAssets, setPendingAssets] = useState(false);
  const [recoveryProject, setRecoveryProject] = useState<ProjectDocument | null>(null);
  const recovery = useRef<{ project: ProjectDocument; accountId: string } | null>(null);
  const recoverySaving = useRef<Promise<void>>(Promise.resolve());
  const [attempt, setAttempt] = useState(0);
  const id = new URL(window.location.href).searchParams.get('room') ?? '';
  const client = useRef<LiveProject | null>(null);
  const solo = useRef<SoloProject | null>(null);
  const mounted = useRef(false);
  const sketchSaving = useRef(false);
  const connection = useRef(false);
  const lastError = useRef('');
  const localSketch = useRef<string | null>(null);
  const displayedSketch = useRef<{ levelId: string; version: number; blob: Blob | null | undefined; address: string | null } | null>(null);
  const loadingSketches = useRef(new Set<string>());

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
    const unregister = registerBeforeAppUpdate(async () => {
      if (recovery.current) throw new Error('Guarda o descarta la copia recuperada antes de continuar.');
      if (solo.current) { await solo.current.settled(); if (!solo.current.durable) throw new Error('Guarda los cambios en este dispositivo antes de actualizar.'); }
      else if (client.current?.hasPending || sketchSaving.current) throw new Error('Espera a que terminen de guardarse los cambios antes de actualizar.');
    }, 'durable');
    let active = true;
    let startupAccountId: string | undefined;
    let unlock: (() => void) | undefined;
    let unlockLive: (() => void) | undefined;
    mounted.current = true; setStatus('loading'); setReady(false); setError(''); setCanEdit(false);
    setOfflineAllowed(false); setPendingOffline(false);
    void readOffline<{ id: string }>('meta', 'identity').then(async identity => {
      if (!active || !identity) return;
      const saved = await readOffline<{ project: ProjectDocument }>('meta', 'recovery:' + identity.id + ':' + id);
      const currentIdentity = await readOffline<{ id: string }>('meta', 'identity');
      if (!active || !saved || recovery.current || currentIdentity?.id !== identity.id) return;
      const project = validateProjectDocument(saved.project);
      if (project.id !== id) return;
      recovery.current = { project, accountId: identity.id }; setRecoveryProject(project);
    }).catch(failure);
    const get = () => accountRequest<ProjectSnapshot>('/api/rooms/' + encodeURIComponent(id));
    const metadata = (snapshot: Omit<ProjectSnapshot, 'project'>) => {
      if (!active) return;
      setRole(snapshot.role); setCanEdit(snapshot.canEdit); setCanManage(snapshot.canManage);
      setShared(snapshot.shared); snapshotRef.current = snapshot; recordRef.current = null; setSketchEpoch(value => value + 1);
    };
    const live = (snapshot: ProjectSnapshot) => {
      if (!active) return;
      solo.current?.destroy(); solo.current = null;
      unlock?.(); unlock = undefined;
      unlockLive?.(); unlockLive = undefined;
      if (snapshot.accountId && navigator.locks) {
        const release = new Promise<void>(accept => { unlockLive = accept; });
        void navigator.locks.request('3d-space-live:' + snapshot.accountId + ':' + id, { mode: 'shared' }, async () => { if (active) await release; }).catch(failure);
      }
      setOfflineAccess(id, null); setOfflineAllowed(false); setPendingOffline(false);
      metadata(snapshot); setProjectState(validateProjectDocument(snapshot.project)); setReady(true);
      const url = new URL('/api/rooms/' + encodeURIComponent(id) + '/live', window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      let liveEditable = snapshot.canEdit;
      const value = new LiveProject(url.href, {
        recovery: (next, message) => {
          if (!active || !snapshot.accountId) return;
          recovery.current = { project: next, accountId: snapshot.accountId }; setRecoveryProject(next); setError(message);
          recoverySaving.current = atomicOffline(snapshot.accountId, [{ store: 'meta', key: 'recovery:' + snapshot.accountId + ':' + id, value: { accountId: snapshot.accountId, roomId: id, project: next } }]).catch(cause => { failure(cause); throw cause; });
          void recoverySaving.current.catch(() => {});
        },
        project: next => { if (active) { setProjectState(next); setReady(true); } },
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
      if (record.deleted) throw new Error('Este diseño está pendiente de eliminación.');
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
        metadata(record.snapshot); setProjectState(record.draft ?? record.snapshot.project); setReady(true); setCanEdit(false);
        setStatus('error'); setError(navigator.locks ? 'Este diseño ya está abierto en otra pestaña. Ciérrala para editar aquí.' : 'Este navegador no permite editar sin conexión.');
        return;
      }
      const value = new SoloProject(record, {
        ...soloNetworkDependencies(record),
        collaborative: live,
        changed: (next, nextStatus: SoloStatus, message, durable) => {
          if (!active) return;
          const allowed = next.authorized && next.snapshot.offlineAllowed === true;
          setProjectState(next.draft ?? next.snapshot.project); setRole(next.snapshot.role); setCanManage(next.snapshot.canManage);
          setShared(next.snapshot.shared); setOfflineAllowed(allowed); setCanEdit(allowed && nextStatus !== 'conflict');
          setOfflineAccess(id, { accountId: next.accountId, allowed: allowed && nextStatus !== 'conflict' });
          setPendingOffline(Boolean(next.localOnly || next.draft || Object.keys(next.sketchDrafts ?? {}).length || next.inflight || Object.keys(next.inflightSketches ?? {}).length));
          connection.current = nextStatus !== 'offline' && next.authorized; setConnected(connection.current);
          setStatus(!durable && (nextStatus === 'saved' || nextStatus === 'offline') ? 'saving' : nextStatus); setError(message); setReady(true);
          recordRef.current = next; snapshotRef.current = next.snapshot; setSketchEpoch(value => value + 1);
        },
      });
      solo.current = value;
      try { await value.initialize(offline); }
      catch (cause) {
        if (!offline && !value.hasPending) { live(record.snapshot); return; }
        throw cause;
      }
    };
    void (async () => {
      try {
        const initialIdentity = await bootstrapOfflineMode();
        startupAccountId = initialIdentity.identity?.id;
        if (offlineForced()) {
          const cached = await readOfflineProject(id);
          if (!cached || cached.deleted) throw new Error('Este diseño no está preparado en este dispositivo.');
          if (!cached.authorized) throw new Error('El acceso a este diseño cambió. Descarga tu copia o abre una copia independiente.');
          await startSolo(cached, true); return;
        }
        const local = await readOfflineProject(id).catch(() => null);
        if (local?.deleted) throw new Error('Este diseño está pendiente de eliminación.');
        if (local?.localOnly && !local.deleted) { await startSolo(local, false); return; }
        const snapshot = await get();
        if (!active) return;
        const currentIdentity = await readOffline<{ id: string }>('meta', 'identity');
        if (!active) return;
        if (snapshot.accountId && currentIdentity && currentIdentity.id !== snapshot.accountId) throw new Error('La cuenta activa cambió. Vuelve a abrir el diseño.');
        if (!snapshot.accountId) { live(snapshot); return; }
        const stored = validateOfflineProject(await readOffline('projects', offlineProjectKey(snapshot.accountId, id)), snapshot.accountId, id);
        const cached = stored ? await hydrateOfflineProject(stored) : null;
        if (!snapshot.offlineAllowed && !cached?.draft && !cached?.inflight && !Object.keys(cached?.sketchDrafts ?? {}).length && !Object.keys(cached?.inflightSketches ?? {}).length) {
          if (cached) { cached.authorized = false; await persistOfflineProject(cached); }
          live(snapshot); return;
        }
        const record: OfflineProjectRecord = cached ?? { id, accountId: snapshot.accountId, snapshot, draft: null, authorized: true, updatedAt: Date.now() };
        if (!cached?.draft && !cached?.inflight && !Object.keys(cached?.sketchDrafts ?? {}).length && !Object.keys(cached?.inflightSketches ?? {}).length) {
          for (const [levelId, cached] of Object.entries(record.sketchBlobs ?? {})) if (!snapshot.sketches[levelId]?.hasSketch || cached.version !== snapshot.sketches[levelId]?.version) delete record.sketchBlobs![levelId];
          record.snapshot = snapshot; record.authorized = true;
        }
        await startSolo(record, false);
      } catch (cause) {
        if (!active) return;
        if (isNetworkError(cause)) {
          try {
            const record = await readOfflineProject(id);
            if (record?.authorized && !record.deleted) { await startSolo(record, true); return; }
          } catch { /* Keep the network error when no local copy can be opened. */ }
        } else if (cause instanceof AccountRequestError && cause.status === 401) {
          const cached = await readOfflineProject(id).catch(() => null);
          if (cached?.authorized && !cached.deleted) { await startSolo(cached, true); solo.current?.offline('Tu sesión terminó. Puedes continuar aquí; entra de nuevo para sincronizar.'); return; }
        } else if (cause instanceof AccountRequestError && [403, 404].includes(cause.status)) {
          setOfflineAccess(id, null);
          const cached = await readOfflineProject(id).catch(() => null);
          if (cached) { cached.authorized = false; await persistOfflineProject(cached).catch(() => {}); }
        }
        failure(cause);
      }
    })();
    const reconnect = () => { if (!active || offlineForced()) return; if (solo.current) void solo.current.retry(); else if (client.current) client.current.retry(); };
    const unsubscribeMode = subscribeOfflineMode(() => {
      client.current?.destroy(); client.current = null;
      const previous = solo.current; previous?.destroy(); solo.current = null;
      void (previous?.settled() ?? Promise.resolve()).finally(() => { unlock?.(); unlock = undefined; if (active) setAttempt(value => value + 1); });
    });
    const disconnect = () => { if (solo.current) solo.current.offline(); else if (client.current) { client.current.offline(); connection.current = false; setConnected(false); setCanEdit(false); setStatus('error'); setError('Espera a que se restablezca la conexión.'); } };
    const identityChanged = (event: Event) => {
      const expected = snapshotRef.current?.accountId ?? recordRef.current?.accountId ?? startupAccountId;
      const next = (event as CustomEvent<{ accountId?: string }>).detail?.accountId;
      if (!expected || expected === next) return;
      active = false;
      if (client.current) { client.current.destroy(); client.current = null; }
      recovery.current = null; setRecoveryProject(null);
      const previous = solo.current; previous?.destroy(); solo.current = null; setOfflineAccess(id, null); setCanEdit(false); setOfflineAllowed(false); setCanManage(false); setReady(false); setProjectState(createDefaultProject());
      snapshotRef.current = null; recordRef.current = null;
      setError('La cuenta activa cambió. Vuelve a abrir el diseño.'); setStatus('error'); void (previous?.settled() ?? Promise.resolve()).finally(() => unlock?.()); unlockLive?.();
    };
    const refresh = setInterval(reconnect, 15000);
    window.addEventListener('online', reconnect); window.addEventListener('focus', reconnect); window.addEventListener('offline', disconnect);
    window.addEventListener('space-offline-identity', identityChanged);
    return () => {
      active = false; mounted.current = false; connection.current = false;
      client.current?.destroy(); client.current = null;
      const previous = solo.current; previous?.destroy(); solo.current = null;
      if (previous) void previous.settled().finally(() => unlock?.()); else unlock?.();
      unlockLive?.(); unlockLive = undefined;
      setOfflineAccess(id, null); if (localSketch.current) URL.revokeObjectURL(localSketch.current); localSketch.current = null; displayedSketch.current = null; loadingSketches.current.clear();
      unregister(); unsubscribeMode(); clearInterval(refresh); window.removeEventListener('online', reconnect); window.removeEventListener('focus', reconnect); window.removeEventListener('offline', disconnect);
      window.removeEventListener('space-offline-identity', identityChanged);
    };
  }, [id, attempt, failure]);

  const setProject = useCallback((next: ProjectDocument) => {
    if (!canEdit || recovery.current) return false;
    try {
      lastError.current = ''; setError('');
      const validated = validateProjectDocument(next);
      if (solo.current) solo.current.change(validated);
      else if (client.current) client.current.change(validated, projectRef.current);
      else return false;
      projectRef.current = validated; setProjectState(validated);
      return true;
    } catch (cause) { failure(cause); return false; }
  }, [canEdit, failure]);
  const setRoom = useCallback((next: Room) => {
    try { return setProject(updateProjectRoom(projectRef.current, activeLevelRef.current, next)); }
    catch (cause) { failure(cause); return false; }
  }, [setProject, failure]);
  const setActiveLevelId = useCallback((levelId: string) => {
    if (!projectRef.current.levels.some(level => level.id === levelId)) return;
    selectLevel(levelId);
    const url = new URL(window.location.href); url.searchParams.set('level', levelId); window.history.replaceState(null, '', url);
  }, []);

  useEffect(() => {
    const snapshot = snapshotRef.current, levelId = activeLevelId;
    const sketch = snapshot?.sketches[levelId];
    const record = recordRef.current;
    const draft = record?.sketchDrafts?.[levelId], cached = record?.sketchBlobs?.[levelId];
    const blob = draft ? draft.blob : cached && cached.version === sketch?.version ? cached.blob : undefined;
    const address = offlineForced() ? null : sketchAddress(id, levelId, sketch?.hasSketch ?? false, sketch?.version ?? 0);
    const previous = displayedSketch.current;
    if (!previous || previous.levelId !== levelId || previous.version !== sketch?.version || previous.blob !== blob || previous.address !== address) {
      if (localSketch.current) { URL.revokeObjectURL(localSketch.current); localSketch.current = null; }
      if (blob) localSketch.current = URL.createObjectURL(blob);
      setSketchUrl(blob !== undefined ? localSketch.current : address);
      displayedSketch.current = { levelId, version: sketch?.version ?? 0, blob, address };
    }
    if (blob === undefined && sketch?.hasSketch && !offlineForced() && solo.current) {
      const owner = solo.current, version = sketch.version, key = id + ':' + levelId + ':' + version;
      if (!loadingSketches.current.has(key)) {
        loadingSketches.current.add(key);
        void offlineFetch(sketchAddress(id, levelId, true, version)!, { credentials: 'same-origin' }).then(async response => {
          if (solo.current === owner && response.ok && snapshotRef.current?.sketches[levelId]?.version === version && response.headers.get('ETag') === '"' + id + '-' + levelId + '-' + version + '"') await owner.cacheSketch(await response.blob(), version, levelId);
        }).catch(() => {}).finally(() => loadingSketches.current.delete(key));
      }
    }
  }, [id, activeLevelId, sketchEpoch]);

  const uploadSketch = useCallback(async (file: File | null) => {
    if (!canEdit) throw new Error('Espera a que se restablezca la conexión.');
    if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)) throw new Error('Usa una imagen PNG, JPG o WebP de hasta 10 MB.');
    if (solo.current) { await solo.current.changeSketch(file, activeLevelRef.current); return; }
    if (!connection.current) throw new Error('Espera a que se restablezca la conexión.');
    if (sketchSaving.current) throw new Error('Espera a que termine de guardarse el croquis.');
    sketchSaving.current = true; lastError.current = ''; setError(''); setStatus('saving');
    try {
      const levelId = activeLevelRef.current;
      const result = await accountRequest<{ hasSketch: boolean; version: number }>('/api/rooms/' + id + '/levels/' + levelId + '/sketch', { method: file ? 'PUT' : 'DELETE', headers: { ...(file ? { 'Content-Type': file.type } : {}), 'X-Sketch-Request-Id': crypto.randomUUID(), 'X-Sketch-Version': String(snapshotRef.current?.sketches[levelId]?.version ?? 0), 'X-Room-Revision': String(snapshotRef.current?.revision ?? 0) }, body: file ?? undefined });
      if (mounted.current && activeLevelRef.current === levelId) setSketchUrl(sketchAddress(id, levelId, result.hasSketch, result.version));
    } catch (cause) { failure(cause); throw cause; }
    finally { sketchSaving.current = false; finishStatus(); }
  }, [id, canEdit, failure, finishStatus]);
  const setSharing = useCallback(async (enabled: boolean) => {
    if (offlineForced()) throw new Error('Desactiva el modo sin conexión para compartir.');
    if (!canManage) throw new Error('Solo el propietario puede cambiar los permisos.');
    if (solo.current?.hasPending) throw new Error('Espera a que se sincronicen los cambios y modelos antes de compartir.');
    await assertRoomReadyToShare(id);
    const result = await accountRequest<{ shared: boolean }>('/api/rooms/' + id + '/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
    if (mounted.current) { setShared(result.shared); if (solo.current) void solo.current.retry(); }
  }, [id, canManage]);
  useEffect(() => {
    let active = true, generation = 0;
    const refresh = () => {
      const current = ++generation;
      void roomHasOfflineChanges(id).then(pending => { if (active && current === generation) setPendingAssets(pending); }).catch(() => { if (active && current === generation) setPendingAssets(true); });
    };
    refresh();
    window.addEventListener('space-offline-assets', refresh); window.addEventListener('space-offline-data', refresh); window.addEventListener('space-offline-identity', refresh);
    return () => { active = false; window.removeEventListener('space-offline-assets', refresh); window.removeEventListener('space-offline-data', refresh); window.removeEventListener('space-offline-identity', refresh); };
  }, [id]);
  const retry = useCallback(() => {
    lastError.current = ''; setError('');
    if (solo.current) void solo.current.retry(); else if (client.current) client.current.retry(); else setAttempt(value => value + 1);
  }, []);
  const discardOffline = useCallback(async () => {
    if (recovery.current) {
      await recoverySaving.current.catch(() => {});
      const identity = await readOffline<{ id: string }>('meta', 'identity');
      if (identity?.id !== recovery.current.accountId) throw new Error('La cuenta activa cambió. Vuelve a abrir el diseño.');
      await removeOffline('meta', 'recovery:' + identity.id + ':' + id);
      recovery.current = null; setRecoveryProject(null); client.current?.clearRecovery(); lastError.current = ''; setError(''); finishStatus();
    } else if (solo.current) await solo.current.discard(); else setAttempt(value => value + 1);
  }, [id, finishStatus]);
  const downloadOfflineBackup = useCallback(async () => {
    if (solo.current) await solo.current.settled();
    let backup = await exportOfflineProject(id);
    if (recovery.current) {
      const identity = await readOffline<{ id: string }>('meta', 'identity');
      if (identity?.id !== recovery.current.accountId) throw new Error('La cuenta activa cambió. Vuelve a abrir el diseño.');
      backup = { ...backup, project: recovery.current.project, sketches: backup.sketches.filter(sketch => recovery.current!.project.levels.some(level => level.id === sketch.levelId)) };
    }
    const data = await serializeProjectBackup(backup);
    const url = URL.createObjectURL(data);
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = '3d-space-' + id + '.3dspace'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [id]);
  const importProject = useCallback(async (backup: ProjectBackup) => {
    if (!solo.current || !canEdit) throw new Error('Abre un diseño privado para importar la copia.');
    const previous = solo.current; previous.destroy(); solo.current = null;
    await previous.settled();
    try { await importOfflineProject(id, backup); }
    finally { setAttempt(value => value + 1); }
  }, [id, canEdit]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (recovery.current || (solo.current ? !solo.current.durable : client.current?.hasPending || sketchSaving.current)) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);

  return { project, setProject, activeLevelId, setActiveLevelId, room, setRoom, ready, status, error, recoveryProject, readOnly: !canEdit || !!recoveryProject, canManage, role, connected, roomId: id, shareUrl: shareAddress(new URL(window.location.href), id), shared, setSharing, uploadSketch, sketchUrl, retry, offlineAllowed, pendingOffline: pendingOffline || pendingAssets || !!recoveryProject, discardOffline, downloadOfflineBackup, importProject };
}
