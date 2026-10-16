import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createBlankProject } from '../src/onboardingModel';
import { TERMS_VERSION } from '../src/legalPolicy';
import { pwaDeployment } from './fixtures/pwaDeployment';

const headers = { Origin: 'http://127.0.0.1:5188', 'Content-Type': 'application/json' };
async function sample(request: APIRequestContext) {
  const username = 'update_' + randomUUID().slice(0, 8), password = 'Update-test-4837';
  const account = await request.post('/api/auth/register', { headers: { ...headers, 'X-Forwarded-For': '198.51.100.' + (test.info().workerIndex + 70) }, data: { username, password, confirmPassword: password, termsVersion: TERMS_VERSION } });
  expect(account.status(), await account.text()).toBe(201);
  const project = createBlankProject('Diseño conservado');
  const created = await request.post('/api/rooms', { headers, data: { id: project.id, project } });
  expect(created.status(), await created.text()).toBe(201); return project;
}
const build = (page: Page) => page.locator('meta[name="pwa-test-build"]');
const notice = (page: Page) => page.locator('.app-update-notice');
async function oldApplication(page: Page, origin: string) {
  await page.goto(origin + '/designs');
  await expect(page.getByRole('heading', { name: 'Mis diseños', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 60000 }).toBe(true);
  await expect(build(page)).toHaveAttribute('content', 'old');
}
async function settings(page: Page) {
  await page.getByRole('button', { name: 'Ajustes de la aplicación', exact: true }).click();
  const dialog = page.locator('dialog.offline-settings'); await expect(dialog).toBeVisible(); return dialog;
}
async function prepareDesigns(page: Page) {
  const dialog = await settings(page);
  await dialog.getByRole('button', { name: 'Preparar diseños', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Actualizar copia local', exact: true })).toBeEnabled({ timeout: 60000 });
  await dialog.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
}
async function helpScreenshots(page: Page) {
  if (process.env.PWA_HELP_SCREENSHOTS !== '1' || test.info().project.name !== 'chromium') return;
  await page.setViewportSize({ width: 1280, height: 800 });
  const dialog = await settings(page);
  await dialog.getByRole('combobox', { name: 'Idioma', exact: true }).selectOption('en');
  await dialog.getByRole('button', { name: 'Update application', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: fileURLToPath(new URL('../public/help/en/offline.jpg', import.meta.url)), type: 'jpeg', quality: 90 });
  await dialog.getByRole('combobox', { name: 'Language', exact: true }).selectOption('es');
  await dialog.getByRole('button', { name: 'Actualizar aplicación', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: fileURLToPath(new URL('../public/help/es/offline.jpg', import.meta.url)), type: 'jpeg', quality: 90 });
  await dialog.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
}
async function mobileNotice(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await notice(page).boundingBox(); expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  for (const button of await notice(page).getByRole('button').all()) {
    const target = await button.boundingBox(); expect(target).not.toBeNull();
    expect(target!.width).toBeGreaterThanOrEqual(44); expect(target!.height).toBeGreaterThanOrEqual(44);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

test('an update preserves unfinished drawing, then survives reload and subsequent full navigation', async ({ page, context }) => {
  const deployment = await pwaDeployment();
  try {
    const project = await sample(context.request); await oldApplication(page, deployment.origin); await prepareDesigns(page);
    deployment.deploy();
    await page.getByRole('link', { name: /Diseño conservado.*Continuar preparación/ }).click();
    await expect(page.getByLabel('Nombre del diseño', { exact: true })).toHaveValue(project.name);
    await expect(notice(page)).toContainText('Actualización disponible', { timeout: 60000 });
    await expect(build(page)).toHaveAttribute('content', 'old');
    await mobileNotice(page);
    await helpScreenshots(page);

    await page.getByRole('button', { name: 'Pared', exact: true }).click();
    const canvas = page.locator('.plan-canvas>svg'), box = await canvas.boundingBox(); expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width * .42, box!.y + box!.height * .42);
    const trace = canvas.locator('polyline[stroke="#315e44"]'); await expect(trace).toHaveCount(1);
    const points = await trace.getAttribute('points'); expect(points).toBeTruthy();
    await notice(page).getByRole('button', { name: 'Actualizar ahora', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(/Termina|trazado|borrador|Guarda los cambios/);
    await expect(trace).toHaveAttribute('points', points!); await expect(build(page)).toHaveAttribute('content', 'old');
    expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);

    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await notice(page).getByRole('button', { name: 'Actualizar ahora', exact: true }).click();
    await expect(build(page)).toHaveAttribute('content', 'new', { timeout: 60000 });
    await expect(page.getByLabel('Nombre del diseño', { exact: true })).toHaveValue(project.name);
    await expect(notice(page)).toHaveCount(0);
    expect(await page.evaluate(() => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).type)).toBe('reload');

    // These controls call window.location.assign rather than changing React state in the current document.
    await page.getByRole('button', { name: 'Mis diseños', exact: true }).click();
    await expect(page).toHaveURL(deployment.origin + '/designs'); await expect(build(page)).toHaveAttribute('content', 'new');
    expect(await page.evaluate(() => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).type)).toBe('navigate');
    await page.getByRole('link', { name: /Diseño conservado.*Continuar preparación/ }).click();
    await expect(page.getByLabel('Nombre del diseño', { exact: true })).toHaveValue(project.name);
    await expect(build(page)).toHaveAttribute('content', 'new');
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting === null)).toBe(true);
  } finally { await page.close(); await deployment.close(); }
});

test('a missing old application module can be recovered through the update notice', async ({ page, context }) => {
  const deployment = await pwaDeployment({ brokenSetup: true });
  try {
    const project = await sample(context.request); await oldApplication(page, deployment.origin);
    deployment.deploy();
    await page.getByRole('link', { name: /Diseño conservado.*Continuar preparación/ }).click();
    await expect(page.getByText('No se pudo abrir esta vista.', { exact: true })).toBeVisible();
    await expect(notice(page)).toContainText('Actualización disponible', { timeout: 60000 });
    await expect(build(page)).toHaveAttribute('content', 'old');
    await notice(page).getByRole('button', { name: 'Actualizar ahora', exact: true }).click();
    await expect(build(page)).toHaveAttribute('content', 'new', { timeout: 60000 });
    await expect(page.getByLabel('Nombre del diseño', { exact: true })).toHaveValue(project.name);
    await expect(page.getByText('No se pudo abrir esta vista.', { exact: true })).toHaveCount(0);
    await expect(notice(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Mis diseños', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Mis diseños', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Diseño conservado.*Continuar preparación/ })).toBeVisible();
    await expect(build(page)).toHaveAttribute('content', 'new');
  } finally { await page.close(); await deployment.close(); }
});

test('forced offline mode hides a pending update and does not check workers or request account data', async ({ page, context }) => {
  const deployment = await pwaDeployment();
  try {
    await sample(context.request); await oldApplication(page, deployment.origin);
    deployment.deploy(); await page.reload();
    await expect(notice(page)).toContainText('Actualización disponible', { timeout: 60000 });
    const dialog = await settings(page);
    await dialog.getByRole('button', { name: 'Preparar diseños', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Actualizar copia local', exact: true })).toBeEnabled({ timeout: 60000 });
    await dialog.getByRole('switch', { name: 'Modo sin conexión', exact: true }).click();
    await expect(dialog.getByRole('switch', { name: 'Modo sin conexión', exact: true })).toHaveAttribute('aria-checked', 'true');
    await dialog.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
    await expect(page.getByText('Sin conexión · Diseños disponibles en este dispositivo', { exact: true })).toBeVisible();
    await expect(notice(page)).toHaveCount(0);
    const start = deployment.requests.length;
    const other = await context.newPage(); await other.goto('about:blank'); await page.bringToFront(); await other.close();
    const offlineSettings = await settings(page);
    await expect(offlineSettings.getByRole('button', { name: 'Actualizar aplicación', exact: true })).toBeDisabled();
    await offlineSettings.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
    await page.waitForTimeout(1000);
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    expect(deployment.requests.slice(start).filter(request => request.path.startsWith('/api/') || request.path === '/service-worker.js')).toEqual([]);
    await expect(build(page)).toHaveAttribute('content', 'old');
  } finally { await page.close(); await deployment.close(); }
});
