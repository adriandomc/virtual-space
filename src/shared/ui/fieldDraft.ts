import { normalizeHex } from './color';

export function parseName(raw: string, maxLength = 80): string | null {
  const value = raw.trim();
  return value && value.length <= maxLength ? value : null;
}

export function parseNumber(raw: string, min: number, max: number): number | null {
  const text = raw.trim();
  if (!/^[+-]?(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(text)) return null;
  const value = Number(text.replace(',', '.'));
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

export function parseColor(raw: string, final = false): string | null {
  if (!final && !/^#?[\da-f]{6}$/i.test(raw.trim())) return null;
  return normalizeHex(raw);
}
