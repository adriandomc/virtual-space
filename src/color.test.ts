import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeHex } from './color';

test('normaliza códigos hexadecimales pegados y rechaza colores incompletos o con alfa', () => {
  assert.equal(normalizeHex(' #Ab12CD '), '#ab12cd');
  assert.equal(normalizeHex('abc'), '#aabbcc');
  assert.equal(normalizeHex('123456'), '#123456');
  for (const invalid of ['', '#12', '#12345', '#11223344', 'red', 'rgb(1,2,3)', '#x12345']) assert.equal(normalizeHex(invalid), null);
});
