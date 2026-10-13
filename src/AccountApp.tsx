import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { Box, Eye, EyeOff, LoaderCircle, LogOut, Plus, Trash2 } from 'lucide-react';
import { createBlankRoom } from './onboardingModel';
import { accountRequest } from './accountApi';
import './account.css';

const RoomEditor = lazy(() => import('./App'));
const SetupApp = lazy(() => import('./SetupApp'));

type User = { id: string; username: string };
type Design = { id: string; name: string; updatedAt: string; setupStep?: 0 | 1 | 2 };

function Brand() {
  return <div className="account-brand"><Box size={24} strokeWidth={1.5} /><strong>espacio<span>.</span></strong></div>;
}

function PasswordField({ label, name, value, onChange, register, disabled }: { label: string; name: string; value: string; onChange: (value: string) => void; register: boolean; disabled: boolean }) {
  const [visible, setVisible] = useState(false);
  return <label className="account-field"><span>{label}</span><div className="account-password">
    <input name={name} aria-label={label} type={visible ? 'text' : 'password'} value={value} onChange={event => onChange(event.target.value)} required minLength={8} maxLength={256} autoComplete={register ? 'new-password' : 'current-password'} disabled={disabled} />
    <button type="button" aria-label={(visible ? 'Ocultar ' : 'Mostrar ') + label.toLowerCase()} aria-pressed={visible} disabled={disabled} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={19} /> : <Eye size={19} />}</button>
  </div></label>;
}

export function AuthScreen({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if ([...password].length < 8 || [...password].length > 128) { setError('La contraseña debe tener de 8 a 128 caracteres.'); return; }
    if (register && password !== confirmPassword) { setError('Las contraseñas no coinciden.'); return; }
    setPending(true); setError('');
    try {
      const result = await accountRequest<{ user: User }>('/api/auth/' + (register ? 'register' : 'login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username.trim().toLowerCase(), password, ...(register ? { confirmPassword } : {}) }) });
      setPassword(''); setConfirmPassword(''); onAuthenticated(result.user);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo ingresar. Inténtalo de nuevo.'); }
    finally { setPending(false); }
  }
  return <main className="account-page auth-page"><section className="auth-card" aria-label="Cuenta"><Brand />
    <div className="auth-tabs" aria-label="Acceso"><button type="button" className={!register ? 'active' : ''} aria-pressed={!register} disabled={pending} onClick={() => { setRegister(false); setError(''); setPassword(''); setConfirmPassword(''); }}>Entrar</button><button type="button" className={register ? 'active' : ''} aria-pressed={register} disabled={pending} onClick={() => { setRegister(true); setError(''); setPassword(''); setConfirmPassword(''); }}>Crear cuenta</button></div>
    <form onSubmit={submit} aria-busy={pending}>
      <label className="account-field"><span>Usuario</span><input name="username" value={username} onChange={event => setUsername(event.target.value.toLowerCase())} onBlur={() => setUsername(current => current.trim())} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]{3,32}" title="De 3 a 32 letras, números o guiones bajos" disabled={pending} /></label>
      <PasswordField label="Contraseña" name="password" value={password} onChange={setPassword} register={register} disabled={pending} />
      {register && <PasswordField label="Confirmar contraseña" name="confirmPassword" value={confirmPassword} onChange={setConfirmPassword} register disabled={pending} />}
      {error && <p className="account-error" role="alert">{error}</p>}
      <button type="submit" className="account-primary" disabled={pending}>{pending && <LoaderCircle size={17} className="saving-spinner" />}{register ? 'Crear cuenta' : 'Entrar'}</button>
    </form>
  </section></main>;
}

export default function AccountApp() {
  const [user, setUser] = useState<User | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loadingDesigns, setLoadingDesigns] = useState(false);
  const [libraryAttempt, setLibraryAttempt] = useState(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const creationId = useRef<string | null>(null);
  const roomId = new URL(window.location.href).searchParams.get('room');

  useEffect(() => {
    let active = true;
    setLoadingSession(true); setSessionError('');
    void accountRequest<{ user: User | null }>('/api/auth/session').then(result => { if (active) setUser(result.user); }).catch(cause => { if (active) setSessionError(cause instanceof Error ? cause.message : 'No se pudo conectar.'); }).finally(() => { if (active) setLoadingSession(false); });
    return () => { active = false; };
  }, [sessionAttempt]);

  useEffect(() => {
    if (!user || roomId) return;
    let active = true;
    setLoadingDesigns(true); setError('');
    void accountRequest<{ rooms: Design[] }>('/api/rooms').then(result => { if (active) setDesigns(result.rooms); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los diseños.'); }).finally(() => { if (active) setLoadingDesigns(false); });
    return () => { active = false; };
  }, [user, roomId, libraryAttempt]);

  async function createDesign() {
    if (pending) return;
    setPending('create'); setError('');
    creationId.current ??= crypto.randomUUID();
    try {
      const result = await accountRequest<{ id: string }>('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: creationId.current, room: createBlankRoom() }) });
      window.location.assign('/?room=' + encodeURIComponent(result.id) + '&setup=1');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear el diseño.'); setPending(null); }
  }
  async function deleteDesign(design: Design) {
    if (pending || !window.confirm('¿Eliminar «' + design.name + '»?')) return;
    setPending(design.id); setError('');
    try { await accountRequest('/api/rooms/' + encodeURIComponent(design.id), { method: 'DELETE', headers: { 'Content-Type': 'application/json' } }); setDesigns(current => current.filter(item => item.id !== design.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo eliminar el diseño.'); }
    finally { setPending(null); }
  }
  async function logout() {
    if (pending) return;
    setPending('logout'); setError('');
    try { await accountRequest('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); setUser(null); setDesigns([]); creationId.current = null; }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cerrar sesión.'); }
    finally { setPending(null); }
  }

  if (roomId) return <Suspense fallback={<main className="account-page account-loading" aria-label="Cargando diseño"><LoaderCircle className="saving-spinner" size={25} /></main>}>{new URL(window.location.href).searchParams.get('setup') === '1' ? <SetupApp /> : <RoomEditor onHome={() => window.location.assign('/')} />}</Suspense>;
  if (loadingSession) return <main className="account-page account-loading" aria-label="Cargando cuenta"><LoaderCircle className="saving-spinner" size={25} /></main>;
  if (sessionError) return <main className="account-page account-loading"><p className="account-error" role="alert">{sessionError}</p><button className="account-secondary" onClick={() => setSessionAttempt(current => current + 1)}>Reintentar</button></main>;
  if (!user) return <AuthScreen onAuthenticated={setUser} />;
  return <main className="account-page library-page"><header className="account-header"><Brand /><div><span className="account-username">{user.username}</span><button type="button" className="account-secondary" aria-label="Cerrar sesión" disabled={!!pending} onClick={() => void logout()}><LogOut size={17} /><span>Cerrar sesión</span></button></div></header>
    <section className="design-library" aria-labelledby="designs-title"><div className="library-heading"><h1 id="designs-title">Mis diseños</h1><button type="button" className="account-primary" disabled={!!pending} onClick={() => void createDesign()}>{pending === 'create' ? <LoaderCircle size={17} className="saving-spinner" /> : <Plus size={19} />}Nuevo diseño</button></div>
      {error && <div className="library-error"><p className="account-error" role="alert">{error}</p><button type="button" className="account-secondary" disabled={!!pending} onClick={() => setLibraryAttempt(current => current + 1)}>Reintentar</button></div>}
      {loadingDesigns ? <div className="library-empty" aria-label="Cargando diseños"><LoaderCircle size={23} className="saving-spinner" /></div> : designs.length ? <ul className="design-list">{designs.map(design => <li key={design.id}><a href={'/?room=' + encodeURIComponent(design.id) + (design.setupStep === undefined ? '' : '&setup=1')} className="design-open"><span className="design-icon"><Box size={27} strokeWidth={1.3} /></span><span><strong>{design.name}</strong><>{design.setupStep === undefined ? <time dateTime={new Date(design.updatedAt).toISOString()}>{new Date(design.updatedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}</time> : <span className="design-progress">Continuar preparación</span>}</></span></a><button type="button" className="design-delete" aria-label={'Eliminar ' + design.name} disabled={!!pending} onClick={() => void deleteDesign(design)}>{pending === design.id ? <LoaderCircle size={19} className="saving-spinner" /> : <Trash2 size={19} />}</button></li>)}</ul> : !error && <p className="library-empty">Sin diseños</p>}
    </section>
  </main>;
}
