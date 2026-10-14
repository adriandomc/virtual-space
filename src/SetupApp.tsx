import { useEffect, useRef, useState } from 'react';
import { CircleHelp, LoaderCircle } from 'lucide-react';
import Onboarding from './Onboarding';
import useProject from './useProject';
import type { Room } from './types';
import { DESIGNS_PATH, editorPath } from './routes';

function editorAddress() {
  const url = new URL(window.location.href);
  return editorPath(url.searchParams.get('room') ?? '');
}

export default function SetupApp() {
  const { room, setRoom, ready, status, error, role, readOnly, canManage, sketchUrl, uploadSketch, retry, pendingOffline, downloadOfflineBackup, discardOffline } = useProject();
  const unauthorized = role !== 'owner' && role !== 'editor';
  const [destination, setDestination] = useState<'editor' | 'library' | null>(null);
  const latestRoom = useRef(room);
  latestRoom.current = room;

  function change(next: Room) { if (!setRoom(next)) return false; latestRoom.current = next; return true; }
  function finish() {
    const { setupStep: _step, ...complete } = latestRoom.current;
    if (!change(complete)) return;
    setDestination('editor');
  }

  useEffect(() => {
    if (ready && (unauthorized || (room.setupStep === undefined && !destination))) window.location.replace(editorAddress());
    else if (ready && destination && (status === 'saved' || status === 'offline')) window.location.replace(destination === 'editor' ? editorAddress() : DESIGNS_PATH);
  }, [ready, unauthorized, room.setupStep, destination, status]);

  if (!ready || unauthorized || (room.setupStep === undefined && !destination)) return <main className="account-page account-loading">{status === 'error' ? <><CircleHelp size={24} /><p className="account-error" role="alert">{error}</p><button className="account-primary" onClick={retry}>Reintentar</button><a href={DESIGNS_PATH}>Mis diseños</a></> : <><LoaderCircle size={25} className="saving-spinner" /><span>Cargando diseño…</span></>}</main>;

  return <Onboarding disabled={readOnly} canManage={canManage} room={destination === 'editor' ? { ...room, setupStep: 2 } : room} onChange={change} sketchUrl={sketchUrl} onSketchChange={uploadSketch} status={destination && !['error', 'conflict', 'offline'].includes(status) ? 'loading' : status} error={error} onRetry={retry} onFinish={finish} onCancel={() => setDestination('library')} pendingOffline={pendingOffline} onDownload={downloadOfflineBackup} onDiscard={discardOffline} />;
}
