import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = resolve('node_modules/three/examples/jsm/libs/basis');
const destination = resolve('public/decoders/basis');
const { version } = JSON.parse(await readFile('node_modules/three/package.json', 'utf8'));
if (version !== '0.180.0') throw new Error('Review Basis transcoder compatibility before changing Three.js.');
await mkdir(destination, { recursive: true });
for (const file of ['basis_transcoder.js', 'basis_transcoder.wasm']) await copyFile(resolve(source, file), resolve(destination, file));
