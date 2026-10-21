import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_GRAPHICS, GraphicsPerformanceController, getAdaptiveGraphicsTier, parseGraphicsPreferences, reduceAutomaticGraphics, resetGraphicsSettings, resolveGraphicsProfile, setAdaptiveGraphicsTier, textureDimensions } from './graphicsSettings';

test('graphics preferences reject unknown and unsafe values without affecting project data', () => {
  assert.deepEqual(parseGraphicsPreferences(null), DEFAULT_GRAPHICS);
  assert.deepEqual(parseGraphicsPreferences({ shadows: 8192, textures: Infinity, renderScale: -1, fps: 1000, ao: 'yes', geometry: 'ultra' }), DEFAULT_GRAPHICS);
  const manual = parseGraphicsPreferences({ mode: 'manual', shadows: 0, textures: 512, renderScale: 0.5, fps: 0, ao: 'off', geometry: 'low', distance: 40 });
  assert.equal(manual.shadows, 0); assert.equal(manual.ao, 'off'); assert.equal(manual.fps, 0);
});
test('automatic graphics use modest mobile defaults and preserve pinned values during tuning', () => {
  const mobile = { coarse: true, memoryGB: 4, cores: 8, width: 390 };
  const initial = resolveGraphicsProfile(DEFAULT_GRAPHICS, mobile);
  assert.deepEqual(initial, { shadows: 512, textures: 512, renderScale: 0.75, geometry: 'low', distance: 40, ao: 'off', fps: 60 });
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
  for (let elapsed = 0; elapsed < 12000; elapsed += 16) assert.equal(controller.sample(5, 16, 60, true), null);
  for (let elapsed = 0; elapsed < 9000; elapsed += 16) change = controller.sample(5, 16, 60, true) ?? change;
  assert.equal(change, 0);
  const fixed = new GraphicsPerformanceController();
  for (let i = 0; i < 1000; i++) assert.equal(fixed.sample(50, 50, 60, false), null);
});
test('automatic detail cannot recover during idle frames or because a 30-FPS cap hides expensive work', () => {
  const controller = new GraphicsPerformanceController();
  for (let elapsed = 0; elapsed < 8000; elapsed += 40) controller.sample(25, 40, 60, true);
  assert.equal(controller.tier, 1);
  for (let elapsed = 0; elapsed < 30000; elapsed += 33) assert.equal(controller.sample(2, 33, 30, true, false), null);
  for (let elapsed = 0; elapsed < 30000; elapsed += 33) assert.equal(controller.sample(20, 33, 30, true), null);
  assert.equal(controller.tier, 1);
});

test('a recreated controller starts at the active tier and can recover quality after sustained movement', () => {
  resetGraphicsSettings(); setAdaptiveGraphicsTier(2);
  try {
    const recovered = new GraphicsPerformanceController(); assert.equal(recovered.tier, 2);
    let next: number | null = null;
    for (let elapsed = 0; elapsed < 21000; elapsed += 33) next = recovered.sample(4, 33, 30, true) ?? next;
    assert.equal(next, 1); setAdaptiveGraphicsTier(next!);
    const remounted = new GraphicsPerformanceController(); assert.equal(remounted.tier, 1);
    setAdaptiveGraphicsTier(0); remounted.reset(); assert.equal(remounted.tier, getAdaptiveGraphicsTier());
  } finally { resetGraphicsSettings(); }
});
test('texture resolution maintains aspect ratio and never enlarges original pixels', () => {
  assert.deepEqual(textureDimensions(1024, 1025, 512), { width: 512, height: 512 });
  assert.deepEqual(textureDimensions(4096, 2048, 1024), { width: 1024, height: 512 });
  assert.deepEqual(textureDimensions(256, 128, 2048), { width: 256, height: 128 });
  for (const invalid of [0, -1, Infinity, NaN]) assert.throws(() => textureDimensions(invalid, 10, 512));
});
