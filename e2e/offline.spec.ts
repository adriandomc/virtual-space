import { expect, test, type APIRequestContext, type Page, type Request } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createBlankProject } from '../src/onboardingModel';
import { addCustomFurniture } from '../src/model';
import { TERMS_VERSION } from '../src/legalPolicy';
import { projectToRoom, updateProjectRoom } from '../src/projectDocument';
import { addLevel } from '../src/projectOperations';
import { parseProjectBackup } from '../src/projectBackup';

const origin = 'http://127.0.0.1:5188';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64');
const jsonHeaders = { Origin: origin, 'Content-Type': 'application/json' };

function triangleModel() {
  const document = { asset: { version: '2.0' }, buffers: [{ byteLength: 36 }], bufferViews: [{ buffer: 0, byteLength: 36 }], accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{ name: 'Pieza de prueba', mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0 };
  const raw = Buffer.from(JSON.stringify(document)), json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(json);
  const bytes = Buffer.alloc(28 + json.length + 36);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8); bytes.writeUInt32LE(json.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); json.copy(bytes, 20); bytes.writeUInt32LE(36, 20 + json.length); bytes.writeUInt32LE(0x004e4942, 24 + json.length);
  [0, 0, 0, 1, 0, 0, 0, 1, 1].forEach((value, index) => bytes.writeFloatLE(value, 28 + json.length + index * 4));
  return bytes;
}
async function account(request: APIRequestContext) {
  const username = 'e2e_' + randomUUID().slice(0, 8);
  const response = await request.post('/api/auth/register', { headers: { ...jsonHeaders, 'X-Forwarded-For': '198.51.100.' + (test.info().workerIndex + 10) }, data: { username, password: 'E2e-password-4837', confirmPassword: 'E2e-password-4837', termsVersion: TERMS_VERSION } });
  expect(response.status(), await response.text()).toBe(201);
}
async function design(request: APIRequestContext, name: string, levelCount = 1) {
  const { setupStep: _step, ...empty } = createBlankProject();
  const id = randomUUID(); let project = { ...empty, id, name };
  while (project.levels.length < levelCount) project = addLevel(project, { copy: true, name: 'Planta ' + (project.levels.length + 1) });
  const response = await request.post('/api/rooms', { headers: jsonHeaders, data: { id, project } }); expect(response.status(), await response.text()).toBe(201);
  return { id, project };
}
async function uploadSketch(request: APIRequestContext, id: string, levelId: string) {
  const snapshot = await (await request.get('/api/rooms/' + id)).json();
  const response = await request.put('/api/rooms/' + id + '/levels/' + levelId + '/sketch', { headers: { Origin: origin, 'Content-Type': 'image/png', 'X-Room-Revision': String(snapshot.revision), 'X-Sketch-Version': String(snapshot.sketches[levelId].version), 'X-Sketch-Request-Id': randomUUID() }, data: png });
  expect(response.status(), await response.text()).toBe(200);
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Ajustes de la aplicación', exact: true }).click();
  const dialog = page.locator('dialog.offline-settings');
  await expect(dialog).toBeVisible();
  return dialog;
}
async function prepare(page: Page) {
  const dialog = await settings(page);
  await dialog.getByRole('button', { name: 'Preparar diseños', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Actualizar copia local', exact: true })).toBeEnabled({ timeout: 60000 });
  await expect(dialog.getByRole('switch', { name: 'Modo sin conexión' })).toBeEnabled();
  await dialog.getByRole('switch', { name: 'Modo sin conexión' }).click();
  await expect(dialog.getByRole('switch', { name: 'Modo sin conexión' })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('button', { name: 'Cerrar ajustes' }).click();
  await expect(page.getByText('Sin conexión · Diseños disponibles en este dispositivo', { exact: true })).toBeVisible();
}
async function createLocal(page: Page, name: string) {
  await page.getByRole('button', { name: 'Nuevo diseño', exact: true }).click();
  await expect(page.getByLabel('Nombre del diseño', { exact: true })).toBeEditable();
  await page.getByLabel('Nombre del diseño', { exact: true }).fill(name);
  await page.getByLabel('Nombre del diseño', { exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cubierta', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Omitir', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Colores', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Omitir', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Decoración', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Omitir', exact: true }).click();
  await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toHaveValue(name);
  return new URL(page.url()).searchParams.get('room')!;
}
async function savedLocally(page: Page) {
  await expect(page.locator('.saved-status')).toHaveAttribute('title', /Guardado en este dispositivo|Sin conexión/);
}

test('manifest, installation assets and mobile settings remain usable', async ({ page, context }, testInfo) => {
  const request = context.request;
  const response = await request.get('/manifest.webmanifest');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('application/manifest+json');
  const manifest = await response.json();
  expect(manifest).toMatchObject({ name: '3D Space', start_url: '/designs', display: 'standalone' });
  expect(manifest.icons.some((icon: { purpose: string }) => icon.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) expect((await request.get(icon.src)).status()).toBe(200);
  await account(request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/designs');
  await expect(page.getByRole('heading', { name: 'Mis diseños', exact: true })).toBeVisible();
  const dialog = await settings(page);
  await expect(dialog.getByRole('switch', { name: 'Modo sin conexión' })).toBeDisabled();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('settings-mobile.png') });
});

test('preparation includes unopened designs, croquis and models; forced mode sends no data', async ({ page, context }) => {
  const request = context.request;
  const streams = new Set<Request>();
  page.on('request', value => { if (value.url().endsWith('/api/notifications/events')) streams.add(value); });
  page.on('requestfinished', value => streams.delete(value)); page.on('requestfailed', value => streams.delete(value));
  await account(request);
  const first = await design(request, 'Con croquis y modelo'), second = await design(request, 'Sin abrir', 12);
  const uploaded = await request.post('/api/models?room=' + first.id, { headers: { Origin: origin, 'Content-Type': 'model/gltf-binary', 'X-Model-Name': encodeURIComponent('Pieza.glb') }, data: triangleModel() });
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  const { model } = await uploaded.json();
  expect((await request.put('/api/rooms/' + first.id, { headers: jsonHeaders, data: { project: updateProjectRoom(first.project, first.project.activeLevelId, addCustomFurniture(projectToRoom(first.project), model)), revision: 1, operationId: randomUUID() } })).status()).toBe(200);
  await uploadSketch(request, first.id, first.project.activeLevelId);
  for (const level of second.project.levels) await uploadSketch(request, second.id, level.id);
  await page.goto('/designs');
  await expect(page.getByRole('link', { name: /Sin abrir/ })).toBeVisible();
  await expect.poll(() => streams.size).toBe(1);
  await prepare(page);
  await expect.poll(() => streams.size).toBe(0);
  const requests: string[] = [], sockets: string[] = [];
  context.on('request', value => { if (new URL(value.url()).pathname.startsWith('/api/')) requests.push(value.url()); });
  const observeSockets = (value: Page) => value.on('websocket', socket => sockets.push(socket.url()));
  observeSockets(page); context.on('page', observeSockets);
  await page.getByRole('link', { name: /Con croquis y modelo/ }).click();
  await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toHaveValue(first.project.name);
  await page.getByRole('tab', { name: 'Planta', exact: true }).click();
  await expect(page.locator('.plan-editor image')).toHaveAttribute('href', /^blob:/);
  await context.setOffline(true);
  const previous = page; page = await context.newPage(); await previous.close();
  await page.goto('/editor?room=' + first.id);
  await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toBeEditable();
  await page.getByRole('tab', { name: 'Planta', exact: true }).click();
  await expect(page.locator('.plan-editor image')).toHaveAttribute('href', /^blob:/);
  const download = page.waitForEvent('download');
  await page.locator('.file-menu summary').click();
  await page.getByRole('button', { name: 'Descargar copia', exact: true }).click();
  const stream = await (await download).createReadStream(), chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk);
  const backup = await parseProjectBackup(new Blob([new Uint8Array(Buffer.concat(chunks))]));
  expect(backup.project.version).toBe(3); expect(backup.assets).toHaveLength(1);
  expect(backup.sketches).toHaveLength(1); expect(Buffer.from(await backup.sketches[0].blob.arrayBuffer())).toEqual(png);
  await page.getByRole('button', { name: 'Mis diseños', exact: true }).click();
  await page.getByRole('link', { name: /Sin abrir/ }).click();
  await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toHaveValue(second.project.name);
  await expect(page.getByRole('combobox', { name: 'Nivel activo', exact: true }).locator('option')).toHaveCount(12);
  await page.getByRole('tab', { name: 'Planta', exact: true }).click();
  for (const level of [second.project.levels[0], second.project.levels[11]]) {
    await page.getByRole('combobox', { name: 'Nivel activo', exact: true }).selectOption(level.id);
    await expect(page.locator('.plan-editor image')).toHaveAttribute('href', /^blob:/);
  }
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toBeEditable();
  // Cross the normal 15-second retry interval with internet restored and forced mode still active.
  await page.waitForTimeout(16000);
  expect(requests).toEqual([]); expect(sockets).toEqual([]);
});

test('new local designs and an edited GLB survive cold offline reload and all synchronize on exit', async ({ page, context }) => {
  const request = context.request;
  await account(request);
  await page.goto('/designs'); await prepare(page);
  const first = await createLocal(page, 'Mesa creada sin red');
  await page.getByRole('button', { name: 'Agregar elemento', exact: true }).click();
  await page.getByRole('button', { name: 'Crear elemento', exact: true }).click();
  const workshop = page.getByRole('dialog', { name: 'Crear modelo', exact: true });
  await workshop.getByRole('button', { name: 'Formas', exact: true }).click();
  await expect(workshop.getByRole('button', { name: 'Agregar Cubo', exact: true })).toBeEnabled({ timeout: 30000 });
  await workshop.getByRole('button', { name: 'Agregar Cubo', exact: true }).click();
  await workshop.getByLabel('Nombre del modelo', { exact: true }).fill('Cubo sin conexión');
  await workshop.getByLabel('Nombre del modelo', { exact: true }).press('Tab');
  await workshop.getByRole('button', { name: 'Guardar modelo', exact: true }).click();
  await expect(workshop).not.toBeVisible(); await savedLocally(page);
  await page.getByRole('button', { name: 'Mis diseños', exact: true }).click();
  const second = await createLocal(page, 'Segundo diseño local');
  await savedLocally(page);
  await context.setOffline(true); await page.reload();
  await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toHaveValue('Segundo diseño local');
  await page.getByRole('button', { name: 'Mis diseños', exact: true }).click();
  await page.getByRole('link', { name: /Mesa creada sin red/ }).click();
  await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toHaveValue('Mesa creada sin red');
  await page.getByRole('button', { name: 'Agregar elemento', exact: true }).click();
  await page.getByRole('button', { name: 'Modelos propios', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Añadir Cubo sin conexión', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar agregar', exact: true }).click();
  await page.getByRole('button', { name: 'Mis diseños', exact: true }).click();
  await context.setOffline(false);
  const dialog = await settings(page);
  await dialog.getByRole('switch', { name: 'Modo sin conexión' }).click();
  await expect.poll(async () => (await (await request.get('/api/rooms')).json()).rooms.map((room: { id: string }) => room.id), { timeout: 30000 }).toEqual(expect.arrayContaining([first, second]));
  await expect.poll(async () => (await (await request.get('/api/rooms/' + first)).json()).project.levels.flatMap((level: { furniture: unknown[] }) => level.furniture).length, { timeout: 30000 }).toBe(1);
  const models = await (await request.get('/api/models?room=' + first)).json();
  expect(models.models).toHaveLength(1); expect(models.models[0].name).toBe('Cubo sin conexión');
  await expect.poll(async () => (await (await request.get('/api/rooms/' + second)).json()).project.setupStep).toBeUndefined();
});

test('shared designs make independent private copies and pending local changes block logout', async ({ page, context }) => {
  const request = context.request;
  await account(request);
  const original = await design(request, 'Diseño compartido');
  expect((await request.post('/api/rooms/' + original.id + '/share', { headers: jsonHeaders, data: { enabled: true } })).status()).toBe(200);
  await page.goto('/designs');
  await page.getByRole('button', { name: 'Crear copia personal de Diseño compartido', exact: true }).click();
  await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toHaveValue('Diseño compartido (copia)');
  const copy = new URL(page.url()).searchParams.get('room')!;
  expect(copy).not.toBe(original.id);
  await expect(page.locator('.saved-status')).toHaveAttribute('title', 'Guardado');
  await page.getByRole('button', { name: 'Mis diseños', exact: true }).click();
  await prepare(page);
  await createLocal(page, 'Con pendientes');
  await page.getByRole('button', { name: 'Mis diseños', exact: true }).click();
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(/sin conexión|pendientes/);
  await expect(page.getByRole('link', { name: /Con pendientes/ })).toBeVisible();
  const remote = await (await request.get('/api/rooms/' + original.id)).json();
  expect(remote.shared).toBe(true); expect(remote.project).toEqual(original.project);
});

test('preparing from the plan editor saves the design and continues in the library', async ({ page, context }) => {
  const request = context.request;
  await account(request);
  const initial = await design(request, 'Croquis por preparar');
  await page.goto('/editor?room=' + initial.id);
  await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toBeEditable();
  await page.getByRole('tab', { name: 'Planta', exact: true }).click();
  await page.getByLabel('Nombre del proyecto', { exact: true }).fill('Croquis actualizado');
  await page.getByLabel('Nombre del proyecto', { exact: true }).press('Tab');
  await expect(page.locator('.saved-status')).toHaveAttribute('title', 'Guardado');
  let dialog = await settings(page);
  await dialog.getByRole('button', { name: 'Preparar diseños', exact: true }).click();
  await expect(page).toHaveURL(/\/designs(?:\?|$)/);
  dialog = page.locator('dialog.offline-settings');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Actualizar copia local', exact: true })).toBeEnabled({ timeout: 60000 });
  await dialog.getByRole('switch', { name: 'Modo sin conexión' }).click();
  await expect(dialog.getByRole('switch', { name: 'Modo sin conexión' })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('button', { name: 'Cerrar ajustes' }).click();
  await context.setOffline(true);
  await page.getByRole('link', { name: /Croquis actualizado/ }).click();
  await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toHaveValue('Croquis actualizado');
  expect((await (await request.get('/api/rooms/' + initial.id)).json()).project.name).toBe('Croquis actualizado');
});
