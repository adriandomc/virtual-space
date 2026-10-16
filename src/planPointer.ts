import type { Point } from './types';

export type PlanPointerFrame = {
  inverse: { a: number; b: number; c: number; d: number; e: number; f: number };
  view: { scale: number; cx: number; cz: number };
};

type ScreenPoint = { clientX: number; clientY: number };
export type PlanGesture = { frame: PlanPointerFrame; first: ScreenPoint; second: ScreenPoint };

export function planPointerSvg(point: ScreenPoint, { inverse: m }: PlanPointerFrame) {
  return { x: m.a * point.clientX + m.c * point.clientY + m.e, y: m.b * point.clientX + m.d * point.clientY + m.f };
}

/** Map through the current SVG matrix; a gesture can keep its original world view. */
export function planPointerWorld(point: { clientX: number; clientY: number }, frame: PlanPointerFrame): Point {
  const { view } = frame, p = planPointerSvg(point, frame);
  return { x: (p.x - 340) / view.scale + view.cx, z: (p.y - 230) / view.scale + view.cz };
}

export function planGestureView(first: ScreenPoint, second: ScreenPoint, gesture: PlanGesture) {
  const { frame } = gesture, a = planPointerSvg(gesture.first, frame), b = planPointerSvg(gesture.second, frame), c = planPointerSvg(first, frame), d = planPointerSvg(second, frame);
  const scale = Math.max(4, Math.min(400, frame.view.scale * Math.hypot(d.x - c.x, d.y - c.y) / Math.max(.001, Math.hypot(b.x - a.x, b.y - a.y))));
  const anchor = planPointerWorld({ clientX: (gesture.first.clientX + gesture.second.clientX) / 2, clientY: (gesture.first.clientY + gesture.second.clientY) / 2 }, frame);
  return { scale, cx: anchor.x - ((c.x + d.x) / 2 - 340) / scale, cz: anchor.z - ((c.y + d.y) / 2 - 230) / scale };
}

export function planGrabPosition(anchor: Point, origin: Point, pointer: Point) {
  return { x: anchor.x + pointer.x - origin.x, z: anchor.z + pointer.z - origin.z };
}
