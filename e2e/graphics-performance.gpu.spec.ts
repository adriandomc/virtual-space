import { expect, test, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createDefaultProject } from '../src/domain/project/projectDocument';
import { addLevel } from '../src/domain/project/projectOperations';
import { TERMS_VERSION } from '../src/domain/policies/legalPolicy';

test('hardware sustained orbit benchmark measures sixty seconds in each visual style at one, four and twelve levels', async ({ page, context, browser }, testInfo) => {
  test.setTimeout(900000);
  const origin = 'http://127.0.0.1:5188', headers = { Origin: origin, 'Content-Type': 'application/json' };
  const signup = await context.request.post('/api/auth/register', { headers, data: { username: 'sustain_' + randomUUID().slice(0, 8), password: 'Graphics-test-5913', confirmPassword: 'Graphics-test-5913', termsVersion: TERMS_VERSION } });
  expect(signup.status(), await signup.text()).toBe(201);
  await page.goto('/designs');
  const device = await page.evaluate(() => {
    const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2');
    if (!gl) return { renderer: '', vendor: '', identified: false };
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const result = { renderer: String(debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)), vendor: String(debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)), identified: Boolean(debug), width: innerWidth, height: innerHeight, dpr: devicePixelRatio };
    gl.getExtension('WEBGL_lose_context')?.loseContext(); return result;
  });
  test.skip(!device.identified || /swiftshader|llvmpipe|lavapipe|software|microsoft basic|warp/i.test(device.renderer), 'This sustained benchmark requires an identified hardware GPU.');
  const results: unknown[] = [], errors: string[] = [], rendererWarnings: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
    else if (message.type() === 'warning' && /THREE|WebGPU|WebGL|renderer|texture|context/i.test(message.text()) && rendererWarnings.length < 200) rendererWarnings.push(message.text());
  });
  const path = testInfo.outputPath('sustained-rendering.json');
  const save = () => writeFile(path, JSON.stringify({ device, browser: browser.version(), notes: 'Active-level orbit, automatic device quality. Main frames count completed renderer submissions, not rAF callbacks or display presentation. Camera poses verify actual movement; effective quality and submission rates are sampled each second. CPU/cadence distributions contain up to the latest 4096 main frames. GPU duration is optional and asynchronously sampled; its latest result may span several main frames. A 10-FPS sanity floor only rejects unusable measurements: inspect each resolved 30/60 target separately. Diagnostics add overhead. This hardware does not represent physical Android/iOS.', errors, rendererWarnings, results }, null, 2));
  async function metrics(canvas: Locator) {
    const before = JSON.parse((await canvas.getAttribute('data-scene-metrics'))!).renderedFrames;
    await canvas.dispatchEvent('space-profile-snapshot');
    await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-scene-metrics'))!).renderedFrames).toBeGreaterThan(before);
    return JSON.parse((await canvas.getAttribute('data-scene-metrics'))!);
  }
  try { for (const count of [1, 4, 12]) for (const style of ['standard', 'realistic', 'hyperrealistic'] as const) {
    let project = createDefaultProject('Sustained ' + count + ' ' + style);
    for (let index = 1; index < count; index++) project = addLevel(project, { copy: true, name: 'Level ' + (index + 1) });
    project.renderQuality = style; project.activeLevelId = project.levels[0].id;
    for (let index = 0; index < 64; index++) {
      const level = project.levels[index % count], local = Math.floor(index / count);
      level.furniture.push({ id: randomUUID(), levelId: level.id, type: 'vanity', variant: 'vanity-double-drawers', x: -1.7 + local % 8 * .48, z: -1.6 + Math.floor(local / 8) * .45, width: .43, depth: .4, height: 1.1, rotation: 0, material: 'wood', color: '#c5a381' });
    }
    const created = await context.request.post('/api/rooms', { headers, data: { id: project.id, project } }); expect(created.status(), await created.text()).toBe(201);
    await page.goto('/editor?room=' + project.id + '&profile=1');
    const canvas = page.locator('.room-scene canvas');
    await expect(canvas).toHaveAttribute('data-scene-metrics', /renderedFrames/, { timeout: 60000 });
    await page.waitForTimeout(3000);
    await canvas.dispatchEvent('space-profile-reset');
    const before = await metrics(canvas), box = (await canvas.boundingBox())!;
    const center = { x: box.x + box.width * .13, y: box.y + box.height * .13 };
    await page.mouse.move(center.x, center.y); await page.mouse.down();
    const started = Date.now(), samples = [before];
    let nextSample = started + 1000, pointerMoves = 0, unexpectedDrag = false;
    try {
      while (Date.now() - started < 60000) {
        const phase = (Date.now() - started) / 1500;
        await page.mouse.move(center.x + Math.sin(phase) * box.width * .075, center.y + Math.sin(phase * .7) * box.height * .055);
        pointerMoves++;
        if (Date.now() >= nextSample) {
          const sample = JSON.parse((await canvas.getAttribute('data-scene-metrics'))!);
          if (sample.sampledAt > samples[samples.length - 1].sampledAt) samples.push(sample);
          unexpectedDrag ||= JSON.parse((await canvas.getAttribute('data-scene-interaction'))!).dragging;
          nextSample = Date.now() + 1000;
        }
        await page.waitForTimeout(16);
      }
    } finally { await page.mouse.up(); }
    const durationMs = Date.now() - started, after = await metrics(canvas);
    samples.push(after);
    const windows = samples.slice(1).map((sample, index) => {
      const previous = samples[index], elapsed = sample.sampledAt - previous.sampledAt;
      const dot = sample.camera.quaternion.reduce((sum: number, value: number, axis: number) => sum + value * previous.camera.quaternion[axis], 0);
      const angleRadians = 2 * Math.acos(Math.min(1, Math.abs(dot)));
      const distance = Math.hypot(...sample.camera.position.map((value: number, axis: number) => value - previous.camera.position[axis]));
      const frames = sample.renderedFrames - previous.renderedFrames, submittedFps = frames / elapsed * 1000;
      return { elapsedMs: elapsed, frames, submittedFps, camera: sample.camera, orbitAngleRadians: angleRadians, orbitDistance: distance, graphics: sample.graphics, pixelRatio: sample.pixelRatio, targetMet: submittedFps >= (sample.graphics.fps || 60) * .9, drawCalls: sample.drawCalls, gpuGeometries: sample.gpuGeometries, gpuTextures: sample.gpuTextures };
    }).filter(sample => sample.elapsedMs >= 500);
    const movingWindows = windows.filter(sample => sample.orbitAngleRadians > .005 && sample.orbitDistance > .005).length;
    const submittedFps = (after.renderedFrames - before.renderedFrames) / durationMs * 1000;
    results.push({ levels: count, furniture: 64, activeLevelFurniture: project.levels[0].furniture.length, style, backend: await canvas.getAttribute('data-backend'), durationMs, pointerMoves, unexpectedDrag, movingWindows, submittedMainFrames: after.renderedFrames - before.renderedFrames, submittedFps, targetMetWindows: windows.filter(sample => sample.targetMet).length, windows, before, after });
    await save();
    expect(unexpectedDrag, 'The input must orbit the camera rather than moving a scene object.').toBe(false);
    expect(windows.length, 'A continuous minute must produce fresh diagnostic windows.').toBeGreaterThanOrEqual(40);
    expect(movingWindows, 'Most sample windows must contain an actual orbit, not a stationary scene with synthetic requests.').toBeGreaterThanOrEqual(Math.ceil(windows.length * .8));
    expect(submittedFps, 'Severe stalls invalidate the sustained benchmark; resolved target attainment is reported separately.').toBeGreaterThan(10);
    expect(after.sampleWindow.cpu.count).toBeGreaterThan(300);
    if (new Set(samples.map(sample => sample.graphics.geometry)).size === 1) expect(after.architectureBuilds).toBe(before.architectureBuilds);
    const response = await context.request.get('/api/rooms/' + project.id); expect(response.status()).toBe(200);
    expect((await response.json()).project, 'Orbiting and automatic graphics must not edit the design.').toEqual(project);
    expect(errors).toEqual([]);
  } } finally {
    await save();
    await testInfo.attach('sustained-rendering.json', { path, contentType: 'application/json' });
  }
});
