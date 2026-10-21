import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createDefaultProject } from '../src/domain/project/projectDocument';
import { TERMS_VERSION } from '../src/domain/policies/legalPolicy';

type Upload = { label: string; format: string; width: number; height: number };
type AssetProbe = { gpu: Upload[]; gl: number; errors: string[]; devices: GPUDevice[] };
const probe = (page: Page) => page.evaluate(() => {
  const value = (window as unknown as { assetProbe: AssetProbe }).assetProbe;
  return { gpu: value.gpu, gl: value.gl, errors: value.errors, devices: value.devices.length };
});

async function metrics(canvas: Locator) {
  const previous = JSON.parse((await canvas.getAttribute('data-scene-metrics'))!).renderCalls;
  await canvas.dispatchEvent('space-profile-snapshot');
  await expect.poll(async () => JSON.parse((await canvas.getAttribute('data-scene-metrics'))!).renderCalls).toBeGreaterThan(previous);
  return JSON.parse((await canvas.getAttribute('data-scene-metrics'))!) as { textures: number; textureBytes: number; gpuTextures: number; drawCalls: number };
}

for (const backend of ['webgpu', 'webgl2'] as const) test(`hyperrealistic KTX2 maps upload on hardware ${backend} and survive renderer recovery`, async ({ page, context, browser }, testInfo) => {
  test.setTimeout(180000);
  await context.addInitScript(({ fallback }) => {
    // Observe actual backend uploads, not just successful HTTP responses or mesh counts.
    const state: AssetProbe = { gpu: [], gl: 0, errors: [], devices: [] };
    (window as unknown as { assetProbe: AssetProbe }).assetProbe = state;
    localStorage.setItem('3d-space-graphics-v1', JSON.stringify({ mode: 'manual', textures: 1024, shadows: 512, renderScale: .75, geometry: 'medium', distance: 40, ao: 'off', fps: 30 }));
    if (fallback) Object.defineProperty(navigator, 'gpu', { configurable: true, value: undefined });
    if (typeof GPUDevice !== 'undefined') {
      const create = GPUDevice.prototype.createTexture;
      GPUDevice.prototype.createTexture = function (descriptor) {
        if (!state.devices.includes(this)) {
          state.devices.push(this);
          this.addEventListener('uncapturederror', event => state.errors.push((event as GPUUncapturedErrorEvent).error.message));
        }
        const size = descriptor.size as GPUExtent3DDict;
        if (descriptor.label?.includes('/materials/ktx2/')) state.gpu.push({ label: descriptor.label, format: descriptor.format, width: Number(size.width), height: Number(size.height ?? 1) });
        return create.call(this, descriptor);
      };
    }
    if (typeof WebGL2RenderingContext !== 'undefined') {
      const upload = WebGL2RenderingContext.prototype.compressedTexSubImage2D;
      WebGL2RenderingContext.prototype.compressedTexSubImage2D = function (...args: unknown[]) {
        const result = Reflect.apply(upload, this, args);
        const error = this.getError(); if (error !== this.NO_ERROR) state.errors.push('Compressed WebGL upload error ' + error);
        if (args[1] === 0 && Number(args[4]) >= 512) state.gl++;
        return result;
      };
    }
  }, { fallback: backend === 'webgl2' });
  const suffix = randomUUID().slice(0, 8), headers = { Origin: 'http://127.0.0.1:5188', 'Content-Type': 'application/json', 'X-Forwarded-For': `198.18.${parseInt(suffix.slice(0, 2), 16)}.${parseInt(suffix.slice(2, 4), 16)}` };
  const signup = await context.request.post('/api/auth/register', { headers, data: { username: 'ktx_' + suffix, password: 'Ktx-smoke-5913', confirmPassword: 'Ktx-smoke-5913', termsVersion: TERMS_VERSION } });
  expect(signup.status(), await signup.text()).toBe(201);
  await page.goto('/designs');
  const hardware = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'), gl = canvas.getContext('webgl2');
    if (!gl) return { renderer: '', webgpu: false };
    const extension = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const adapter = await navigator.gpu?.requestAdapter();
    return { renderer, webgpu: Boolean(adapter) };
  });
  test.skip(!hardware.renderer || /swiftshader|llvmpipe|lavapipe|software|microsoft basic|warp/i.test(hardware.renderer), 'No identifiable hardware backend is available.');
  test.skip(backend === 'webgpu' && !hardware.webgpu, 'Hardware WebGPU is unavailable; fallback has its own test.');

  const project = createDefaultProject('KTX2 materials'), level = project.levels[0];
  project.renderQuality = 'hyperrealistic';
  level.surfaces[0].finish.material = 'marble';
  project.roofs[0].finish.material = 'concrete';
  level.furniture.push({ id: randomUUID(), levelId: level.id, type: 'bed', bedSize: 'single', x: -1.1, z: 0, width: 1, depth: 1.9, height: 1.1, rotation: 0, material: 'wood', color: '#b8a084' });
  level.furniture.push({ id: randomUUID(), levelId: level.id, type: 'wardrobe', variant: 'wardrobe-classic', x: 1.1, z: -1.1, width: .8, depth: .5, height: 2, rotation: 0, material: 'wood', color: '#c5a381' });
  const created = await context.request.post('/api/rooms', { headers, data: { id: project.id, project } });
  expect(created.status(), await created.text()).toBe(201);
  const errors: string[] = [], failed: string[] = [], maps = new Set<string>(), jpegFallbacks = new Set<string>();
  let requestingDeviceLoss = false, expectedDeviceLosses = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    const text = message.text();
    if (requestingDeviceLoss && text.startsWith(`THREE.WebGPURenderer: ${backend === 'webgpu' ? 'WebGPU' : 'WebGL'} Device Lost:`)) { expectedDeviceLosses++; return; }
    if (message.type() === 'error' || /GPUValidationError|VALIDATION_ERROR|INVALID_(?:OPERATION|VALUE|ENUM)|Architectural texture (?:unavailable|loader)/i.test(text)) errors.push(text);
  });
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if (/\.(?:ktx2|wasm|hdr|js|css)$/.test(path) && response.status() >= 400) failed.push(path + ':' + response.status());
    if (path.endsWith('.ktx2') && response.ok()) maps.add(path);
    if (path.startsWith('/materials/') && path.endsWith('.jpg')) jpegFallbacks.add(path);
  });
  page.on('requestfailed', request => { if (/\.(?:ktx2|wasm|hdr|js|css)(?:\?|$)/.test(request.url())) failed.push(request.url() + ':' + request.failure()?.errorText); });
  await page.goto('/editor?room=' + project.id + '&profile=1');
  const canvas = page.locator('.room-scene canvas');
  await expect(canvas).toHaveAttribute('data-backend', backend, { timeout: 60000 });
  await expect(canvas).toHaveAttribute('data-scene-metrics', /gpuTextures/, { timeout: 60000 });
  // Bed, walls, marble floor and concrete roof exercise every bundled surface, including fabric.
  await expect.poll(() => maps.size, { timeout: 60000 }).toBe(15);
  const uploaded = async () => { const value = await probe(page); return backend === 'webgpu' ? value.gpu.filter(upload => /^(?:bc|etc2|astc)/.test(upload.format)).length : value.gl; };
  // The hidden roof may stay CPU-resident until shown; four visible materials require twelve maps.
  await expect.poll(uploaded, { timeout: 60000 }).toBeGreaterThanOrEqual(12);
  const before = await metrics(canvas), baseline = await uploaded();
  expect(before.textures).toBeGreaterThanOrEqual(12); expect(before.textureBytes).toBeGreaterThan(0); expect(before.drawCalls).toBeGreaterThan(0);
  expect(jpegFallbacks.size, 'KTX2 must decode successfully instead of silently using JPEGs').toBe(0);
  expect(failed).toEqual([]); expect(errors).toEqual([]); expect((await probe(page)).errors).toEqual([]);
  const materialsPath = testInfo.outputPath(backend + '-materials.jpg');
  await page.screenshot({ type: 'jpeg', path: materialsPath });
  await testInfo.attach(backend + '-materials.jpg', { path: materialsPath, contentType: 'image/jpeg' });

  const oldCanvas = await canvas.elementHandle();
  requestingDeviceLoss = true;
  if (backend === 'webgpu') await page.evaluate(() => (window as unknown as { assetProbe: AssetProbe }).assetProbe.devices[0].destroy());
  else await canvas.dispatchEvent('webglcontextlost', { cancelable: true });
  await expect.poll(() => oldCanvas!.evaluate(element => element.isConnected)).toBe(false);
  await expect(canvas).toHaveAttribute('data-backend', backend, { timeout: 60000 });
  await expect(canvas).toHaveAttribute('data-scene-metrics', /gpuTextures/, { timeout: 60000 });
  await expect.poll(uploaded, { timeout: 60000 }).toBeGreaterThanOrEqual(baseline + 12);
  requestingDeviceLoss = false;
  expect(expectedDeviceLosses).toBe(1);
  const after = await metrics(canvas), uploads = await probe(page);
  expect(after.gpuTextures).toBeLessThanOrEqual(before.gpuTextures + 8);
  expect(uploads.errors).toEqual([]); expect(failed).toEqual([]); expect(errors).toEqual([]); expect(jpegFallbacks.size).toBe(0);
  const saved = await context.request.get('/api/rooms/' + project.id); expect((await saved.json()).project).toEqual(project);
  const recoveredPath = testInfo.outputPath(backend + '-recovered.jpg'), assetPath = testInfo.outputPath(backend + '-assets.json');
  await page.screenshot({ type: 'jpeg', path: recoveredPath });
  await writeFile(assetPath, JSON.stringify({ hardware, browser: browser.version(), maps: [...maps], before, after, uploads }, null, 2));
  await testInfo.attach(backend + '-recovered.jpg', { path: recoveredPath, contentType: 'image/jpeg' });
  await testInfo.attach(backend + '-assets.json', { path: assetPath, contentType: 'application/json' });
});
