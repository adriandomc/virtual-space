export type SitePage = 'landing' | 'login' | 'designs' | 'editor' | 'embed' | 'privacy' | 'terms' | 'help';

export const LOGIN_PATH = '/login';
export const DESIGNS_PATH = '/designs';
export const PRIVACY_PATH = '/privacy';
export const TERMS_PATH = '/terms';
export const HELP_PATH = '/help';

export function editorPath(id: string, setup = false) {
  const query = new URLSearchParams({ room: id });
  if (setup) query.set('setup', '1');
  return '/editor?' + query;
}

export function shareAddress(source: URL, id: string) {
  return new URL(editorPath(id), source.origin).href;
}

export function embedAddress(source: URL, id: string) {
  return new URL('/embed?' + new URLSearchParams({ room: id }), source.origin).href;
}

export function embedCode(source: URL, id: string, title = '3D Space') {
  const address = embedAddress(source, id).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const label = title.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<iframe src="${address}" title="${label}" width="100%" height="560" style="border:0" loading="lazy" allowfullscreen referrerpolicy="no-referrer"></iframe>`;
}

export function siteRoute(url: URL): { page: SitePage; redirect?: string } {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const id = url.searchParams.get('room');
  if (path === '/embed') return { page: 'embed' };
  if (path === '/editor') return id ? { page: 'editor' } : { page: 'designs', redirect: DESIGNS_PATH };
  if (path === LOGIN_PATH) return { page: 'login' };
  if (path === DESIGNS_PATH) return { page: 'designs' };
  if (path === PRIVACY_PATH) return { page: 'privacy' };
  if (path === TERMS_PATH) return { page: 'terms' };
  if (path === HELP_PATH) return { page: 'help' };
  return path === '/' ? { page: 'landing' } : { page: 'landing', redirect: '/' };
}

export function accountRedirect(page: SitePage, authenticated: boolean) {
  if (page === 'login' && authenticated) return DESIGNS_PATH;
  if (page === 'designs' && !authenticated) return LOGIN_PATH;
  return null;
}
