import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server-dist/server/server.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(join(tmpdir(), '3d-space-e2e-'));
const server = createServer({ dataDir: temporary, staticDir: join(root, 'dist'), appOrigin: 'http://127.0.0.1:5188', secureCookie: false, maintenance: false });
server.listen(5188, '127.0.0.1', () => process.send?.('ready'));
let closing = false;
function stop() {
  if (closing) return;
  closing = true;
  server.close(error => {
    if (error) { console.error(error); process.exitCode = 1; return; }
    if (dirname(resolve(temporary)) === resolve(tmpdir()) && basename(temporary).startsWith('3d-space-e2e-')) rmSync(temporary, { recursive: true, force: true });
    process.disconnect?.();
  });
  server.closeIdleConnections();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
process.on('message', message => { if (message === 'stop') stop(); });
