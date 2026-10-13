import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountRequest } from './accountApi';

test('account requests preserve cookie credentials and actionable server errors', async context => {
  const body = JSON.stringify({ username: 'ana', password: 'abcdefgh' });
  context.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    assert.equal(path, '/api/auth/login');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.method, 'POST');
    assert.equal(options.body, body);
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ user: { id: 'id', username: 'ana' } });
  });
  assert.deepEqual(await accountRequest('/api/auth/login', { method: 'POST', body }), { user: { id: 'id', username: 'ana' } });
  context.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Espera antes de volver a intentar.' }, { status: 429 }));
  await assert.rejects(accountRequest('/api/auth/login'), /Espera antes de volver a intentar\./);
});

test('account requests turn disconnected or invalid responses into a retry message', async context => {
  context.mock.method(globalThis, 'fetch', async () => { throw new TypeError('failed fetch'); });
  await assert.rejects(accountRequest('/api/auth/session'), /No se pudo conectar/);
  context.mock.method(globalThis, 'fetch', async () => new Response('<html>Unavailable</html>', { status: 502 }));
  await assert.rejects(accountRequest('/api/auth/session'), /No se pudo conectar/);
  context.mock.method(globalThis, 'fetch', async () => Response.json(null, { status: 403 }));
  await assert.rejects(accountRequest('/api/rooms'), /No se pudo completar/);
});
