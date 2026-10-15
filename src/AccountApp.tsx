import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { Box, Copy, Eye, EyeOff, LoaderCircle, LogOut, Plus, Trash2 } from 'lucide-react';
import Brand from './Brand';
import Notifications from './Notifications';
import { createBlankRoom } from './onboardingModel';
import { accountRequest, isNetworkError } from './accountApi';
import { offlineIdentity, rememberOfflineIdentity } from './offlineIdentity';
import OfflineSettings, { useOfflineMode } from './OfflineSettings';
import { bootstrapOfflineMode, offlineForced } from './offlineMode';
import { clearOfflineAccount, copyDesign, createDesignLocal, deleteDesign as removeDesign, listDesigns, pendingOfflineCount } from './offlineService';
import { TERMS_VERSION } from './legalPolicy';
import { accountRedirect, DESIGNS_PATH, editorPath, LOGIN_PATH, type SitePage } from './routes';
import './account.css';

const RoomEditor = lazy(() => import('./App'));
const SetupApp = lazy(() => import('./SetupApp'));

type User = { id: string; username: string };
type Design = { id: string; name: string; updatedAt: string; setupStep?: 0 | 1 | 2; role: 'owner' | 'editor' | 'reader'; canManage: boolean; offlineAllowed?: boolean; offline?: boolean };

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
  const [rememberSession, setRememberSession] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    if ([...password].length < 8 || [...password].length > 128) { setError('La contraseña debe tener de 8 a 128 caracteres.'); return; }
    if (register && password !== confirmPassword) { setError('Las contraseñas no coinciden.'); return; }
    if (register && !acceptTerms) { setError('Acepta las condiciones de uso para crear tu cuenta.'); return; }
    setPending(true); setError('');
    try {
      const result = await accountRequest<{ user: User }>('/api/auth/' + (register ? 'register' : 'login'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: username.trim().toLowerCase(), password, rememberSession, ...(register ? { confirmPassword, termsVersion: TERMS_VERSION } : {}) }) });
      setPassword(''); setConfirmPassword(''); onAuthenticated(result.user);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo ingresar. Inténtalo de nuevo.'); }
    finally { setPending(false); }
  }
  return <main className="account-page auth-page"><section className="auth-card" aria-label="Cuenta"><Brand />
    <div className="auth-tabs" aria-label="Acceso"><button type="button" className={!register ? 'active' : ''} aria-pressed={!register} disabled={pending} onClick={() => { setRegister(false); setError(''); setPassword(''); setConfirmPassword(''); setAcceptTerms(false); }}>Entrar</button><button type="button" className={register ? 'active' : ''} aria-pressed={register} disabled={pending} onClick={() => { setRegister(true); setError(''); setPassword(''); setConfirmPassword(''); setAcceptTerms(false); }}>Crear cuenta</button></div>
    <form onSubmit={submit} aria-busy={pending}>
      <label className="account-field"><span>Usuario</span><input name="username" value={username} onChange={event => setUsername(event.target.value.toLowerCase())} onBlur={() => setUsername(current => current.trim())} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} required minLength={3} maxLength={32} pattern="[a-zA-Z0-9_]{3,32}" title="De 3 a 32 letras, números o guiones bajos" disabled={pending} /></label>
      <PasswordField label="Contraseña" name="password" value={password} onChange={setPassword} register={register} disabled={pending} />
      {register && <PasswordField label="Confirmar contraseña" name="confirmPassword" value={confirmPassword} onChange={setConfirmPassword} register disabled={pending} />}
      {register && <p className="account-note">Nota: recuerda tu contraseña. No hay forma de recuperarla.</p>}
      {register && <p className="account-note">Tras 3 meses sin usar tu cuenta, se eliminan la cuenta y sus diseños.</p>}
      {register && <label className="account-remember account-terms"><input type="checkbox" name="acceptTerms" checked={acceptTerms} required disabled={pending} onChange={event => setAcceptTerms(event.target.checked)} /><span>Acepto las <a href="/terms" target="_blank" rel="noopener">condiciones de uso</a>.</span></label>}
      <label className="account-remember"><input type="checkbox" name="rememberSession" checked={rememberSession} disabled={pending} onChange={event => setRememberSession(event.target.checked)} /><span>Recordar sesión 30 días (usa cookies)</span></label>
      {error && <p className="account-error" role="alert">{error}</p>}
      <button type="submit" className="account-primary" disabled={pending}>{pending && <LoaderCircle size={17} className="saving-spinner" />}{register ? 'Crear cuenta' : 'Entrar'}</button>
    </form>
    <nav className="auth-links" aria-label="Enlaces de cuenta"><a href="/" className="auth-home">Volver al inicio</a><a className="privacy-link" href="/privacy" target="_blank" rel="noopener">Aviso de privacidad</a><a className="privacy-link" href="/terms" target="_blank" rel="noopener">Condiciones de uso</a></nav>
  </section></main>;
}

export default function AccountApp({ page }: { page: Exclude<SitePage, 'landing' | 'privacy' | 'terms'> }) {
  const forced = useOfflineMode();
  const [user, setUser] = useState<User | null>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [sessionAttempt, setSessionAttempt] = useState(0);
  const [offline, setOffline] = useState(false);
  const [reauthenticate, setReauthenticate] = useState(false);
  const [designs, setDesigns] = useState<Design[]>([]);
  const [loadingDesigns, setLoadingDesigns] = useState(false);
  const [libraryAttempt, setLibraryAttempt] = useState(0);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const pendingAccount = useRef<string | null>(null);
  const libraryGeneration = useRef(0);
  pendingAccount.current = pending;
  const creationId = useRef<string | null>(null);
  const roomId = new URL(window.location.href).searchParams.get('room');

  useEffect(() => {
    let active = true;
    setLoadingSession(true); setSessionError('');
    void (async () => {
      const local = await bootstrapOfflineMode();
      if (local.forced) return { user: local.identity, local: true };
      const result = await accountRequest<{ user: User | null }>('/api/auth/session');
      return { ...result, local: false };
    })().then(async result => {
      if (!active) return;
      if (result.user && !result.local) await rememberOfflineIdentity(result.user).catch(() => {});
      const local = !result.user ? await offlineIdentity().catch(() => null) : null;
      if (active) { setUser(result.user ?? local); setOffline(result.local || !!local); setReauthenticate(!result.user && !!local); }
    }).catch(async cause => {
      const identity = isNetworkError(cause) ? await offlineIdentity().catch(() => null) : null;
      if (!active) return;
      if (identity) { setUser(identity); setOffline(true); }
      else setSessionError(cause instanceof Error ? cause.message : 'No se pudo conectar.');
    }).finally(() => { if (active) setLoadingSession(false); });
    return () => { active = false; };
  }, [page, sessionAttempt, forced]);

  useEffect(() => {
    const reconnect = () => { if (!offlineForced()) setSessionAttempt(current => current + 1); };
    const offlineError = (event: Event) => { const message = (event as CustomEvent).detail; if (typeof message === 'string') setError(message); };
    window.addEventListener('online', reconnect);
    window.addEventListener('space-offline-error', offlineError);
    return () => { window.removeEventListener('online', reconnect); window.removeEventListener('space-offline-error', offlineError); };
  }, []);

  const signingIn = page === 'login' && new URL(window.location.href).searchParams.get('reauth') === '1' && !forced;
  const redirect = loadingSession || sessionError || signingIn ? null : accountRedirect(page, !!user);
  useEffect(() => { if (redirect) window.location.replace(redirect); }, [redirect]);

  useEffect(() => {
    if (!user || page !== 'designs') return;
    let active = true, loading = false;
    const load = (silent = false) => {
      if (loading || pendingAccount.current) return;
      loading = true;
      const generation = libraryGeneration.current;
      if (!silent) { setLoadingDesigns(true); setError(''); }
      void listDesigns().then(result => {
        if (active && generation === libraryGeneration.current && !pendingAccount.current) { setDesigns(result); setOffline(offlineForced() || !navigator.onLine || reauthenticate); }
      }).catch(async cause => {
        if (!active || generation !== libraryGeneration.current) return;
        setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los diseños.');
      }).finally(() => { loading = false; if (active) setLoadingDesigns(false); });
    };
    const refresh = () => { if (!offlineForced() && document.visibilityState === 'visible') load(true); };
    const refreshLocal = () => load(true);
    load();
    const timer = forced ? undefined : setInterval(refresh, 30000);
    window.addEventListener('focus', refresh); window.addEventListener('online', refresh); document.addEventListener('visibilitychange', refresh);
    window.addEventListener('space-offline-data', refreshLocal);
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); window.removeEventListener('space-offline-data', refreshLocal); };
  }, [user, page, libraryAttempt, forced, reauthenticate]);

  async function createDesign() {
    if (pending) return;
    libraryGeneration.current++;
    setPending('create'); setError('');
    creationId.current ??= crypto.randomUUID();
    try {
      let result: { id: string };
      if (forced || offline) result = await createDesignLocal();
      else try { result = await accountRequest<{ id: string }>('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: creationId.current, room: createBlankRoom() }) }); }
      catch (cause) { if (!isNetworkError(cause)) throw cause; result = await createDesignLocal(createBlankRoom(), creationId.current); }
      window.location.assign(editorPath(result.id, true));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear el diseño.'); setPending(null); }
  }
  async function deleteDesign(design: Design) {
    if (design.role !== 'owner' || pending || !window.confirm('¿Eliminar «' + design.name + '»?')) return;
    libraryGeneration.current++;
    setPending(design.id); setError('');
    try { await removeDesign(design.id); setDesigns(current => current.filter(item => item.id !== design.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo eliminar el diseño.'); }
    finally { setPending(null); }
  }
  async function logout() {
    if (pending) return;
    libraryGeneration.current++;
    setPending('logout'); setError('');
    try {
      if (forced) throw new Error('Desactiva el modo sin conexión y sincroniza tus cambios antes de cerrar sesión.');
      if (!user) return;
      const locks = await navigator.locks?.query();
      if (locks?.held?.some(lock => lock.name?.startsWith('3d-space-project:' + user.id + ':'))) throw new Error('Cierra las pestañas del editor antes de cerrar sesión.');
      if (await pendingOfflineCount(user.id)) throw new Error('Hay cambios pendientes. Sincronízalos desde Ajustes antes de cerrar sesión.');
      await accountRequest('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      await clearOfflineAccount(user.id); window.location.assign(LOGIN_PATH);
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo cerrar sesión.'); }
    finally { setPending(null); }
  }
  async function personalCopy(design: Design) {
    if (pending) return;
    setPending(design.id); setError('');
    try { const result = await copyDesign(design.id); window.location.assign(editorPath(result.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo crear la copia.'); setPending(null); }
  }

  if (page === 'editor' && roomId) return <Suspense fallback={<main className="account-page account-loading" aria-label="Cargando diseño"><LoaderCircle className="saving-spinner" size={25} /></main>}>{new URL(window.location.href).searchParams.get('setup') === '1' ? <SetupApp /> : <RoomEditor onHome={() => window.location.assign(DESIGNS_PATH)} />}</Suspense>;
  if (loadingSession || redirect) return <main className="account-page account-loading" aria-label="Cargando cuenta"><LoaderCircle className="saving-spinner" size={25} /></main>;
  if (sessionError) return <main className="account-page account-loading"><p className="account-error" role="alert">{sessionError}</p><button className="account-secondary" onClick={() => setSessionAttempt(current => current + 1)}>Reintentar</button></main>;
  if (!user || signingIn) return <AuthScreen onAuthenticated={next => { void rememberOfflineIdentity(next).catch(() => {}).finally(() => window.location.replace(DESIGNS_PATH)); }} />;
  return <main className="account-page library-page"><header className="account-header"><Brand /><div><span className="account-username">{user.username}</span>{!forced && !offline && <Notifications onAccepted={() => setLibraryAttempt(current => current + 1)} />}<OfflineSettings /><button type="button" className="account-secondary" aria-label="Cerrar sesión" disabled={!!pending} onClick={() => void logout()}><LogOut size={17} /><span>Cerrar sesión</span></button></div></header>
    <section className="design-library" aria-labelledby="designs-title"><div className="library-heading"><h1 id="designs-title">Mis diseños</h1><button type="button" className="account-primary" disabled={!!pending} onClick={() => void createDesign()}>{pending === 'create' ? <LoaderCircle size={17} className="saving-spinner" /> : <Plus size={19} />}Nuevo diseño</button></div>
      {offline && <p className="account-note" role="status">Sin conexión · Diseños disponibles en este dispositivo</p>}
      {reauthenticate && !forced && <p className="account-note">Tu sesión venció. Puedes seguir trabajando aquí. <a href="/login?reauth=1">Inicia sesión para sincronizar</a>.</p>}
      {error && <div className="library-error"><p className="account-error" role="alert">{error}</p><button type="button" className="account-secondary" disabled={!!pending} onClick={() => setLibraryAttempt(current => current + 1)}>Reintentar</button></div>}
      {loadingDesigns ? <div className="library-empty" aria-label="Cargando diseños"><LoaderCircle size={23} className="saving-spinner" /></div> : designs.length ? <ul className="design-list">{designs.map(design => <li key={design.id}><a href={editorPath(design.id, design.role === 'owner' && design.setupStep !== undefined)} className="design-open"><span className="design-icon"><Box size={27} strokeWidth={1.3} /></span><span><strong>{design.name}</strong>{design.role !== 'owner' && <span className="design-progress">Compartido · {design.role === 'editor' ? 'Editor' : 'Lector'}</span>}{design.role === 'owner' && design.setupStep !== undefined ? <span className="design-progress">Continuar preparación</span> : <time dateTime={new Date(design.updatedAt).toISOString()}>{new Date(design.updatedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}</time>}</span></a>{(design.offlineAllowed === false || design.offline) && <button type="button" className="design-delete" aria-label={'Crear copia personal de ' + design.name} title="Crear copia personal para usar sin conexión" disabled={!!pending || (design.offlineAllowed === false && (forced || offline))} onClick={() => void personalCopy(design)}><Copy size={19} /></button>}{design.role === 'owner' && <button type="button" className="design-delete" aria-label={'Eliminar ' + design.name} disabled={!!pending} onClick={() => void deleteDesign(design)}>{pending === design.id ? <LoaderCircle size={19} className="saving-spinner" /> : <Trash2 size={19} />}</button>}</li>)}</ul> : !error && <p className="library-empty">Sin diseños</p>}
    </section>
    <footer className="account-footer"><a className="privacy-link" href="/privacy">Aviso de privacidad</a><a className="privacy-link" href="/terms">Condiciones de uso</a></footer>
  </main>;
}
