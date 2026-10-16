import { builtinModules } from 'node:module';
import { readdirSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const nodeModules = new Set(builtinModules.map(name => name.replace(/^node:/, '')));
const areas = new Set(['app', 'features', 'client', 'domain', 'server', 'shared']);
const browserGlobals = new Set(['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB']);

export function dependencyViolation(source, target) {
  const area = source.split('/')[0], destination = target.split('/')[0];
  if (!areas.has(area) || !areas.has(destination)) return 'Source modules must belong to a documented area';
  if (area !== 'server' && destination === 'server') return 'Browser and domain modules cannot import the server, including its types';
  if (area === 'server' && !['server', 'domain', 'shared'].includes(destination)) return 'The server cannot depend on browser features';
  if (area === 'domain' && destination !== 'domain' && !(destination === 'shared' && !target.startsWith('shared/ui/') && !target.startsWith('shared/i18n/'))) return 'Domain rules cannot depend on presentation or browser infrastructure';
  if (area === 'client' && ['features', 'app'].includes(destination)) return 'Browser infrastructure cannot depend on application screens';
  if (area === 'shared' && ['features', 'app'].includes(destination)) return 'Shared controls cannot depend on application screens';
  if (area === 'server' && /^shared\/(ui|i18n)\//.test(target)) return 'The server cannot depend on browser controls or localization runtime';
  return null;
}

export function checkArchitecture(root) {
  const sourceRoot = resolve(root, 'src'), files = [], errors = [];
  const normalize = path => relative(sourceRoot, path).split(sep).join('/');
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts')) files.push(path);
    }
  }
  walk(sourceRoot);
  const options = { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true, resolveJsonModule: true };
  const program = ts.createProgram(files, options), checker = program.getTypeChecker();
  for (const file of files) {
    const source = normalize(file), area = source.split('/')[0], ast = program.getSourceFile(file);
    if (!areas.has(area)) errors.push(`${source}: module outside a documented area`);
    const dependencies = new Set();
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) dependencies.add(node.moduleSpecifier.text);
      if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteralLike(node.argument.literal)) dependencies.add(node.argument.literal.text);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) dependencies.add(node.arguments[0].text);
      if (area === 'domain' && ts.isIdentifier(node) && browserGlobals.has(node.text) && checker.getSymbolAtLocation(node)?.declarations?.some(declaration => /lib\.dom\.d\.ts$/.test(declaration.getSourceFile().fileName))) errors.push(`${source}: domain uses browser global ${node.text}`);
      ts.forEachChild(node, visit);
    }
    visit(ast);
    for (const dependency of dependencies) {
      if (area !== 'server' && nodeModules.has(dependency.replace(/^node:/, ''))) errors.push(`${source}: Node dependency ${dependency} outside server`);
      if (area === 'domain' && /^(react(?:-dom)?(?:\/|$)|three\/(?:webgpu|tsl|addons|src))/.test(dependency)) errors.push(`${source}: presentation dependency ${dependency} inside domain`);
      if (!dependency.startsWith('.')) continue;
      const target = ts.resolveModuleName(dependency, file, options, ts.sys).resolvedModule?.resolvedFileName;
      if (!target) { if (!dependency.endsWith('.css')) errors.push(`${source}: unresolved dependency ${dependency}`); continue; }
      if (!resolve(target).startsWith(sourceRoot + sep)) continue;
      const violation = dependencyViolation(source, normalize(target));
      if (violation) errors.push(`${source} -> ${normalize(target)}: ${violation}`);
    }
  }
  return { modules: files.length, errors };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkArchitecture(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  if (result.errors.length) { console.error(result.errors.join('\n')); process.exitCode = 1; }
  else console.log(`Architecture boundaries checked: ${result.modules} source modules.`);
}
