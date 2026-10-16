import type { Point } from './types';

export type PlanPointerFrame = {
  inverse: { a: number; b: number; c: number; d: number; e: number; f: number };
  view: { scale: number; cx: number; cz: number };
};

/** Keep the pointer's original screen/world frame when contextual controls reflow during a drag. */
export function planPointerWorld(point: { clientX: number; clientY: number }, frame: PlanPointerFrame): Point {
  const { inverse: m, view } = frame;
  return { x: (m.a * point.clientX + m.c * point.clientY + m.e - 340) / view.scale + view.cx, z: (m.b * point.clientX + m.d * point.clientY + m.f - 230) / view.scale + view.cz };
}
