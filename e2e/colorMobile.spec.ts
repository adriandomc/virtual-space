import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDefaultProject } from '../src/domain/project/projectDocument';
import { TERMS_VERSION } from '../src/domain/policies/legalPolicy';

test('mobile color editing reveals the scene and restores the properties panel and focus on Cancel or Escape', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const suffix = randomUUID().slice(0, 8), headers = { Origin: 'http://127.0.0.1:5188', 'Content-Type': 'application/json', 'X-Forwarded-For': `198.18.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}` };
  expect((await context.request.post('/api/auth/register', { headers, data: { username: 'mobile_color_' + suffix, password: 'Mobile-colors-5913', confirmPassword: 'Mobile-colors-5913', termsVersion: TERMS_VERSION } })).status()).toBe(201);
  const project = createDefaultProject('Mobile preview');
  expect((await context.request.post('/api/rooms', { headers, data: { id: project.id, project } })).status()).toBe(201);
  await page.goto('/editor?room=' + project.id); await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toBeEditable();
  await page.getByRole('button', { name: 'Materiales', exact: true }).click();
  const properties = page.locator('.properties-panel'), backdrop = page.locator('.mobile-backdrop'), trigger = page.getByRole('button', { name: 'Color', exact: true }), picker = page.getByRole('dialog', { name: 'Color', exact: true });
  const canvas = page.locator('.room-scene canvas'); await expect(canvas).toBeVisible(); const fullHeight = (await canvas.boundingBox())!.height;
  for (const action of ['cancel', 'escape']) {
    await trigger.click(); await expect(picker).toBeVisible();
    await expect(properties).toHaveCSS('visibility', 'hidden');
    await expect(backdrop).toHaveCSS('backdrop-filter', 'none'); await expect(backdrop).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const box = (await picker.boundingBox())!; expect(box.height).toBeLessThanOrEqual(465); expect(box.y).toBeGreaterThan(350);
    await expect.poll(async () => { const scene = (await canvas.boundingBox())!, sheet = (await picker.boundingBox())!; return scene.y + scene.height <= sheet.y + 2; }).toBe(true);
    const visibleScene = (await canvas.boundingBox())!; expect(visibleScene.height).toBeGreaterThanOrEqual(100); expect(visibleScene.height).toBeLessThan(fullHeight * .6);
    await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-scene-metrics') ?? '{}').drawCalls ?? 0).toBeGreaterThan(0);
    await picker.getByLabel('Código hexadecimal', { exact: true }).fill('#123456');
    if (action === 'cancel') await picker.getByRole('button', { name: 'Cancelar', exact: true }).click(); else await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0); await expect(properties).toHaveCSS('visibility', 'visible'); await expect(trigger).toBeFocused();
    await expect.poll(async () => (await canvas.boundingBox())!.height).toBeGreaterThan(fullHeight - 2);
    const response = await context.request.get('/api/rooms/' + project.id); expect((await response.json()).project.levels[0].walls[0].left.color).toBe('#ffffff');
  }
});
