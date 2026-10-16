import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';

async function openMenu() {
  const exports: Record<string, any> = {}, states: boolean[] = []; let ref = 0;
  const source = ts.transpileModule(await readFile(new URL('./Popover.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(source, {
    exports, module: { exports }, HTMLElement: { prototype: {} },
    requestAnimationFrame: (callback: () => void) => callback(),
    require: (name: string) => name === 'react/jsx-runtime' ? jsx : name === 'react' ? {
      useCallback: (callback: unknown) => callback, useEffect() {}, useLayoutEffect() {}, useId: () => 'menu',
      useState: () => [true, (value: boolean) => states.push(value)],
      useRef: (value: unknown) => ({ current: value === false ? true : value === null ? ++ref === 1 ? { contains: () => false, focus() {} } : {} : value }),
    } : {},
  });
  const menu = exports.default({ label: 'Room', trigger: 'Room', role: 'menu', children: () => null });
  return { blur: menu.props.children[1].props.onBlur as (event: unknown) => void, states };
}

test('a menu blur without a focus destination does not unmount a pointer activation', async () => {
  const menu = await openMenu(); menu.blur({ relatedTarget: null, currentTarget: { contains: () => false } });
  assert.deepEqual(menu.states, []);
});

test('moving keyboard focus to another control still dismisses a menu', async () => {
  const menu = await openMenu(); menu.blur({ relatedTarget: {}, currentTarget: { contains: () => false } });
  assert.deepEqual(menu.states, [false]);
});
