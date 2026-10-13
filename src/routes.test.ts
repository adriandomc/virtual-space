import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountRedirect, editorPath, shareAddress, siteRoute } from './routes';

test('site routes separate the public demo, account, library and editor', () => {
  const route = (path: string) => siteRoute(new URL(path, 'https://space.example'));
  assert.deepEqual(route('/'), { page: 'landing' });
  assert.deepEqual(route('/?room=design&setup=1#edit=secret'), { page: 'landing' });
  assert.deepEqual(route('/login'), { page: 'login' });
  assert.deepEqual(route('/login?room=design&setup=1#edit=secret'), { page: 'login' });
  assert.deepEqual(route('/designs'), { page: 'designs' });
  assert.deepEqual(route('/privacy'), { page: 'privacy' });
  assert.deepEqual(route('/privacy/'), { page: 'privacy' });
  assert.deepEqual(route('/privacy?room=design#cookies'), { page: 'privacy' });
  assert.deepEqual(route('/editor?room=design&setup=1'), { page: 'editor' });
  assert.deepEqual(route('/editor'), { page: 'designs', redirect: '/designs' });
  assert.deepEqual(route('/unknown'), { page: 'landing', redirect: '/' });
  assert.deepEqual(route('/login/'), { page: 'login' });
});

test('account guards do not bounce public viewers or signed-in library users', () => {
  assert.equal(accountRedirect('login', true), '/designs');
  assert.equal(accountRedirect('designs', false), '/login');
  for (const page of ['landing', 'editor', 'privacy'] as const) {
    assert.equal(accountRedirect(page, false), null);
    assert.equal(accountRedirect(page, true), null);
  }
  assert.equal(accountRedirect('login', false), null);
  assert.equal(accountRedirect('designs', true), null);
});

test('new and shared editor addresses encode identifiers and exclude onboarding or hash state', () => {
  assert.equal(editorPath('room id', true), '/editor?room=room+id&setup=1');
  assert.equal(shareAddress(new URL('https://space.example/editor?room=old&setup=1#edit=secret'), 'room id'), 'https://space.example/editor?room=room+id');
});
