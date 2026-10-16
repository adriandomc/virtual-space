import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { TERMS_VERSION } from '../src/legalPolicy';
import { createDefaultProject, type ProjectDocument } from '../src/projectDocument';
import { addLevel, addRoom, addStair, deleteWall } from '../src/projectOperations';
import { buildStairGeometry } from '../src/projectGeometry';

const origin = 'http://127.0.0.1:5188';
const headers = { Origin: origin, 'Content-Type': 'application/json' };
async function account(request: APIRequestContext) {
  const suffix = randomUUID().slice(0, 8), ip = `198.18.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}`;
  const response = await request.post('/api/auth/register', { headers: { ...headers, 'X-Forwarded-For': ip }, data: { username: 'construction_' + suffix, password: 'Test-building-5913', confirmPassword: 'Test-building-5913', termsVersion: TERMS_VERSION } });
  expect(response.status(), await response.text()).toBe(201);
}
async function design(request: APIRequestContext, levels = 1, setup = false, wide = false, furnished = false) {
  let project = createDefaultProject('Construction test');
  if (wide) { project.levels[0].points.forEach(p => { p.x *= 3; p.z *= 3; }); if (project.roofs[0].type !== 'mesh') project.roofs[0].footprint.forEach(p => { p.x *= 3; p.z *= 3; }); }
  while (project.levels.length < levels) project = addLevel(project, { copy: true, name: 'Level ' + (project.levels.length + 1) });
  project.activeLevelId = project.levels[0].id;
  if (furnished) { project.levels[0].furniture.push({ id: randomUUID(), levelId: project.levels[0].id, type: 'nightstand', variant: 'nightstand-classic', material: 'wood', color: '#ffffff', x: 0, z: 0, width: .6, depth: .45, height: .6, rotation: 0 }); project.levels[0].lights[0].x = -1.8; project.levels[0].lights[0].z = -1.4; }
  if (setup) project.setupStep = 0;
  const response = await request.post('/api/rooms', { headers, data: { id: project.id, project } }); expect(response.status(), await response.text()).toBe(201);
  return project;
}
async function snapshot(request: APIRequestContext, id: string): Promise<ProjectDocument> { const response = await request.get('/api/rooms/' + id); expect(response.status()).toBe(200); return (await response.json()).project; }
async function field(page: Page | Locator, label: string, value: string) { const input = page.getByLabel(label, { exact: true }); await input.fill(value); await input.press('Tab'); }
async function openEditor(page: Page, project: ProjectDocument, setup = false) { await page.goto('/editor?room=' + project.id + (setup ? '&setup=1' : '')); await expect(page.getByLabel(setup ? 'Nombre del diseño' : 'Nombre del proyecto', { exact: true })).toBeEditable(); }
async function openRoom(page: Page) { const button = page.getByRole('button', { name: 'Cuarto', exact: true }); if (await button.getAttribute('aria-expanded') !== 'true') await button.click(); }
async function openMaterials(page: Page) { const button = page.getByRole('button', { name: 'Materiales', exact: true }); if (await button.getAttribute('aria-expanded') !== 'true') await button.click(); }
async function expand(scope: Page | Locator, text: string) { const summary = scope.locator('summary').filter({ hasText: new RegExp('^' + text + '$') }).first(); if (await summary.locator('..').getAttribute('open') === null) await summary.click(); }
async function planPoint(page: Page, x: number, z: number) {
  return page.locator('.large-plan .plan-canvas > svg, .setup-preview .plan-canvas > svg').evaluate((svg, point) => {
    const polygon = svg.querySelector('polygon[fill="#fffdfa"]') as SVGPolygonElement;
    const points = Array.from(polygon.points), minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y));
    const local = new DOMPoint(minX + (maxX - minX) * (point.x + 2.5) / 5, minY + (maxY - minY) * (point.z + 2) / 4);
    const screen = local.matrixTransform((svg as SVGSVGElement).getScreenCTM()!); return { x: screen.x, y: screen.y };
  }, { x, z });
}

test('all four setup steps can be skipped without resetting edited work', async ({ page, context }) => {
  await account(context.request); const project = await design(context.request, 1, true); await openEditor(page, project, true);
  await field(page, 'Nombre del diseño', 'Keep my changes'); await field(page, 'Ancho', '6');
  await page.getByRole('button', { name: 'Omitir', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Cubierta', exact: true })).toBeVisible();
  await page.getByLabel('Forma de cubierta', { exact: true }).selectOption('gable'); await page.getByRole('button', { name: 'Omitir', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Colores', exact: true })).toBeVisible(); await field(page, 'Código de color', '#123456');
  await page.getByRole('button', { name: 'Omitir', exact: true }).click(); await page.getByRole('button', { name: 'Agregar', exact: true }).click();
  await page.getByRole('button', { name: 'Omitir', exact: true }).click(); await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toHaveValue('Keep my changes');
  await expect.poll(async () => { const p = await snapshot(context.request, project.id), level = p.levels[0]; return { name: p.name, width: Math.max(...level.points.map(p => p.x)) - Math.min(...level.points.map(p => p.x)), roof: p.roofs[0].type, color: level.walls[0].left.color, furniture: level.furniture.length, setup: p.setupStep }; }).toEqual({ name: 'Keep my changes', width: 6, roof: 'gable', color: '#123456', furniture: 1, setup: undefined });
});

test('mobile onboarding starts with the visible plan and keeps advanced stairs collapsed', async ({ page, context }) => {
  await account(context.request); const project = await design(context.request, 1, true); await page.setViewportSize({ width: 390, height: 844 }); await openEditor(page, project, true);
  const preview = page.locator('.setup-preview'), controls = page.locator('.setup-controls'), previewBox = (await preview.boundingBox())!, controlsBox = (await controls.boundingBox())!;
  expect(previewBox.y).toBeLessThan(controlsBox.y); expect(previewBox.y).toBeLessThan(390);
  const svg = preview.locator('.plan-canvas > svg'), svgBox = (await svg.boundingBox())!; expect(svgBox.y).toBeLessThan(700); expect(svgBox.height).toBeGreaterThanOrEqual(180);
  await expect(controls.locator('summary').filter({ hasText: /^Escaleras$/ }).locator('..')).not.toHaveAttribute('open');
  await preview.getByRole('button', { name: 'Pared', exact: true }).click(); await svg.scrollIntoViewIfNeeded();
  for (const point of [{ x: -2.5, z: 0 }, { x: 2.5, z: 0 }]) { const screen = await planPoint(page, point.x, point.z); await page.mouse.click(screen.x, screen.y); }
  await preview.getByRole('button', { name: 'Terminar', exact: true }).click(); await expect.poll(async () => (await snapshot(context.request, project.id)).levels[0].walls.length).toBe(7);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('setup paints one floor zone and wall face without changing their neighbors', async ({ page, context }) => {
  await account(context.request); let project = createDefaultProject('Independent finishes'), levelId = project.levels[0].id;
  project = addRoom(project, levelId, [{ x: -.8, z: -.8 }, { x: .8, z: -.8 }, { x: .8, z: .8 }, { x: -.8, z: .8 }]); project.setupStep = 2;
  project.levels[0].surfaces[0].finish = { color: '#112233', material: 'wood' }; project.levels[0].surfaces[1].finish = { color: '#aabbcc', material: 'marble' }; const wall = project.levels[0].walls[0]; wall.left.color = '#334455'; wall.right.color = '#556677';
  expect((await context.request.post('/api/rooms', { headers, data: { id: project.id, project } })).status()).toBe(201);
  await page.goto('/editor?room=' + project.id + '&setup=1'); await expect(page.getByRole('heading', { name: 'Colores', exact: true })).toBeVisible();
  await page.getByLabel('Zona del piso', { exact: true }).selectOption(project.levels[0].surfaces[1].id); await field(page, 'Código de color', '#fedcba'); await page.getByLabel('Material del piso', { exact: true }).selectOption('tile-brick');
  await expect.poll(async () => (await snapshot(context.request, project.id)).levels[0].surfaces[1].finish).toEqual({ color: '#fedcba', material: 'tile-brick' });
  await page.getByLabel('Superficie a pintar', { exact: true }).selectOption(wall.id); await page.getByLabel('Cara de la pared', { exact: true }).selectOption('right'); await field(page, 'Código de color', '#123456');
  await expect.poll(async () => (await snapshot(context.request, project.id)).levels[0].walls[0].right.color).toBe('#123456'); const saved = await snapshot(context.request, project.id);
  expect(saved.levels[0].surfaces[0].finish).toEqual(project.levels[0].surfaces[0].finish); expect(saved.levels[0].walls[0].left).toEqual(wall.left); expect(saved.levels[0].surfaces[1].finish).toEqual({ color: '#fedcba', material: 'tile-brick' });
});

test('an incomplete plan prevents level and view changes until explicitly cancelled', async ({ page, context }) => {
  await account(context.request); const project = await design(context.request, 2); await openEditor(page, project); await page.getByRole('tab', { name: 'Planta', exact: true }).click();
  const plan = page.locator('.large-plan'); await plan.getByRole('button', { name: 'Pared', exact: true }).click(); const point = await planPoint(page, 0, -.8); await page.mouse.click(point.x, point.y);
  await page.getByLabel('Nivel activo', { exact: true }).selectOption(project.levels[1].id); await expect(page.getByLabel('Nivel activo', { exact: true })).toHaveValue(project.levels[0].id);
  await page.getByRole('tab', { name: '3D', exact: true }).click(); await expect(page.getByRole('tab', { name: 'Planta', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Termina, recupera o cancela el borrador antes de continuar.', { exact: true }).first()).toBeVisible(); expect((await snapshot(context.request, project.id)).levels[0].walls).toHaveLength(4);
  await plan.getByRole('button', { name: 'Cancelar', exact: true }).click(); await page.getByLabel('Nivel activo', { exact: true }).selectOption(project.levels[1].id); await expect(page.getByLabel('Nivel activo', { exact: true })).toHaveValue(project.levels[1].id);
});

test('a shared construction draft survives connection loss and requires explicit resume', async ({ page, context }) => {
  await account(context.request); const project = await design(context.request);
  expect((await context.request.post('/api/rooms/' + project.id + '/share', { headers, data: { enabled: true } })).status()).toBe(200);
  await openEditor(page, project); await page.getByRole('tab', { name: 'Planta', exact: true }).click(); const plan = page.locator('.large-plan');
  await plan.getByRole('button', { name: 'Pared', exact: true }).click();
  for (const point of [{ x: -2.5, z: 0 }, { x: 2.5, z: 0 }]) { const screen = await planPoint(page, point.x, point.z); await page.mouse.click(screen.x, screen.y); }
  await context.setOffline(true);
  try {
    await expect(plan.getByRole('button', { name: 'Terminar', exact: true })).toBeDisabled();
    await expand(plan, 'Recuperar borrador'); const recovery = plan.getByLabel('Datos del borrador de construcción', { exact: true });
    await expect(recovery).toBeVisible(); expect(JSON.parse(await recovery.inputValue()).points).toHaveLength(2);
  } finally { await context.setOffline(false); }
  const resume = plan.getByRole('button', { name: 'Reanudar trazado', exact: true }); await expect(resume).toBeEnabled();
  expect((await snapshot(context.request, project.id)).levels[0].walls).toHaveLength(4); await expect(plan.getByRole('button', { name: 'Terminar', exact: true })).toBeDisabled();
  await resume.click(); await plan.getByRole('button', { name: 'Terminar', exact: true }).click(); await expect.poll(async () => (await snapshot(context.request, project.id)).levels[0].walls.length).toBe(7);
});

test.describe('identity response isolation', () => {
// Keep the delayed HTTP fixture observable; WebKit routes worker-owned requests separately.
test.use({ serviceWorkers: 'block' });
test('a delayed shared-project response cannot restore another account after a real account switch', async ({ page, context }) => {
  await account(context.request); const project = await design(context.request); expect((await context.request.post('/api/rooms/' + project.id + '/share', { headers, data: { enabled: true } })).status()).toBe(200);
  let release!: () => void, received = false; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/rooms/' + project.id, async route => { const response = await route.fetch(); received = true; await gate; await route.fulfill({ response }); });
  const other = await context.newPage();
  try {
    await page.goto('/editor?room=' + project.id, { waitUntil: 'domcontentloaded' }); await expect.poll(() => received).toBe(true);
    await other.goto('/designs'); await other.getByRole('button', { name: 'Cerrar sesión', exact: true }).click(); await expect(other).toHaveURL(/\/login$/);
    await other.locator('.auth-tabs').getByRole('button', { name: 'Crear cuenta', exact: true }).click(); await other.getByLabel('Usuario', { exact: true }).fill('switched_' + randomUUID().slice(0, 8));
    await other.getByLabel('Contraseña', { exact: true }).fill('Switch-account-5913'); await other.getByLabel('Confirmar contraseña', { exact: true }).fill('Switch-account-5913'); await other.getByRole('checkbox', { name: /Acepto las condiciones de uso/ }).check();
    await other.locator('form').getByRole('button', { name: 'Crear cuenta', exact: true }).click(); await expect(other).toHaveURL(/\/designs$/);
    release(); await expect(page.getByText('La cuenta activa cambió. Vuelve a abrir el diseño.', { exact: true })).toBeVisible(); await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toHaveCount(0);
  } finally { release(); await other.close(); }
});
});

test('deleting the selected wall remotely cannot commit its unfinished color into the first wall', async ({ page, context }) => {
  await account(context.request); const project = await design(context.request); expect((await context.request.post('/api/rooms/' + project.id + '/share', { headers, data: { enabled: true } })).status()).toBe(200);
  await openEditor(page, project); await page.getByRole('button', { name: 'Materiales', exact: true }).click(); const selector = page.getByLabel('Superficie a pintar', { exact: true }); await selector.selectOption('3'); await expect(selector.locator('option')).toHaveCount(6);
  await page.getByLabel('Código hexadecimal', { exact: true }).fill('#abcdef');
  const old = await (await context.request.get('/api/rooms/' + project.id)).json(), next = deleteWall(old.project, project.levels[0].id, project.levels[0].walls[3].id);
  expect((await context.request.put('/api/rooms/' + project.id, { headers, data: { project: next, revision: old.revision, operationId: randomUUID() } })).status()).toBe(200);
  await expect.poll(async () => selector.locator('option').count()).not.toBe(6); await page.keyboard.press('Tab');
  await expect(page.locator('.saved-status')).toHaveAttribute('title', 'Guardado'); const saved = await snapshot(context.request, project.id); expect(saved.levels[0].walls[0].left.color).toBe('#ffffff'); expect(saved.levels[0].walls.some(wall => wall.id === project.levels[0].walls[3].id)).toBe(false);
});

test('additive plan tools create junctions, rooms and holes, with atomic undo', async ({ page, context }) => {
  await account(context.request); const project = await design(context.request); await openEditor(page, project); await page.getByRole('tab', { name: 'Planta', exact: true }).click();
  const plan = page.locator('.large-plan'); await plan.getByRole('button', { name: 'Pared', exact: true }).click();
  for (const point of [{ x: -2.5, z: 0 }, { x: 2.5, z: 0 }]) { const screen = await planPoint(page, point.x, point.z); await page.mouse.click(screen.x, screen.y); }
  await plan.getByRole('button', { name: 'Terminar', exact: true }).click(); await expect.poll(async () => (await snapshot(context.request, project.id)).levels[0].walls.length).toBe(7);
  await plan.getByRole('button', { name: 'Cancelar', exact: true }).click(); await expand(plan, 'Habitación'); await plan.getByRole('button', { name: 'Rectángulo', exact: true }).click();
  for (const point of [{ x: -.8, z: -.8 }, { x: .8, z: .8 }]) { const screen = await planPoint(page, point.x, point.z); await page.mouse.click(screen.x, screen.y); }
  await expect.poll(async () => (await snapshot(context.request, project.id)).levels[0].surfaces.length).toBe(2);
  const current = await snapshot(context.request, project.id); for (const wall of project.levels[0].walls) expect(current.levels[0].walls.some(w => w.id === wall.id)).toBe(true);
  await plan.getByRole('button', { name: 'Deshacer construcción', exact: true }).click(); await expect.poll(async () => (await snapshot(context.request, project.id)).levels[0].surfaces.length).toBe(1);
  await plan.getByRole('button', { name: 'Cancelar', exact: true }).click(); await expand(plan, 'Habitación'); await plan.getByRole('button', { name: 'Hueco', exact: true }).click();
  for (const point of [{ x: -.5, z: .8 }, { x: .5, z: .8 }, { x: .5, z: 1.6 }, { x: -.5, z: 1.6 }]) { const screen = await planPoint(page, point.x, point.z); await page.mouse.click(screen.x, screen.y); }
  await plan.getByRole('button', { name: 'Terminar', exact: true }).click(); await expect.poll(async () => (await snapshot(context.request, project.id)).levels[0].surfaces[0].holes.length).toBe(1);
  await plan.getByRole('button', { name: 'Cancelar', exact: true }).click(); const holePoint = await planPoint(page, .3, 1.2); await page.mouse.click(holePoint.x, holePoint.y);
  await expect(plan.getByRole('button', { name: 'Eliminar hueco', exact: true })).toBeVisible(); await expect(plan.locator('.plan-canvas > svg circle[stroke-width="1"]')).toHaveCount(4);
  const floorPoint = await planPoint(page, 1.5, 1); await page.mouse.click(floorPoint.x, floorPoint.y); await expect(page.getByLabel('Superficie a pintar', { exact: true })).toHaveValue('floor');
});

test('pointer selection paints the exact nested floor region and preserves the surrounding slab', async ({ page, context }) => {
  await account(context.request); let project = createDefaultProject('Plan floor selection');
  project = addRoom(project, project.levels[0].id, [{ x: -.8, z: -.8 }, { x: .8, z: -.8 }, { x: .8, z: .8 }, { x: -.8, z: .8 }]);
  project.levels[0].lights[0].x = 1.7; project.levels[0].lights[0].z = 1.3;
  project.levels[0].surfaces[0].finish = { color: '#112233', material: 'wood' }; project.levels[0].surfaces[1].finish = { color: '#aabbcc', material: 'marble' };
  expect((await context.request.post('/api/rooms', { headers, data: { id: project.id, project } })).status()).toBe(201);
  await openEditor(page, project); await page.getByRole('tab', { name: 'Planta', exact: true }).click();
  const surface = page.locator('[data-plan-surface="' + project.levels[0].surfaces[1].id + '"]'); await expect(surface).toHaveAttribute('fill', '#aabbcc');
  const point = await planPoint(page, 0, 0); await page.mouse.click(point.x, point.y); await page.getByRole('button', { name: 'Propiedades del elemento', exact: true }).click(); await field(page, 'Código hexadecimal', '#fedcba');
  await expect.poll(async () => (await snapshot(context.request, project.id)).levels[0].surfaces[1].finish.color).toBe('#fedcba');
  expect((await snapshot(context.request, project.id)).levels[0].surfaces[0].finish).toEqual(project.levels[0].surfaces[0].finish);
});

test('a lower ceiling edits the upper slab underside independently of its floor and roof', async ({ page, context }) => {
  await account(context.request); const project = await design(context.request, 2); await openEditor(page, project);
  await page.getByRole('button', { name: 'Materiales', exact: true }).click(); await page.getByLabel('Superficie a pintar', { exact: true }).selectOption('ceiling');
  await field(page, 'Código hexadecimal', '#123456'); await page.getByLabel('Material de la superficie', { exact: true }).selectOption('wood');
  await expect.poll(async () => (await snapshot(context.request, project.id)).levels[1].surfaces[0].undersideFinish).toEqual({ color: '#123456', material: 'wood' });
  let saved = await snapshot(context.request, project.id); expect(saved.levels[0].surfaces[0].finish.color).toBe('#ffffff'); expect(saved.levels[1].surfaces[0].finish.color).toBe('#ffffff'); expect(saved.roofs[0].undersideFinish.color).toBe('#ffffff');
  await page.getByLabel('Nivel activo', { exact: true }).selectOption(project.levels[1].id); await expect(page.getByLabel('Nivel activo', { exact: true })).toHaveValue(project.levels[1].id); await openMaterials(page); await page.getByLabel('Superficie a pintar', { exact: true }).selectOption('floor'); await field(page, 'Código hexadecimal', '#fedcba');
  await expect.poll(async () => (await snapshot(context.request, project.id)).levels[1].surfaces[0].finish.color).toBe('#fedcba');
  await page.getByLabel('Nivel activo', { exact: true }).selectOption(project.levels[0].id); await expect(page.getByLabel('Nivel activo', { exact: true })).toHaveValue(project.levels[0].id); await openMaterials(page); await page.getByLabel('Superficie a pintar', { exact: true }).selectOption('ceiling');
  await expect(page.getByLabel('Código hexadecimal', { exact: true })).toHaveValue('#123456'); await expect(page.getByLabel('Material de la superficie', { exact: true })).toHaveValue('wood');
  saved = await snapshot(context.request, project.id); expect(saved.levels[1].surfaces[0].undersideFinish).toEqual({ color: '#123456', material: 'wood' });
});

test('empty/copy level controls preserve original content and enforce twelve levels', async ({ page, context }) => {
  test.setTimeout(180000); await account(context.request); const project = await design(context.request); await openEditor(page, project); await page.getByRole('tab', { name: 'Planta', exact: true }).click();
  const menu = page.locator('.level-menu'); await menu.locator('summary').click(); await menu.getByRole('button', { name: 'Nivel vacío', exact: true }).click();
  await expect.poll(async () => (await snapshot(context.request, project.id)).levels.length).toBe(2); let saved = await snapshot(context.request, project.id); expect(saved.levels[1].walls).toHaveLength(0); expect(saved.levels[1].lights).toHaveLength(0);
  await page.getByLabel('Nivel activo', { exact: true }).selectOption(project.levels[0].id);
  for (let count = 3; count <= 12; count++) {
    if (await menu.getAttribute('open') === null) await menu.locator('summary').click(); await menu.getByRole('button', { name: 'Copiar estructura inferior', exact: true }).click(); await expect.poll(async () => (await snapshot(context.request, project.id)).levels.length).toBe(count);
  }
  if (await menu.getAttribute('open') === null) await menu.locator('summary').click(); await expect(menu.getByRole('button', { name: 'Nivel vacío', exact: true })).toBeDisabled(); await expect(menu.getByRole('button', { name: 'Copiar estructura inferior', exact: true })).toBeDisabled();
  saved = await snapshot(context.request, project.id); expect(saved.levels[0].lights).toHaveLength(1); expect(saved.levels.slice(1).every(level => !level.furniture.length && !level.openings.length && !level.lights.length)).toBe(true);
});

for (const type of ['straight', 'landing', 'l', 'u', 'spiral'] as const) test(`stair controls create ${type} with a real upper slab opening`, async ({ page, context }) => {
  await account(context.request); const project = await design(context.request, 2, false, true); await openEditor(page, project); await openRoom(page); await expand(page, 'Escaleras');
  await page.getByLabel('Tipo de nueva escalera', { exact: true }).selectOption(type); await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await expect.poll(async () => (await snapshot(context.request, project.id)).stairs.length).toBe(1); const saved = await snapshot(context.request, project.id); expect(saved.stairs[0].type).toBe(type); expect(saved.levels[1].surfaces[0].holes.some(h => h.stairId === saved.stairs[0].id)).toBe(true);
  await expand(page.locator('details.property-section').filter({ has: page.getByLabel('Tipo de nueva escalera', { exact: true }) }), 'Más opciones');
  await page.getByLabel('Barandales', { exact: true }).selectOption('none'); await expect.poll(async () => (await snapshot(context.request, project.id)).stairs[0].rails).toBe('none');
});

test('roof templates and free-form drafts apply atomically and cancel safely', async ({ page, context }) => {
  await account(context.request); const project = await design(context.request); await openEditor(page, project); await openRoom(page); await expand(page, 'Cubiertas');
  for (const type of ['shed', 'gable', 'hip', 'flat']) { await page.getByLabel('Forma de cubierta', { exact: true }).selectOption(type); await expect.poll(async () => (await snapshot(context.request, project.id)).roofs[0].type).toBe(type); }
  await page.getByRole('button', { name: 'Editar forma', exact: true }).click(); await expect(page.getByLabel('Vértice de cubierta', { exact: true })).toBeVisible();
  await expect.poll(async () => (await snapshot(context.request, project.id)).roofs[0].type).toBe('mesh');
  await page.getByRole('button', { name: 'Eliminar vértice y caras', exact: true }).click(); await page.getByRole('button', { name: 'Aplicar forma', exact: true }).click(); await expect(page.locator('.roof-mesh-dialog [role="alert"]')).toBeVisible();
  const before = await snapshot(context.request, project.id); expect(before.roofs[0].type).toBe('mesh'); const stored = JSON.stringify(before.roofs[0]);
  await page.locator('.roof-mesh-dialog').getByRole('button', { name: 'Cancelar', exact: true }).click(); await page.getByRole('button', { name: 'Descartar cambios', exact: true }).click(); expect(JSON.stringify((await snapshot(context.request, project.id)).roofs[0])).toBe(stored);
  await page.getByRole('button', { name: 'Editar vértices y caras', exact: true }).click(); const y = Number(await page.getByLabel('Coordenada Y del vértice', { exact: true }).inputValue()); await field(page, 'Coordenada Y del vértice', String(y + .01));
  await page.getByRole('button', { name: 'Aplicar forma', exact: true }).click(); await expect(page.locator('.roof-mesh-dialog')).toHaveCount(0);
});

test('English mobile settings retain local manual graphics choices and reset independently', async ({ page, context }) => {
  await account(context.request); await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await page.getByLabel('Idioma', { exact: true }).selectOption('en');
  await page.goto('/designs'); await page.getByRole('button', { name: 'Application settings', exact: true }).click(); const dialog = page.locator('dialog.offline-settings');
  await dialog.getByRole('button', { name: 'Manual', exact: true }).click(); await dialog.getByLabel('Shadows', { exact: true }).selectOption('0'); await dialog.getByLabel('Frame rate limit', { exact: true }).selectOption('30');
  await page.reload(); await page.getByRole('button', { name: 'Application settings', exact: true }).click(); await expect(dialog.getByLabel('Shadows', { exact: true })).toHaveValue('0'); await expect(dialog.getByLabel('Frame rate limit', { exact: true })).toHaveValue('30');
  await dialog.getByRole('button', { name: 'Reset graphics', exact: true }).click(); await expect(dialog.getByLabel('Shadows', { exact: true })).toHaveValue('auto'); await expect(dialog.getByRole('button', { name: 'Automatic', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('touch plan supports two-finger pan/zoom and actual point drawing at mobile width', async ({ browser, browserName }) => {
  test.skip(browserName !== 'chromium', 'Multi-touch emulation uses Chromium input; physical Safari gestures require device verification.');
  const context = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'es-MX' });
  try {
    await account(context.request); const project = await design(context.request), page = await context.newPage(); await openEditor(page, project); await page.getByRole('tab', { name: 'Planta', exact: true }).tap();
    const svg = page.locator('.large-plan .plan-canvas > svg'), box = await svg.boundingBox(); expect(box).not.toBeNull();
    await expect.poll(async () => (await svg.locator('[data-plan-item] circle[fill="transparent"]').first().boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(43.9);
    const before = await svg.locator('polygon[fill="#fffdfa"]').first().getAttribute('points');
    const session = await context.newCDPSession(page), x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x - 35, y, id: 1 }, { x: x + 35, y, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 45, y: y + 15, id: 1 }, { x: x + 65, y: y + 15, id: 2 }] }); await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(svg.locator('polygon[fill="#fffdfa"]').first()).not.toHaveAttribute('points', before!); expect((await snapshot(context.request, project.id)).levels[0].walls).toHaveLength(4);
    const afterGesture = await svg.locator('polygon[fill="#fffdfa"]').first().getAttribute('points'), scrollTop = await page.evaluate(() => window.scrollY);
    await svg.hover(); await page.mouse.wheel(0, -100); await expect(svg.locator('polygon[fill="#fffdfa"]').first()).not.toHaveAttribute('points', afterGesture!); expect(await page.evaluate(() => window.scrollY)).toBe(scrollTop);
    await page.getByRole('button', { name: 'Centrar plano', exact: true }).tap(); await page.locator('.large-plan').getByRole('button', { name: 'Pared', exact: true }).tap();
    for (const point of [{ x: -2.5, z: 0 }, { x: 2.5, z: 0 }]) { const screen = await planPoint(page, point.x, point.z); await page.touchscreen.tap(screen.x, screen.y); }
    await page.locator('.large-plan').getByRole('button', { name: 'Terminar', exact: true }).tap(); await expect.poll(async () => (await snapshot(context.request, project.id)).levels[0].walls.length).toBe(7);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  } finally { await context.close(); }
});

test('twenty level switches retain a single renderer and bounded resources at 1, 4 and 12 levels', async ({ page, context }, info) => {
  test.setTimeout(240000); await account(context.request); const measurements: unknown[] = [], errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const count of [1, 4, 12]) {
    const project = await design(context.request, count, false, false, true), loadStarted = performance.now(); await openEditor(page, project); const canvas = page.locator('.room-scene canvas'); await expect(canvas).toBeVisible();
    await expect.poll(() => canvas.getAttribute('data-scene-metrics'), { timeout: 45000 }).not.toBeNull();
    const loadReadyMs = Math.round(performance.now() - loadStarted), paintStarted = performance.now();
    await page.getByRole('button', { name: 'Materiales', exact: true }).click(); await field(page, 'Código hexadecimal', '#fafafa');
    await expect.poll(async () => (await snapshot(context.request, project.id)).levels[0].walls[0].left.color).toBe('#fafafa'); const paintToSaveMs = Math.round(performance.now() - paintStarted);
    await page.getByRole('tab', { name: 'Planta', exact: true }).click(); const from = await planPoint(page, .28, .2), to = await planPoint(page, .88, .8), dragStarted = performance.now();
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 5 }); await page.mouse.up();
    await expect.poll(async () => { const item = (await snapshot(context.request, project.id)).levels[0].furniture[0]; return { x: item.x, z: item.z }; }).toEqual({ x: .6, z: .6 }); const dragToSaveMs = Math.round(performance.now() - dragStarted);
    await page.getByRole('tab', { name: '3D', exact: true }).click();
    async function freshMetrics(after: number, levelId: string) {
      await expect.poll(async () => { await canvas.hover(); await page.mouse.wheel(0, 1); const raw = await canvas.getAttribute('data-scene-metrics'), value = raw ? JSON.parse(raw) : null; return value?.sampledAt >= after && value?.activeLevelId === levelId; }, { timeout: 20000, intervals: [100, 250] }).toBe(true);
      return JSON.parse((await canvas.getAttribute('data-scene-metrics'))!);
    }
    const baseline = await freshMetrics(Date.now(), project.levels[0].id), switchesStarted = performance.now();
    for (let index = 0; index < 20; index++) await page.getByLabel('Nivel activo', { exact: true }).selectOption(project.levels[index % count].id);
    const twentySwitchesMs = Math.round(performance.now() - switchesStarted); await expect(canvas).toHaveCount(1); const current = await freshMetrics(Date.now(), project.levels[19 % count].id); measurements.push({ levelCount: count, backend: await canvas.getAttribute('data-backend'), loadReadyMs, paintToSaveMs, dragToSaveMs, twentySwitchesMs, baseline, after20Switches: current });
    expect(current.levels).toBe(count); expect(current.residentLevels).toBeLessThanOrEqual(Math.min(3, count)); expect(current.gpuGeometries).toBeLessThanOrEqual(baseline.gpuGeometries + 200); expect(current.gpuTextures).toBeLessThanOrEqual(baseline.gpuTextures + 30); expect(current.architectureBuilds).toBe(baseline.architectureBuilds);
  }
  expect(errors).toEqual([]); const path = info.outputPath('construction-resource-measurements.json'); await writeFile(path, JSON.stringify(measurements, null, 2)); await info.attach('construction-resource-measurements.json', { path, contentType: 'application/json' });
});

for (const type of ['straight', 'spiral'] as const) test(`actual keyboard walkthrough climbs and descends ${type} stairs`, async ({ page, context }, info) => {
  test.setTimeout(240000); await account(context.request);
  let project = createDefaultProject('Keyboard stair traversal'); project = addLevel(project, { copy: true }); project.activeLevelId = project.levels[0].id;
  project = addStair(project, { fromLevelId: project.levels[0].id, toLevelId: project.levels[1].id, type });
  if (type === 'spiral') project.levels[0].furniture.push({ id: randomUUID(), levelId: project.levels[0].id, type: 'nightstand', variant: 'nightstand-classic', material: 'wood', color: '#ffffff', x: 0, z: 0, width: .2, depth: .2, height: .3, rotation: 0 });
  expect((await context.request.post('/api/rooms', { headers, data: { id: project.id, project } })).status()).toBe(201);
  await openEditor(page, project); await page.getByRole('button', { name: 'Recorrer', exact: true }).click();
  const canvas = page.locator('.room-scene canvas'); type Pose = { x: number; z: number; yaw: number; feetY: number; eyeY: number; levelId: string; blocked: boolean };
  const pose = async (): Promise<Pose> => JSON.parse((await canvas.getAttribute('data-walk-pose'))!);
  await expect.poll(() => canvas.getAttribute('data-walk-pose')).not.toBeNull();
  const route = buildStairGeometry(project, project.stairs[0]).path.map(p => ({ x: p.x, z: p.z })), samples: Pose[] = [];
  if (type === 'straight') { const a = route[0], b = route[1], length = Math.hypot(b.x - a.x, b.z - a.z); route[0] = { x: a.x + (b.x - a.x) * .25 / length, z: a.z + (b.z - a.z) * .25 / length }; const end = route.at(-1)!, previous = route.at(-2)!; route[route.length - 1] = { x: end.x + (previous.x - end.x) * .25 / length, z: end.z + (previous.z - end.z) * .25 / length }; }
  async function walkTo(target: { x: number; z: number }) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const before = await pose(), distance = Math.hypot(target.x - before.x, target.z - before.z); if (distance < .095) return;
      const desired = Math.atan2(before.x - target.x, before.z - target.z), difference = Math.atan2(Math.sin(before.yaw - desired), Math.cos(before.yaw - desired));
      let remaining = difference / .004; const box = (await canvas.boundingBox())!;
      while (Math.abs(remaining) > .5) { const pixels = Math.sign(remaining) * Math.min(100, Math.abs(remaining)); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + pixels, box.y + box.height / 2, { steps: 3 }); await page.mouse.up(); remaining -= pixels; }
      await canvas.focus(); await page.keyboard.down('w');
      try {
        await expect.poll(async () => { const value = await pose(); return (value.x - before.x) * (target.x - before.x) / distance + (value.z - before.z) * (target.z - before.z) / distance; }, { timeout: 6000, intervals: [16, 20, 30] }).toBeGreaterThanOrEqual(Math.min(.2, distance - .075));
      } finally { await page.keyboard.up('w'); }
      const after = await pose(); samples.push(after); expect(Math.abs(after.feetY - before.feetY)).toBeLessThan(.35); expect(after.eyeY - after.feetY).toBeCloseTo(1.6, 4);
    }
    throw new Error('Keyboard movement did not reach waypoint ' + JSON.stringify(target));
  }
  await walkTo(route[0]); for (const target of route.slice(1)) await walkTo(target);
  await expect.poll(async () => (await pose()).feetY).toBeCloseTo(project.levels[1].elevation, 1);
  for (const target of [...route].reverse().slice(1)) await walkTo(target); await expect.poll(async () => (await pose()).feetY).toBeLessThan(.05);
  await info.attach('keyboard-stair-traversal.json', { body: JSON.stringify({ type, backend: await canvas.getAttribute('data-backend'), samples }), contentType: 'application/json' });
});
