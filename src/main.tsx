import React from 'react';
import ReactDOM from 'react-dom/client';
import { LoaderCircle } from 'lucide-react';
import { siteRoute } from './routes';
import './styles.css';

const Landing = React.lazy(() => import('./Landing'));
const AccountApp = React.lazy(() => import('./AccountApp'));
const Privacy = React.lazy(() => import('./Privacy'));
const route = siteRoute(new URL(window.location.href));

if (route.redirect) window.location.replace(route.redirect);
else ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><React.Suspense fallback={<main className="project-loading" aria-label="Cargando"><LoaderCircle size={25} className="saving-spinner" /></main>}>
    {route.page === 'landing' ? <Landing /> : route.page === 'privacy' ? <Privacy /> : <AccountApp page={route.page} />}
  </React.Suspense></React.StrictMode>,
);
