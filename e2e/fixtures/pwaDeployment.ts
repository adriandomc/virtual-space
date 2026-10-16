import assert from 'node:assert/strict';
import { createServer, request as forwardRequest } from 'node:http';
import { readFile } from 'node:fs/promises';

/** Real workers/caches, one compiled application, and two deployment identities. No retired data/schema is emulated. */
export async function pwaDeployment({ brokenSetup = false, beforeModelUpload }: { brokenSetup?: boolean; beforeModelUpload?: () => Promise<void> } = {}) {
  const [shell, worker] = await Promise.all(['index.html', 'service-worker.js'].map(file => readFile(new URL('../../dist/' + file, import.meta.url), 'utf8')));
  assert.equal((worker.match(/const CACHE = ["'][^"']+["'];/g) ?? []).length, 1);
  let generation: 'old' | 'new' = 'old';
  // A deployed build has different immutable module URLs. Relative chunk imports retain this prefix.
  const originalBuild = JSON.parse(worker.match(/const BUILD = ([^;]+);/)![1]);
  const assetPaths = (source: string, version: string) => source.replaceAll('/assets/', `/__pwa_${version}/assets/`).replaceAll(originalBuild, originalBuild + '-' + version);
  const requests: { path: string; generation: string }[] = [];
  const pages = new Set(['/', '/index.html', '/login', '/designs', '/editor', '/help', '/privacy', '/terms', '/embed']);
  const server = createServer(async (incoming, response) => {
    const path = new URL(incoming.url ?? '/', 'http://127.0.0.1').pathname;
    requests.push({ path, generation });
    if (path === '/api/models' && incoming.method === 'POST' && beforeModelUpload) await beforeModelUpload();
    if (path === '/service-worker.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' });
      const variant = assetPaths(worker.replace(/const CACHE = ["'][^"']+["'];/, `const CACHE = '3d-space-v3-static-update-test-${generation}';`), generation)
        .replace("['/__pwa_" + generation + "/assets/',", "['/__pwa_old/assets/', '/__pwa_new/assets/',");
      response.end(variant); return;
    }
    if (pages.has(path)) {
      response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
      response.end(assetPaths(shell.replace('</head>', `<meta name="pwa-test-build" content="${generation}"></head>`), generation)); return;
    }
    const asset = path.match(/^\/__pwa_(old|new)(\/assets\/.*)$/), assetVersion = asset?.[1];
    const targetPath = asset ? incoming.url!.replace(/^\/__pwa_(old|new)/, '') : incoming.url;
    // A successfully downloaded but unusable old chunk exercises the actual lazy-import error boundary.
    if (brokenSetup && assetVersion === 'old' && /^\/assets\/SetupApp-[^/]+\.js$/.test(asset![2])) {
      response.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
      response.end("throw new Error('Test deployment: setup module unavailable');"); return;
    }
    // Reuse the existing temporary E2E backend. The proxy's browser origin is its own ephemeral localhost port.
    const headers = { ...incoming.headers, host: '127.0.0.1:5188', 'accept-encoding': 'identity' };
    if (headers.origin) headers.origin = 'http://127.0.0.1:5188';
    const upstream = forwardRequest({ hostname: '127.0.0.1', port: 5188, path: targetPath, method: incoming.method, headers }, result => {
      if (assetVersion && /\.(js|css)$/.test(path)) {
        const chunks: Buffer[] = [];
        result.on('data', chunk => chunks.push(Buffer.from(chunk)));
        result.on('end', () => {
          const rewritten = { ...result.headers }; delete rewritten['content-length'];
          response.writeHead(result.statusCode ?? 502, rewritten);
          response.end(assetPaths(Buffer.concat(chunks).toString('utf8'), assetVersion));
        });
      } else { response.writeHead(result.statusCode ?? 502, result.headers); result.pipe(response); }
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    response.on('close', () => upstream.destroy()); incoming.pipe(upstream);
  });
  // A private solo project normally opens no collaboration socket; still preserve normal upgrade behavior.
  server.on('upgrade', (incoming, socket, head) => {
    const headers = { ...incoming.headers, host: '127.0.0.1:5188' };
    if (headers.origin) headers.origin = 'http://127.0.0.1:5188';
    const upstream = forwardRequest({ hostname: '127.0.0.1', port: 5188, path: incoming.url, method: incoming.method, headers });
    upstream.on('upgrade', (response, target, first) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\n' + Object.entries(response.headers).map(([key, value]) => key + ': ' + value).join('\r\n') + '\r\n\r\n');
      if (first.length) socket.write(first); if (head.length) target.write(head); target.pipe(socket); socket.pipe(target);
      socket.on('close', () => target.destroy()); target.on('error', () => socket.destroy()); socket.on('error', () => target.destroy());
    });
    upstream.on('error', () => socket.destroy()); upstream.end();
  });
  await new Promise<void>(accept => server.listen(0, '127.0.0.1', accept));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return {
    origin: 'http://127.0.0.1:' + address.port,
    requests,
    deploy: () => { generation = 'new'; },
    close: async () => { const closed = new Promise<void>((accept, reject) => server.close(error => error ? reject(error) : accept())); server.closeAllConnections(); await closed; },
  };
}
