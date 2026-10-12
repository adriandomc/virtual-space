import { useCallback, useEffect, useRef, useState } from 'react';
import { createDefaultRoom, validateRoom } from './model';
import type { Room } from './types';

type Snapshot = { id: string; room: Room; revision: number; canEdit: boolean; hasSketch: boolean; sketchVersion: number; editKey: string; shareUrl: string };
type Session = { id: string; editKey: string; revision: number; readOnly: boolean };
type Status = 'loading' | 'saving' | 'saved' | 'error';
let initialization: Promise<Snapshot> | null = null;
let creationIdentity: { id: string; editKey: string } | null = null;

function identity() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const editKey = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  const idBytes = crypto.getRandomValues(new Uint8Array(16));
  idBytes[6] = (idBytes[6] & 15) | 64;
  idBytes[8] = (idBytes[8] & 63) | 128;
  const hex = Array.from(idBytes, value => value.toString(16).padStart(2, '0')).join('');
  return { id: hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' + hex.slice(16, 20) + '-' + hex.slice(20), editKey };
}

async function responseJson(response: Response) {
  let body: Record<string, unknown>;
  try { body = await response.json() as Record<string, unknown>; }
  catch { throw new Error('El servidor no está disponible. Inténtalo de nuevo.'); }
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'No se pudo guardar el proyecto.');
  return body;
}
async function request(url: string, options: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.body instanceof File ? 30000 : 15000);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  catch { throw new Error('No se pudo conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.'); }
  finally { clearTimeout(timeout); }
}
const sketchAddress = (id: string, hasSketch: boolean, version: number) => hasSketch ? '/api/rooms/' + id + '/sketch?v=' + version : null;

function initialize(): Promise<Snapshot> {
  if (initialization) return initialization;
  initialization = (async () => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get('room');
    const editKey = new URLSearchParams(url.hash.slice(1)).get('edit') ?? '';
    let response: Response;
    let key = editKey;
    if (id) response = await request('/api/rooms/' + encodeURIComponent(id), { headers: key ? { Authorization: 'Bearer ' + key } : undefined });
    else {
      creationIdentity ??= identity();
      key = creationIdentity.editKey;
      response = await request('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...creationIdentity, room: createDefaultRoom() }) });
    }
    const data = await responseJson(response);
    if (typeof data.id !== 'string' || !Number.isSafeInteger(data.revision)) throw new Error('El servidor devolvió un proyecto inválido.');
    const room = validateRoom(data.room);
    url.searchParams.set('room', data.id);
    if (!id) { url.hash = 'edit=' + key; window.history.replaceState(null, '', url); }
    const share = new URL(url); share.hash = '';
    return { id: data.id, room, revision: data.revision as number, canEdit: data.canEdit === true, hasSketch: data.hasSketch === true, sketchVersion: Number(data.sketchVersion) || 0, editKey: key, shareUrl: share.href };
  })().finally(() => { initialization = null; });
  return initialization;
}

export default function useProject() {
  const [room, setRoomState] = useState<Room>(createDefaultRoom);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState('');
  const [readOnly, setReadOnly] = useState(true);
  const [shareUrl, setShareUrl] = useState('');
  const [sketchUrl, setSketchUrl] = useState<string | null>(null);
  const session = useRef<Session | null>(null);
  const pending = useRef<Room | null>(null);
  const retrySnapshot = useRef<Room | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef(false);
  const sketchSaving = useRef<Promise<void> | null>(null);
  const pendingSketch = useRef<File | null | undefined>(undefined);
  const lastError = useRef('');
  const mounted = useRef(false);
  const initializationAttempt = useRef(0);

  const failure = useCallback((cause: unknown) => {
    lastError.current = cause instanceof Error ? cause.message : 'No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.';
    if (mounted.current) { setError(lastError.current); setStatus('error'); }
  }, []);
  const finishStatus = useCallback(() => {
    if (mounted.current) setStatus(lastError.current ? 'error' : saving.current || pending.current || retrySnapshot.current || pendingSketch.current !== undefined || sketchSaving.current ? 'saving' : 'saved');
  }, []);
  const clearError = useCallback(() => {
    lastError.current = '';
    if (mounted.current) { setError(''); setStatus('saving'); }
  }, []);
  const load = useCallback(async () => {
    const attempt = ++initializationAttempt.current;
    if (mounted.current) { setStatus('loading'); setError(''); }
    try {
      const snapshot = await initialize();
      if (!mounted.current || attempt !== initializationAttempt.current) return;
      session.current = { id: snapshot.id, editKey: snapshot.editKey, revision: snapshot.revision, readOnly: !snapshot.canEdit };
      setRoomState(snapshot.room); setReadOnly(!snapshot.canEdit); setShareUrl(snapshot.shareUrl);
      setSketchUrl(sketchAddress(snapshot.id, snapshot.hasSketch, snapshot.sketchVersion));
      lastError.current = ''; setStatus('saved'); setReady(true);
    } catch (cause) { if (mounted.current && attempt === initializationAttempt.current) failure(cause); }
  }, [failure]);

  const save = useCallback(async () => {
    const active = session.current;
    if (!active || active.readOnly || saving.current || (!pending.current && !retrySnapshot.current)) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    saving.current = true;
    try {
      while (pending.current || retrySnapshot.current) {
        const submitted: Room = retrySnapshot.current ?? pending.current!;
        if (retrySnapshot.current) retrySnapshot.current = null;
        else pending.current = null;
        try {
          const result = await responseJson(await request('/api/rooms/' + active.id, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + active.editKey }, body: JSON.stringify({ room: submitted, revision: active.revision }) }));
          if (!Number.isSafeInteger(result.revision)) throw new Error('No se pudo confirmar el guardado.');
          active.revision = result.revision as number;
        } catch (cause) { retrySnapshot.current = submitted; failure(cause); return; }
      }
    } finally { saving.current = false; finishStatus(); }
  }, [failure, finishStatus]);

  const saveSketch = useCallback((): Promise<void> => {
    if (sketchSaving.current) return sketchSaving.current;
    const active = session.current;
    if (!active || active.readOnly || pendingSketch.current === undefined) return Promise.resolve();
    const operation = (async () => {
      while (pendingSketch.current !== undefined) {
        const file = pendingSketch.current;
        pendingSketch.current = undefined;
        try {
          const result = await responseJson(await request('/api/rooms/' + active.id + '/sketch', { method: file ? 'PUT' : 'DELETE', headers: { Authorization: 'Bearer ' + active.editKey, ...(file ? { 'Content-Type': file.type } : {}) }, body: file ?? undefined }));
          if (mounted.current) setSketchUrl(sketchAddress(active.id, result.hasSketch === true, Number(result.sketchVersion)));
        } catch (cause) { if (pendingSketch.current === undefined) pendingSketch.current = file; failure(cause); throw cause; }
      }
    })();
    sketchSaving.current = operation;
    void operation.finally(() => { sketchSaving.current = null; finishStatus(); }).catch(() => {});
    return operation;
  }, [failure, finishStatus]);

  const setRoom = useCallback((next: Room) => {
    if (!session.current || session.current.readOnly) return;
    try {
      const validated = validateRoom(next);
      setRoomState(validated); pending.current = validated; clearError();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => { timer.current = null; void save(); }, 250);
    } catch (cause) { failure(cause); }
  }, [clearError, failure, save]);

  const uploadSketch = useCallback(async (file: File | null) => {
    if (!session.current || session.current.readOnly) throw new Error('Este enlace solo permite ver el proyecto.');
    if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)) throw new Error('Usa una imagen PNG, JPG o WebP de hasta 10 MB.');
    pendingSketch.current = file; clearError(); await saveSketch();
  }, [clearError, saveSketch]);
  const retry = useCallback(() => {
    if (!session.current) { void load(); return; }
    clearError(); void save(); void saveSketch().catch(() => {}); finishStatus();
  }, [clearError, finishStatus, load, save, saveSketch]);

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; ++initializationAttempt.current; };
  }, [load]);
  useEffect(() => {
    const flush = () => {
      // shortcut: keepalive accepts small pending projects; larger unsaved edits remain marked until the normal save completes.
      const active = session.current;
      if (!active || active.readOnly || saving.current || retrySnapshot.current || !pending.current) return;
      const body = JSON.stringify({ room: pending.current, revision: active.revision });
      if (new Blob([body]).size > 60 * 1024) return;
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      const submitted = pending.current; pending.current = null; saving.current = true;
      void fetch('/api/rooms/' + active.id, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + active.editKey }, body, keepalive: true }).then(responseJson).then(result => { active.revision = result.revision as number; }).catch(cause => { retrySnapshot.current = submitted; failure(cause); }).finally(() => { saving.current = false; finishStatus(); if (pending.current && !lastError.current) void save(); });
    };
    const warnUnsaved = (event: BeforeUnloadEvent) => {
      if (saving.current || pending.current || retrySnapshot.current || sketchSaving.current || pendingSketch.current !== undefined) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', warnUnsaved);
    return () => { window.removeEventListener('pagehide', flush); window.removeEventListener('beforeunload', warnUnsaved); };
  }, [failure, finishStatus, save]);

  return { room, setRoom, ready, status, error, readOnly, shareUrl, uploadSketch, sketchUrl, retry };
}
