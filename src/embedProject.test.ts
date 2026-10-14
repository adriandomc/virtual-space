import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchPublicDesign } from './embedProject';
import { createDefaultRoom } from './model';

const id = 'd4962b5b-0980-424a-85fd-235d837278bc';
test('embedded views omit session credentials and only accept public read-only snapshots', async t => {
  const requests: { path: string; options?: RequestInit }[] = [];
  let data = { room: createDefaultRoom(), revision: 1, role: 'public', shared: true, canEdit: false };
  t.mock.method(globalThis, 'fetch', async (path: string, options?: RequestInit) => { requests.push({ path, options }); return Response.json(data); });
  const controller = new AbortController();
  const result = await fetchPublicDesign(id, controller.signal);
  assert.equal(result.room.name, data.room.name);
  assert.equal(requests[0].path, '/api/rooms/' + id + '?public=1');
  assert.equal(requests[0].options?.credentials, 'omit');
  assert.equal(requests[0].options?.cache, 'no-store');
  assert.equal(requests[0].options?.signal, controller.signal);
  data = { ...data, role: 'owner' };
  await assert.rejects(fetchPublicDesign(id, controller.signal), /no está disponible/);
  data = { ...data, role: 'public', shared: false };
  await assert.rejects(fetchPublicDesign(id, controller.signal), /no está disponible/);
  data = { ...data, shared: true, canEdit: true };
  await assert.rejects(fetchPublicDesign(id, controller.signal), /no está disponible/);
  const count = requests.length;
  await assert.rejects(fetchPublicDesign('invalid', controller.signal), /no está disponible/);
  assert.equal(requests.length, count);
});

test('revoked or missing public designs return an unavailable message without accepting a snapshot', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 404 }));
  await assert.rejects(fetchPublicDesign(id, new AbortController().signal), /no está disponible/);
});
