import { existsSync, lstatSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, parse, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { recordErasure, validateErasureFile } from './erasures.js';
import { usernameValue } from './auth.js';
import { DATABASE_VERSION, initializeDatabase } from './databaseSchema.js';
import { initializeErasures } from './erasures.js';

function offlineDirectory(value: string) {
  if (!isAbsolute(value)) throw new Error('Provide an absolute service data directory.');
  const directory = resolve(value), root = parse(directory).root;
  if (directory === root) throw new Error('A filesystem root is not a service data directory.');
  let current = root;
  for (const part of directory.slice(root.length).split(sep)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('Service data paths cannot contain symbolic links.');
  }
  if (!lstatSync(directory).isDirectory() || !lstatSync(join(directory, 'accounts.sqlite')).isFile()) throw new Error('An existing service data directory is required.');
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (existsSync(join(directory, 'accounts.sqlite' + suffix))) throw new Error('Stop the service and close SQLite before deleting data.');
  }
  return directory;
}

export function cancelAccount(dataDir: string, username: string, confirmation: string, now = Date.now()) {
  const directory = offlineDirectory(dataDir), normalized = usernameValue(username);
  if (confirmation !== '--confirm=' + normalized) throw new Error('Explicit account cancellation confirmation is required.');
  const ledger = join(directory, 'erasures.json');
  validateErasureFile(ledger);
  const database = new DatabaseSync(join(directory, 'accounts.sqlite'));
  try {
    database.exec('PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;');
    const user = database.prepare('SELECT id FROM users WHERE username = ?').get(normalized);
    if (!user) throw new Error('Account not found.');
    recordErasure(database, ledger, { kind: 'user', id: String(user.id), at: now }, () => {
      database.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      database.prepare('DELETE FROM request_limits WHERE key = ?').run('create-user:' + createHash('sha256').update(String(user.id)).digest('hex'));
    });
    database.exec('VACUUM;');
    return { cancelled: true };
  } finally { database.close(); }
}

export function closeService(dataDir: string, confirmation: string) {
  const directory = offlineDirectory(dataDir);
  if (confirmation !== '--confirm=erase-all') throw new Error('Explicit permanent closure confirmation is required.');
  const backupDir = join(directory, 'backups');
  const backups: string[] = [];
  if (existsSync(backupDir)) {
    if (lstatSync(backupDir).isSymbolicLink() || !lstatSync(backupDir).isDirectory()) throw new Error('Invalid backup directory.');
    for (const name of readdirSync(backupDir)) {
      if (!/^(?:accounts-\d{13}-[a-f0-9]{32}\.sqlite|\.accounts-\d{13}-[a-f0-9]{32}\.partial\.sqlite)(?:-wal|-shm|-journal)?$/.test(name) || !lstatSync(join(backupDir, name)).isFile() || lstatSync(join(backupDir, name)).isSymbolicLink()) throw new Error('Unrecognized backup files: review the directory before closure.');
      backups.push(join(backupDir, name));
    }
  }
  const owned = ['erasures.json', 'maintenance-status.json', '.maintenance-status.tmp', 'prelaunch-reset.json', ...readdirSync(directory).filter(name => /^\.erasures-[0-9a-f-]{36}\.tmp$/.test(name))].map(name => join(directory, name));
  for (const path of owned) if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) throw new Error('Invalid service metadata file.');
  const databasePath = join(directory, 'accounts.sqlite'), database = new DatabaseSync(databasePath);
  try {
    if (!database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='users'").get() || !database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='rooms'").get()) throw new Error('This is not a 3D Space database.');
    database.exec('PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; BEGIN IMMEDIATE; DELETE FROM users; DELETE FROM request_limits; COMMIT; VACUUM; PRAGMA wal_checkpoint(TRUNCATE);');
  } finally { database.close(); }
  for (const path of [...backups, ...owned, databasePath]) if (existsSync(path)) unlinkSync(path);
  return { closed: true, removedBackups: backups.length };
}

/** Deliberate launch-only operation; no application startup path calls this. */
export function resetPrelaunch(dataDir: string, confirmation: string, now = Date.now()) {
  const directory = offlineDirectory(dataDir);
  if (confirmation !== '--confirm=reset-3d-space-test-data') throw new Error('Explicit prelaunch reset confirmation is required.');
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid reset timestamp.');
  const marker = join(directory, 'prelaunch-reset.json');
  if (existsSync(marker)) throw new Error('The one-time prelaunch reset has already completed.');
  for (const name of readdirSync(directory)) {
    if (!['accounts.sqlite', 'backups', 'erasures.json', 'maintenance-status.json', '.maintenance-status.tmp'].includes(name) && !/^\.erasures-[0-9a-f-]{36}\.tmp$/.test(name)) throw new Error('Unrecognized service files: review the directory before reset.');
  }
  const source = new DatabaseSync(join(directory, 'accounts.sqlite'), { readOnly: true });
  try {
    const objects = source.prepare("SELECT type, name FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*'").all();
    if (objects.some(row => row.type !== 'table' && row.type !== 'index' || row.type === 'table' && !['users', 'sessions', 'request_limits', 'rooms', 'room_members', 'model_assets'].includes(String(row.name))) || !['salt', 'password_hash', 'username'].every(name => source.prepare('PRAGMA table_info(users)').all().some(row => row.name === name)) || !['room', 'owner_id', 'revision'].every(name => source.prepare('PRAGMA table_info(rooms)').all().some(row => row.name === name))) throw new Error('This is not a recognized 3D Space test database.');
  } finally { source.close(); }
  const removed = closeService(directory, '--confirm=erase-all');
  const database = new DatabaseSync(join(directory, 'accounts.sqlite'));
  try { initializeDatabase(database); initializeErasures(directory, database); }
  finally { database.close(); }
  writeFileSync(marker, JSON.stringify({ version: DATABASE_VERSION, resetAt: now }), { flag: 'wx', mode: 0o600, flush: true });
  return { reset: true, version: DATABASE_VERSION, removedBackups: removed.removedBackups };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.umask(0o077);
  try {
    const [command, dataDir, usernameOrConfirmation, confirmation] = process.argv.slice(2);
    const result = command === 'cancel-account' && dataDir && usernameOrConfirmation && confirmation
      ? cancelAccount(dataDir, usernameOrConfirmation, confirmation)
      : dataDir && usernameOrConfirmation && !confirmation && (command === 'close-service' || command === 'reset-prelaunch')
        ? command === 'close-service' ? closeService(dataDir, usernameOrConfirmation) : resetPrelaunch(dataDir, usernameOrConfirmation)
        : (() => { throw new Error('Invalid operator command.'); })();
    console.log(JSON.stringify({ ok: true, ...result }));
  } catch { console.error('Operation refused or incomplete. Verify the offline data directory, confirmation, and files.'); process.exitCode = 1; }
}
