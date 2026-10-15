import React from 'react';
import ReactDOM from 'react-dom/client';
import { LoaderCircle } from 'lucide-react';
import { siteRoute } from './routes';
import { registerAppOffline } from './appOffline';
import { bootstrapOfflineMode } from './offlineMode';
import AppRecovery, { AppFrame } from './AppRecovery';
import './styles.css';
import './offline.css';

const Landing = React.lazy(() => import('./Landing'));
const Embed = React.lazy(() => import('./Embed'));
const AccountApp = React.lazy(() => import('./AccountApp'));
const Privacy = React.lazy(() => import('./Privacy'));
const Terms = React.lazy(() => import('./Terms'));
const route = siteRoute(new URL(window.location.href));
if (route.page !== 'embed') registerAppOffline();
else document.body.classList.add('embed-page');
const viewport = window.visualViewport;
const syncViewportHeight = () => document.documentElement.style.setProperty('--app-height', Math.round(viewport && viewport.scale === 1 ? viewport.height : window.innerHeight) + 'px');
viewport?.addEventListener('resize', syncViewportHeight);
window.addEventListener('resize', syncViewportHeight);
syncViewportHeight();
import.meta.hot?.dispose(() => { viewport?.removeEventListener('resize', syncViewportHeight); window.removeEventListener('resize', syncViewportHeight); });

if (route.redirect) window.location.replace(route.redirect);
else {
 const root = ReactDOM.createRoot(document.getElementById('root')!);
 root.render(<main className="project-loading" aria-label="Cargando"><LoaderCircle size={25} className="saving-spinner" /></main>);
 void (route.page === 'embed' ? Promise.resolve() : bootstrapOfflineMode()).then(() => root.render(
  <React.StrictMode><AppRecovery><AppFrame><React.Suspense fallback={<main className="project-loading" aria-label="Cargando"><LoaderCircle size={25} className="saving-spinner" /></main>}>
    {route.page === 'embed' ? <Embed /> : route.page === 'landing' ? <Landing /> : route.page === 'privacy' ? <Privacy /> : route.page === 'terms' ? <Terms /> : <AccountApp page={route.page} />}
  </React.Suspense></AppFrame></AppRecovery></React.StrictMode>,
 )).catch(() => root.render(<main className="project-loading"><p>No se pudo abrir el almacenamiento de este dispositivo.</p><button className="primary-button" onClick={() => window.location.reload()}>Reintentar</button></main>));
}
