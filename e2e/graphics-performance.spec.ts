import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createDefaultProject, type ProjectDocument } from '../src/domain/project/projectDocument';
import { TERMS_VERSION } from '../src/domain/policies/legalPolicy';

type Metrics = { sampledAt: number; renderCalls: number; renderedFrames: number; architectureBuilds: number; pixelRatio: number; walk: { x: number; z: number; eyeY: number; yaw: number } | null };
async function sample(request: APIRequestContext, lightHeight?: number) {
  const suffix = randomUUID().slice(0, 8), headers = { Origin: 'http://127.0.0.1:5188', 'Content-Type': 'application/json', 'X-Forwarded-For': `198.18.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}` };
  const signup = await request.post('/api/auth/register', { headers, data: { username: 'graphics_' + suffix, password: 'Graphics-test-5913', confirmPassword: 'Graphics-test-5913', termsVersion: TERMS_VERSION } });
  expect(signup.status(), await signup.text()).toBe(201);
  const project = createDefaultProject('Graphics studio'), level = project.levels[0];
  project.renderQuality = 'standard';
  if (lightHeight !== undefined) { level.lights[0].y = lightHeight; level.lights[0].z = -1; }
  level.furniture.push({ id: randomUUID(), levelId: level.id, type: 'nightstand', variant: 'nightstand-classic', x: -1, z: -.4, width: .6, depth: .45, height: .6, rotation: 0, material: 'wood', color: '#aabbcc' });
  const response = await request.post('/api/rooms', { headers, data: { id: project.id, project } });
  expect(response.status(), await response.text()).toBe(201);
  return project;
}
async function saved(request: APIRequestContext, id: string): Promise<ProjectDocument> {
  const response = await request.get('/api/rooms/' + id); expect(response.status()).toBe(200); return (await response.json()).project;
}
async function open(page: Page, project: ProjectDocument) {
  await page.goto('/editor?room=' + project.id + '&profile=1');
  const canvas = page.locator('.room-scene canvas');
  await expect(canvas).toHaveAttribute('data-scene-metrics', /renderCalls/, { timeout: 45000 });
  return canvas;
}
async function metrics(canvas: Locator): Promise<Metrics> {
  const previous = JSON.parse((await canvas.getAttribute('data-scene-metrics'))!) as Metrics;
  await canvas.dispatchEvent('space-profile-snapshot');
  await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-scene-metrics'))!).renderCalls).toBeGreaterThan(previous.renderCalls);
  return JSON.parse((await canvas.getAttribute('data-scene-metrics'))!);
}
async function idle(page: Page, canvas: Locator) {
  // Let controls, roof fading and initial GPU uploads settle before measuring actual draw calls.
  await page.waitForTimeout(1200);
  const before = await metrics(canvas);
  await page.waitForTimeout(600);
  const after = await metrics(canvas);
  expect(after.renderedFrames - before.renderedFrames).toBe(1);
}

test('orbit and walkthrough stop drawing at rest and resume on keyboard input', async ({ page, context }) => {
  const project = await sample(context.request), canvas = await open(page, project);
  await idle(page, canvas);
  await page.getByRole('button', { name: 'Recorrer', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-walk-pose', /eyeY/);
  await idle(page, canvas);
  const before = JSON.parse((await canvas.getAttribute('data-walk-pose'))!);
  await canvas.focus(); await page.keyboard.down('w');
  try {
    await expect.poll(async () => { const pose = JSON.parse((await canvas.getAttribute('data-walk-pose'))!); return Math.hypot(pose.x - before.x, pose.z - before.z); }).toBeGreaterThan(.04);
  } finally { await page.keyboard.up('w'); }
  await idle(page, canvas);
  await page.getByRole('button', { name: 'Salir', exact: true }).click();
  await idle(page, canvas);
});

test('walkthrough light switches keep the renderer and movement alive across shadow changes', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && /Room renderer|THREE|Architectural effects/.test(message.text())) errors.push(message.text()); });
  const project = await sample(context.request, 1.6), canvas = await open(page, project), name = project.levels[0].lights[0].name;
  await page.getByRole('button', { name: 'Elementos', exact: true }).click();
  await page.locator('.tree-item').filter({ hasText: name }).first().click();
  await page.getByRole('button', { name: 'Recorrer', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-walk-pose', /eyeY/);
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.getByRole('button', { name: `Apagar ${name}`, exact: true }).click();
    await expect.poll(async () => (await saved(context.request, project.id)).levels[0].lights[0].enabled).toBe(false);
    await metrics(canvas);
    await page.getByRole('button', { name: `Encender ${name}`, exact: true }).click();
    await expect.poll(async () => (await saved(context.request, project.id)).levels[0].lights[0].enabled).toBe(true);
    await metrics(canvas);
  }
  const before = JSON.parse((await canvas.getAttribute('data-walk-pose'))!);
  await canvas.focus(); await page.keyboard.down('w');
  try { await expect.poll(async () => { const pose = JSON.parse((await canvas.getAttribute('data-walk-pose'))!); return Math.hypot(pose.x - before.x, pose.z - before.z); }).toBeGreaterThan(.04); }
  finally { await page.keyboard.up('w'); }
  await idle(page, canvas); expect(errors).toEqual([]);
});

test('render scale changes the drawing buffer immediately and color edits preserve furniture geometry', async ({ page, context }) => {
  const project = await sample(context.request), canvas = await open(page, project);
  await page.getByRole('button', { name: 'Ajustes de la aplicación', exact: true }).click();
  const settings = page.locator('dialog.offline-settings');
  const scale = settings.getByRole('combobox', { name: 'Escala de renderizado', exact: true });
  await scale.selectOption('1');
  await metrics(canvas);
  const full = await canvas.evaluate(element => ({ width: (element as HTMLCanvasElement).width, height: (element as HTMLCanvasElement).height, css: element.getBoundingClientRect().width }));
  await scale.selectOption('0.5');
  await expect.poll(() => canvas.evaluate(element => (element as HTMLCanvasElement).width)).toBe(Math.floor(full.width * .5));
  expect(await canvas.evaluate(element => element.getBoundingClientRect().width)).toBe(full.css);
  await settings.getByRole('button', { name: 'Cerrar ajustes', exact: true }).click();
  await page.getByRole('button', { name: 'Elementos', exact: true }).click();
  await page.locator('.tree-item').filter({ hasText: 'Buró' }).first().click();
  await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-scene-interaction'))!).selectedGeometryIds.length).toBeGreaterThan(0);
  const geometry = JSON.parse((await canvas.getAttribute('data-scene-interaction'))!).selectedGeometryIds;
  const before = await metrics(canvas);
  await page.getByRole('button', { name: 'Color del material', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Color del material', exact: true });
  await picker.getByLabel('Código hexadecimal', { exact: true }).fill('#123456');
  await picker.getByRole('button', { name: 'Aplicar', exact: true }).click();
  await expect.poll(async () => (await saved(context.request, project.id)).levels[0].furniture[0].color).toBe('#123456');
  const after = await metrics(canvas);
  expect(JSON.parse((await canvas.getAttribute('data-scene-interaction'))!).selectedGeometryIds).toEqual(geometry);
  expect(after.architectureBuilds).toBe(before.architectureBuilds);
});

test('returning a long drag to its original position removes its recovery checkpoint', async ({ page, context }) => {
  const project = await sample(context.request), canvas = await open(page, project);
  const checkpoint = () => page.evaluate(id => new Promise<ProjectDocument | undefined>((resolve, reject) => {
    const request = indexedDB.open('3d-space-v3', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('meta', 'readonly'), values = tx.objectStore('meta').getAll();
      tx.oncomplete = () => { db.close(); resolve(values.result.find(value => value.roomId === id && value.project)?.project); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), project.id);
  await page.getByRole('button', { name: 'Elementos', exact: true }).click();
  await page.locator('.tree-item').filter({ hasText: 'Buró' }).first().click();
  await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-scene-interaction'))!).handles.some((handle: { axis: string }) => handle.axis === 'X')).toBe(true);
  await metrics(canvas);
  const handle = JSON.parse((await canvas.getAttribute('data-scene-interaction'))!).handles.find((handle: { axis: string }) => handle.axis === 'X').points[0];
  const box = (await canvas.boundingBox())!, grab = { x: box.x + handle.x, y: box.y + handle.y };
  await page.mouse.move(grab.x, grab.y); await page.mouse.down(); await page.mouse.move(grab.x + 40, grab.y, { steps: 8 });
  await expect.poll(async () => (await checkpoint())?.levels[0].furniture[0].x).not.toBeUndefined();
  expect((await checkpoint())!.levels[0].furniture[0].x).not.toBe(project.levels[0].furniture[0].x);
  await page.mouse.move(grab.x, grab.y, { steps: 8 }); await page.mouse.up();
  await expect.poll(checkpoint).toBeUndefined();
  expect(await saved(context.request, project.id)).toEqual(project);
  await page.reload(); await expect(page.getByLabel('Nombre del proyecto', { exact: true })).toBeEditable();
  expect(await checkpoint()).toBeUndefined();
  expect(await saved(context.request, project.id)).toEqual(project);
});

test('a lost graphics context recreates the viewer without resetting the walkthrough or design', async ({ page, context }) => {
  const project = await sample(context.request), canvas = await open(page, project);
  test.skip((await canvas.getAttribute('data-backend')) !== 'webgl2', 'This regression exercises the WebGL context-loss event. Hardware WebGPU is tested separately.');
  await page.getByRole('button', { name: 'Recorrer', exact: true }).click();
  await expect(canvas).toHaveAttribute('data-walk-pose', /eyeY/);
  await canvas.focus(); await page.keyboard.down('w');
  const start = JSON.parse((await canvas.getAttribute('data-walk-pose'))!);
  try { await expect.poll(async () => { const pose = JSON.parse((await canvas.getAttribute('data-walk-pose'))!); return Math.hypot(pose.x - start.x, pose.z - start.z); }).toBeGreaterThan(.1); }
  finally { await page.keyboard.up('w'); }
  const before = await metrics(canvas), oldCanvas = await canvas.elementHandle();
  await canvas.dispatchEvent('webglcontextlost', { cancelable: true });
  await expect.poll(() => oldCanvas!.evaluate(element => element.isConnected)).toBe(false);
  await expect(canvas).toHaveAttribute('data-walk-pose', /eyeY/, { timeout: 45000 });
  const pose = JSON.parse((await canvas.getAttribute('data-walk-pose'))!);
  expect(pose.x).toBeCloseTo(before.walk!.x, 4); expect(pose.z).toBeCloseTo(before.walk!.z, 4); expect(pose.eyeY).toBeCloseTo(before.walk!.eyeY, 4); expect(pose.yaw).toBeCloseTo(before.walk!.yaw, 4);
  expect(await saved(context.request, project.id)).toEqual(project);
  await idle(page, canvas);
});
