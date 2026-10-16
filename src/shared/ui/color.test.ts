import assert from 'node:assert/strict';
import test from 'node:test';
import { hexToHsv, hexToRgb, hsvToHex, normalizeHex, rgbToHex } from './color';

test('normaliza códigos hexadecimales pegados y rechaza colores incompletos o con alfa', () => {
  assert.equal(normalizeHex(' #Ab12CD '), '#ab12cd');
  assert.equal(normalizeHex('abc'), '#aabbcc');
  assert.equal(normalizeHex('123456'), '#123456');
  for (const invalid of ['', '#12', '#12345', '#11223344', 'red', 'rgb(1,2,3)', '#x12345']) assert.equal(normalizeHex(invalid), null);
});

test('HSV y RGB conservan los colores sRGB guardados, incluidos grises y extremos', () => {
  for (const hex of ['#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff', '#808080', '#a4bd78', '#123456', '#f0a9ee']) {
    assert.equal(rgbToHex(hexToRgb(hex)), hex);
    assert.equal(hsvToHex(...hexToHsv(hex)), hex);
  }
  assert.equal(hsvToHex(360, 1, 1), '#ff0000');
  assert.equal(hsvToHex(-120, 1, 1), '#0000ff');
  assert.equal(rgbToHex([-1, 256, 127.8]), '#00ff80');
  for (const red of [0, 1, 51, 128, 204, 254, 255]) for (const green of [0, 1, 51, 128, 204, 254, 255]) for (const blue of [0, 1, 51, 128, 204, 254, 255]) {
    const hex = rgbToHex([red, green, blue]);
    assert.equal(hsvToHex(...hexToHsv(hex)), hex);
  }
});
