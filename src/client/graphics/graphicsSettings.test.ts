import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_GRAPHICS, GraphicsPerformanceController, parseGraphicsPreferences, reduceAutomaticGraphics, resolveGraphicsProfile, textureDimensions } from './graphicsSettings';

test('graphics preferences reject unknown and unsafe values without affecting project data', () => {
  assert.deepEqual(parseGraphicsPreferences(null), DEFAULT_GRAPHICS);
  assert.deepEqual(parseGraphicsPreferences({ shadows: 8192, textures: Infinity, renderScale: -1, fps: 1000, ao: 'yes', geometry: 'ultra' }), DEFAULT_GRAPHICS);
  const manual = parseGraphicsPreferences({ mode: 'manual', shadows: 0, textures: 512, renderScale: 0.5, fps: 0, ao: 'off', geometry: 'low', distance: 40 });
  assert.equal(manual.shadows, 0); assert.equal(manual.ao, 'off'); assert.equal(manual.fps, 0);
});
test('automatic graphics use modest mobile defaults and preserve pinned values during tuning', () => {
  const mobile = { coarse: true, memoryGB: 4, cores: 8, width: 390 };
  const initial = resolveGraphicsProfile(DEFAULT_GRAPHICS, mobile);
  assert.deepEqual(initial, { shadows: 512, textures: 512, renderScale: 0.75, geometry: 'low', distance: 40, ao: 'off', fps: 30 });
  const pinned = { ...DEFAULT_GRAPHICS, shadows: 2048 as const, fps: 60 as const, renderScale: 1 as const };
  const reduced = reduceAutomaticGraphics(resolveGraphicsProfile(pinned, mobile), pinned);
  assert.equal(reduced.shadows, 2048); assert.equal(reduced.fps, 60); assert.equal(reduced.renderScale, 1);
  const manual = { ...pinned, mode: 'manual' as const };
  const profile = resolveGraphicsProfile(manual, mobile);
  assert.equal(reduceAutomaticGraphics(profile, manual), profile);
});
test('automatic performance tuning requires sustained slowdown and a longer recovery before raising detail', () => {
  const controller = new GraphicsPerformanceController();
  assert.equal(controller.sample(180, 180, 60, true), null);
  let change: number | null = null;
  for (let elapsed = 0; elapsed < 8000; elapsed += 40) change = controller.sample(40, 40, 60, true) ?? change;
  assert.equal(change, 1);
  for (let elapsed = 0; elapsed < 12000; elapsed += 16) assert.equal(controller.sample(16, 16, 60, true), null);
  for (let elapsed = 0; elapsed < 9000; elapsed += 16) change = controller.sample(16, 16, 60, true) ?? change;
  assert.equal(change, 0);
  const fixed = new GraphicsPerformanceController();
  for (let i = 0; i < 1000; i++) assert.equal(fixed.sample(50, 50, 60, false), null);
});
test('texture resolution maintains aspect ratio and never enlarges original pixels', () => {
  assert.deepEqual(textureDimensions(1024, 1025, 512), { width: 512, height: 512 });
  assert.deepEqual(textureDimensions(4096, 2048, 1024), { width: 1024, height: 512 });
  assert.deepEqual(textureDimensions(256, 128, 2048), { width: 256, height: 128 });
  for (const invalid of [0, -1, Infinity, NaN]) assert.throws(() => textureDimensions(invalid, 10, 512));
});
