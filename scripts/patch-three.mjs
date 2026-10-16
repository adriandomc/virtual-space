import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Backport the upstream r184 feature guard without changing the pinned TSL/rendering API.
// https://github.com/mrdoob/three.js/blob/r184/src/renderers/common/Textures.js
// https://github.com/mrdoob/three.js/blob/r184/src/textures/Source.js
const directory = resolve('node_modules/three');
const { version } = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
if (version !== '0.180.0') throw new Error('Review/remove the Three.js VideoFrame patch before changing Three.js 0.180.0.');

const files = [
  ['src/textures/Source.js', 'data'],
  ['src/renderers/common/Textures.js', 'image'],
  ['build/three.core.js', 'data'],
  ['build/three.cjs', 'data'],
  ['build/three.webgpu.js', 'image'],
  ['build/three.webgpu.nodes.js', 'image'],
];
// Preflight every source/build copy before writing any file; unexpected upstream code must fail installation.
const patches = await Promise.all(files.map(async ([file, value]) => {
  const path = resolve(directory, file), source = await readFile(path, 'utf8');
  const before = `else if ( ${value} instanceof VideoFrame )`;
  const after = `else if ( typeof VideoFrame !== 'undefined' && ${value} instanceof VideoFrame )`;
  const original = source.split(before).length - 1, applied = source.split(after).length - 1;
  if (original + applied !== 1) throw new Error('Unexpected Three.js VideoFrame predicate in ' + file + '.');
  return { path, source: original ? source.replace(before, after) : source, changed: original === 1 };
}));
for (const patch of patches) if (patch.changed) await writeFile(patch.path, patch.source);
