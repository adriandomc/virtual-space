import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default async function setup() {
  const server = fork(fileURLToPath(new URL('../scripts/e2e-server.mjs', import.meta.url)), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { server.kill(); reject(new Error('The isolated E2E server did not start.')); }, 20000);
    server.once('error', cause => { clearTimeout(timer); reject(cause); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error('The isolated E2E server exited: ' + code)); });
    server.once('message', message => { if (message === 'ready') { clearTimeout(timer); resolve(); } });
  });
  return async () => {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { server.kill(); reject(new Error('The E2E server could not clean its temporary data.')); }, 10000);
      server.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error('The E2E server cleanup failed.')); });
      server.send('stop');
    });
  };
}
