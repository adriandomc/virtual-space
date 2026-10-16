import assert from 'node:assert/strict';
import test from 'node:test';
import messagesEs from './locales/es/messages.json';
import messagesEn from './locales/en/messages.json';
import errorsEs from './locales/es/errors.json';
import errorsEn from './locales/en/errors.json';
import editorEs from './locales/es/editor.json';
import editorEn from './locales/en/editor.json';
import { createMessageTranslator } from './messageLocalization';
import { createDefaultRoom, fitRoom, validateRoom } from './model';
import { parseProjectBackup } from './projectBackup';

const catalogs = {
  es: { ...errorsEs, ...editorEs, ...messagesEs } as Record<string, string>,
  en: { ...errorsEn, ...editorEn, ...messagesEn } as Record<string, string>,
};
function translator(language: 'es' | 'en' = 'en') {
  let locale = language;
  const t = createMessageTranslator(catalogs, (key, values) => (catalogs[locale][key] ?? key).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(values?.[name] ?? '{{' + name + '}}')));
  return { t, language: (value: 'es' | 'en') => { locale = value; } };
}
function errorMessage(operation: () => unknown): string {
  try { operation(); } catch (error) { assert.ok(error instanceof Error); return error.message; }
  assert.fail('Expected a validation error');
}

test('formats real room, opening, light, and wall validation messages in the active language', () => {
  const { t } = translator();
  const room = createDefaultRoom();
  const height = errorMessage(() => validateRoom({ ...room, height: 0 }));
  assert.equal(t(height), 'The height: use a number between 1.8 and 8.');
  const light = errorMessage(() => validateRoom({ ...room, lights: [{ ...room.lights[0], x: 100 }] }));
  assert.equal(t(light), 'Light 1, X: use a number between -50 and 50.');
  const outside = errorMessage(() => validateRoom({ ...room, lights: [{ ...room.lights[0], x: 20 }], editing: { ...room.editing, bounds: true } }));
  assert.equal(t(outside), 'Light 1 must be inside the room.');
  const opening = errorMessage(() => validateRoom({ ...room, openings: [{ id: 'door-1', type: 'door', doorStyle: 'right', open: false, width: 0, height: 2, sill: 0, offset: 0, wall: 0 }] }));
  assert.equal(t(opening), 'Opening 1 width: use a number between 0.3 and 5.');
  assert.equal(t('Dos aberturas se superponen en la pared 3.'), 'Two openings overlap on wall 3.');
  const tooShort = errorMessage(() => fitRoom({ ...room, vertices: [{ x: 0, z: 0 }, { x: 0.2, z: 0 }, { x: 5, z: 4 }, { x: 0, z: 4 }], openings: [{ id: 'door-1', type: 'door', doorStyle: 'right', open: false, width: 0.8, height: 2, sill: 0, offset: 0, wall: 0 }] }));
  assert.equal(t(tooShort), 'A wall is too short to keep its opening.');
});

test('translates nested project backup validation messages and rejects obsolete archives', async () => {
  const { t } = translator();
  const invalidRoom = 'El respaldo no es válido: ' + errorMessage(() => validateRoom({ ...createDefaultRoom(), height: 0 }));
  assert.equal(t(invalidRoom), 'The backup is not valid: The height: use a number between 1.8 and 8.');
  const invalidSketch = 'El respaldo no es válido: El croquis contiene datos dañados.';
  assert.equal(t(invalidSketch), 'The backup is not valid: The sketch contains damaged data.');
  assert.equal(t('El respaldo no es válido: Un modelo supera 20 MB.'), 'The backup is not valid: A model exceeds 20 MB.');
  await assert.rejects(parseProjectBackup({ version: 1 }), /archivo \.3dspace actual/);
});

test('previously translated errors follow locale switches without changing user values', () => {
  const current = translator();
  const source = 'El respaldo no es válido: Color de mueble 2: usa un color hexadecimal de seis cifras.';
  const english = current.t(source);
  assert.equal(english, 'The backup is not valid: Furniture 2 color: use a six-digit hex color.');
  const staticEnglish = current.t('Las contraseñas no coinciden.');
  current.language('es');
  assert.equal(current.t(english), source);
  assert.equal(current.t(staticEnglish), 'Las contraseñas no coinciden.');
  current.language('en');
  assert.equal(current.t('No se pudo descargar Madera.'), 'Could not download Madera.');
  assert.equal(current.t('Pared {{number}}', { number: 'Madera' }), 'Wall Madera');
  assert.equal(current.t('Cama {{size}}', { size: 'Salvia suave' }), 'Salvia suave bed');
  assert.equal(current.t('{{label}}: debe ser un objeto.', { label: 'Madera' }), 'Madera: must be an object.');
});

test('specific templates win, metacharacters are escaped, and invalid patterns stay bounded', () => {
  const source = { '{{name}}': '{{name}}', 'Problema [{{label}}].': 'Problema [{{label}}].', 'Problema [{{label}}]. Detalle.': 'Problema [{{label}}]. Detalle.', 'Repite {{name}} / {{name}}.': 'Repite {{name}} / {{name}}.' };
  const english = { '{{name}}': '{{name}}', 'Problema [{{label}}].': 'Problem [{{label}}].', 'Problema [{{label}}]. Detalle.': 'Specific [{{label}}].', 'Repite {{name}} / {{name}}.': 'Repeat {{name}} / {{name}}.' };
  const t = createMessageTranslator({ es: source, en: english }, (key, values) => english[key as keyof typeof english]?.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name])) ?? key);
  assert.equal(t('Problema [Plano]. Detalle.'), 'Specific [Plano].');
  assert.equal(t('Problema [Plano].'), 'Problem [Plano].');
  assert.equal(t('Problema XPlanoY.'), 'Problema XPlanoY.');
  assert.equal(t('Problema [].'), 'Problema [].');
  assert.equal(t('Problema [ ].'), 'Problema [ ].');
  assert.equal(t('Repite A / B.'), 'Repite A / B.');
  assert.equal(t('Repite A / A.'), 'Repeat A / A.');
  assert.equal(t('Unknown user name'), 'Unknown user name');
  const { t: actual } = translator();
  const deeplyNested = 'El respaldo no es válido: '.repeat(30) + 'revisa el diseño.';
  assert.ok(actual(deeplyNested).length < 2000);
  const oversized = 'El respaldo no es válido: ' + 'x'.repeat(5000);
  assert.equal(actual(oversized), oversized);
});

test('new message catalogs have matching keys and placeholders without conflicting existing translations', () => {
  assert.deepEqual(Object.keys(messagesEs).sort(), Object.keys(messagesEn).sort());
  for (const [key, value] of Object.entries(messagesEn)) {
    assert.ok(value.trim(), key);
    assert.deepEqual([...key.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort(), [...value.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort(), key);
    for (const other of [errorsEn, editorEn]) if (Object.hasOwn(other, key)) assert.equal(value, (other as Record<string, string>)[key], key);
  }
});

test('new locales join message resolution without modifying the translator', () => {
  const localized = { ...catalogs, fr: { 'Las contraseñas no coinciden.': 'Les mots de passe ne correspondent pas.', 'No se pudo descargar {{name}}.': 'Impossible de télécharger {{name}}.' } };
  const { t: english } = translator();
  const t = createMessageTranslator(localized, english);
  assert.equal(t('Les mots de passe ne correspondent pas.'), 'The passwords do not match.');
  assert.equal(t('Impossible de télécharger Madera.'), 'Could not download Madera.');
});
