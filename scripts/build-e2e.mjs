import { spawnSync } from 'node:child_process';
const result = spawnSync(process.execPath, [process.env.npm_execpath || 'node_modules/npm/bin/npm-cli.js', 'run', 'build'], { stdio: 'inherit', env: { ...process.env, VITE_SCENE_DIAGNOSTICS: 'true' } });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
