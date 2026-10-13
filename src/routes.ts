export type SitePage = 'landing' | 'login' | 'designs' | 'editor' | 'privacy' | 'terms';

export const LOGIN_PATH = '/login';
export const DESIGNS_PATH = '/designs';
export const PRIVACY_PATH = '/privacy';
export const TERMS_PATH = '/terms';

export function editorPath(id: string, setup = false) {
  const query = new URLSearchParams({ room: id });
  if (setup) query.set('setup', '1');
  return '/editor?' + query;
}

export function shareAddress(source: URL, id: string) {
  return new URL(editorPath(id), source.origin).href;
}

export function siteRoute(url: URL): { page: SitePage; redirect?: string } {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const id = url.searchParams.get('room');
  if (path === '/editor') return id ? { page: 'editor' } : { page: 'designs', redirect: DESIGNS_PATH };
  if (path === LOGIN_PATH) return { page: 'login' };
  if (path === DESIGNS_PATH) return { page: 'designs' };
  if (path === PRIVACY_PATH) return { page: 'privacy' };
  if (path === TERMS_PATH) return { page: 'terms' };
  return path === '/' ? { page: 'landing' } : { page: 'landing', redirect: '/' };
}

export function accountRedirect(page: SitePage, authenticated: boolean) {
  if (page === 'login' && authenticated) return DESIGNS_PATH;
  if (page === 'designs' && !authenticated) return LOGIN_PATH;
  return null;
}
