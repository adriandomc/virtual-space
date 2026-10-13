import { writeFileSync, renameSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { pruneBackups, runBackup } from './backups.js';
import { pruneErasures } from './erasures.js';
import { deleteInactiveAccounts } from './retention.js';

const HOUR = 60 * 60_000;

export function createMaintenance(database: DatabaseSync, dataDir: string, ledgerPath: string, {
  now = Date.now, intervalMs = HOUR, backup = runBackup,
}: { now?: () => number; intervalMs?: number; backup?: typeof runBackup } = {}) {
  let running: Promise<void> | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastBackup: { createdAt: number; verifiedAt: number; file: string; digest: string } | null = null;
  const run = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) return running;
    running = (async () => {
      const time = now();
      try {
        const deletedAccounts = deleteInactiveAccounts(database, time);
        // Keep the deletion ledger until every expired recovery snapshot is gone.
        await pruneBackups(dataDir, { now: time });
        pruneErasures(ledgerPath, time, database);
        const result = await backup(database, dataDir, { now: time });
        lastBackup = { createdAt: Number(basename(result.path).split('-')[1]), verifiedAt: time, file: basename(result.path), digest: result.verified.digest };
        const status = { checkedAt: time, deletedAccounts, backup: lastBackup, error: null };
        const temporary = join(dataDir, '.maintenance-status.tmp');
        writeFileSync(temporary, JSON.stringify(status), { mode: 0o600 });
        renameSync(temporary, join(dataDir, 'maintenance-status.json'));
        if (result.created) console.log('Database backup verified: ' + basename(result.path));
        if (deletedAccounts) console.log('Inactive accounts removed: ' + deletedAccounts);
      } catch (error) {
        console.error('Database maintenance failed:', error instanceof Error ? error.message : 'Unknown error');
        const temporary = join(dataDir, '.maintenance-status.tmp');
        writeFileSync(temporary, JSON.stringify({ checkedAt: time, backup: lastBackup, error: 'Maintenance failed; inspect server logs.' }), { mode: 0o600 });
        renameSync(temporary, join(dataDir, 'maintenance-status.json'));
      }
    })().finally(() => { running = null; });
    return running;
  };
  return {
    run,
    start() {
      if (stopped || timer) return;
      timer = setInterval(() => { void run().catch(() => console.error('Could not persist maintenance status.')); }, intervalMs);
      timer.unref();
      void run().catch(() => console.error('Could not persist maintenance status.'));
    },
    async stop() { stopped = true; if (timer) clearInterval(timer); await running; },
  };
}
