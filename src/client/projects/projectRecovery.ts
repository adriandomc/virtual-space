import { validateProjectDocument, type ProjectDocument } from '../../domain/project/projectDocument';
import { atomicOffline, readOffline, removeOffline } from '../offline/offlineStorage';
import type { ProjectBackup } from './projectBackup';

/** A rejected collaborative edit remains account-scoped until explicitly discarded. */
export class ProjectRecovery {
  private value: { project: ProjectDocument; accountId: string } | null = null;
  private saving: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private generation = 0;

  constructor(private id: string) {}
  project = () => this.value?.project ?? null;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private notify() { this.listeners.forEach(listener => listener()); }
  private key(accountId: string) { return 'recovery:' + accountId + ':' + this.id; }

  async restore(active: () => boolean) {
    const generation = this.generation;
    const identity = await readOffline<{ id: string }>('meta', 'identity');
    if (!active() || !identity) return;
    const saved = await readOffline<{ project: ProjectDocument }>('meta', this.key(identity.id));
    const currentIdentity = await readOffline<{ id: string }>('meta', 'identity');
    if (!active() || !saved || this.value || generation !== this.generation || currentIdentity?.id !== identity.id) return;
    const project = validateProjectDocument(saved.project);
    if (project.id !== this.id) return;
    this.value = { project, accountId: identity.id }; this.notify();
  }

  capture(project: ProjectDocument, accountId: string) {
    this.generation++;
    this.value = { project, accountId }; this.notify();
    this.saving = this.saving.catch(() => {}).then(() => atomicOffline(accountId, [{ store: 'meta', key: this.key(accountId), value: { accountId, roomId: this.id, project } }]));
    return this.saving;
  }

  clear() { this.generation++; this.value = null; this.notify(); }

  private async owned() {
    const current = this.value;
    const identity = await readOffline<{ id: string }>('meta', 'identity');
    if (current && identity?.id !== current.accountId) throw new Error('La cuenta activa cambió. Vuelve a abrir el diseño.');
    return current;
  }

  discard() {
    const current = this.value;
    this.saving = this.saving.catch(() => {}).then(async () => {
      await this.owned();
      if (!current || this.value !== current) return;
      await removeOffline('meta', this.key(current.accountId));
      if (this.value === current) this.clear();
    });
    return this.saving;
  }

  async applyToBackup(backup: ProjectBackup): Promise<ProjectBackup> {
    const current = await this.owned();
    return current ? { ...backup, project: current.project, sketches: backup.sketches.filter(sketch => current.project.levels.some(level => level.id === sketch.levelId)) } : backup;
  }
}
