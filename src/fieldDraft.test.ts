import assert from 'node:assert/strict';
import test from 'node:test';
import { parseColor, parseName, parseNumber } from './fieldDraft';

test('los nombres pueden estar vacíos mientras se editan pero sólo se confirma texto válido', () => {
  for (const raw of ['', ' ', '\t\n', 'a'.repeat(81)]) assert.equal(parseName(raw), null);
  assert.equal(parseName('  Mi diseño nuevo  '), 'Mi diseño nuevo');
  assert.equal(parseName('M'), 'M');
  assert.equal(parseName('a'.repeat(80)), 'a'.repeat(80));
  assert.equal(parseName('abc', 2), null);
});

test('los números incompletos y coerciones peligrosas nunca se guardan como cero u otro número', () => {
  for (const raw of ['', ' ', '\t\n', '-', '+', '.', ',', '1.', '1,', '1e', '1e3', '0x10', '2m', '2.5.1', '1,5.2', 'NaN', 'Infinity', '-Infinity']) {
    assert.equal(parseNumber(raw, -50, 50), null, raw);
  }
  assert.equal(parseNumber('9'.repeat(400), -Infinity, Infinity), null);
  assert.equal(parseNumber('-0.1', 0, 50), null);
  assert.equal(parseNumber('50.01', 0, 50), null);
  assert.equal(parseNumber('0', 0.5, 50), null);
});

test('los decimales completos, la coma y los límites incluidos sí son válidos', () => {
  assert.equal(parseNumber('0', 0, 50), 0);
  assert.equal(parseNumber('50', 0, 50), 50);
  assert.equal(parseNumber('005.20', 0, 50), 5.2);
  assert.equal(parseNumber('5,20', 0, 50), 5.2);
  assert.equal(parseNumber('.5', 0, 50), 0.5);
  assert.equal(parseNumber('-,5', -50, 50), -0.5);
  assert.equal(parseNumber(' 2.5 ', 0, 50), 2.5);
  assert.equal(parseNumber('5.234', 0, 50), 5.234);
});

test('el color conserva borradores parciales y normaliza sólo códigos completos o confirmados', () => {
  for (const raw of ['', '#', 'ab', '#abc', '#abcd', '#abcdefg', 'red', 'rgb(1,2,3)']) assert.equal(parseColor(raw), null, raw);
  assert.equal(parseColor('#ABCDEF'), '#abcdef');
  assert.equal(parseColor('  ABCDEF  '), '#abcdef');
  assert.equal(parseColor('abc', true), '#aabbcc');
  assert.equal(parseColor('#ABC', true), '#aabbcc');
  assert.equal(parseColor('#ABCDEF', true), '#abcdef');
  for (const raw of ['', ' ', '#', '#abcd', '#abcxyz']) assert.equal(parseColor(raw, true), null, raw);
});
