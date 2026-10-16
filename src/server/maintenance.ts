import { pathToFileURL } from 'node:url';
import { backupFromDirectory, restoreBackup, verifyBackup } from './maintenance/backups.js';

export async function runMaintenance(args: string[]) {
  const [command, ...values] = args;
  if (command === 'backup' && values.length <= 1) return backupFromDirectory(values[0] ?? process.env.DATA_DIR ?? './data');
  if (command === 'verify' && values.length === 1) return verifyBackup(values[0]);
  if (command === 'restore' && values.length === 3) return restoreBackup(values[0], values[1], { erasureFile: values[2] });
  throw new Error('Usage: maintenance.js backup [dataDir] | verify <backup> | restore <backup> <newDataDir> <currentErasureFile>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMaintenance(process.argv.slice(2)).then(result => {
    console.log(JSON.stringify({ ok: true, ...result }));
  }).catch(() => {
    console.error('Maintenance failed. Check the command, backup, paths, and current erasure ledger.');
    process.exitCode = 1;
  });
}
