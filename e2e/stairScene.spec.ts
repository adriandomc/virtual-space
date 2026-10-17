import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDefaultProject, type ProjectDocument, type ProjectStair } from '../src/domain/project/projectDocument';
import { addLevel, addStair, updateStair } from '../src/domain/project/projectOperations';
import { TERMS_VERSION } from '../src/domain/policies/legalPolicy';

const origin = 'http://127.0.0.1:5188';
const headers = { Origin: origin, 'Content-Type': 'application/json' };
type ScreenPoint = { x: number; y: number };
type Interaction = { stairs: { id: string; point: ScreenPoint; points: ScreenPoint[] }[]; handles: { axis: string; points: ScreenPoint[] }[]; selection: { kind: string; id?: string } | null; dragging: boolean; invalid: boolean };

async function sample(request: APIRequestContext, setup = false, snap = true, pose?: Pick<ProjectStair, 'x' | 'z' | 'rotation'>, withStair = true) {
  const suffix = randomUUID().slice(0, 8);
  const sampleHeaders = { ...headers, 'X-Forwarded-For': `198.18.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}` };
  const registration = await request.post('/api/auth/register', { headers: sampleHeaders, data: { username: 'stair_scene_' + suffix, password: 'Stair-handles-5913', confirmPassword: 'Stair-handles-5913', termsVersion: TERMS_VERSION } });
  expect(registration.status(), await registration.text()).toBe(201);
  let project = createDefaultProject('Stair placement');
  project.levels[0].points.forEach(point => { point.x *= 1.6; point.z *= 1.6; });
  if (project.roofs[0].type !== 'mesh') project.roofs[0].footprint.forEach(point => { point.x *= 1.6; point.z *= 1.6; });
  project = addLevel(project, { copy: true }); project.activeLevelId = project.levels[0].id;
  if (withStair) project = addStair(project, { fromLevelId: project.levels[0].id, toLevelId: project.levels[1].id, type: 'straight', rotation: 0, run: 3, stepCount: 12, rails: 'none', finish: { color: '#a87947', material: 'wood' } });
  if (pose) project = updateStair(project, project.stairs[0].id, pose);
  project.editing.snap = snap;
  if (setup) project.setupStep = 3;
  const created = await request.post('/api/rooms', { headers: sampleHeaders, data: { id: project.id, project } });
  expect(created.status(), await created.text()).toBe(201);
  return project;
}

async function snapshot(request: APIRequestContext, id: string): Promise<ProjectDocument> {
  const response = await request.get('/api/rooms/' + id); expect(response.status()).toBe(200); return (await response.json()).project;
}

async function open(page: Page, project: ProjectDocument, setup = false, english = false) {
  if (english) { await page.goto('/'); await page.getByLabel('Idioma', { exact: true }).selectOption('en'); }
  await page.goto('/editor?room=' + project.id + (setup ? '&setup=1' : ''));
  if (setup) await expect(page.getByLabel('Elemento a agregar', { exact: true })).toBeEnabled();
  else await expect(page.getByLabel(english ? 'Project name' : 'Nombre del proyecto', { exact: true })).toBeEditable();
  const canvas = page.locator('.room-scene canvas');
  await expect.poll(async () => JSON.parse(await canvas.getAttribute('data-scene-metrics') ?? '{}').drawCalls ?? 0).toBeGreaterThan(0);
  await expect.poll(() => canvas.getAttribute('data-scene-interaction')).not.toBeNull();
  return canvas;
}

async function interaction(canvas: Locator): Promise<Interaction> { return JSON.parse((await canvas.getAttribute('data-scene-interaction'))!); }
async function screen(canvas: Locator, point: ScreenPoint) { const box = (await canvas.boundingBox())!; return { x: box.x + point.x, y: box.y + point.y }; }
async function selectStair(page: Page, canvas: Locator, project: ProjectDocument, touch = false) {
  const point = (await interaction(canvas)).stairs.find(stair => stair.id === project.stairs[0].id)!.point;
  const position = await screen(canvas, point);
  if (touch) await page.touchscreen.tap(position.x, position.y); else await page.mouse.click(position.x, position.y);
  await expect.poll(async () => (await interaction(canvas)).selection).toEqual({ kind: 'stair', id: project.stairs[0].id });
  await expect(page.getByRole('button', { name: /^(Mover elemento|Move item)$/, exact: true })).toBeVisible();
}
async function handle(canvas: Locator, axis: string) {
  // Selecting a stair opens the inspector and resizes the canvas before its next render.
  await canvas.hover();
  await expect.poll(() => canvas.evaluate(element => {
    const rect = element.getBoundingClientRect(), host = element.parentElement!;
    return Math.abs(rect.width - host.clientWidth) < 1 && Math.abs(rect.height - host.clientHeight) < 1;
  })).toBe(true);
  await expect.poll(async () => (await interaction(canvas)).handles.some(item => item.axis === axis && item.points.length > 0)).toBe(true);
  const points = (await interaction(canvas)).handles.find(item => item.axis === axis)!.points;
  return { point: await screen(canvas, points[0]), points };
}
async function meshGrab(canvas: Locator, id: string) {
  const state = await interaction(canvas), handles = state.handles.flatMap(handle => handle.points), stair = state.stairs.find(stair => stair.id === id)!;
  const distance = (point: ScreenPoint) => Math.min(...handles.map(handle => Math.hypot(point.x - handle.x, point.y - handle.y)));
  const point = [...stair.points].sort((a, b) => distance(b) - distance(a))[0];
  return { point: await screen(canvas, point), index: stair.points.indexOf(point) };
}
function stairState(project: ProjectDocument) { return { stair: project.stairs[0], holes: project.levels[1].surfaces.flatMap(surface => surface.holes) }; }

test('scene stair move handles commit one complete move with the slab opening and undo together', async ({ page, context }) => {
  const unsupportedObjects: string[] = [];
  page.on('console', message => { if (message.type() === 'error' && /Objects of type .* are not supported/.test(message.text())) unsupportedObjects.push(message.text()); });
  await page.setViewportSize({ width: 1360, height: 900 }); const project = await sample(context.request), canvas = await open(page, project);
  await selectStair(page, canvas, project);
  const before = stairState(await snapshot(context.request, project.id)), grab = (await handle(canvas, 'X')).point;
  await page.mouse.move(grab.x, grab.y); await page.mouse.down(); await page.mouse.move(grab.x + 38, grab.y, { steps: 8 });
  await expect.poll(async () => (await interaction(canvas)).dragging).toBe(true);
  await page.keyboard.press('KeyQ'); await page.keyboard.press('ArrowRight');
  expect(stairState(await snapshot(context.request, project.id))).toEqual(before);
  await page.mouse.up();
  await expect.poll(async () => (await snapshot(context.request, project.id)).stairs[0].x).not.toBe(before.stair.x);
  const after = stairState(await snapshot(context.request, project.id)), dx = after.stair.x - before.stair.x, dz = after.stair.z - before.stair.z;
  expect(after.stair.x / project.editing.step).toBeCloseTo(Math.round(after.stair.x / project.editing.step), 6);
  expect(after.stair.rotation).toBe(before.stair.rotation);
  for (let index = 0; index < before.holes[0].vertices.length; index++) {
    expect(after.holes[0].vertices[index].x - before.holes[0].vertices[index].x).toBeCloseTo(dx, 5);
    expect(after.holes[0].vertices[index].z - before.holes[0].vertices[index].z).toBeCloseTo(dz, 5);
  }
  await page.getByRole('button', { name: 'Deshacer construcción', exact: true }).click();
  await expect.poll(async () => stairState(await snapshot(context.request, project.id))).toEqual(before);
  await page.getByRole('button', { name: 'Rehacer construcción', exact: true }).click();
  await expect.poll(async () => stairState(await snapshot(context.request, project.id))).toEqual(after);
  await page.reload(); await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toBeEditable(); expect(stairState(await snapshot(context.request, project.id))).toEqual(after);
  expect(unsupportedObjects).toEqual([]);
});

test('stair scene gestures cancel and invalid placement reverts without saving partial geometry', async ({ page, context }) => {
  await page.setViewportSize({ width: 1360, height: 900 }); const project = await sample(context.request, false, false), canvas = await open(page, project);
  await selectStair(page, canvas, project); const before = stairState(await snapshot(context.request, project.id));
  let grab = (await handle(canvas, 'X')).point;
  await page.mouse.move(grab.x, grab.y); await page.mouse.down(); await page.mouse.move(grab.x + 35, grab.y, { steps: 6 });
  await expect.poll(async () => (await interaction(canvas)).dragging).toBe(true); await page.keyboard.press('Escape'); await page.mouse.up();
  expect(stairState(await snapshot(context.request, project.id))).toEqual(before);
  await selectStair(page, canvas, project); grab = (await handle(canvas, 'X')).point;
  await page.mouse.move(grab.x, grab.y); await page.mouse.down(); await page.mouse.move(grab.x + 540, grab.y, { steps: 12 });
  await expect.poll(async () => (await interaction(canvas)).invalid).toBe(true); expect(stairState(await snapshot(context.request, project.id))).toEqual(before);
  await page.mouse.up(); await expect(page.locator('.room-scene [role="status"]')).toContainText(/No se puede|hueco|escalera|posición/i);
  await expect.poll(async () => (await interaction(canvas)).dragging).toBe(false); expect(stairState(await snapshot(context.request, project.id))).toEqual(before);
});

test('direct dragging a selected staircase preserves its grab point without snapping or double displacement', async ({ page, context }) => {
  await page.setViewportSize({ width: 1360, height: 900 }); const project = await sample(context.request, false, false), canvas = await open(page, project); await selectStair(page, canvas, project);
  const before = stairState(await snapshot(context.request, project.id));
  const mesh = await meshGrab(canvas, project.stairs[0].id), grab = mesh.point, target = { x: grab.x + 28, y: grab.y + 6 };
  await page.mouse.move(grab.x, grab.y); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 10 });
  await expect.poll(async () => (await interaction(canvas)).dragging).toBe(true);
  const distance = async () => { const current = (await interaction(canvas)).stairs.find(stair => stair.id === project.stairs[0].id)!.points[mesh.index], visible = await screen(canvas, current); return Math.hypot(visible.x - target.x, visible.y - target.y); };
  await expect.poll(distance).toBeLessThan(3); expect(stairState(await snapshot(context.request, project.id))).toEqual(before);
  await page.mouse.up(); await expect.poll(async () => (await snapshot(context.request, project.id)).stairs[0].x).not.toBe(before.stair.x);
  await expect.poll(distance).toBeLessThan(3);
});

test('clicking stair handles preserves manual placement and movement does not resnap untouched values', async ({ page, context }) => {
  await page.setViewportSize({ width: 1360, height: 900 }); const pose = { x: .135, z: -1.335, rotation: 17 }, project = await sample(context.request, false, true, pose), canvas = await open(page, project); await selectStair(page, canvas, project);
  const before = stairState(await snapshot(context.request, project.id)), grab = (await handle(canvas, 'X')).point;
  await page.mouse.click(grab.x, grab.y); await expect(page.getByRole('button', { name: 'Deshacer construcción', exact: true })).toBeDisabled(); expect(stairState(await snapshot(context.request, project.id))).toEqual(before);
  await canvas.focus(); await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await snapshot(context.request, project.id)).stairs[0].x).toBe(.2);
  let saved = (await snapshot(context.request, project.id)).stairs[0]; expect(saved.z).toBe(pose.z); expect(saved.rotation).toBe(pose.rotation);
  await page.getByRole('button', { name: 'Deshacer construcción', exact: true }).click(); await expect.poll(async () => stairState(await snapshot(context.request, project.id))).toEqual(before);
  await canvas.focus(); await page.keyboard.press('KeyQ');
  await expect.poll(async () => (await snapshot(context.request, project.id)).stairs[0].rotation).toBe(30);
  saved = (await snapshot(context.request, project.id)).stairs[0]; expect(saved.x).toBe(pose.x); expect(saved.z).toBe(pose.z);
});

test('stair rotation handles and keyboard keep the upper opening aligned', async ({ page, context }) => {
  await page.setViewportSize({ width: 1360, height: 900 }); const project = await sample(context.request), canvas = await open(page, project); await selectStair(page, canvas, project);
  await page.getByRole('button', { name: 'Girar elemento', exact: true }).click();
  const ring = await handle(canvas, 'Y'), target = await screen(canvas, ring.points[Math.floor(ring.points.length / 4)]);
  await page.mouse.move(ring.point.x, ring.point.y); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 16 }); await page.mouse.up();
  await expect.poll(async () => (await snapshot(context.request, project.id)).stairs[0].rotation).not.toBe(project.stairs[0].rotation);
  const rotated = await snapshot(context.request, project.id); expect(rotated.stairs[0].rotation / 15).toBeCloseTo(Math.round(rotated.stairs[0].rotation / 15), 6);
  expect(stairState(rotated).holes[0].vertices).not.toEqual(stairState(project).holes[0].vertices);
  await canvas.focus(); await page.keyboard.press('KeyQ'); await expect.poll(async () => (await snapshot(context.request, project.id)).stairs[0].rotation).not.toBe(rotated.stairs[0].rotation);
  const turned = await snapshot(context.request, project.id); await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await snapshot(context.request, project.id)).stairs[0].x).toBeCloseTo(turned.stairs[0].x + project.editing.step, 6);
});

test('mobile touch stair handles commit on release and touch cancellation preserves the original', async ({ browser, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Touch dragging uses Chromium input; physical Android and iOS gestures still require device verification.');
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'es-MX' });
  try {
    const project = await sample(context.request), page = await context.newPage(), canvas = await open(page, project); await selectStair(page, canvas, project, true);
    const session = await context.newCDPSession(page), before = stairState(await snapshot(context.request, project.id));
    let grab = (await handle(canvas, 'X')).point;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...grab, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: grab.x + 22, y: grab.y, id: 1 }] });
    await expect.poll(async () => (await interaction(canvas)).dragging).toBe(true); expect(stairState(await snapshot(context.request, project.id))).toEqual(before);
    await canvas.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const heldStairs = (await interaction(canvas)).stairs;
    const held = { x: grab.x + 22, y: grab.y, id: 1 }, canvasBox = (await canvas.boundingBox())!;
    await canvas.evaluate(element => document.addEventListener('pointerup', () => { (element as HTMLElement).dataset.secondaryPointerUp = 'true'; }, { once: true, capture: true }));
    const second = { x: canvasBox.x + canvasBox.width * .75, y: canvasBox.y + canvasBox.height * .25, id: 9 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [held, second] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [held, { ...second, x: second.x + 12, y: second.y + 12 }] });
    await canvas.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect((await interaction(canvas)).stairs).toEqual(heldStairs);
    // End only the second contact; the first finger remains captured by the handle.
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ ...second, x: second.x + 12, y: second.y + 12 }] });
    await expect(canvas).toHaveAttribute('data-secondary-pointer-up', 'true');
    await canvas.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect.poll(async () => (await interaction(canvas)).dragging).toBe(true);
    expect(stairState(await snapshot(context.request, project.id))).toEqual(before);
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await snapshot(context.request, project.id)).stairs[0].x).not.toBe(before.stair.x);
    const after = stairState(await snapshot(context.request, project.id)); grab = (await handle(canvas, 'Z')).point;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...grab, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: grab.x, y: grab.y + 18, id: 2 }] });
    await expect.poll(async () => (await interaction(canvas)).dragging).toBe(true);
    await session.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await expect.poll(async () => (await interaction(canvas)).dragging).toBe(false); expect(stairState(await snapshot(context.request, project.id))).toEqual(after);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const dock = page.locator('.selection-dock');
    for (const button of await dock.getByRole('button').all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(43.9);
    await page.screenshot({ path: info.outputPath('mobile-stair-handles.jpg'), type: 'jpeg', quality: 90 });
  } finally { await context.close(); }
});

test('mobile decoration exposes stair move and rotate controls and Skip keeps their changes', async ({ page, context }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); const project = await sample(context.request, true), canvas = await open(page, project, true); await selectStair(page, canvas, project);
  const preview = page.locator('.setup-preview'), dock = preview.locator('.selection-dock');
  await expect(dock.getByRole('button', { name: 'Mover elemento', exact: true })).toBeVisible(); await expect(dock.getByRole('button', { name: 'Girar elemento', exact: true })).toBeVisible();
  const grab = (await handle(canvas, 'X')).point;
  await page.mouse.move(grab.x, grab.y); await page.mouse.down(); await page.mouse.move(grab.x + 14, grab.y, { steps: 6 }); await page.mouse.up();
  await expect.poll(async () => (await snapshot(context.request, project.id)).stairs[0].x).not.toBe(project.stairs[0].x);
  await dock.getByRole('button', { name: 'Girar elemento', exact: true }).click(); await handle(canvas, 'Y'); await canvas.focus(); await page.keyboard.press('KeyQ');
  await expect.poll(async () => (await snapshot(context.request, project.id)).stairs[0].rotation).toBe(15);
  const after = stairState(await snapshot(context.request, project.id));
  await page.screenshot({ path: info.outputPath('setup-stair-handles.jpg'), type: 'jpeg', quality: 90 });
  await dock.getByRole('button', { name: 'Propiedades del elemento', exact: true }).click();
  const activeStair = page.locator('.setup-controls').getByLabel('Escalera activa', { exact: true });
  await expect(activeStair).toBeFocused(); await expect(activeStair).toBeInViewport();
  await page.screenshot({ path: info.outputPath('setup-stair-properties.jpg'), type: 'jpeg', quality: 90 });
  await page.getByRole('button', { name: 'Omitir', exact: true }).click(); await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toBeEditable();
  await expect.poll(async () => stairState(await snapshot(context.request, project.id))).toEqual(after);
  expect((await snapshot(context.request, project.id)).setupStep).toBeUndefined();
});

test('mobile decoration catalog returns to the selected staircase preview and Edit focuses its properties', async ({ page, context }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); const project = await sample(context.request, true, true, undefined, false), canvas = await open(page, project, true);
  await page.getByLabel('Elemento a agregar', { exact: true }).selectOption('stairs');
  await page.getByRole('button', { name: 'Ver modelos', exact: true }).click();
  const dialog = page.locator('dialog.setup-catalog-dialog'); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Agregar Recta', exact: true }).click(); await expect(dialog).not.toBeVisible();
  await expect.poll(async () => (await snapshot(context.request, project.id)).stairs.length).toBe(1);
  const added = await snapshot(context.request, project.id), preview = page.locator('.setup-preview'), dock = preview.locator('.selection-dock');
  await expect.poll(async () => (await interaction(canvas)).selection).toEqual({ kind: 'stair', id: added.stairs[0].id });
  await handle(canvas, 'X');
  await expect(preview).toBeInViewport({ ratio: .7 });
  for (const name of ['Mover elemento', 'Girar elemento']) await expect(dock.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: .7 });
  await page.screenshot({ path: info.outputPath('setup-stair-catalog-placement.jpg'), type: 'jpeg', quality: 90 });
  await dock.getByRole('button', { name: 'Propiedades del elemento', exact: true }).click();
  const activeStair = page.locator('.setup-controls').getByLabel('Escalera activa', { exact: true }); await expect(activeStair).toBeFocused(); await expect(activeStair).toBeInViewport();
  await page.screenshot({ path: info.outputPath('setup-stair-catalog-properties.jpg'), type: 'jpeg', quality: 90 });
  await page.getByRole('button', { name: 'Omitir', exact: true }).click(); await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toBeEditable();
  await expect.poll(async () => stairState(await snapshot(context.request, project.id))).toEqual(stairState(added)); expect((await snapshot(context.request, project.id)).setupStep).toBeUndefined();
});

test('plan dragging keeps a staircase under its grab point and commits its linked opening once', async ({ page, context }) => {
  await page.setViewportSize({ width: 1360, height: 900 }); const project = await sample(context.request, false, false); await open(page, project);
  await page.getByRole('tab', { name: 'Planta', exact: true }).click();
  const stair = page.locator('[data-plan-stair="' + project.stairs[0].id + '"]'), before = stairState(await snapshot(context.request, project.id)), box = (await stair.boundingBox())!, grab = { x: box.x + box.width / 2, y: box.y + box.height / 2 }, target = { x: grab.x + 26, y: grab.y + 13 };
  await page.mouse.move(grab.x, grab.y); await page.mouse.down(); await page.mouse.move(target.x, target.y, { steps: 8 });
  const distance = async () => { const visible = (await stair.boundingBox())!; return Math.hypot(visible.x + visible.width / 2 - target.x, visible.y + visible.height / 2 - target.y); };
  await expect.poll(distance).toBeLessThan(2); expect(stairState(await snapshot(context.request, project.id))).toEqual(before); await page.mouse.up();
  await expect.poll(async () => (await snapshot(context.request, project.id)).stairs[0].x).not.toBe(before.stair.x); await expect.poll(distance).toBeLessThan(2);
  await page.locator('.editor-level-bar').getByRole('button', { name: 'Deshacer construcción', exact: true }).click();
  await expect.poll(async () => stairState(await snapshot(context.request, project.id))).toEqual(before);
});

for (const locale of ['es', 'en'] as const) test(`stair handles stay visible in ${locale} and capture the illustrated help`, async ({ page, context }, info) => {
  await page.setViewportSize({ width: 1280, height: 800 }); const project = await sample(context.request), canvas = await open(page, project, false, locale === 'en'); await selectStair(page, canvas, project);
  for (const axis of ['X', 'Z']) {
    const point = (await handle(canvas, axis)).point, box = (await canvas.boundingBox())!;
    expect(point.x).toBeGreaterThan(box.x); expect(point.x).toBeLessThan(box.x + box.width); expect(point.y).toBeGreaterThan(box.y); expect(point.y).toBeLessThan(box.y + box.height);
  }
  await expect(page.getByRole('button', { name: locale === 'es' ? 'Girar elemento' : 'Rotate item', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('stairs-scene-' + locale + '.jpg'), type: 'jpeg', quality: 90 });
});
