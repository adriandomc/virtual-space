/** Persisted JSON object order is not part of a document's identity. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => sameData(value, b[index]));
  const first = a as Record<string, unknown>, second = b as Record<string, unknown>, keys = Object.keys(first).filter(key => first[key] !== undefined);
  return keys.length === Object.keys(second).filter(key => second[key] !== undefined).length && keys.every(key => Object.hasOwn(second, key) && sameData(first[key], second[key]));
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, (item as Record<string, unknown>)[key]])) : item);
}
