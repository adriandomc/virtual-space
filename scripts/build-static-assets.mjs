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
      const gzip = bytes.length > 1024 && /\.(?:html|js|css|json|webmanifest|svg)$/.test(name) ? '.http-gzip/' + hash + '.gz' : null;
      if (gzip) await writeFile(join(root, gzip), gzipSync(bytes));
      files[name] = { etag: 'W/"' + hash + '"', size: bytes.length, gzip };
    }
  }
}
await visit(root);
await writeFile(join(root, '.http-assets.json'), JSON.stringify({ version: 1, files }));
