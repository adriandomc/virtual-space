export type WorkshopGroup = { id: string; name: string };

/** Extras describe selection groups only; they never change geometry or its hierarchy. */
export function readWorkshopGroup(value: unknown): WorkshopGroup | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const { id, name } = value as Record<string, unknown>;
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(id) || typeof name !== 'string') return null;
  const label = name.trim();
  if (!label || label.length > 80 || /[\u0000-\u001f\u007f]/.test(label)) return null;
  return { id, name: label };
}
