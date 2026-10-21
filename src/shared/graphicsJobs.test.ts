import assert from 'node:assert/strict';
import test from 'node:test';
import { GraphicsJobBudget } from './graphicsJobs';

test('heavy tasks share a bounded budget, cancelled waiters do not run and release is idempotent', async () => {
  const budget = new GraphicsJobBudget(1, 2), first = await budget.acquire();
  const controller = new AbortController(), cancelled = budget.acquire(controller.signal);
  const next = budget.acquire();
  await assert.rejects(budget.acquire(), /full/);
  controller.abort(); await assert.rejects(cancelled, { name: 'AbortError' });
  assert.deepEqual(budget.usage, { running: 1, waiting: 1, limit: 1 });
  first(); first(); const second = await next;
  assert.deepEqual(budget.usage, { running: 1, waiting: 0, limit: 1 });
  second(); assert.equal(budget.usage.running, 0);
});
