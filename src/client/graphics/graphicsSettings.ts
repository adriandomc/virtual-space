import { useSyncExternalStore } from 'react';

export type GraphicsProfile = {
  shadows: 0 | 512 | 1024 | 2048;
  textures: 512 | 1024 | 2048;
  renderScale: 0.5 | 0.75 | 1;
  geometry: 'low' | 'medium' | 'high';
  distance: 40 | 80 | 160;
  ao: 'off' | 'low' | 'medium' | 'high';
  fps: 0 | 30 | 60;
};
export type GraphicsKey = keyof GraphicsProfile;
export type GraphicsPreferences = { mode: 'auto' | 'manual' } & { [K in GraphicsKey]: GraphicsProfile[K] | 'auto' };
export type GraphicsDevice = { coarse: boolean; memoryGB: number; cores: number; width: number };
export const GRAPHICS_STORAGE_KEY = '3d-space-graphics-v1';
export const DEFAULT_GRAPHICS: GraphicsPreferences = { mode: 'auto', shadows: 'auto', textures: 'auto', renderScale: 'auto', geometry: 'auto', distance: 'auto', ao: 'auto', fps: 'auto' };
const choices: { [K in GraphicsKey]: readonly GraphicsProfile[K][] } = { shadows: [0, 512, 1024, 2048], textures: [512, 1024, 2048], renderScale: [0.5, 0.75, 1], geometry: ['low', 'medium', 'high'], distance: [40, 80, 160], ao: ['off', 'low', 'medium', 'high'], fps: [0, 30, 60] };

export function parseGraphicsPreferences(value: unknown): GraphicsPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_GRAPHICS };
  const raw = value as Record<string, unknown>, next = { ...DEFAULT_GRAPHICS };
  if (raw.mode === 'manual') next.mode = 'manual';
  for (const key of Object.keys(choices) as GraphicsKey[]) if ((choices[key] as readonly unknown[]).includes(raw[key])) Object.assign(next, { [key]: raw[key] });
  return next;
}

export function graphicsDevice(): GraphicsDevice {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return { coarse: false, memoryGB: 8, cores: 8, width: 1280 };
  return { coarse: window.matchMedia('(pointer: coarse)').matches, memoryGB: Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) || 4, cores: navigator.hardwareConcurrency || 4, width: window.innerWidth };
}

export function resolveGraphicsProfile(preferences: GraphicsPreferences, device = graphicsDevice()): GraphicsProfile {
  const low = device.memoryGB < 4 || device.cores <= 4 || device.coarse && device.width <= 700;
  const high = !device.coarse && device.memoryGB >= 8 && device.cores >= 8;
  const profile: GraphicsProfile = low
    ? { shadows: 512, textures: 512, renderScale: 0.75, geometry: 'low', distance: 40, ao: 'off', fps: 60 }
    : high ? { shadows: 2048, textures: 2048, renderScale: 1, geometry: 'high', distance: 160, ao: 'high', fps: 60 }
      : { shadows: 1024, textures: 1024, renderScale: 1, geometry: 'medium', distance: 80, ao: 'low', fps: 60 };
  for (const key of Object.keys(choices) as GraphicsKey[]) if (preferences[key] !== 'auto') Object.assign(profile, { [key]: preferences[key] });
  return profile;
}

/** Automatic tuning may reduce unpinned settings, never the user's explicit choices. */
export function reduceAutomaticGraphics(profile: GraphicsProfile, preferences: GraphicsPreferences): GraphicsProfile {
  if (preferences.mode !== 'auto') return profile;
  const next = { ...profile };
  if (preferences.ao === 'auto') next.ao = 'off';
  if (preferences.shadows === 'auto') next.shadows = profile.shadows > 1024 ? 1024 : 512;
  if (preferences.renderScale === 'auto') next.renderScale = profile.renderScale > 0.75 ? 0.75 : 0.5;
  if (preferences.geometry === 'auto') next.geometry = 'low';
  if (preferences.textures === 'auto') next.textures = profile.textures > 1024 ? 1024 : 512;
  if (preferences.distance === 'auto') next.distance = profile.distance > 80 ? 80 : 40;
  if (preferences.fps === 'auto') next.fps = 30;
  return next;
}

export function textureDimensions(width: number, height: number, maximum: number) {
  if (![width, height, maximum].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid texture dimensions.');
  const scale = Math.min(1, maximum / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

let preferences: GraphicsPreferences = { ...DEFAULT_GRAPHICS };
let adaptiveTier = 0;
try { if (typeof window !== 'undefined') preferences = parseGraphicsPreferences(JSON.parse(window.localStorage.getItem(GRAPHICS_STORAGE_KEY) ?? 'null')); } catch { /* Graphics choices remain available without device storage. */ }
const listeners = new Set<() => void>();
export const getGraphicsPreferences = () => preferences;
export const getAdaptiveGraphicsTier = () => adaptiveTier;
export function getGraphicsProfile() {
  let profile = resolveGraphicsProfile(preferences);
  for (let tier = 0; tier < adaptiveTier; tier++) profile = reduceAutomaticGraphics(profile, preferences);
  return profile;
}
export function subscribeGraphicsSettings(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function setGraphicsPreferences(next: GraphicsPreferences) {
  adaptiveTier = 0;
  preferences = parseGraphicsPreferences(next);
  try { window.localStorage.setItem(GRAPHICS_STORAGE_KEY, JSON.stringify(preferences)); } catch { /* Keep the preference for this tab. */ }
  listeners.forEach(listener => listener());
}
export function setGraphicsMode(mode: GraphicsPreferences['mode']) {
  setGraphicsPreferences(mode === 'auto' ? { ...DEFAULT_GRAPHICS } : { mode, ...getGraphicsProfile() });
}
export function resetGraphicsSettings() { setGraphicsPreferences({ ...DEFAULT_GRAPHICS }); }
export function setAdaptiveGraphicsTier(tier: number) {
  const next = Math.max(0, Math.min(2, Math.round(tier)));
  if (next === adaptiveTier || preferences.mode !== 'auto') return;
  adaptiveTier = next; preferences = { ...preferences }; listeners.forEach(listener => listener());
}

/** Dwell times prevent quality oscillation and ignore a brief shader-compilation spike. */
export class GraphicsPerformanceController {
  tier: number;
  private slow = 0;
  private fast = 0;
  private sinceChange = 0;
  constructor(tier = getAdaptiveGraphicsTier()) { this.tier = tier; }
  reset(tier = getAdaptiveGraphicsTier()) { this.tier = tier; this.slow = this.fast = this.sinceChange = 0; }
  sample(cpuMs: number, elapsedMs: number, targetFps: number, automatic: boolean, interacting = true, gpuMs?: number): number | null {
    // Idle, resumed/background frames and first-frame compilation are not sustained performance.
    if (!automatic || !interacting || !Number.isFinite(cpuMs) || elapsedMs <= 0 || elapsedMs > 250 || cpuMs > 250) { this.slow = this.fast = 0; return null; }
    this.sinceChange += elapsedMs;
    const budget = 1000 / (targetFps || 60);
    const work = Math.max(cpuMs, Number.isFinite(gpuMs) ? gpuMs! : 0);
    if (elapsedMs > budget * 1.3 || work > budget * .9) { this.slow += elapsedMs; this.fast = 0; }
    // A capped 30-FPS cadence is not proof of headroom for 60. Require measured work below a 60-FPS budget.
    else if (elapsedMs < budget * 1.12 && work < Math.min(budget, 1000 / 60) * .6) { this.fast += elapsedMs; this.slow = 0; }
    else { this.slow = this.fast = 0; }
    const down = this.slow >= 2500 && this.sinceChange >= 8000 && this.tier < 2;
    const up = this.fast >= 15000 && this.sinceChange >= 20000 && this.tier > 0;
    if (!down && !up) return null;
    this.tier += down ? 1 : -1; this.slow = this.fast = this.sinceChange = 0;
    return this.tier;
  }
}
export function useGraphicsSettings() { return useSyncExternalStore(subscribeGraphicsSettings, getGraphicsPreferences, () => DEFAULT_GRAPHICS); }
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== GRAPHICS_STORAGE_KEY) return;
  adaptiveTier = 0;
  try { preferences = parseGraphicsPreferences(JSON.parse(event.newValue ?? 'null')); } catch { preferences = { ...DEFAULT_GRAPHICS }; }
  listeners.forEach(listener => listener());
});
