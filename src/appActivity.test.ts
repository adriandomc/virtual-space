import assert from 'node:assert/strict';
import test from 'node:test';
import { appStartupIdle, appActivityReason, beginAppActivity, markAppInteraction, registerAppActivity, setAppUpdateReady } from './appActivity';

test('startup readiness never turns a used session idle, while unfinished fields and operations block saving', () => {
  assert.equal(appStartupIdle(), false); setAppUpdateReady(true); assert.equal(appStartupIdle(), true);
  const operation = beginAppActivity('Uploading'); assert.equal(appStartupIdle(), false); assert.equal(appActivityReason(), 'Uploading');
  operation(); assert.equal(appStartupIdle(), true);
  let composing = true; const field = registerAppActivity(() => composing ? 'Finish input' : false);
  assert.equal(appActivityReason(), 'Finish input'); composing = false; assert.equal(appStartupIdle(), true); field();
  markAppInteraction(); assert.equal(appStartupIdle(), false); setAppUpdateReady(false); setAppUpdateReady(true); assert.equal(appStartupIdle(), false);
});

test('an unmounted component and a failed sibling cannot release an operation still running', () => {
  let busy = true;
  const component = registerAppActivity(() => busy), upload = beginAppActivity('Uploading'), sibling = beginAppActivity('Importing');
  busy = false; component(); sibling(); sibling();
  assert.equal(appActivityReason(), 'Uploading');
  upload(); assert.equal(appActivityReason(), '');
});
