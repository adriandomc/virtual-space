import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { validateProjectDocument, projectToRoom, updateProjectRoom, type ProjectDocument } from '../../domain/project/projectDocument';
import type { Room } from '../../domain/project/types';
import { shareAddress } from '../../shared/routes';
import { accountRequest } from '../../client/api/accountApi';
import { offlineForced } from '../../client/offline/offlineMode';
import { assertRoomReadyToShare, exportOfflineProject, importOfflineProject, roomHasOfflineChanges } from '../../client/offline/offlineService';
import { serializeProjectBackup, type ProjectBackup } from '../../client/projects/projectBackup';
import { ProjectSession, initialProjectSession } from '../../client/projects/projectSession';
import { ProjectRecovery } from '../../client/projects/projectRecovery';
import { ProjectSketch, sketchAddress } from '../../client/projects/projectSketch';
import { registerBeforeAppUpdate, setAppUpdateReady, beginAppActivity } from '../../client/pwa/appOffline';
import { validateSketchBlob } from '../../domain/models/imageValidation';
import { appActivityReason, appVersion, assertCurrentAppVersion, subscribeAppVersion } from '../../client/pwa/appActivity';

export default function useProject() {
  const version = useSyncExternalStore(subscribeAppVersion, appVersion);
  const id = new URL(window.location.href).searchParams.get('room') ?? '';
  const [state, setState] = useState(initialProjectSession);
  const { project, ready, status, error, connected, canEdit, canManage, role, shared, offlineAllowed, pendingOffline } = state;
  const [selectedLevelId, selectLevel] = useState(() => new URL(window.location.href).searchParams.get('level') ?? '');
  const activeLevelId = project.levels.some(level => level.id === selectedLevelId) ? selectedLevelId : project.activeLevelId;
  const room = useMemo(() => projectToRoom(project, activeLevelId), [project, activeLevelId]);
  const projectRef = useRef(project); projectRef.current = project;
  const activeLevelRef = useRef(activeLevelId); activeLevelRef.current = activeLevelId;
  const [sketchUrl, setSketchUrl] = useState<string | null>(null);
  const [pendingAssets, setPendingAssets] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const session = useRef<ProjectSession | null>(null);
  const sketch = useRef<ProjectSketch | null>(null);
  const recovery = useMemo(() => new ProjectRecovery(id), [id]);
  const recoveryProject = useSyncExternalStore(recovery.subscribe, recovery.project);
  useEffect(() => { setAppUpdateReady(status !== 'loading'); return () => setAppUpdateReady(false); }, [status]);

  useEffect(() => {
    let active = true;
    const value = new ProjectSession(id, {
      changed: next => { if (active) setState(next); },
      recovery: (project, accountId, message) => { value.failure(message); void recovery.capture(project, accountId).catch(value.failure); },
      identityChanged: () => recovery.clear(),
      restart: () => { if (active) setAttempt(value => value + 1); },
    });
    session.current = value;
    const image = new ProjectSketch(id, url => { if (active) setSketchUrl(url); });
    sketch.current = image;
    const unregister = registerBeforeAppUpdate(async () => {
      if (recovery.project()) throw new Error('Guarda o descarta la copia recuperada antes de continuar.');
      await value.assertDurable();
    }, 'durable');
    void recovery.restore(() => active).catch(value.failure);
    void value.start().catch(value.failure);
    return () => {
      active = false;
      void value.destroy(); image.dispose(); unregister();
      if (session.current === value) session.current = null;
      if (sketch.current === image) sketch.current = null;
    };
  }, [id, attempt, recovery]);

  const setProject = useCallback((next: ProjectDocument) => {
    if (!canEdit || recovery.project()) return false;
    try {
      assertCurrentAppVersion();
      const validated = validateProjectDocument(next);
      if (!session.current?.change(validated)) return false;
      projectRef.current = validated;
      return true;
    } catch (cause) { session.current?.failure(cause); return false; }
  }, [canEdit, recovery]);
  const setRoom = useCallback((next: Room) => {
    try { return setProject(updateProjectRoom(projectRef.current, activeLevelRef.current, next)); }
    catch (cause) { session.current?.failure(cause); return false; }
  }, [setProject]);
  const setActiveLevelId = useCallback((levelId: string) => {
    if (!projectRef.current.levels.some(level => level.id === levelId)) return;
    selectLevel(levelId);
    const url = new URL(window.location.href); url.searchParams.set('level', levelId); window.history.replaceState(null, '', url);
  }, []);

  useEffect(() => {
    const value = session.current;
    if (value) sketch.current?.update({ snapshot: value.snapshot, record: value.record, owner: value.solo, levelId: activeLevelId, offline: offlineForced() });
  }, [state, activeLevelId]);

  const uploadSketch = useCallback(async (file: File | null) => {
    const release = beginAppActivity(), levelId = activeLevelRef.current, value = session.current;
    try {
      assertCurrentAppVersion();
      if (!canEdit || !value) throw new Error('Espera a que se restablezca la conexión.');
      if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)) throw new Error('Usa una imagen PNG, JPG o WebP de hasta 10 MB.');
      if (file) await validateSketchBlob(file);
      if (session.current !== value || activeLevelRef.current !== levelId) throw new Error('El nivel cambió. Vuelve a seleccionar el croquis.');
      if (value.solo) { await value.solo.changeSketch(file, levelId); return; }
      if (!value.state.connected) throw new Error('Espera a que se restablezca la conexión.');
      if (value.sketchSaving) throw new Error('Espera a que termine de guardarse el croquis.');
      value.setSketchSaving(true);
      try {
        const result = await accountRequest<{ hasSketch: boolean; version: number }>('/api/rooms/' + id + '/levels/' + levelId + '/sketch', { method: file ? 'PUT' : 'DELETE', headers: { ...(file ? { 'Content-Type': file.type } : {}), 'X-Sketch-Request-Id': crypto.randomUUID(), 'X-Sketch-Version': String(value.snapshot?.sketches[levelId]?.version ?? 0), 'X-Room-Revision': String(value.snapshot?.revision ?? 0) }, body: file ?? undefined });
        if (session.current === value && activeLevelRef.current === levelId) setSketchUrl(sketchAddress(id, levelId, result.hasSketch, result.version));
      } catch (cause) { value.failure(cause); throw cause; }
      finally { value.setSketchSaving(false); }
    } finally { release(); }
  }, [id, canEdit]);
  const setSharing = useCallback(async (enabled: boolean) => {
    assertCurrentAppVersion();
    if (offlineForced()) throw new Error('Desactiva el modo sin conexión para compartir.');
    if (!canManage) throw new Error('Solo el propietario puede cambiar los permisos.');
    const value = session.current;
    if (value?.solo?.hasPending) throw new Error('Espera a que se sincronicen los cambios y modelos antes de compartir.');
    await assertRoomReadyToShare(id);
    const result = await accountRequest<{ shared: boolean }>('/api/rooms/' + id + '/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
    if (session.current === value) value?.setShared(result.shared);
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
    const value = session.current; value?.clearError();
    if (value?.solo || value?.live) value.retry(); else setAttempt(value => value + 1);
  }, []);
  const discardOffline = useCallback(async () => {
    const value = session.current;
    if (recovery.project()) {
      await recovery.discard();
      value?.live?.clearRecovery(); value?.clearError(); value?.finishStatus();
    } else if (value?.solo) await value.solo.discard(); else setAttempt(value => value + 1);
  }, [recovery]);
  const downloadOfflineBackup = useCallback(async () => {
    const release = beginAppActivity();
    try {
      if (session.current?.solo) await session.current.solo.settled();
      const backup = await recovery.applyToBackup(await exportOfflineProject(id));
      const data = await serializeProjectBackup(backup);
      const url = URL.createObjectURL(data);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = '3d-space-' + id + '.3dspace'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally { release(); }
  }, [id, recovery]);
  const importProject = useCallback(async (backup: ProjectBackup) => {
    assertCurrentAppVersion();
    const value = session.current;
    if (!value?.solo || !canEdit) throw new Error('Abre un diseño privado para importar la copia.');
    await value.detachSolo();
    try { await importOfflineProject(id, backup); }
    finally { setAttempt(value => value + 1); }
  }, [id, canEdit]);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (recovery.project() || session.current?.hasUndurableWork) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [recovery]);

  return { project, setProject, activeLevelId, setActiveLevelId, room, setRoom, ready, status, error, recoveryProject, readOnly: !canEdit || !!recoveryProject || version !== 'current' && !appActivityReason(), canManage, role, connected, roomId: id, shareUrl: shareAddress(new URL(window.location.href), id), shared, setSharing, uploadSketch, sketchUrl, retry, offlineAllowed, pendingOffline: pendingOffline || pendingAssets || !!recoveryProject, discardOffline, downloadOfflineBackup, importProject };
}
