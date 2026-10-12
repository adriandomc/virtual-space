export function normalizeHex(value: string): string | null {
  const hex = value.trim().replace(/^#/, '');
  if (/^[\da-f]{6}$/i.test(hex)) return '#' + hex.toLowerCase();
  if (/^[\da-f]{3}$/i.test(hex)) return '#' + [...hex].map(character => character + character).join('').toLowerCase();
  return null;
}
