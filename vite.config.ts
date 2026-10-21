import { defineConfig, type Plugin } from 'vite';
import { createServiceWorkerSource } from './src/client/pwa/serviceWorkerSource';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { languages, translationCatalogs, type Locale } from './src/shared/i18n/translations';
const buildId = process.env.APP_BUILD_ID ?? Date.now().toString(36);

async function localizedManifest(locale: Locale) {
  const template = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
  const strings = translationCatalogs[locale];
  return JSON.stringify({ ...template, name: strings['3D Space'], short_name: strings['3D Space'], lang: locale, description: strings['Creador de espacios 3D gratuito y de código abierto'] });
}

function appOffline(): Plugin {
  return {
    name: 'app-offline', apply: 'build', enforce: 'post',
    async generateBundle() {
      for (const { code } of languages) {
        const source = await localizedManifest(code), fileName = `manifest.${code}.webmanifest`;
        this.emitFile({ type: 'asset', fileName, source });
      }
    },
    async writeBundle(options) {
      // Vite still rewrites dynamic-import preload tables after generateBundle hooks.
      // Hash emitted bytes only, once every output and copied public asset is on disk.
      const root = resolve(options.dir ?? 'dist'), files = new Map<string, Uint8Array>();
      const visit = async (directory: string, prefix = '') => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (entry.name.startsWith('.http-') || entry.name === 'service-worker.js') continue;
          if (entry.isDirectory()) await visit(join(directory, entry.name), prefix + entry.name + '/');
          else if (entry.isFile() && !entry.name.endsWith('.md')) files.set('/' + prefix + entry.name, await readFile(join(directory, entry.name)));
        }
      };
      await visit(root);
      const hash = createHash('sha256'), identities: Record<string, string> = {};
      for (const [name, content] of [...files].sort(([a], [b]) => a.localeCompare(b))) { hash.update(name).update(content); identities[name] = createHash('sha256').update(content).digest('hex'); }
      const source = createServiceWorkerSource('3d-space-v3-static-' + hash.digest('hex').slice(0, 20), [...files.keys()], buildId, identities);
      await writeFile(join(root, 'service-worker.js'), source);
    },
  };
}

const devManifests: Plugin = {
  name: 'localized-manifests',
  async configureServer(server) {
    const manifests = new Map<string, string>(await Promise.all(languages.map(async ({ code }) => [`/manifest.${code}.webmanifest`, await localizedManifest(code)] as const)));
    server.middlewares.use((request, response, next) => {
      const body = manifests.get((request.url ?? '').split('?')[0]);
      if (!body) return next();
      response.setHeader('Content-Type', 'application/manifest+json'); response.end(body);
    });
  },
};
export default defineConfig({ define: { 'import.meta.env.VITE_BUILD_ID': JSON.stringify(buildId) }, plugins: [react(), devManifests, appOffline()], resolve: { alias: [{ find: /^three$/, replacement: 'three/webgpu' }] }, server: { proxy: { '/api': { target: 'http://127.0.0.1:8080', changeOrigin: false, ws: true } } } });
