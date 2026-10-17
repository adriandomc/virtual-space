import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDefaultProject } from '../src/domain/project/projectDocument';
import { TERMS_VERSION } from '../src/domain/policies/legalPolicy';

const origin = 'http://127.0.0.1:5188';

async function openSample(page: Page) {
  const suffix = randomUUID().slice(0, 8), headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-For': `198.18.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}` };
  const registration = await page.request.post('/api/auth/register', { headers, data: { username: 'panels_' + suffix, password: 'Panels-layout-5913', confirmPassword: 'Panels-layout-5913', termsVersion: TERMS_VERSION } });
  expect(registration.status(), await registration.text()).toBe(201);
  const project = createDefaultProject('Panel layout sample');
  const creation = await page.request.post('/api/rooms', { headers, data: { id: project.id, project } });
  expect(creation.status(), await creation.text()).toBe(201);
  await page.goto('/editor?room=' + project.id);
  await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toBeEditable();
}

async function expand(scope: Locator, title: string) {
  const summary = scope.locator('summary').filter({ hasText: new RegExp('^' + title + '$') }).first();
  if (await summary.locator('..').getAttribute('open') === null) await summary.click();
  return summary;
}

async function noHorizontalOverflow(scope: Locator) {
  expect(await scope.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
}

async function comfortableControls(scope: Locator) {
  const controls = scope.locator('input:not([type=checkbox]):not([type=range]):visible, select:visible, button:visible');
  expect(await controls.count()).toBeGreaterThan(0);
  for (const control of await controls.all()) {
    expect((await control.boundingBox())!.height, (await control.getAttribute('aria-label')) ?? (await control.textContent()) ?? 'control').toBeGreaterThanOrEqual(43.9);
  }
}

test('resizing an idle viewport redraws the scene after opening and closing panels', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 }); await openSample(page);
  const canvas = page.locator('.room-scene canvas');
  const sample = async () => JSON.parse(await canvas.getAttribute('data-scene-metrics') ?? '{}').sampledAt ?? 0;
  await expect.poll(sample).toBeGreaterThan(0);
  for (const name of ['Cuarto', 'Elementos', 'Cuarto', 'Elementos']) {
    // Metrics are throttled to one second; wait for a quiet frame before resizing.
    await expect.poll(async () => Date.now() - await sample()).toBeGreaterThan(1100);
    const before = await sample(), width = (await canvas.boundingBox())!.width;
    await page.getByRole('button', { name, exact: true }).click();
    await expect.poll(async () => (await canvas.boundingBox())!.width).not.toBe(width);
    await expect.poll(sample).toBeGreaterThan(before);
  }
});

for (const viewport of [{ width: 1360, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 740 }, { width: 390, height: 480 }]) {
  test(`construction panels retain aligned disclosure, usable fields and isolated color styles at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport); await openSample(page);
    const room = page.getByRole('button', { name: 'Cuarto', exact: true });
    if (await room.getAttribute('aria-expanded') !== 'true') await room.click();
    const panel = page.getByRole('complementary', { name: 'Propiedades del diseño', exact: true });
    await expect(panel).toBeVisible();
    await expect(panel.locator('.construction-panel > .property-section')).not.toHaveAttribute('open');
    const roofSummary = await expand(panel, 'Cubiertas'), roof = roofSummary.locator('..'), body = roof.locator('> .section-body');
    const dimensionSummary = panel.locator('.property-section > summary').filter({ hasText: /^Dimensiones$/ });
    for (const summary of [roofSummary, dimensionSummary]) {
      await expect(summary).toHaveCSS('padding-left', '18px'); await expect(summary).toHaveCSS('padding-right', '18px');
      expect(await summary.evaluate(element => {
        const marker = getComputedStyle(element, '::before');
        return !!element.querySelector('svg') || !['none', 'normal'].includes(marker.content) && parseFloat(marker.width) > 0;
      })).toBe(true);
    }
    await expect(body).toHaveCSS('padding-left', '18px'); await expect(body).toHaveCSS('padding-right', '18px');
    await comfortableControls(body); await noHorizontalOverflow(panel); await noHorizontalOverflow(body);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const roofImage = info.outputPath('roof-panel.png'); await page.screenshot({ path: roofImage });
    await info.attach('roof-panel', { path: roofImage, contentType: 'image/png' });

    await expand(roof, 'Acabado exterior'); await roof.getByRole('button', { name: 'Color', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Color', exact: true }), hue = picker.getByLabel('Tono', { exact: true });
    await expect(picker).toBeVisible();
    expect(await hue.evaluate(element => getComputedStyle(element).backgroundImage)).toContain('linear-gradient');
    const sheet = (await picker.boundingBox())!;
    expect(sheet.x).toBeGreaterThanOrEqual(0); expect(sheet.x + sheet.width).toBeLessThanOrEqual(viewport.width + 1);
    await noHorizontalOverflow(picker); await comfortableControls(picker);
    await picker.getByLabel('Código hexadecimal', { exact: true }).fill('#abcdef');
    await picker.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(roof.getByRole('button', { name: 'Color', exact: true })).toContainText('#FFFFFF');

    await roof.getByRole('button', { name: 'Editar forma', exact: true }).click();
    const mesh = page.getByRole('dialog', { name: 'Editar forma de cubierta', exact: true }); await expect(mesh).toBeVisible();
    const meshBox = (await mesh.boundingBox())!;
    expect(meshBox.y).toBeGreaterThanOrEqual(0); expect(meshBox.y + meshBox.height).toBeLessThanOrEqual(viewport.height + 1);
    await expect(mesh.locator('.roof-mesh-header')).toBeInViewport(); await expect(mesh.locator('.roof-mesh-footer')).toBeInViewport();
    const checkbox = mesh.getByLabel('Seleccionar varios', { exact: true }), checkboxBox = (await checkbox.boundingBox())!;
    expect(checkboxBox.width).toBeGreaterThanOrEqual(18); expect(checkboxBox.width).toBeLessThanOrEqual(24);
    expect(checkboxBox.height).toBeGreaterThanOrEqual(18); expect(checkboxBox.height).toBeLessThanOrEqual(24);
    expect((await checkbox.locator('..').boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
    await noHorizontalOverflow(mesh); await mesh.getByRole('button', { name: 'Cerrar edición de cubierta', exact: true }).click();

    await page.getByRole('button', { name: 'Ajustes de la aplicación', exact: true }).click();
    const settings = page.locator('dialog.offline-settings'); await expect(settings).toBeVisible();
    const graphics = settings.locator('.graphics-settings'); await comfortableControls(graphics); await noHorizontalOverflow(settings);
    const settingsBox = (await settings.boundingBox())!;
    expect(settingsBox.x).toBeGreaterThanOrEqual(0); expect(settingsBox.x + settingsBox.width).toBeLessThanOrEqual(viewport.width + 1);
    const settingsImage = info.outputPath('settings-panel.png'); await page.screenshot({ path: settingsImage });
    await info.attach('settings-panel', { path: settingsImage, contentType: 'image/png' });
    await settings.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
    await expect(settings).not.toBeVisible();
  });
}
