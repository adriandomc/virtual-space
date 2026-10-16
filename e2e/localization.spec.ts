import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { TERMS_VERSION } from '../src/domain/policies/legalPolicy';

const origin = 'http://127.0.0.1:5188';

async function createAccount(request: APIRequestContext) {
  const username = 'locale_' + randomUUID().slice(0, 8);
  const response = await request.post('/api/auth/register', {
    headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-For': '198.51.101.' + (50 + test.info().workerIndex) },
    data: { username, password: 'Locale-password-4837', confirmPassword: 'Locale-password-4837', termsVersion: TERMS_VERSION },
  });
  expect(response.status(), await response.text()).toBe(201);
  return username;
}

async function settings(page: Page, locale: 'es' | 'en') {
  await page.getByRole('button', { name: locale === 'es' ? 'Ajustes de la aplicación' : 'Application settings', exact: true }).click();
  const dialog = page.locator('dialog.offline-settings');
  await expect(dialog).toBeVisible();
  return dialog;
}

async function screenshots(page: Page, locale: 'es' | 'en') {
  const images = page.locator('.help-content img');
  await expect(images).toHaveCount(6);
  for (const image of await images.all()) {
    await expect(image).toHaveAttribute('src', new RegExp('^/help/' + locale + '/(?:library|setup|editor|workshop|offline|sharing)\\.jpg$'));
    await expect(image).not.toHaveAttribute('alt', '');
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0)).toBe(true);
  }
}

test('landing language changes labels and survives navigation and reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Diseña tu espacio en 3D. ¡Totalmente gratis!');
  await page.getByRole('combobox', { name: 'Idioma', exact: true }).selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Design your space in 3D. Completely free!');
  await expect(page.getByRole('button', { name: 'Next demo', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Privacy notice', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveValue('en');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Design your space in 3D. Completely free!');
  await page.getByRole('link', { name: /Sign in or create.*account/, exact: false }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Language', exact: true })).toHaveValue('en');
});

test('English account forms expose translated validation and password visibility', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('combobox', { name: 'Idioma', exact: true }).selectOption('en');
  await page.locator('.auth-tabs').getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill('Locale_Account');
  await expect(page.getByLabel('Username', { exact: true })).toHaveValue('locale_account');
  const password = page.getByLabel('Password', { exact: true });
  const confirm = page.getByLabel('Confirm password', { exact: true });
  await expect(password).toHaveAttribute('minlength', '8');
  await password.fill('Locale-password-4837');
  await confirm.fill('Different-password-4837');
  await expect(password).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Show password', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(page.getByText('Note: remember your password. There is no way to recover it.', { exact: true })).toBeVisible();
  await page.getByRole('checkbox', { name: /I accept the terms of use/ }).check();
  await page.locator('form').getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText(/(?:The )?[Pp]asswords do not match\./);
  await expect(confirm).toHaveValue('Different-password-4837');
  await page.locator('.auth-tabs').getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('Confirm password', { exact: true })).toHaveCount(0);
  await expect(page.locator('form').getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Privacy notice', exact: true })).toHaveCount(0);
});

test('mobile settings and Information lead to an English setup, editor and model workshop', async ({ page, context }, testInfo) => {
  const username = await createAccount(context.request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/designs');
  await expect(page.getByText(username, { exact: true })).toBeVisible();
  let dialog = await settings(page, 'es');
  await dialog.getByRole('combobox', { name: 'Idioma', exact: true }).selectOption('en');
  await expect(dialog.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect(dialog.getByRole('switch', { name: 'Offline mode', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'My designs', exact: true })).toBeVisible();
  const settingsBox = await page.getByRole('button', { name: 'Application settings', exact: true }).boundingBox();
  const infoButton = page.getByRole('button', { name: 'Information', exact: true });
  const infoBox = await infoButton.boundingBox();
  expect(settingsBox).not.toBeNull(); expect(infoBox).not.toBeNull();
  expect(infoBox!.x).toBeGreaterThanOrEqual(settingsBox!.x + settingsBox!.width - 1);
  expect(Math.abs(infoBox!.y - settingsBox!.y)).toBeLessThan(2);
  await expect(page.getByRole('link', { name: 'Privacy notice', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Terms of use', exact: true })).toHaveCount(0);
  await infoButton.click();
  const information = page.getByRole('navigation', { name: 'Information', exact: true });
  await expect(information.getByRole('link', { name: 'Help and getting started', exact: true })).toBeVisible();
  await expect(information.getByRole('link', { name: 'Privacy notice', exact: true })).toBeVisible();
  await expect(information.getByRole('link', { name: 'Terms of use', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(information).toHaveCount(0);
  await expect(infoButton).toBeFocused();
  await page.getByRole('button', { name: 'New design', exact: true }).click();
  await expect(page.getByRole('list', { name: 'New design steps', exact: true }).getByRole('listitem').filter({ hasText: 'Sketch' })).toHaveAttribute('aria-current', 'step');
  await page.getByLabel('Design name', { exact: true }).fill('My unchanged project name');
  await page.getByLabel('Design name', { exact: true }).press('Tab');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByRole('list', { name: 'New design steps', exact: true }).getByRole('listitem').filter({ hasText: 'Roof' })).toHaveAttribute('aria-current', 'step');
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.getByRole('list', { name: 'New design steps', exact: true }).getByRole('listitem').filter({ hasText: 'Colors' })).toHaveAttribute('aria-current', 'step');
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.getByRole('list', { name: 'New design steps', exact: true }).getByRole('listitem').filter({ hasText: 'Furniture' })).toHaveAttribute('aria-current', 'step');
  await page.getByRole('button', { name: 'Remove Main light', exact: true }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  // Windows WebKit can block its first WebGL frame while compiling shaders; keep other checks at their normal timeout.
  const firstEditorTimeout = testInfo.project.name === 'webkit' ? 45000 : 15000;
  await expect(page.getByLabel('Project name', { exact: true })).toHaveValue('My unchanged project name', { timeout: firstEditorTimeout });
  await expect.poll(async () => {
    const raw = await page.locator('.room-scene canvas').getAttribute('data-scene-metrics');
    return raw ? JSON.parse(raw).drawCalls : 0;
  }, { timeout: firstEditorTimeout }).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Items', exact: true }).click();
  await expect(page.locator('.tree-item').filter({ hasText: 'Main light' })).toHaveCount(0);
  await expect(page.locator('.tree-item').filter({ hasText: 'Luz principal' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close items', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Walk through', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add item', exact: true }).click();
  await page.getByRole('button', { name: 'Create item', exact: true }).click();
  const workshop = page.getByRole('dialog', { name: 'Create model', exact: true });
  await expect(workshop).toBeVisible();
  await workshop.getByRole('button', { name: 'Shapes', exact: true }).click();
  const cube = workshop.getByRole('button', { name: 'Add Cube', exact: true });
  await expect(cube).toBeEnabled({ timeout: 30000 });
  await cube.click();
  await expect(workshop.getByLabel('Model name', { exact: true })).toBeEditable();
  await expect(workshop.getByRole('checkbox', { name: 'Select multiple', exact: true })).toBeVisible();
  await expect(workshop.getByRole('button', { name: 'Snap', exact: true })).toBeVisible();
  await expect(workshop.getByRole('button', { name: 'Save model', exact: true })).toBeEnabled();
  await workshop.getByRole('button', { name: 'Close model editor', exact: true }).click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  dialog = await settings(page, 'en');
  await expect(dialog.getByRole('combobox', { name: 'Language', exact: true })).toHaveValue('en');
  await dialog.getByRole('combobox', { name: 'Language', exact: true }).selectOption('es');
  await dialog.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
  await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toHaveValue('My unchanged project name');
});

test('illustrated help translates search and screenshots and opens offline in both languages', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/help');
  await expect(page.getByRole('heading', { name: 'Ayuda y guía de inicio', exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar en la ayuda', exact: true }).fill('sin conexion');
  await expect(page.getByRole('heading', { name: 'Preparar y usar sin conexión', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tu primer diseño', exact: true })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Buscar en la ayuda', exact: true }).clear();
  await screenshots(page, 'es');
  await page.getByRole('combobox', { name: 'Idioma', exact: true }).selectOption('en');
  await expect(page.getByRole('heading', { name: 'Help and getting started', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your first design', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Tu primer diseño', exact: true })).toHaveCount(0);
  const search = page.getByRole('searchbox', { name: 'Search help', exact: true });
  await search.fill('not-a-help-topic-58921');
  await expect(page.locator('.help-no-results')).toHaveText('No topics found. Try another word.');
  await expect(page.locator('.help-section')).toHaveCount(0);
  await search.fill('OFFLINE');
  await expect(page.getByRole('heading', { name: 'Prepare and work offline', exact: true })).toBeVisible();
  await search.clear();
  await screenshots(page, 'en');
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 60000 }).toBe(true);
  await expect(page.locator('.app-update-notice')).toHaveCount(0);
  const requests: string[] = [];
  context.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Help and getting started', exact: true })).toBeVisible();
  await screenshots(page, 'en');
  await page.getByRole('combobox', { name: 'Language', exact: true }).selectOption('es');
  await expect(page.getByRole('heading', { name: 'Ayuda y guía de inicio', exact: true })).toBeVisible();
  await screenshots(page, 'es');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ayuda y guía de inicio', exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
