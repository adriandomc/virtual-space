import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createDefaultProject, type ProjectDocument } from '../src/domain/project/projectDocument';
import { addLevel, addStair } from '../src/domain/project/projectOperations';
import { TERMS_VERSION } from '../src/domain/policies/legalPolicy';

async function sample(request: APIRequestContext, setup = false) {
  const suffix = randomUUID().slice(0, 8), headers = { Origin: 'http://127.0.0.1:5188', 'Content-Type': 'application/json', 'X-Forwarded-For': `198.18.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}` };
  const account = await request.post('/api/auth/register', { headers, data: { username: 'paint_' + suffix, password: 'Paint-test-5913', confirmPassword: 'Paint-test-5913', termsVersion: TERMS_VERSION } });
  expect(account.status(), await account.text()).toBe(201);
  let project = addLevel(createDefaultProject('Paint studio'), { copy: true, name: 'Nivel 2' });
  project = addStair(project, { fromLevelId: project.levels[0].id, toLevelId: project.levels[1].id, rotation: 0, width: .7, run: 2.6, stepCount: 12, rails: 'none' });
  project.activeLevelId = project.levels[0].id;
  const level = project.levels[0];
  level.furniture.push({ id: randomUUID(), levelId: level.id, type: 'nightstand', variant: 'nightstand-classic', x: -1, z: -.4, width: .6, depth: .45, height: .6, rotation: 0, material: 'wood', color: '#aabbcc' });
  level.lights[0].x = -1; level.lights[0].z = .9;
  level.openings.push({ id: randomUUID(), levelId: level.id, wallId: level.walls[0].id, type: 'door', doorStyle: 'left', open: false, offset: .7, width: .9, height: 2, sill: 0 });
  level.openings.push({ id: randomUUID(), levelId: level.id, wallId: level.walls[1].id, type: 'window', offset: .8, width: .9, height: .8, sill: 1 });
  if (setup) project.setupStep = 2;
  const response = await request.post('/api/rooms', { headers, data: { id: project.id, project } });
  expect(response.status(), await response.text()).toBe(201);
  return project;
}
async function saved(request: APIRequestContext, id: string): Promise<ProjectDocument> { const response = await request.get('/api/rooms/' + id); expect(response.status()).toBe(200); return (await response.json()).project; }
async function open(page: Page, project: ProjectDocument, setup = false) {
  await page.goto('/editor?room=' + project.id + (setup ? '&setup=1' : ''));
  await expect(page.getByRole('button', { name: 'Cubeta de pintura', exact: true })).toBeEnabled();
}
async function foreground(page: Page, color: string) {
  await page.getByRole('button', { name: 'Color principal', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Color principal', exact: true });
  await dialog.getByLabel('Código hexadecimal', { exact: true }).fill(color);
  await dialog.getByRole('button', { name: 'Aplicar', exact: true }).click();
}
async function activatePaint(page: Page) {
  const bucket = page.getByRole('button', { name: 'Cubeta de pintura', exact: true });
  await bucket.click(); await expect(bucket).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.large-plan .plan-canvas > svg, .room-scene canvas').hover();
}
async function activateSample(page: Page) {
  const eyedropper = page.getByRole('button', { name: 'Cuentagotas', exact: true });
  await eyedropper.click(); await expect(eyedropper).toHaveAttribute('aria-pressed', 'true');
}
async function expectForeground(page: Page, color: string) {
  const channels = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
  await expect(page.getByRole('button', { name: 'Color principal', exact: true }).locator('.color-trigger-swatch')).toHaveCSS('background-color', `rgb(${channels.join(', ')})`);
}
async function center(locator: Locator) { const box = (await locator.boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }

test('the eyedropper samples every plan target without saving and transfers only its color through the bucket', async ({ page, context }) => {
  const project = await sample(context.request), level = project.levels[0];
  level.surfaces[0].finish.color = '#234567'; level.walls[2].left.color = '#123456'; project.stairs[0].finish.color = '#345678';
  const response = await context.request.put('/api/rooms/' + project.id, { headers: { Origin: 'http://127.0.0.1:5188', 'Content-Type': 'application/json' }, data: { project, revision: 1, operationId: randomUUID() } });
  expect(response.status(), await response.text()).toBe(200);
  await open(page, project); await page.getByRole('tab', { name: 'Planta', exact: true }).click();
  const plan = page.locator('.large-plan svg[role="group"]'), floor = plan.locator(`[data-plan-surface="${level.surfaces[0].id}"]`);
  const sources = [
    { target: floor, color: '#234567' },
    { target: plan.locator(`[data-plan-wall="${level.walls[2].id}"]`), color: '#123456' },
    { target: plan.locator(`[data-plan-item="${level.furniture[0].id}"]`), color: '#aabbcc' },
    { target: plan.locator(`[data-plan-item="${level.lights[0].id}"]`), color: '#343931' },
    { target: plan.locator(`[data-plan-item="${level.openings[0].id}"]`), color: '#c7b297' },
    { target: plan.locator(`[data-plan-item="${level.openings[1].id}"]`), color: '#efece3' },
    { target: plan.locator(`[data-plan-stair="${project.stairs[0].id}"]`), color: '#345678' },
  ];
  for (const source of sources) {
    const before = await saved(context.request, project.id); await activateSample(page);
    await source.target.press('Space'); await expectForeground(page, source.color);
    await expect(page.getByRole('button', { name: 'Cubeta de pintura', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('button', { name: 'Cuentagotas', exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect(await saved(context.request, project.id)).toEqual(before);
    const destination = source.target === floor ? plan.locator(`[data-plan-wall="${level.walls[1].id}"]`) : floor;
    await destination.press('Enter');
    await expect.poll(async () => {
      const next = await saved(context.request, project.id);
      return source.target === floor ? next.levels[0].walls[1].left.color : next.levels[0].surfaces[0].finish.color;
    }).toBe(source.color);
  }
  const final = await saved(context.request, project.id);
  expect(final.levels[0].furniture).toEqual(level.furniture); expect(final.levels[0].openings).toEqual(level.openings); expect(final.levels[0].lights).toEqual(level.lights);
  expect(final.levels[0].surfaces[0].finish.material).toBe(level.surfaces[0].finish.material); expect(final.stairs).toEqual(project.stairs);
});

test('the bucket paints all plan item kinds once on release, retains materials, and survives reload', async ({ page, context }) => {
  const project = await sample(context.request), level = project.levels[0]; await open(page, project);
  await foreground(page, '#123456');
  expect(await saved(context.request, project.id)).toEqual(project);
  await page.getByRole('tab', { name: 'Planta', exact: true }).click();
  await activatePaint(page);
  const plan = page.locator('.large-plan svg[role="group"]');
  const light = plan.locator(`[data-plan-item="${level.lights[0].id}"]`), lightPoint = await center(light);
  await page.mouse.move(lightPoint.x, lightPoint.y); await page.mouse.down();
  expect((await saved(context.request, project.id)).levels[0].lights[0].color).toBeUndefined();
  await page.mouse.up();
  await expect.poll(async () => (await saved(context.request, project.id)).levels[0].lights[0].color).toBe('#123456');
  for (const item of [...level.furniture, ...level.openings]) { const at = await center(plan.locator(`[data-plan-item="${item.id}"]`)); await page.mouse.click(at.x, at.y); }
  await plan.locator(`[data-plan-stair="${project.stairs[0].id}"]`).press('Enter');
  const wallPoint = await plan.locator(`[data-plan-wall="${level.walls[2].id}"] line`).first().evaluate(line => {
    const a = (name: string) => Number(line.getAttribute(name));
    const point = new DOMPoint(a('x1') * .75 + a('x2') * .25, a('y1') * .75 + a('y2') * .25).matrixTransform((line as SVGGraphicsElement).getScreenCTM()!);
    return { x: point.x, y: point.y };
  });
  await page.mouse.click(wallPoint.x, wallPoint.y);
  await plan.locator(`[data-plan-surface="${level.surfaces[0].id}"]`).press('Space');
  await expect.poll(async () => {
    const p = await saved(context.request, project.id), l = p.levels[0];
    return [l.furniture[0].color, ...l.openings.map(item => item.color), l.walls[2].left.color, l.surfaces[0].finish.color, p.stairs[0].finish.color];
  }).toEqual(Array(6).fill('#123456'));
  const p = await saved(context.request, project.id);
  expect(p.levels[0].walls[2].right.color).toBe('#ffffff'); expect(p.levels[1].surfaces[0].finish.color).toBe('#ffffff');
  expect(p.levels[0].furniture[0]).toEqual({ ...level.furniture[0], color: '#123456' });
  expect(p.levels[0].lights[0]).toEqual({ ...level.lights[0], color: '#123456' });
  await page.locator('.editor-level-bar').getByRole('button', { name: 'Deshacer construcción', exact: true }).click();
  await expect.poll(async () => (await saved(context.request, project.id)).levels[0].surfaces[0].finish.color).toBe('#ffffff');
  await page.locator('.editor-level-bar').getByRole('button', { name: 'Rehacer construcción', exact: true }).click();
  await expect.poll(async () => (await saved(context.request, project.id)).levels[0].surfaces[0].finish.color).toBe('#123456');
  await page.reload(); await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toBeEditable();
  expect((await saved(context.request, project.id)).levels[0].lights[0].color).toBe('#123456');
});

test('mobile painting does not turn a drag into paint and exposes the complete wheel', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'es-MX' }), page = await context.newPage();
  try {
    const project = await sample(context.request); await open(page, project); await foreground(page, '#445566');
    await page.getByRole('tab', { name: 'Planta', exact: true }).click(); await activatePaint(page);
    const item = page.locator(`[data-plan-item="${project.levels[0].furniture[0].id}"]`), at = await center(item);
    await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(at.x + 35, at.y + 20, { steps: 5 }); await page.mouse.up();
    expect((await saved(context.request, project.id)).levels[0].furniture[0]).toEqual(project.levels[0].furniture[0]);
    await page.touchscreen.tap(at.x, at.y);
    await expect.poll(async () => (await saved(context.request, project.id)).levels[0].furniture[0].color).toBe('#445566');
    await page.getByRole('button', { name: 'Color principal', exact: true }).click();
    const picker = page.getByRole('dialog', { name: 'Color principal', exact: true }), box = (await picker.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390); expect(box.y + box.height).toBeLessThanOrEqual(844);
    expect(await picker.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    for (const input of await picker.locator('.color-values input').all()) { const bounds = (await input.boundingBox())!; expect(bounds.x).toBeGreaterThanOrEqual(box.x); expect(bounds.x + bounds.width).toBeLessThanOrEqual(box.x + box.width); }
    await expect(picker.getByRole('button', { name: 'Reutilizar color #445566', exact: true })).toBeVisible();
    await picker.getByLabel('Código hexadecimal', { exact: true }).fill('#ff0000');
    const wheel = picker.getByRole('slider', { name: 'Tono', exact: true }), wheelBox = (await wheel.boundingBox())!;
    await page.touchscreen.tap(wheelBox.x + wheelBox.width / 2, wheelBox.y + wheelBox.height - 8);
    await expect(wheel).toHaveAttribute('aria-valuenow', '90'); await expect(picker.getByLabel('Código hexadecimal', { exact: true })).toHaveValue('#80FF00');
    await page.screenshot({ path: info.outputPath('paint-wheel-mobile.png') });
    await picker.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Color principal', exact: true }).locator('.color-trigger-swatch')).toHaveCSS('background-color', 'rgb(68, 85, 102)');
    await page.setViewportSize({ width: 320, height: 480 });
    const toolbar = page.getByRole('group', { name: 'Herramientas de pintura', exact: true }), toolbarBox = (await toolbar.boundingBox())!;
    expect(toolbarBox.x).toBeGreaterThanOrEqual(0); expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(320);
    for (const button of await toolbar.getByRole('button').all()) { const b = (await button.boundingBox())!; expect(b.width).toBeGreaterThanOrEqual(44); expect(b.height).toBeGreaterThanOrEqual(44); }
    await page.screenshot({ path: info.outputPath('paint-toolbar-small-mobile.png') });
  } finally { await context.close(); }
});

test('mobile eyedropper ignores out-and-back drags, cancels with Escape, and samples with one touch', async ({ browser }, info) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'es-MX' }), page = await context.newPage();
  try {
    const project = await sample(context.request); await open(page, project); await foreground(page, '#445566');
    await page.getByRole('tab', { name: 'Planta', exact: true }).click(); await activateSample(page);
    const item = page.locator(`[data-plan-item="${project.levels[0].furniture[0].id}"]`), at = await center(item);
    await page.mouse.move(at.x, at.y); await page.mouse.down(); await page.mouse.move(at.x + 35, at.y + 20, { steps: 5 }); await page.mouse.move(at.x, at.y, { steps: 5 }); await page.mouse.up();
    await expect(page.getByRole('button', { name: 'Cuentagotas', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expectForeground(page, '#445566'); expect(await saved(context.request, project.id)).toEqual(project);
    await item.press('Escape'); await expect(page.getByRole('group', { name: 'Herramientas de pintura', exact: true }).getByRole('button', { name: 'Seleccionar', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await activateSample(page); const afterCancel = await center(item); await page.touchscreen.tap(afterCancel.x, afterCancel.y);
    await expectForeground(page, '#aabbcc'); await expect(page.getByRole('button', { name: 'Cubeta de pintura', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await saved(context.request, project.id)).toEqual(project);
    const light = page.locator(`[data-plan-item="${project.levels[0].lights[0].id}"]`), to = await center(light); await page.touchscreen.tap(to.x, to.y);
    await expect.poll(async () => (await saved(context.request, project.id)).levels[0].lights[0].color).toBe('#aabbcc');
    expect((await saved(context.request, project.id)).levels[0].furniture).toEqual(project.levels[0].furniture);
    await page.screenshot({ path: info.outputPath('eyedropper-mobile.png') });
  } finally { await context.close(); }
});

test('surface levels keep stable wall targets and actual ceilings, with no long surface dropdown', async ({ page, context }) => {
  const project = await sample(context.request); await open(page, project);
  await page.getByRole('button', { name: 'Materiales', exact: true }).click();
  await expect(page.getByLabel('Superficie a pintar', { exact: true })).toHaveCount(0);
  const wall = page.locator('[data-surface-wall="' + project.levels[0].walls[1].id + '"]'), at = await center(wall);
  await page.mouse.click(at.x, at.y);
  await expect(wall).toHaveAttribute('aria-pressed', 'true');
  const navigator = page.locator('.surface-navigator'); await navigator.locator('summary').filter({ hasText: 'Nivel 2' }).click();
  await navigator.getByRole('button', { name: 'Pared 03 · Nivel 2 · Lado izquierdo', exact: true }).press('Enter');
  await expect(page.locator('.surface-level.active > summary')).toContainText('Nivel 2');
  await page.getByRole('button', { name: 'Color', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Color', exact: true }); await picker.getByLabel('Código hexadecimal', { exact: true }).fill('#654321'); await picker.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect.poll(async () => (await saved(context.request, project.id)).levels[1].walls[2].left.color).toBe('#654321');
  expect((await saved(context.request, project.id)).levels[0].walls[2].left.color).toBe('#ffffff');
  const lower = navigator.locator('.surface-level').filter({ hasText: 'Planta baja' });
  if (await lower.getAttribute('open') === null) await lower.locator(':scope > summary').click();
  await lower.getByRole('button', { name: 'Techo', exact: true }).click();
  await foreground(page, '#778899'); await activatePaint(page);
  await page.locator('.room-scene canvas').press('Enter');
  await expect.poll(async () => (await saved(context.request, project.id)).levels[1].surfaces[0].undersideFinish?.color).toBe('#778899');
  expect((await saved(context.request, project.id)).levels[1].surfaces[0].finish.color).toBe('#ffffff');
});

test('onboarding paints and samples the original 3D tint during Colors and Skip keeps the result', async ({ page, context }) => {
  const project = await sample(context.request, true); await open(page, project, true);
  await foreground(page, '#abcdef'); await activatePaint(page);
  const canvas = page.locator('.room-scene canvas');
  await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-scene-interaction') ?? '{}').stairs?.length ?? 0).toBe(1);
  await canvas.hover();
  const point = JSON.parse((await canvas.getAttribute('data-scene-interaction'))!).stairs[0].points[0], box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + point.x, box.y + point.y); await page.mouse.down();
  await page.keyboard.press('Enter'); await page.keyboard.press('Escape'); await page.mouse.up();
  expect((await saved(context.request, project.id)).stairs[0]).toEqual(project.stairs[0]);
  await expect(page.getByRole('button', { name: 'Cubeta de pintura', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await canvas.hover();
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await expect.poll(async () => (await saved(context.request, project.id)).stairs[0].finish.color).toBe('#abcdef');
  const beforeSample = await saved(context.request, project.id); await foreground(page, '#112233'); await activateSample(page); await canvas.hover();
  const samplePoint = JSON.parse((await canvas.getAttribute('data-scene-interaction'))!).stairs[0].points[0], sampleBox = (await canvas.boundingBox())!;
  await page.mouse.click(sampleBox.x + samplePoint.x, sampleBox.y + samplePoint.y);
  await expectForeground(page, '#abcdef'); expect(await saved(context.request, project.id)).toEqual(beforeSample);
  await expect(page.getByRole('button', { name: 'Cubeta de pintura', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Omitir', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Decoración', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cubeta de pintura', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await foreground(page, '#556677');
  await canvas.hover();
  const decorationPoint = JSON.parse((await canvas.getAttribute('data-scene-interaction'))!).stairs[0].points[0], decorationBox = (await canvas.boundingBox())!;
  await page.mouse.click(decorationBox.x + decorationPoint.x, decorationBox.y + decorationPoint.y);
  await expect.poll(async () => (await saved(context.request, project.id)).stairs[0].finish.color).toBe('#556677');
  await page.getByRole('button', { name: 'Omitir', exact: true }).click();
  await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toBeEditable();
  expect((await saved(context.request, project.id)).stairs[0]).toEqual({ ...project.stairs[0], finish: { ...project.stairs[0].finish, color: '#556677' } });
});

for (const locale of ['es', 'en'] as const) test('paint tools and help screenshot in ' + locale, async ({ page, context }, info) => {
  const project = await sample(context.request); await page.setViewportSize({ width: 1280, height: 800 });
  if (locale === 'en') { await page.goto('/'); await page.getByLabel('Idioma', { exact: true }).selectOption('en'); }
  await page.goto('/editor?room=' + project.id);
  await expect.poll(async () => JSON.parse(await page.locator('.room-scene canvas').getAttribute('data-scene-metrics') ?? '{}').drawCalls ?? 0).toBeGreaterThan(0);
  await page.getByRole('button', { name: locale === 'es' ? 'Materiales' : 'Materials', exact: true }).click();
  await expect(page.getByRole('button', { name: locale === 'es' ? 'Cuentagotas' : 'Eyedropper', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: locale === 'es' ? 'Cubeta de pintura' : 'Paint bucket', exact: true }).click();
  await page.getByRole('button', { name: locale === 'es' ? 'Color principal' : 'Foreground color', exact: true }).click();
  const picker = page.getByRole('dialog', { name: locale === 'es' ? 'Color principal' : 'Foreground color', exact: true }); await expect(picker).toBeVisible();
  expect(await picker.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const image = await page.screenshot({ type: 'jpeg', quality: 90 });
  await writeFile(info.outputPath('materials-' + locale + '.jpg'), image);
  if (info.project.name === 'chromium') await writeFile(fileURLToPath(new URL('../public/help/' + locale + '/materials.jpg', import.meta.url)), image);
});

for (const tool of ['paint', 'sample'] as const) test('cancelled touch and two-finger navigation never ' + tool + ', and a fresh touch remains usable', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium supplies CDP multi-touch and cancellation; physical gestures require device verification.');
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5188', viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'es-MX' }), page = await context.newPage();
  try {
    const project = await sample(context.request); await open(page, project); await foreground(page, '#2468ac');
    await page.getByRole('tab', { name: 'Planta', exact: true }).click();
    const bucket = page.getByRole('button', { name: 'Cubeta de pintura', exact: true }), activeTool = page.getByRole('button', { name: tool === 'paint' ? 'Cubeta de pintura' : 'Cuentagotas', exact: true }), toolbar = page.getByRole('group', { name: 'Herramientas de pintura', exact: true });
    await activeTool.click(); await expect(activeTool).toHaveAttribute('aria-pressed', 'true');
    const light = page.locator(`[data-plan-item="${project.levels[0].lights[0].id}"]`), at = await center(light), session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...at, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect(activeTool).toHaveAttribute('aria-pressed', 'true'); await expectForeground(page, '#2468ac');
    expect(await saved(context.request, project.id)).toEqual(project);
    await toolbar.getByRole('button', { name: 'Seleccionar', exact: true }).click(); await expect(bucket).toHaveAttribute('aria-pressed', 'false');
    await activeTool.click(); await expect(activeTool).toHaveAttribute('aria-pressed', 'true');
    const before = await center(light);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...before, id: 1 }, { x: before.x + 65, y: before.y, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: before.x + 20, y: before.y - 12, id: 1 }, { x: before.x + 85, y: before.y - 12, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await center(light)).x - before.x).toBeCloseTo(20, 0);
    await expect.poll(async () => (await center(light)).y - before.y).toBeCloseTo(-12, 0);
    await expect(activeTool).toHaveAttribute('aria-pressed', 'true'); await expectForeground(page, '#2468ac');
    expect(await saved(context.request, project.id)).toEqual(project);
    const after = await center(light); await page.touchscreen.tap(after.x, after.y);
    if (tool === 'paint') await expect.poll(async () => (await saved(context.request, project.id)).levels[0].lights[0].color).toBe('#2468ac');
    else {
      await expectForeground(page, '#343931'); await expect(bucket).toHaveAttribute('aria-pressed', 'true'); expect(await saved(context.request, project.id)).toEqual(project);
      const furniture = page.locator(`[data-plan-item="${project.levels[0].furniture[0].id}"]`), destination = await center(furniture); await page.touchscreen.tap(destination.x, destination.y);
      await expect.poll(async () => (await saved(context.request, project.id)).levels[0].furniture[0].color).toBe('#343931');
    }
  } finally { await context.close(); }
});

test('a secondary touch entering the 3D canvas cannot sample and a later primary touch still works', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium supplies CDP multi-touch; physical gestures require device verification.');
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5188', viewport: { width: 390, height: 844 }, hasTouch: true, locale: 'es-MX' }), page = await context.newPage();
  try {
    const project = await sample(context.request); await open(page, project); await foreground(page, '#445566'); await activateSample(page);
    const canvas = page.locator('.room-scene canvas');
    await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-scene-interaction') ?? '{}').stairs?.length ?? 0).toBe(1);
    const stairPoint = async () => {
      const point = JSON.parse((await canvas.getAttribute('data-scene-interaction'))!).stairs[0].points[0], bounds = (await canvas.boundingBox())!;
      return { x: bounds.x + point.x, y: bounds.y + point.y };
    };
    const outside = await center(page.locator('.saved-status')), at = await stairPoint(), session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...outside, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...outside, id: 1 }, { ...at, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(page.getByRole('button', { name: 'Cuentagotas', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expectForeground(page, '#445566'); expect(await saved(context.request, project.id)).toEqual(project);
    const primary = await stairPoint(); await page.touchscreen.tap(primary.x, primary.y);
    await expectForeground(page, project.stairs[0].finish.color); await expect(page.getByRole('button', { name: 'Cubeta de pintura', exact: true })).toHaveAttribute('aria-pressed', 'true');
    expect(await saved(context.request, project.id)).toEqual(project);
  } finally { await context.close(); }
});

test('offline paint survives a cold offline page and synchronizes only after leaving forced mode', async ({ page, context }) => {
  test.setTimeout(120000);
  const project = await sample(context.request), floorId = project.levels[0].surfaces[0].id;
  await page.goto('/designs'); await page.getByRole('button', { name: 'Ajustes de la aplicación', exact: true }).click();
  let settings = page.locator('dialog.offline-settings');
  await settings.getByRole('button', { name: 'Preparar diseños', exact: true }).click();
  await expect(settings.getByRole('button', { name: 'Actualizar copia local', exact: true })).toBeEnabled({ timeout: 60000 });
  const forced = settings.getByRole('switch', { name: 'Modo sin conexión', exact: true });
  await expect(forced).toBeEnabled(); await forced.click(); await expect(forced).toHaveAttribute('aria-checked', 'true');
  await settings.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
  const requests: string[] = [];
  context.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url()); });
  await page.getByRole('link', { name: /Paint studio/ }).click(); await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toBeEditable();
  await foreground(page, '#476a9b'); await page.getByRole('tab', { name: 'Planta', exact: true }).click(); await activatePaint(page);
  await page.locator(`[data-plan-surface="${floorId}"]`).press('Space');
  await expect(page.locator(`[data-plan-surface="${floorId}"]`)).toHaveAttribute('fill', '#476a9b');
  await expect(page.locator('.saved-status')).toHaveAttribute('title', /Guardado en este dispositivo|Sin conexión/);
  await activateSample(page); await page.locator(`[data-plan-surface="${floorId}"]`).press('Space'); await expectForeground(page, '#476a9b');
  await expect(page.getByRole('button', { name: 'Cubeta de pintura', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect((await saved(context.request, project.id)).levels[0].surfaces[0].finish.color).toBe('#ffffff');
  await context.setOffline(true);
  const previous = page; page = await context.newPage(); await previous.close();
  await page.goto('/editor?room=' + project.id); await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toBeEditable();
  await page.getByRole('tab', { name: 'Planta', exact: true }).click(); await expect(page.locator(`[data-plan-surface="${floorId}"]`)).toHaveAttribute('fill', '#476a9b');
  await context.setOffline(false); await page.reload(); await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toBeEditable();
  await page.getByRole('tab', { name: 'Planta', exact: true }).click(); await expect(page.locator(`[data-plan-surface="${floorId}"]`)).toHaveAttribute('fill', '#476a9b');
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'Ajustes de la aplicación', exact: true }).click(); settings = page.locator('dialog.offline-settings');
  await settings.getByRole('switch', { name: 'Modo sin conexión', exact: true }).click();
  await expect(settings.getByRole('switch', { name: 'Modo sin conexión', exact: true })).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toBeEditable();
  await expect.poll(async () => (await saved(context.request, project.id)).levels[0].surfaces[0].finish.color).toBe('#476a9b');
  expect((await saved(context.request, project.id)).levels[0].furniture).toEqual(project.levels[0].furniture);
});

test('a public embedded viewer cannot expose painting or save colors by pointer or keyboard', async ({ browser, context }) => {
  const project = await sample(context.request);
  const share = await context.request.post('/api/rooms/' + project.id + '/share', { headers: { Origin: 'http://127.0.0.1:5188', 'Content-Type': 'application/json' }, data: { enabled: true } });
  expect(share.status(), await share.text()).toBe(200);
  const reader = await browser.newContext({ baseURL: 'http://127.0.0.1:5188', locale: 'es-MX' }), page = await reader.newPage();
  try {
    await page.goto('/embed?room=' + project.id);
    const canvas = page.locator('.room-scene canvas'); await expect(canvas).toBeVisible();
    await expect.poll(() => canvas.getAttribute('data-scene-interaction')).not.toBeNull();
    await expect(page.getByRole('button', { name: 'Cubeta de pintura', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cuentagotas', exact: true })).toHaveCount(0);
    const data = JSON.parse((await canvas.getAttribute('data-scene-interaction'))!), point = data.stairs[0].points[0], box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + point.x, box.y + point.y); await canvas.press('Enter'); await canvas.press('Space');
    expect(await saved(context.request, project.id)).toEqual(project);
    const denied = await reader.request.put('/api/rooms/' + project.id, { headers: { Origin: 'http://127.0.0.1:5188', 'Content-Type': 'application/json' }, data: { project, revision: 1, operationId: randomUUID() } });
    expect([401, 403]).toContain(denied.status());
  } finally { await reader.close(); }
});
