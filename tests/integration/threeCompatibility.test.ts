import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Source, Vector3 } from 'three/webgpu';

const script = fileURLToPath(new URL('../../scripts/patch-three.mjs', import.meta.url));
const copies = ['src/textures/Source.js', 'src/renderers/common/Textures.js', 'build/three.core.js', 'build/three.cjs', 'build/three.webgpu.js', 'build/three.webgpu.nodes.js'];
async function installation() {
  const directory = await mkdtemp(join(tmpdir(), '3d-space-three-patch-')), dependency = join(directory, 'node_modules', 'three');
  await mkdir(dependency, { recursive: true }); await writeFile(join(dependency, 'package.json'), '{"version":"0.180.0"}');
  for (const file of copies) {
    const source = await readFile(new URL('../../node_modules/three/' + file, import.meta.url), 'utf8');
    const value = file.includes('Source.js') || file.includes('three.core') || file.includes('three.cjs') ? 'data' : 'image';
    const original = source.replace(`else if ( typeof VideoFrame !== 'undefined' && ${value} instanceof VideoFrame )`, `else if ( ${value} instanceof VideoFrame )`);
    await mkdir(dirname(join(dependency, file)), { recursive: true }); await writeFile(join(dependency, file), original);
  }
  return { directory, dependency, dispose: async () => { assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('3d-space-three-patch-')); await rm(directory, { recursive: true, force: true }); } };
}

test('Three texture sizes work without a VideoFrame global in the exported build and source manager', async () => {
  assert.equal(typeof globalThis.VideoFrame, 'undefined', 'Node fixture reproduces the missing WebCodecs constructor');
  const source = new Source({ width: 32, height: 16, depth: 3 });
  assert.deepEqual(source.getSize(new Vector3()).toArray(), [32, 16, 3]);
  assert.deepEqual(new Source(null).getSize(new Vector3()).toArray(), [0, 0, 0]);
  const sourceModule = await import(new URL('../../node_modules/three/src/renderers/common/Textures.js', import.meta.url).href);
  const textures = new sourceModule.default(null, null, null);
  const dimensions = (size: { width: number; height: number; depth: number }) => [size.width, size.height, size.depth];
  assert.deepEqual(dimensions(textures.getSize({ image: { width: 32, height: 16, depth: 3 } })), [32, 16, 3]);
  assert.deepEqual(dimensions(textures.getSize({ images: [{ image: { width: 8, height: 4 } }], isCubeTexture: true })), [8, 4, 6]);
  assert.deepEqual(dimensions(textures.getSize({ image: null })), [1, 1, 1]);
});

test('the install patch guards every shipped copy and can run repeatedly without changing bytes', async () => {
  const fixture = await installation();
  try {
    execFileSync(process.execPath, [script], { cwd: fixture.directory });
    const first = await Promise.all(copies.map(file => readFile(join(fixture.dependency, file), 'utf8')));
    for (const [index, source] of first.entries()) { assert.equal(/else if \( (?:data|image) instanceof VideoFrame \)/.test(source), false, copies[index]); assert.ok(/typeof VideoFrame !== 'undefined' && (?:data|image) instanceof VideoFrame/.test(source), copies[index]); }
    execFileSync(process.execPath, [script], { cwd: fixture.directory });
    assert.deepEqual(await Promise.all(copies.map(file => readFile(join(fixture.dependency, file), 'utf8'))), first);
  } finally { await fixture.dispose(); }
});

test('unsupported versions and unexpected predicates fail before any dependency file is patched', async () => {
  const fixture = await installation();
  try {
    const first = await readFile(join(fixture.dependency, copies[0]), 'utf8');
    await writeFile(join(fixture.dependency, 'package.json'), '{"version":"0.184.0"}');
    assert.throws(() => execFileSync(process.execPath, [script], { cwd: fixture.directory, stdio: 'pipe' }), /Review\/remove/);
    await writeFile(join(fixture.dependency, 'package.json'), '{"version":"0.180.0"}');
    await writeFile(join(fixture.dependency, copies.at(-1)!), 'unexpected upstream source');
    assert.throws(() => execFileSync(process.execPath, [script], { cwd: fixture.directory, stdio: 'pipe' }), /Unexpected Three.js/);
    assert.equal(await readFile(join(fixture.dependency, copies[0]), 'utf8'), first);
  } finally { await fixture.dispose(); }
});
