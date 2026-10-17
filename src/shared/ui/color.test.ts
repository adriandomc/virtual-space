import assert from 'node:assert/strict';
import test from 'node:test';
import { hexToHsv, hexToRgb, hsvToHex, hueKey, normalizeHex, rgbToHex, wheelHue } from './color';

test('normaliza códigos hexadecimales pegados y rechaza colores incompletos o con alfa', () => {
  assert.equal(normalizeHex(' #Ab12CD '), '#ab12cd');
  assert.equal(normalizeHex('abc'), '#aabbcc');
  assert.equal(normalizeHex('123456'), '#123456');
  for (const invalid of ['', '#12', '#12345', '#11223344', 'red', 'rgb(1,2,3)', '#x12345']) assert.equal(normalizeHex(invalid), null);
});

test('la rueda conserva el tono en el centro y convierte el puntero alrededor del círculo sin depender del tamaño', () => {
  assert.equal(wheelHue(0, 0, 215), 215);
  for (const radius of [22, 100, 300]) {
    assert.equal(wheelHue(radius, 0, 0), 0);
    assert.equal(wheelHue(0, radius, 0), 90);
    assert.equal(wheelHue(-radius, 0, 0), 180);
    assert.equal(wheelHue(0, -radius, 0), 270);
    for (const hue of [0, 15, 120, 215, 359]) {
      const angle = hue * Math.PI / 180;
      assert.ok(Math.abs(wheelHue(Math.cos(angle) * radius, Math.sin(angle) * radius, 0) - hue) < 1e-10);
    }
  }
});

test('la rueda admite teclado con pasos finos, amplios y regreso a los extremos sin salir del rango', () => {
  assert.equal(hueKey(359, 'ArrowRight'), 0);
  assert.equal(hueKey(0, 'ArrowLeft'), 359);
  assert.equal(hueKey(354, 'ArrowUp', true), 4);
  assert.equal(hueKey(4, 'ArrowDown', true), 354);
  assert.equal(hueKey(354, 'PageUp'), 4);
  assert.equal(hueKey(4, 'PageDown'), 354);
  assert.equal(hueKey(120, 'Home'), 0);
  assert.equal(hueKey(120, 'End'), 359);
  for (const key of ['Tab', 'Escape', 'Enter', 'a']) assert.equal(hueKey(120, key), null);
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
