import { expect, test, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createDefaultProject } from '../src/projectDocument';
import { addLevel } from '../src/projectOperations';
import { TERMS_VERSION } from '../src/legalPolicy';

test('hardware browser keeps resources stable through twenty level switches and twenty walkthroughs at one, four and twelve storeys', async ({ page, context, browser }, testInfo) => {
  test.setTimeout(360000);
  const origin = 'http://127.0.0.1:5188', headers = { Origin: origin, 'Content-Type': 'application/json' };
  const signup = await context.request.post('/api/auth/register', { headers, data: { username: 'gpu_' + randomUUID().slice(0, 8), password: 'Gpu-test-password-4837', confirmPassword: 'Gpu-test-password-4837', termsVersion: TERMS_VERSION } });
  expect(signup.status(), await signup.text()).toBe(201);
  await page.goto('/designs');
  const hardware = await page.evaluate(() => {
    const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2');
    if (!gl) return { renderer: '', vendor: '' };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const result = { renderer: String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)), vendor: String(debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)) };
    gl.getExtension('WEBGL_lose_context')?.loseContext(); return result;
  });
  const devicePath = testInfo.outputPath('gpu-device.json'); await writeFile(devicePath, JSON.stringify({ ...hardware, browser: browser.version() }, null, 2)); await testInfo.attach('gpu-device.json', { path: devicePath, contentType: 'application/json' });
  test.skip(!hardware.renderer || /swiftshader|llvmpipe|lavapipe|software|microsoft basic|warp/i.test(hardware.renderer), 'A hardware graphics backend is not available in this browser.');
  const results: unknown[] = [], errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  async function metrics(canvas: Locator, after: number, levelId: string, walk: boolean) {
    await expect.poll(async () => {
      if (!walk) { await canvas.hover(); await page.mouse.wheel(0, 1); }
      const raw = await canvas.getAttribute('data-scene-metrics'), value = raw ? JSON.parse(raw) : null;
      return value?.sampledAt >= after && value?.activeLevelId === levelId && (!walk || Boolean(value.walk));
    }, { timeout: 25000, intervals: [100, 250] }).toBe(true);
    return JSON.parse((await canvas.getAttribute('data-scene-metrics'))!);
  }
  for (const count of [1, 4, 12]) {
    let project = createDefaultProject('GPU ' + count);
    for (let index = 1; index < count; index++) project = addLevel(project, { copy: true, name: 'Level ' + (index + 1) });
    for (const level of project.levels) {
      level.furniture = Array.from({ length: 4 }, (_, index) => ({ id: randomUUID(), levelId: level.id, type: 'wardrobe' as const, variant: 'wardrobe-classic', x: -1.5 + index, z: -1.3, width: .8, depth: .5, height: 2, rotation: 0, material: 'wood' as const, color: '#c5a381' }));
      level.lights = [{ id: randomUUID(), levelId: level.id, name: 'Light', x: 0, y: 2.5, z: 0, lumens: 1200, temperature: 3000, enabled: true }];
    }
    project.renderQuality = 'realistic';
    const created = await context.request.post('/api/rooms', { headers, data: { id: project.id, project } }); expect(created.status(), await created.text()).toBe(201);
    await page.goto('/editor?room=' + project.id);
    const canvas = page.locator('.room-scene canvas');
    await expect(canvas).toHaveAttribute('data-scene-metrics', /gpuGeometries/, { timeout: 45000 });
    const select = page.getByRole('combobox', { name: 'Nivel activo', exact: true });
    await select.selectOption(project.levels[0].id); await expect(select).toHaveValue(project.levels[0].id);
    const initial = await metrics(canvas, Date.now(), project.levels[0].id, false);
    const timings: number[] = [];
    for (let index = 0; index < 20; index++) {
      const started = Date.now(); await select.selectOption(project.levels[index % count].id);
      await expect(select).toHaveValue(project.levels[index % count].id);
      timings.push(Date.now() - started);
    }
    await select.selectOption(project.levels[0].id); await expect(select).toHaveValue(project.levels[0].id);
    const afterLevelSwitches = await metrics(canvas, Date.now(), project.levels[0].id, false);
    expect(afterLevelSwitches.architectureBuilds).toBe(initial.architectureBuilds);
    // Warm lazy walkthrough resources before measuring repeated mode transitions.
    await page.getByRole('button', { name: 'Recorrer', exact: true }).click(); await metrics(canvas, Date.now(), project.levels[0].id, true);
    await page.getByRole('button', { name: 'Salir', exact: true }).click(); const baseline = await metrics(canvas, Date.now(), project.levels[0].id, false);
    const walks: unknown[] = [];
    for (let index = 0; index < 20; index++) {
      const started = Date.now(); await page.getByRole('button', { name: 'Recorrer', exact: true }).click();
      const entered = await metrics(canvas, Date.now(), project.levels[0].id, true);
      const pose = async () => JSON.parse((await canvas.getAttribute('data-walk-pose'))!) as { x: number; z: number; feetY: number; eyeY: number };
      const before = await pose(); await canvas.focus(); await page.keyboard.down('w'); let rafIntervalsMs: number[] | undefined;
      try {
        if (index === 0) rafIntervalsMs = await page.evaluate(() => new Promise<number[]>(resolve => { const times: number[] = []; const sample = (time: number) => { times.push(time); if (times.length === 12) resolve(times.slice(1).map((value, index) => value - times[index])); else requestAnimationFrame(sample); }; requestAnimationFrame(sample); }));
        await expect.poll(async () => { const next = await pose(); return Math.hypot(next.x - before.x, next.z - before.z); }, { timeout: 5000, intervals: [16, 30] }).toBeGreaterThan(.04);
      } finally { await page.keyboard.up('w'); }
      const forward = await pose(), distance = Math.hypot(forward.x - before.x, forward.z - before.z); await page.keyboard.down('s');
      try { await expect.poll(async () => { const next = await pose(); return ((next.x - forward.x) * (before.x - forward.x) + (next.z - forward.z) * (before.z - forward.z)) / distance; }, { timeout: 5000, intervals: [16, 30] }).toBeGreaterThanOrEqual(Math.max(.04, distance - .025)); }
      finally { await page.keyboard.up('s'); }
      const backward = await pose(); expect(backward.eyeY - backward.feetY).toBeCloseTo(1.6, 3);
      await page.getByRole('button', { name: 'Salir', exact: true }).click(); walks.push({ index, durationMs: Date.now() - started, forwardDistance: Math.hypot(forward.x - before.x, forward.z - before.z), backwardDistance: Math.hypot(backward.x - forward.x, backward.z - forward.z), sampledRenderCpuMs: entered.frameMs, ...(rafIntervalsMs ? { rafIntervalsMs } : {}) });
    }
    const resources = await metrics(canvas, Date.now(), project.levels[0].id, false);
    expect(await page.locator('.room-scene canvas').count()).toBe(1); expect(resources.residentLevels).toBeLessThanOrEqual(3); expect(resources.levels).toBe(count); expect(resources.drawCalls).toBeGreaterThan(0);
    expect(resources.architectureBuilds).toBe(baseline.architectureBuilds); expect(resources.gpuGeometries).toBeLessThanOrEqual(baseline.gpuGeometries + 16); expect(resources.gpuTextures).toBeLessThanOrEqual(baseline.gpuTextures + 8);
    results.push({ count, backend: await canvas.getAttribute('data-backend'), timings, initial, afterLevelSwitches, baseline, after20Walkthroughs: resources, walks, hardware });
    await testInfo.attach('hardware-' + count + '-levels.jpg', { body: await page.screenshot({ type: 'jpeg' }), contentType: 'image/jpeg' });
  }
  expect(errors).toEqual([]); const path = testInfo.outputPath('hardware-level-benchmarks.json'); await writeFile(path, JSON.stringify({ browser: browser.version(), notes: 'rAF cadence is sampled during keyboard movement; frameMs measures CPU work, not GPU frame time. These observations do not guarantee FPS on other devices.', results }, null, 2)); await testInfo.attach('hardware-level-benchmarks.json', { path, contentType: 'application/json' });
});
