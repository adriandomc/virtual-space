import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const sourceDirectory = new URL('./', import.meta.url);
const localeDirectory = new URL('./locales/', import.meta.url);
const locales = readdirSync(localeDirectory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
const catalogs = Object.fromEntries(locales.map(locale => [locale, Object.fromEntries(
  readdirSync(new URL(locale + '/', localeDirectory)).filter(file => file.endsWith('.json')).sort().map(file => [file, JSON.parse(readFileSync(new URL(locale + '/' + file, localeDirectory), 'utf8')) as Record<string, string>]),
)]));
const merged = Object.fromEntries(locales.map(locale => [locale, Object.assign({}, ...Object.values(catalogs[locale])) as Record<string, string>]));
const placeholders = (value: string) => [...value.matchAll(/\{\{\s*([^},]+?)(?:\s*,[^}]+)?\s*\}\}/g)].map(match => match[1].trim()).sort();
const displayAttributes = new Set(['label', 'title', 'placeholder', 'alt', 'aria-label', 'aria-roledescription']);
const unitsAndKeys = new Set(['m', 'cm', 'mm', 'km', 'm²', 'm³', 'K', 'W', 'lm', 'lux', 'MB', 'GB', 'Hz', 'RGB', 'GLB', 'PNG', 'JPEG', 'JPG', 'WebP', 'WASD', 'X', 'Y', 'Z', 'Q', 'E', 'R', 'F', 'N', 'S']);

function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'JPEG signature');
  const frames = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 4 < bytes.length) {
    assert.equal(bytes[offset++], 0xff, 'JPEG marker');
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd7) continue;
    const length = bytes.readUInt16BE(offset);
    assert.ok(length >= 2 && offset + length <= bytes.length, 'JPEG segment bounds');
    if (frames.has(marker)) {
      assert.ok(length >= 8, 'JPEG frame bounds');
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  throw new Error('JPEG dimensions are missing');
}

function nonlinguistic(value: string) {
  const text = value.trim();
  if (!text || /^[23]D$/.test(text) || /^#[\da-f]{3,8}$/i.test(text) || /^[\d\s+−\-–—,.×÷%°²³()[\]#:;!?/\\·•…]*$/u.test(text)) return true;
  return text.split(/[\s\d+−\-–—,.×÷%°()[\]#:;!?/\\·•]+/u).filter(Boolean).every(token => unitsAndKeys.has(token) || token === 'glb');
}

function localizedArgument(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 't') {
      const key = parent.arguments[0];
      if (key && node.getStart() >= key.getStart() && node.end <= key.end) return true;
    }
  }
  return false;
}

function rawDisplayText(source: ts.SourceFile): string[] {
  const errors: string[] = [];
  const report = (node: ts.Node, value: string) => {
    if (!nonlinguistic(value)) errors.push(`${source.fileName}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${JSON.stringify(value.trim())}`);
  };
  const attributeText = (node: ts.Node) => {
    if (localizedArgument(node)) return;
    if (ts.isStringLiteralLike(node)) {
      const parent = node.parent;
      // Values compared to state are program identifiers, rather than displayed text.
      if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(parent.operatorToken.kind)) return;
      report(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      report(node.head, node.head.text);
      for (const span of node.templateSpans) report(span.literal, span.literal.text);
    }
    ts.forEachChild(node, attributeText);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) report(node, node.text);
    if (ts.isJsxAttribute(node) && displayAttributes.has(node.name.getText(source)) && node.initializer) attributeText(node.initializer);
    if (ts.isJsxExpression(node) && node.expression && !ts.isJsxAttribute(node.parent)) {
      const displayed = (expression: ts.Expression) => {
        if (ts.isStringLiteralLike(expression)) report(expression, expression.text);
        else if (ts.isTemplateExpression(expression)) {
          report(expression.head, expression.head.text);
          for (const span of expression.templateSpans) { report(span.literal, span.literal.text); displayed(span.expression); }
        } else if (ts.isConditionalExpression(expression)) { displayed(expression.whenTrue); displayed(expression.whenFalse); }
        else if (ts.isBinaryExpression(expression)) {
          if (expression.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) displayed(expression.left);
          displayed(expression.right);
        } else if (ts.isParenthesizedExpression(expression)) displayed(expression.expression);
      };
      displayed(node.expression);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return errors;
}

test('every locale has the same nonempty catalog entries and interpolation variables', () => {
  assert.ok(locales.includes('es') && locales.includes('en'));
  const files = Object.keys(catalogs.es).sort();
  for (const locale of locales) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), files, locale);
    const seen = new Map<string, string>();
    for (const file of files) {
      const dictionary = catalogs[locale][file];
      assert.deepEqual(Object.keys(dictionary).sort(), Object.keys(catalogs.es[file]).sort(), `${locale}/${file}`);
      for (const [key, value] of Object.entries(dictionary)) {
        assert.equal(typeof value, 'string', `${locale}/${file}: ${key}`);
        assert.ok(value.trim(), `${locale}/${file}: empty ${key}`);
        assert.deepEqual(placeholders(value), placeholders(catalogs.es[file][key]), `${locale}/${file}: ${key}`);
        if (seen.has(key)) assert.equal(value, seen.get(key), `${locale}: conflicting translation for ${key}`);
        seen.set(key, value);
      }
    }
  }
});

test('all literal translation keys in the interface exist in every locale', () => {
  const missing: string[] = [];
  for (const file of readdirSync(sourceDirectory).filter(name => name.endsWith('.tsx') || name === 'main.ts')) {
    const source = ts.createSourceFile(file, readFileSync(new URL(file, sourceDirectory), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
        const key = node.arguments[0].text;
        for (const locale of locales) if (!Object.hasOwn(merged[locale], key)) missing.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${locale}: ${key}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(missing, []);
});

test('model and collaboration boundary errors have translations before reaching the interface', () => {
  const missing: string[] = [];
  const modules = ['modelAssets.ts', 'offlineModelValidation.ts', 'modelWorkshopGeometry.ts', 'workshopBoolean.ts', 'workshopBooleanClient.ts', 'workshopPieces.ts', 'workshopGrouping.ts', 'offlineAssets.ts', 'collaborationServer.ts', 'customModel.ts'];
  for (const file of modules) {
    const source = ts.createSourceFile(file, readFileSync(new URL(file, sourceDirectory), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const check = (value: ts.Expression | undefined) => {
      if (!value) return;
      if (ts.isStringLiteralLike(value)) {
        for (const locale of locales) if (!Object.hasOwn(merged[locale], value.text)) missing.push(`${file}:${source.getLineAndCharacterOfPosition(value.getStart()).line + 1}: ${locale}: ${value.text}`);
      } else if (ts.isConditionalExpression(value)) { check(value.whenTrue); check(value.whenFalse); }
    };
    const visit = (node: ts.Node) => {
      if (ts.isNewExpression(node) && ts.isIdentifier(node.expression)) {
        if (node.expression.text === 'HttpError') check(node.arguments?.[1]);
        else if (['Error', 'AccountRequestError'].includes(node.expression.text)) check(node.arguments?.[0]);
      }
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['invalid', 'fail'].includes(node.expression.text)) check(node.arguments[0]);
      if (ts.isParameter(node) && node.name.getText(source) === 'message') check(node.initializer);
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(missing, []);
});

test('interface text and accessible labels use the translation catalog', () => {
  const errors = readdirSync(sourceDirectory).filter(name => name.endsWith('.tsx') || name === 'main.ts').flatMap(file => rawDisplayText(ts.createSourceFile(file, readFileSync(new URL(file, sourceDirectory), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)));
  assert.deepEqual(errors, []);
});

test('the source guard catches raw and conditional text while allowing units and user data', () => {
  const parse = (source: string) => ts.createSourceFile('fixture.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.equal(rawDisplayText(parse('<button title="Guardar">Guardar</button>')).length, 2);
  assert.equal(rawDisplayText(parse('<input aria-label={mode === "edit" ? "Editar" : "Ver"} />')).length, 2);
  assert.equal(rawDisplayText(parse('<input placeholder={`Ancho ${unit}`} />')).length, 1);
  assert.equal(rawDisplayText(parse('<span>{open ? "Abierto" : `Cerrar ${item.name}`}</span>')).length, 2);
  assert.deepEqual(rawDisplayText(parse('<label title={t("Ancho")}><input aria-label={item.name} placeholder="#ffffff" />{t("Ancho")} {item.name} cm × 20 MB WASD</label>')), []);
});

test('help JPEG headers expose dimensions after metadata and reject invalid segments', () => {
  const header = Buffer.from('ffd8ffe000040000ffc00011080320050003011100021100031100ffd9', 'hex');
  assert.deepEqual(jpegDimensions(header), { width: 1280, height: 800 });
  const progressive = Buffer.from(header); progressive[9] = 0xc2;
  assert.deepEqual(jpegDimensions(progressive), { width: 1280, height: 800 });
  const truncated = Buffer.from(header); truncated.writeUInt16BE(65535, 4);
  assert.throws(() => jpegDimensions(truncated), /segment bounds/);
  assert.throws(() => jpegDimensions(Buffer.alloc(24)), /JPEG signature/);
});

test('help content and screenshots are available in each locale with the declared dimensions', () => {
  const source = ts.createSourceFile('Help.tsx', readFileSync(new URL('Help.tsx', sourceDirectory), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const images = new Set<string>();
  const strings: string[] = [];
  const dimensions = new Map<string, number>();
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === 'img') for (const attribute of node.attributes.properties) {
      if (ts.isJsxAttribute(attribute) && ['width', 'height'].includes(attribute.name.getText(source)) && attribute.initializer && ts.isStringLiteral(attribute.initializer)) dimensions.set(attribute.name.getText(source), Number(attribute.initializer.text));
    }
    if (ts.isPropertyAssignment(node)) {
      const key = node.name.getText(source);
      if (key === 'file' && ts.isStringLiteralLike(node.initializer)) images.add(node.initializer.text);
      if (['title', 'introduction', 'note', 'alt', 'caption'].includes(key) && ts.isStringLiteralLike(node.initializer)) strings.push(node.initializer.text);
      if (key === 'steps' && ts.isArrayLiteralExpression(node.initializer)) for (const element of node.initializer.elements) if (ts.isStringLiteralLike(element)) strings.push(element.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(images.size > 0);
  assert.ok((dimensions.get('width') ?? 0) > 0 && (dimensions.get('height') ?? 0) > 0, 'Help images declare their dimensions');
  for (const locale of locales) {
    for (const text of strings) assert.ok(Object.hasOwn(merged[locale], text), `${locale}: missing help text: ${text}`);
    for (const image of images) {
      assert.match(image, /\.jpg$/, `${locale}/${image}: native JPEG screenshot`);
      const bytes = readFileSync(new URL('../public/help/' + locale + '/' + image, sourceDirectory));
      const actual = jpegDimensions(bytes);
      assert.equal(actual.width, dimensions.get('width'), `${locale}/${image}: width`);
      assert.equal(actual.height, dimensions.get('height'), `${locale}/${image}: height`);
      if (locale !== 'es') assert.ok(!bytes.equals(readFileSync(new URL('../public/help/es/' + image, sourceDirectory))), `${locale}/${image}: use a localized screenshot`);
    }
  }
});
