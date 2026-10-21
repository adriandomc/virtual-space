import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemandFrames } from './demandFrames';

test('idle previews stop scheduling, settle damping, coalesce invalidations and respect frame limits', () => {
  const queued = new Map<number, FrameRequestCallback>(); let next = 1, draws = 0, moving = false;
  const frames = createDemandFrames(() => { draws++; return moving; }, { request: callback => { const id = next++; queued.set(id, callback); return id; }, cancel: id => { queued.delete(id); }, fps: () => 30, hidden: () => false });
  const tick = (time: number) => { const first = queued.entries().next().value; assert(first); queued.delete(first[0]); first[1](time); };
  assert.equal(queued.size, 0); frames.invalidate(); frames.invalidate(); assert.equal(queued.size, 1);
  tick(0); assert.equal(draws, 1); assert.equal(queued.size, 0);
  moving = true; frames.invalidate(); tick(10); assert.equal(draws, 1); tick(34); assert.equal(draws, 2); assert.equal(queued.size, 1);
  moving = false; tick(68); assert.equal(draws, 3); assert.equal(queued.size, 0);
  frames.invalidate(); frames.dispose(); assert.equal(queued.size, 0); frames.invalidate(); assert.equal(queued.size, 0);
});

test('hidden previews do not draw or queue work; active control invalidation during a frame is retained', () => {
  let hidden = true, draws = 0; const queued: FrameRequestCallback[] = [];
  const frames = createDemandFrames(() => { draws++; if (draws === 1) frames.invalidate(); }, { request: next => { queued.push(next); return 1; }, cancel: () => { queued.length = 0; }, hidden: () => hidden });
  frames.invalidate(); assert.equal(queued.length, 0);
  hidden = false; frames.invalidate(); queued.shift()!(0); assert.equal(draws, 1); assert.equal(queued.length, 1);
  queued.shift()!(17); assert.equal(draws, 2); assert.equal(queued.length, 0); frames.dispose();
});
