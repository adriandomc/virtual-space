import { useEffect, useRef, useState } from 'react';
import { t, useLocale } from '../../shared/i18n/i18n';
import { CircleHelp, LoaderCircle } from 'lucide-react';
import Onboarding from './Onboarding';
import RecoveryPanel from '../editor/RecoveryPanel';
import useProject from '../editor/useProject';
import type { Room } from '../../domain/project/types';
import { DESIGNS_PATH, editorPath } from '../../shared/routes';

function editorAddress() {
  const url = new URL(window.location.href);
  return editorPath(url.searchParams.get('room') ?? '');
}

export default function SetupApp() {
  useLocale();
  const { project, setProject, activeLevelId, setActiveLevelId, room, setRoom, ready, status, error, role, readOnly, canManage, sketchUrl, uploadSketch, retry, pendingOffline, downloadOfflineBackup, discardOffline, recoveryProject } = useProject();
  const unauthorized = role !== 'owner' && role !== 'editor';
  const [recoveryError, setRecoveryError] = useState('');
  const recoveryPanel = <RecoveryPanel project={recoveryProject} onDownload={downloadOfflineBackup} onDiscard={discardOffline} onError={setRecoveryError} />;
  const [destination, setDestination] = useState<'editor' | 'library' | null>(null);
  const latestProject = useRef(project);
  latestProject.current = project;

  function change(next: Room) { return setRoom(next); }
  function finish() {
    const { setupStep: _step, ...complete } = latestProject.current;
    if (!setProject(complete)) return;
    setDestination('editor');
  }

  useEffect(() => {
    if (ready && (unauthorized || (room.setupStep === undefined && !destination))) window.location.replace(editorAddress());
    else if (ready && destination && (status === 'saved' || status === 'offline')) window.location.replace(destination === 'editor' ? editorAddress() : DESIGNS_PATH);
  }, [ready, unauthorized, room.setupStep, destination, status]);

  if (!ready || unauthorized || (room.setupStep === undefined && !destination)) return <main className="account-page account-loading">{recoveryPanel}{recoveryError && <p role="alert">{t(recoveryError)}</p>}{status === 'error' ? <><CircleHelp size={24} /><p className="account-error" role="alert">{t(error)}</p><button className="account-primary" onClick={retry}>{t("Reintentar")}</button><a href={DESIGNS_PATH}>{t("Mis diseños")}</a></> : <><LoaderCircle size={25} className="saving-spinner" /><span>{t("Cargando diseño…")}</span></>}</main>;

  return <>{recoveryPanel}{recoveryError && <p role="alert">{t(recoveryError)}</p>}<Onboarding project={project} activeLevelId={activeLevelId} onProjectChange={setProject} onLevelChange={setActiveLevelId} disabled={readOnly} canManage={canManage} room={destination === 'editor' ? { ...room, setupStep: 3 } : room} onChange={change} sketchUrl={sketchUrl} onSketchChange={uploadSketch} status={destination && !['error', 'conflict', 'offline'].includes(status) ? 'loading' : status} error={t(error)} onRetry={retry} onFinish={finish} onCancel={() => setDestination('library')} pendingOffline={pendingOffline} onDownload={downloadOfflineBackup} onDiscard={discardOffline} /></>;
}
