import { validateProjectDocument, type ProjectDocument } from '../../domain/project/projectDocument';
import { atomicOffline, readOffline, removeOffline } from '../offline/offlineStorage';
import type { ProjectBackup } from './projectBackup';

/** A rejected collaborative edit remains account-scoped until explicitly discarded. */
export class ProjectRecovery {
  private value: { project: ProjectDocument; accountId: string } | null = null;
  private saving: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private generation = 0;
  private checkpointAccount: string | null = null;
  private checkpointGeneration = 0;

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
    this.checkpointGeneration++;
    this.checkpointAccount = null;
    this.value = { project, accountId }; this.notify();
    this.saving = this.saving.catch(() => {}).then(() => atomicOffline(accountId, [{ store: 'meta', key: this.key(accountId), value: { accountId, roomId: this.id, project } }]));
    return this.saving;
  }

  /** A transient gesture is recoverable after a crash without publishing intermediate edits. */
  checkpoint(project: ProjectDocument, accountId: string, current: () => boolean = () => true) {
    if (this.value) return Promise.reject(new Error('Guarda o descarta la copia recuperada antes de continuar.'));
    this.generation++;
    const generation = ++this.checkpointGeneration;
    this.checkpointAccount = accountId;
    this.saving = this.saving.catch(() => {}).then(async () => {
      if (this.value || generation !== this.checkpointGeneration || !current()) return;
      await atomicOffline(accountId, [{ store: 'meta', key: this.key(accountId), value: { accountId, roomId: this.id, project } }]);
    });
    return this.saving;
  }

  /** Call after the final edit is durable, or after an explicitly cancelled gesture. */
  clearCheckpoint(current: () => boolean = () => true) {
    const accountId = this.checkpointAccount;
    if (!accountId) return this.saving;
    const generation = this.checkpointGeneration;
    this.saving = this.saving.catch(() => {}).then(async () => {
      // A rejected edit captured in the meantime must survive this cleanup.
      const valid = () => !this.value && generation === this.checkpointGeneration && current();
      if (!valid()) return;
      const identity = await readOffline<{ id: string }>('meta', 'identity');
      if (identity?.id !== accountId || !valid()) return;
      await atomicOffline(accountId, [{ store: 'meta', key: this.key(accountId), remove: true }]);
      if (valid()) this.checkpointAccount = null;
    });
    return this.saving;
  }

  /** A later preview/cancel must not replace the only durable copy of an accepted edit. */
  async updateCheckpoint(project: ProjectDocument | null, accountId: string | undefined, durability: { assertDurable(): Promise<void>; readonly hasUndurableWork: boolean }, current: () => boolean) {
    try { await durability.assertDurable(); }
    catch { return false; }
    const valid = () => current() && !durability.hasUndurableWork && !this.value;
    if (!valid() || project && !accountId) return false;
    if (project) await this.checkpoint(project, accountId!, valid);
    else await this.clearCheckpoint(valid);
    return valid();
  }

  clear() { this.generation++; this.checkpointGeneration++; this.checkpointAccount = null; this.value = null; this.notify(); }

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
