import { t, useLocale } from './i18n';
import { lazy, Suspense, useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { AccountRequestError } from './accountApi';
import { fetchPublicDesign, type PublicDesign } from './embedProject';
import type { Room } from './types';
import './embed.css';

const RoomScene = lazy(() => import('./RoomScene'));
const ignore = () => {};

export default function Embed() {
  useLocale();
  const id = new URL(window.location.href).searchParams.get('room') ?? '';
  const [design, setDesign] = useState<PublicDesign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [mode, setMode] = useState<'orbit' | 'walk'>('orbit');
  const [quality, setQuality] = useState<Room['renderQuality'] | null>(null);

  useEffect(() => {
    let active = true, pending = false;
    let controller: AbortController | undefined;
    const load = async () => {
      if (pending || !active) return;
      pending = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15000);
      try {
        const next = await fetchPublicDesign(id, controller.signal);
        if (active) { setDesign(previous => previous?.revision === next.revision ? previous : next); setError(''); }
      } catch (cause) {
        if (!active) return;
        if (cause instanceof AccountRequestError && [401, 403, 404].includes(cause.status)) setDesign(null);
        setError(cause instanceof AccountRequestError ? cause.message : "No se pudo cargar el diseño.");
      } finally { clearTimeout(timeout); pending = false; if (active) setLoading(false); }
    };
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = setInterval(refresh, 15000);
    window.addEventListener('online', refresh); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { active = false; controller?.abort(); clearInterval(timer); window.removeEventListener('online', refresh); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [id, attempt]);

  const room = design && (quality && quality !== design.room.renderQuality ? { ...design.room, renderQuality: quality } : design.room);
  return <main className="embed-view" aria-label={t('Visor 3D')}>
    {room ? <>
      <Suspense fallback={<div className="embed-loading" aria-label={t('Cargando')}><LoaderCircle size={24} className="saving-spinner" /></div>}>
        <RoomScene room={room} roomId={id} publicView mode={mode} animateView selection={null} onSelect={ignore} onChange={ignore} onModelError={setError} readOnly transformMode="translate" resetKey={0} />
      </Suspense>
      <div className="embed-controls">
        <div className="embed-mode" role="group" aria-label={t('Vista')}><button type="button" aria-pressed={mode === 'orbit'} onClick={() => setMode('orbit')}>{t('Visor')}</button><button type="button" aria-pressed={mode === 'walk'} onClick={() => setMode('walk')}>{t('Recorrido')}</button></div>
        <select aria-label={t('Modo de renderizado')} value={quality ?? room.renderQuality} onChange={event => setQuality(event.target.value as Room['renderQuality'])}><option value="standard">{t('Estándar')}</option><option value="realistic">{t('Realista')}</option><option value="hyperrealistic">{t('Hiperrealista')}</option></select>
      </div>
      {error && <div className="embed-notice" role="status"><span>{t(error)}</span><button type="button" onClick={() => setAttempt(value => value + 1)}>{t('Reintentar')}</button></div>}
    </> : <div className="embed-empty">{loading ? <LoaderCircle size={24} className="saving-spinner" aria-label={t('Cargando')} /> : <><p role="alert">{t(error || 'Este diseño no está disponible.')}</p><button type="button" onClick={() => { setLoading(true); setAttempt(value => value + 1); }}>{t('Reintentar')}</button></>}</div>}
  </main>;
}
