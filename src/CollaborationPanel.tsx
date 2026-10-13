import { useEffect, useState } from 'react';
import { Check, LoaderCircle, UserPlus, X } from 'lucide-react';
import { accountRequest } from './accountApi';
import './collaboration.css';

type Member = { id: string; username: string; role: 'reader' | 'editor'; status: 'pending' | 'accepted' };
export default function CollaborationPanel({ roomId }: { roomId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<'reader' | 'editor'>('editor');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const base = '/api/rooms/' + encodeURIComponent(roomId) + '/members';
  useEffect(() => {
    let active = true;
    let loading = false;
    const refresh = () => {
      if (loading || document.visibilityState !== 'visible') return;
      loading = true;
      void accountRequest<{ members: Member[] }>(base).then(result => { if (active) setMembers(result.members); }).catch(cause => { if (active) setError(cause.message); }).finally(() => { loading = false; });
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [base]);
  async function mutate(path: string, method: string, body?: unknown) {
    setPending(true); setError(''); setNotice('');
    try {
      const result = await accountRequest<{ members: Member[] }>(path, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      setMembers(result.members); return true;
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cambiar el acceso.'); return false; }
    finally { setPending(false); }
  }
  return <section className="collaboration-access" aria-label="Colaboradores">
    <h3>Personas</h3>
    <form className="collaboration-invite" onSubmit={event => { event.preventDefault(); void mutate(base, 'POST', { username: username.trim().toLowerCase(), role }).then(ok => { if (ok) { setUsername(''); setNotice('Invitación enviada.'); } }); }}>
      <label>Usuario<input aria-label="Usuario a invitar" value={username} onChange={event => setUsername(event.target.value.toLowerCase())} required minLength={3} maxLength={32} pattern="[a-z0-9_]{3,32}" autoCapitalize="none" autoComplete="off" disabled={pending} /></label>
      <label>Acceso<select aria-label="Rol de la invitación" value={role} onChange={event => setRole(event.target.value as 'reader' | 'editor')} disabled={pending}><option value="reader">Lector</option><option value="editor">Editor</option></select></label>
      <button className="outline-button" disabled={pending || !username.trim()}>{pending ? <LoaderCircle size={17} className="saving-spinner" /> : <UserPlus size={17} />}Invitar</button>
    </form>
    <ul className="collaboration-members">{members.map(member => <li key={member.id}><div><strong>{member.username}</strong><small>{member.status === 'pending' ? 'Pendiente' : 'Aceptada'}</small></div><select aria-label={'Acceso de ' + member.username} value={member.role} disabled={pending} onChange={event => void mutate(base + '/' + member.id, 'PATCH', { role: event.target.value })}><option value="reader">Lector</option><option value="editor">Editor</option></select><button className="icon-button" aria-label={'Retirar acceso de ' + member.username} disabled={pending} onClick={() => void mutate(base + '/' + member.id, 'DELETE')}><X size={18} /></button></li>)}</ul>
    {error && <p className="account-error" role="alert">{error}</p>}
    {notice && <p className="collaboration-notice" role="status"><Check size={15} />{notice}</p>}
  </section>;
}
