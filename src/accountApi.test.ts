import assert from 'node:assert/strict';
import test from 'node:test';
import { accountRequest, AccountRequestError, isNetworkError } from './accountApi';

test('account requests preserve cookie credentials and actionable server errors', async context => {
  const body = JSON.stringify({ username: 'ana', password: 'abcdefgh' });
  context.mock.method(globalThis, 'fetch', async (path: string, options: RequestInit) => {
    assert.equal(path, '/api/auth/login'); assert.equal(options.credentials, 'same-origin');
    assert.equal(options.method, 'POST'); assert.equal(options.body, body); assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ user: { id: 'id', username: 'ana' } });
  });
  assert.deepEqual(await accountRequest('/api/auth/login', { method: 'POST', body }), { user: { id: 'id', username: 'ana' } });
  context.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Espera antes de volver a intentar.' }, { status: 429 }));
  await assert.rejects(accountRequest('/api/auth/login'), /Espera antes de volver a intentar\./);
});

test('account requests preserve retry messages for disconnected, invalid and empty error responses', async context => {
  context.mock.method(globalThis, 'fetch', async () => { throw new TypeError('failed fetch'); });
  await assert.rejects(accountRequest('/api/auth/session'), /No se pudo conectar/);
  context.mock.method(globalThis, 'fetch', async () => new Response('<html>Unavailable</html>', { status: 502 }));
  await assert.rejects(accountRequest('/api/auth/session'), /No se pudo leer/);
  context.mock.method(globalThis, 'fetch', async () => Response.json(null, { status: 403 }));
  await assert.rejects(accountRequest('/api/rooms'), /No se pudo completar/);
});

test('transport failures are distinct from authoritative HTTP rejection and invalid responses', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError('Offline'); };
    await assert.rejects(accountRequest('/api/test'), isNetworkError);
    for (const status of [401, 403, 404, 429]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Rechazado' }), { status });
      await assert.rejects(accountRequest('/api/test'), cause => cause instanceof AccountRequestError && cause.status === status && !isNetworkError(cause));
    }
    for (const status of [408, 502, 503, 504]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Temporalmente no disponible' }), { status });
      await assert.rejects(accountRequest('/api/test'), cause => cause instanceof AccountRequestError && cause.status === status && isNetworkError(cause));
    }
    globalThis.fetch = async () => new Response('Not JSON', { status: 502 });
    await assert.rejects(accountRequest('/api/test'), cause => cause instanceof AccountRequestError && cause.status === 502 && isNetworkError(cause));
    for (const status of [200, 403]) {
      const response = new Response('{}', { status }); response.json = async () => { throw new TypeError('Body connection closed'); };
      globalThis.fetch = async () => response;
      await assert.rejects(accountRequest('/api/test'), cause => cause instanceof AccountRequestError && (status === 200 ? isNetworkError(cause) : cause.status === 403 && !isNetworkError(cause)));
    }
  } finally { globalThis.fetch = original; }
});
