import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import test from 'node:test';
// The checker is also the production build's dependency guard.
// @ts-expect-error The build tool intentionally runs as native JavaScript.
import { checkArchitecture, dependencyViolation } from '../scripts/check-architecture.mjs';

test('architecture keeps domain, server and browser dependencies in their areas', () => {
  assert.equal(dependencyViolation('features/editor/App.tsx', 'domain/project/types.ts'), null);
  assert.equal(dependencyViolation('server/projects/service.ts', 'domain/project/types.ts'), null);
  for (const [source, target] of [
    ['domain/project/types.ts', 'server/auth/auth.ts'],
    ['domain/project/types.ts', 'client/api/request.ts'],
    ['server/projects/service.ts', 'features/editor/App.tsx'],
    ['client/offline/store.ts', 'features/editor/App.tsx'],
    ['shared/ui/Picker.tsx', 'features/editor/App.tsx'],
  ]) assert.ok(dependencyViolation(source, target), `${source} -> ${target}`);
});

test('architecture checks type imports, dynamic imports and browser globals before bundling', () => {
  const directory = mkdtempSync(join(tmpdir(), '3d-space-architecture-'));
  try {
    mkdirSync(join(directory, 'src/domain'), { recursive: true }); mkdirSync(join(directory, 'src/server'), { recursive: true });
    writeFileSync(join(directory, 'src/server/types.ts'), 'export type Secret = string;');
    writeFileSync(join(directory, 'src/domain/project.ts'), "import type { Secret } from '../server/types'; export type Other = import('../server/types').Secret; const load = () => import('../server/types'); window.location.reload();");
    const result = checkArchitecture(directory);
    assert.ok(result.errors.some((error: string) => error.includes('server/types.ts')));
    assert.ok(result.errors.some((error: string) => error.includes('browser global window')));
    writeFileSync(join(directory, 'src/domain/project.ts'), "import { readFile } from 'node:fs'; export const run = readFile;");
    assert.ok(checkArchitecture(directory).errors.some((error: string) => error.includes('Node dependency')));
    writeFileSync(join(directory, 'src/domain/project.ts'), "import React from 'react'; export const view = React;");
    assert.ok(checkArchitecture(directory).errors.some((error: string) => error.includes('presentation dependency')));
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.ok(basename(directory).startsWith('3d-space-architecture-'));
    rmSync(directory, { recursive: true, force: true });
  }
});
