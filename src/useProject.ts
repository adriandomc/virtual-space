import { useCallback, useEffect, useRef, useState } from 'react';
import { createDefaultRoom, validateRoom } from './model';
import type { Room } from './types';
import { shareAddress } from './routes';
import { accountRequest } from './accountApi';
import { LiveProject, type ProjectRole, type ProjectSnapshot } from './liveProject';

type Status = 'loading' | 'saving' | 'saved' | 'error';
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
  const [attempt, setAttempt] = useState(0);
  const id = new URL(window.location.href).searchParams.get('room') ?? '';
  const client = useRef<LiveProject | null>(null);
  const mounted = useRef(false);
  const sketchSaving = useRef(false);
  const connection = useRef(false);
  const lastError = useRef('');

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
    mounted.current = true; setStatus('loading'); setReady(false); setError('');
    const metadata = (snapshot: Omit<ProjectSnapshot, 'room'>) => {
      if (!active) return;
      setRole(snapshot.role); setCanEdit(snapshot.canEdit); setCanManage(snapshot.canManage);
      setShared(snapshot.shared); setSketchUrl(sketchAddress(id, snapshot.hasSketch, snapshot.sketchVersion));
    };
    void accountRequest<ProjectSnapshot>('/api/rooms/' + encodeURIComponent(id)).then(snapshot => {
      if (!active) return;
      setRoomState(validateRoom(snapshot.room)); metadata(snapshot);
      const url = new URL('/api/rooms/' + encodeURIComponent(id) + '/live', window.location.origin);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      const live = new LiveProject(url.href, {
        room: next => { if (active) { setRoomState(next); setReady(true); } },
        metadata,
        state: (online, pending) => {
          if (!active) return;
          connection.current = online; setConnected(online);
          if (online) { lastError.current = ''; setError(''); setStatus(pending || sketchSaving.current ? 'saving' : 'saved'); }
          else setStatus('error');
        },
        error: (message, denied) => { if (active) { if (denied) { setCanEdit(false); setCanManage(false); } failure(message); } },
      });
      client.current = live; live.connect();
    }).catch(cause => { if (active) failure(cause); });
    return () => { active = false; mounted.current = false; connection.current = false; client.current?.destroy(); client.current = null; };
  }, [id, attempt, failure]);

  const setRoom = useCallback((next: Room) => {
    if (!client.current || !canEdit) return false;
    try { lastError.current = ''; setError(''); client.current.change(validateRoom(next), room); return true; }
    catch (cause) { failure(cause); return false; }
  }, [room, canEdit, failure]);

  const uploadSketch = useCallback(async (file: File | null) => {
    if (!canEdit || !connection.current) throw new Error('Espera a que se restablezca la conexión.');
    if (file && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024)) throw new Error('Usa una imagen PNG, JPG o WebP de hasta 10 MB.');
    if (sketchSaving.current) throw new Error('Espera a que termine de guardarse el croquis.');
    sketchSaving.current = true; lastError.current = ''; setError(''); setStatus('saving');
    try {
      const response = await fetch('/api/rooms/' + id + '/sketch', { method: file ? 'PUT' : 'DELETE', headers: file ? { 'Content-Type': file.type } : undefined, body: file ?? undefined, credentials: 'same-origin', signal: AbortSignal.timeout(30000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudo guardar el croquis.');
      if (mounted.current) setSketchUrl(sketchAddress(id, result.hasSketch === true, result.sketchVersion));
    } catch (cause) { failure(cause); throw cause; }
    finally { sketchSaving.current = false; finishStatus(); }
  }, [id, canEdit, failure, finishStatus]);
  const setSharing = useCallback(async (enabled: boolean) => {
    if (!canManage) throw new Error('Solo el propietario puede cambiar los permisos.');
    const result = await accountRequest<{ shared: boolean }>('/api/rooms/' + id + '/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
    if (mounted.current) setShared(result.shared);
  }, [id, canManage]);
  const retry = useCallback(() => {
    lastError.current = ''; setError('');
    if (client.current) client.current.retry(); else setAttempt(value => value + 1);
  }, []);

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (client.current?.hasPending || sketchSaving.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  return { room, setRoom, ready, status, error, readOnly: !canEdit || !connected, canManage, role, connected, roomId: id, shareUrl: shareAddress(new URL(window.location.href), id), shared, setSharing, uploadSketch, sketchUrl, retry };
}
