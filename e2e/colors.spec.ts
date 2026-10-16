import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDefaultProject, type ProjectDocument } from '../src/projectDocument';
import { deleteWall } from '../src/projectOperations';
import { TERMS_VERSION } from '../src/legalPolicy';

const headers = { Origin: 'http://127.0.0.1:5188', 'Content-Type': 'application/json' };
async function sample(request: APIRequestContext, setup = false, shared = false) {
  const suffix = randomUUID().slice(0, 8), ip = `198.18.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}`;
  const registration = await request.post('/api/auth/register', { headers: { ...headers, 'X-Forwarded-For': ip }, data: { username: 'colors_' + suffix, password: 'Test-colors-5913', confirmPassword: 'Test-colors-5913', termsVersion: TERMS_VERSION } });
  expect(registration.status(), await registration.text()).toBe(201);
  const project = createDefaultProject('Color test'); if (setup) project.setupStep = 2;
  const response = await request.post('/api/rooms', { headers, data: { id: project.id, project } }); expect(response.status(), await response.text()).toBe(201);
  if (shared) expect((await request.post(`/api/rooms/${project.id}/share`, { headers, data: { enabled: true } })).status()).toBe(200);
  return project;
}
async function open(page: Page, project: ProjectDocument) { await page.goto('/editor?room=' + project.id); await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toBeEditable(); await page.getByRole('button', { name: 'Materiales', exact: true }).click(); }
async function saved(request: APIRequestContext, id: string) { const response = await request.get('/api/rooms/' + id); expect(response.status()).toBe(200); return await response.json() as { project: ProjectDocument; revision: number }; }

test('color previews stay transient; Cancel restores the previous swatch and Apply saves once', async ({ page, context }) => {
  const project = await sample(context.request); await open(page, project);
  let writes = 0; page.on('request', request => { if (request.method() === 'PUT' && request.url().endsWith('/api/rooms/' + project.id)) writes++; });
  const trigger = page.getByRole('button', { name: 'Color', exact: true }); await trigger.click();
  const picker = page.getByRole('dialog', { name: 'Color', exact: true });
  await picker.getByLabel('Código hexadecimal', { exact: true }).fill('#123456');
  await expect(picker.getByRole('button', { name: 'Anterior', exact: true })).toBeVisible();
  expect((await saved(context.request, project.id)).project.levels[0].walls[0].left.color).toBe('#ffffff'); expect(writes).toBe(0);
  await picker.getByRole('button', { name: 'Cancelar', exact: true }).click(); await expect(picker).toHaveCount(0); await expect(trigger).toContainText('#FFFFFF');
  await trigger.click(); await picker.getByLabel('Código hexadecimal', { exact: true }).fill('#123456'); await picker.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect.poll(async () => (await saved(context.request, project.id)).project.levels[0].walls[0].left.color).toBe('#123456'); expect(writes).toBe(1);
  await trigger.click(); await picker.getByRole('slider', { name: 'Tono', exact: true }).press('Home'); await picker.getByRole('slider', { name: 'Tono', exact: true }).press('ArrowRight'); await page.keyboard.press('Escape'); await expect(picker).toHaveCount(0); await expect(trigger).toBeFocused(); expect(writes).toBe(1);
});

test('mobile color sheet fits the viewport and incomplete HEX or RGB cannot be applied', async ({ page, context }) => {
  const project = await sample(context.request); await page.setViewportSize({ width: 390, height: 844 }); await open(page, project); await page.getByRole('button', { name: 'Color', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Color', exact: true }), box = (await picker.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390); expect(box.y + box.height).toBeLessThanOrEqual(844); expect(box.height).toBeLessThanOrEqual(633);
  const apply = picker.getByRole('button', { name: 'Aplicar', exact: true }); await picker.getByLabel('Código hexadecimal', { exact: true }).fill(''); await expect(apply).toBeDisabled();
  await picker.getByLabel('Código hexadecimal', { exact: true }).fill('#12'); await expect(apply).toBeDisabled();
  await picker.getByLabel('Código hexadecimal', { exact: true }).fill('#abcdef'); await picker.getByLabel('Canal R', { exact: true }).fill(''); await expect(apply).toBeDisabled();
  await picker.getByLabel('Canal R', { exact: true }).fill('999'); await expect(apply).toBeDisabled();
  await picker.getByLabel('Canal R', { exact: true }).fill('255'); await apply.click();
  await expect.poll(async () => (await saved(context.request, project.id)).project.levels[0].walls[0].left.color).toBe('#ffcdef');
  await page.getByRole('button', { name: 'Color', exact: true }).click(); await picker.getByLabel('Código hexadecimal', { exact: true }).fill('#001122');
  await page.mouse.click(15, 200); await expect(picker).toHaveCount(0); expect((await saved(context.request, project.id)).project.levels[0].walls[0].left.color).toBe('#ffcdef');
});

test('onboarding color applies explicitly and Skip preserves it', async ({ page, context }) => {
  const project = await sample(context.request, true); await page.goto('/editor?room=' + project.id + '&setup=1'); await expect(page.getByRole('heading', { name: 'Colores', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Color', exact: true }).click(); const picker = page.getByRole('dialog', { name: 'Color', exact: true });
  await picker.getByLabel('Código hexadecimal', { exact: true }).fill('abc'); await picker.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await page.getByRole('button', { name: 'Omitir', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Decoración', exact: true })).toBeVisible();
  await expect.poll(async () => (await saved(context.request, project.id)).project.levels[0].walls.map(wall => wall.left.color)).toEqual(['#aabbcc', '#aabbcc', '#aabbcc', '#aabbcc']);
});

test('remote deletion cancels an open color preview and cannot paint another wall', async ({ page, context }) => {
  const project = await sample(context.request, false, true); await open(page, project); await page.getByLabel('Superficie a pintar', { exact: true }).selectOption('3');
  await page.getByRole('button', { name: 'Color', exact: true }).click(); const picker = page.getByRole('dialog', { name: 'Color', exact: true }); await picker.getByLabel('Código hexadecimal', { exact: true }).fill('#aabbcc');
  const base = await saved(context.request, project.id), next = deleteWall(base.project, project.levels[0].id, project.levels[0].walls[3].id);
  expect((await context.request.put('/api/rooms/' + project.id, { headers, data: { project: next, revision: base.revision, operationId: randomUUID() } })).status()).toBe(200);
  await expect(picker).toHaveCount(0); expect((await saved(context.request, project.id)).project.levels[0].walls[0].left.color).toBe('#ffffff');
});

test('closing the workshop keeps unsaved pieces until discard is confirmed', async ({ page, context }) => {
  const project = await sample(context.request); await page.goto('/editor?room=' + project.id); await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toBeEditable();
  await page.getByRole('button', { name: 'Agregar elemento', exact: true }).click(); await page.getByRole('button', { name: 'Crear elemento', exact: true }).click();
  const workshop = page.getByRole('dialog', { name: 'Crear modelo', exact: true }); await workshop.getByRole('button', { name: 'Formas', exact: true }).click(); await expect(workshop.getByRole('button', { name: 'Agregar Cubo', exact: true })).toBeEnabled({ timeout: 30000 }); await workshop.getByRole('button', { name: 'Agregar Cubo', exact: true }).click();
  await workshop.getByRole('button', { name: 'Cerrar editor de modelo', exact: true }).click(); await expect(workshop.getByRole('alert')).toContainText('¿Descartar los cambios del modelo?');
  await workshop.getByRole('button', { name: 'Seguir editando', exact: true }).click(); await expect(workshop.getByRole('button', { name: 'Guardar modelo', exact: true })).toBeEnabled();
  await page.keyboard.press('Escape'); await expect(workshop.getByRole('alert')).toContainText('¿Descartar los cambios del modelo?'); await workshop.getByRole('button', { name: 'Descartar cambios', exact: true }).click(); await expect(workshop).toHaveCount(0);
});
