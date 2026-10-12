import type { Room } from './types';

export function renderPixelRatio(deviceRatio: number, quality: Room['renderQuality'], highResolution: boolean) {
  return Math.round(Math.min(deviceRatio, highResolution ? quality === 'hyperrealistic' ? 1.75 : 2 : 1.5) * 100) / 100;
}

export function joystickVector(x: number, z: number) {
  const length = Math.hypot(x, z);
  if (length < 0.08) return { x: 0, z: 0 };
  const scale = Math.max(1, length);
  return { x: x / scale, z: z / scale };
}

export function daylightFactor(day: number, openingArea: number, floorArea: number) {
  return day * Math.min(1, openingArea / floorArea * 5);
}
