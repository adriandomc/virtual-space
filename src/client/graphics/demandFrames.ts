type Options = {
  fps?: () => number;
  hidden?: () => boolean;
  request?: (callback: FrameRequestCallback) => number;
  cancel?: (handle: number) => void;
};

/** Draw only after invalidation, retaining frames while orbit damping is still moving. */
export function createDemandFrames(draw: () => boolean | void, options: Options = {}) {
  const request = options.request ?? requestAnimationFrame, cancel = options.cancel ?? cancelAnimationFrame;
  const hidden = options.hidden ?? (() => typeof document !== 'undefined' && document.visibilityState === 'hidden');
  let handle: number | undefined, dirty = false, drawing = false, disposed = false, last = -Infinity;
  const schedule = () => { if (!disposed && !drawing && handle === undefined && !hidden()) handle = request(frame); };
  const frame = (time: number) => {
    handle = undefined;
    if (disposed || hidden()) return;
    const fps = options.fps?.() ?? 0;
    if (fps > 0 && time - last < 1000 / fps - .5) { schedule(); return; }
    if (!dirty) return;
    last = time; dirty = false; drawing = true;
    try { if (draw()) dirty = true; }
    finally { drawing = false; if (dirty) schedule(); }
  };
  const invalidate = () => { dirty = true; schedule(); };
  const visibility = () => {
    if (hidden()) { if (handle !== undefined) cancel(handle); handle = undefined; }
    else { last = -Infinity; invalidate(); }
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibility);
  return { invalidate, dispose() { disposed = true; if (handle !== undefined) cancel(handle); handle = undefined; if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibility); } };
}
