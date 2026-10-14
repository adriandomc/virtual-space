import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountRedirect, editorPath, embedAddress, embedCode, shareAddress, siteRoute } from './routes';

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
  assert.deepEqual(route('/terms'), { page: 'terms' });
  assert.deepEqual(route('/terms/'), { page: 'terms' });
  assert.deepEqual(route('/terms?room=design#conservacion'), { page: 'terms' });
  assert.deepEqual(route('/editor?room=design&setup=1'), { page: 'editor' });
  assert.deepEqual(route('/editor'), { page: 'designs', redirect: '/designs' });
  assert.deepEqual(route('/embed?room=design'), { page: 'embed' });
  assert.deepEqual(route('/embed/'), { page: 'embed' });
  assert.deepEqual(route('/unknown'), { page: 'landing', redirect: '/' });
  assert.deepEqual(route('/login/'), { page: 'login' });
});

test('account guards do not bounce public viewers or signed-in library users', () => {
  assert.equal(accountRedirect('login', true), '/designs');
  assert.equal(accountRedirect('designs', false), '/login');
  for (const page of ['landing', 'editor', 'embed', 'privacy', 'terms'] as const) {
    assert.equal(accountRedirect(page, false), null);
    assert.equal(accountRedirect(page, true), null);
  }
  assert.equal(accountRedirect('login', false), null);
  assert.equal(accountRedirect('designs', true), null);
});

test('embed links and iframe code contain only the public design identifier', () => {
  const source = new URL('https://space.example/editor?room=old&setup=1#edit=secret');
  assert.equal(embedAddress(source, 'room id'), 'https://space.example/embed?room=room+id');
  const html = embedCode(source, 'room id');
  assert.ok(html.includes('src="https://space.example/embed?room=room+id"'));
  assert.ok(html.includes('width="100%"'));
  assert.ok(html.includes('title="Visor 3D"'));
  assert.ok(html.includes('allowfullscreen'));
  assert.ok(!html.includes('secret') && !html.includes('setup'));
  assert.ok(!embedCode(source, '\"><script>').includes('<script>'));
});

test('new and shared editor addresses encode identifiers and exclude onboarding or hash state', () => {
  assert.equal(editorPath('room id', true), '/editor?room=room+id&setup=1');
  assert.equal(shareAddress(new URL('https://space.example/editor?room=old&setup=1#edit=secret'), 'room id'), 'https://space.example/editor?room=room+id');
});
