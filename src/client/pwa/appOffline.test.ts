import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmLocalSaved, registerBeforeAppUpdate } from './appOffline';

test('updates and exports flush previews before checking durable storage regardless of registration order', async () => {
  let draft = 'old', saved = 'old';
  const events: string[] = [];
  const durable = registerBeforeAppUpdate(async () => { events.push('durable'); await Promise.resolve(); saved = draft; }, 'durable');
  const flush = registerBeforeAppUpdate(async () => { events.push('flush'); await Promise.resolve(); draft = 'new'; });
  try { await confirmLocalSaved(); assert.deepEqual(events, ['flush', 'durable']); assert.equal(saved, 'new'); }
  finally { flush(); durable(); }
});

test('incomplete geometry blocks updates before durability can be reported', async () => {
  let checked = false;
  const durable = registerBeforeAppUpdate(async () => { checked = true; }, 'durable');
  const flush = registerBeforeAppUpdate(async () => { throw new Error('unfinished'); });
  try { await assert.rejects(confirmLocalSaved(), /unfinished/); assert.equal(checked, false); }
  finally { flush(); durable(); }
});
