export function normalizeHex(value: string): string | null {
  const hex = value.trim().replace(/^#/, '');
  if (/^[\da-f]{6}$/i.test(hex)) return '#' + hex.toLowerCase();
  if (/^[\da-f]{3}$/i.test(hex)) return '#' + [...hex].map(character => character + character).join('').toLowerCase();
  return null;
}

export function hexToRgb(value: string): [number, number, number] {
  const hex = normalizeHex(value) ?? '#ffffff';
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)) as [number, number, number];
}
export function rgbToHex(rgb: readonly number[]): string {
  return '#' + rgb.map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('');
}
export function hexToHsv(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(value => value / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const hue = !delta ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return [hue * 60, max ? delta / max : 0, max];
}
export function hsvToHex(hue: number, saturation: number, value: number): string {
  const h = ((hue % 360) + 360) % 360 / 60, chroma = value * saturation, x = chroma * (1 - Math.abs(h % 2 - 1)), m = value - chroma;
  const rgb = h < 1 ? [chroma, x, 0] : h < 2 ? [x, chroma, 0] : h < 3 ? [0, chroma, x] : h < 4 ? [0, x, chroma] : h < 5 ? [x, 0, chroma] : [chroma, 0, x];
  return rgbToHex(rgb.map(channel => (channel + m) * 255));
}

export function wheelHue(x: number, y: number, previous: number): number {
  return Math.hypot(x, y) < .001 ? previous : (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function hueKey(hue: number, key: string, shift = false): number | null {
  if (key === 'Home') return 0;
  if (key === 'End') return 359;
  const direction = key === 'ArrowRight' || key === 'ArrowUp' || key === 'PageUp' ? 1 : key === 'ArrowLeft' || key === 'ArrowDown' || key === 'PageDown' ? -1 : 0;
  return direction ? (hue + direction * (shift || key.startsWith('Page') ? 10 : 1) + 360) % 360 : null;
}
