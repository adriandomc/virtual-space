import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = resolve(process.argv[2] ?? 'dist'), files = {};
await mkdir(join(root, '.http-gzip'), { recursive: true });
async function visit(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.http-')) continue;
    const name = prefix + entry.name, path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path, name + '/');
    else if (entry.isFile()) {
      const bytes = await readFile(path), hash = createHash('sha256').update(bytes).digest('hex');
      const gzip = bytes.length > 1024 && /\.(?:html|js|css|json|webmanifest|svg|wasm)$/.test(name) ? '.http-gzip/' + hash + '.gz' : null;
      if (gzip) await writeFile(join(root, gzip), gzipSync(bytes));
      files[name] = { etag: 'W/"' + hash + '"', size: bytes.length, gzip };
    }
  }
}
await visit(root);
// Fail the build if any late bundler mutation would make offline integrity checks reject it.
if (files['service-worker.js']) {
  const worker = await readFile(join(root, 'service-worker.js'), 'utf8');
  const serialized = /^const IDENTITIES = (.+);$/m.exec(worker)?.[1];
  if (!serialized) throw new Error('Service worker resource identities are missing.');
  const identities = JSON.parse(serialized);
  const expected = Object.keys(files).filter(name => name !== 'service-worker.js' && !name.endsWith('.md'));
  if (Object.keys(identities).length !== expected.length) throw new Error('Service worker resource inventory differs from the emitted build.');
  for (const name of expected) if (files[name].etag !== 'W/"' + identities['/' + name] + '"') throw new Error('Service worker integrity mismatch: ' + name);
}
await writeFile(join(root, '.http-assets.json'), JSON.stringify({ version: 1, files }));
