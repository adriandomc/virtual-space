import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Offline authoring tool: install Khronos KTX-Software 4.4.2; no encoder runs in the app or Docker image.
const encoder = process.env.KTX_BINARY || 'ktx';
const manifestPath = resolve('public/materials/manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const surfaces = process.argv.slice(2);
if (surfaces.some(surface => !manifest.some(entry => entry.path.split('/').at(-2) === surface))) throw new Error('Unknown material surface.');
for (const entry of manifest) {
  if (surfaces.length && !surfaces.includes(entry.path.split('/').at(-2))) continue;
  entry.compressed = {};
  for (const resolution of [512, 1024]) {
    const original = entry.variants[String(resolution)];
    const path = `/materials/ktx2/${resolution}/${entry.path.split('/').slice(-2).join('/').replace('.jpg', '.ktx2')}`;
    const destination = resolve('public' + path);
    const scale = Math.min(1, resolution / Math.max(original.width, original.height));
    // WebGPU compressed base levels must align to 4×4 blocks, including the 1024×1025 fabric source.
    const dimension = value => Math.max(4, Math.min(resolution, Math.round(value * scale / 4) * 4));
    const width = dimension(original.width), height = dimension(original.height);
    const color = path.endsWith('/color.ktx2'), normal = path.endsWith('/normal.ktx2');
    await mkdir(dirname(destination), { recursive: true });
    const encoding = normal ? ['--encode', 'uastc', '--uastc-quality', '2', '--uastc-rdo', '--uastc-rdo-l', '0.25', '--uastc-rdo-m', '--zstd', '18'] : ['--encode', 'basis-lz', '--qlevel', '255', '--clevel', '2'];
    const args = ['create', '--format', color ? 'R8G8B8A8_SRGB' : 'R8G8B8A8_UNORM', '--assign-tf', color ? 'srgb' : 'linear', '--convert-texcoord-origin', 'bottom-left', '--width', String(width), '--height', String(height), '--generate-mipmap', ...encoding, '--threads', '2', resolve('public' + original.path), destination];
    const result = spawnSync(encoder, args, { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'KTX encoding failed.');
    const validation = spawnSync(encoder, ['validate', destination], { encoding: 'utf8' });
    if (validation.error || validation.status !== 0) throw new Error(validation.error?.message || validation.stderr || 'Invalid KTX2 output.');
    const bytes = await readFile(destination);
    entry.compressed[resolution] = { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), width, height, encoding: normal ? 'uastc' : 'basis-lz', transfer: color ? 'srgb' : 'linear' };
    console.log(path, bytes.length);
  }
}
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
