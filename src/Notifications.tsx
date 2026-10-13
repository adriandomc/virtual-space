import { useEffect, useRef, useState } from 'react';
import { Bell, Check, LoaderCircle, X } from 'lucide-react';
import { accountRequest } from './accountApi';
import { editorPath } from './routes';
import './collaboration.css';

type Notice = { id: string; roomId: string; roomName: string; role: 'reader' | 'editor'; fromUsername: string; createdAt: number };
export default function Notifications({ onAccepted }: { onAccepted?: () => void }) {
  const [items, setItems] = useState<Notice[]>([]);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true;
    const load = () => { void accountRequest<{ notifications: Notice[] }>('/api/notifications').then(result => { if (active) { setItems(result.notifications); setError(''); } }).catch(cause => { if (active) setError(cause.message); }); };
    load();
    const stream = new EventSource('/api/notifications/events');
    stream.onmessage = event => { try { const data = JSON.parse(event.data); if (active && Array.isArray(data.notifications)) { setItems(data.notifications); setError(''); } } catch { load(); } };
    const timer = setInterval(() => { if (document.visibilityState === 'visible' && stream.readyState !== EventSource.OPEN) load(); }, 15000);
    window.addEventListener('focus', load);
    return () => { active = false; stream.close(); clearInterval(timer); window.removeEventListener('focus', load); };
  }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  async function reply(item: Notice, accepted: boolean) {
    setPending(item.id); setError('');
    try {
      const result = await accountRequest<{ roomId: string }>('/api/notifications/' + item.id + '/' + (accepted ? 'accept' : 'decline'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      setItems(current => current.filter(value => value.id !== item.id));
      if (accepted) { onAccepted?.(); window.location.assign(editorPath(result.roomId)); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo responder.'); }
    finally { setPending(null); }
  }
  return <div className="notifications" ref={container}>
    <button className="icon-button notification-button" aria-label={'Notificaciones' + (items.length ? ', ' + items.length + ' pendientes' : '')} aria-expanded={open} onClick={() => setOpen(value => !value)}><Bell size={20} />{items.length > 0 && <span className="notification-count">{items.length > 9 ? '9+' : items.length}</span>}</button>
    {open && <section className="notifications-panel" aria-label="Notificaciones"><header><h2>Notificaciones</h2><button className="icon-button" aria-label="Cerrar notificaciones" onClick={() => setOpen(false)}><X size={18} /></button></header>{items.length === 0 && !error && <p>Sin notificaciones</p>}<ul>{items.map(item => <li key={item.id}><strong>{item.roomName}</strong><span>{item.fromUsername} te invita como {item.role === 'editor' ? 'editor' : 'lector'}.</span><div><button className="outline-button" disabled={!!pending} onClick={() => void reply(item, true)}>{pending === item.id ? <LoaderCircle size={16} className="saving-spinner" /> : <Check size={16} />}Aceptar</button><button className="icon-button" aria-label={'Rechazar invitación a ' + item.roomName} disabled={!!pending} onClick={() => void reply(item, false)}><X size={18} /></button></div></li>)}</ul>{error && <p className="account-error" role="alert">{error}</p>}</section>}
  </div>;
}
