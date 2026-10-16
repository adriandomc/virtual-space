import assert from 'node:assert/strict';
import test from 'node:test';
import { appStartupIdle, appActivityReason, appVersion, assertCurrentAppVersion, beginAppActivity, markAppInteraction, registerAppActivity, setAppUpdateReady, setAppVersion } from './appActivity';

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

test('new edit boundaries reject unchecked or outdated versions without altering pending activity', () => {
  const pending = beginAppActivity('An existing draft');
  try {
    for (const version of ['checking', 'outdated'] as const) { setAppVersion(version); assert.equal(appVersion(), version); assert.throws(assertCurrentAppVersion, version === 'checking' ? /Espera a que termine/ : /Actualiza la aplicación/); assert.equal(appActivityReason(), 'An existing draft'); }
    setAppVersion('current'); assert.doesNotThrow(assertCurrentAppVersion);
  } finally { pending(); setAppVersion('current'); }
});
