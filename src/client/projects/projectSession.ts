import { createDefaultProject, validateProjectDocument, type ProjectDocument } from '../../domain/project/projectDocument';
import { accountRequest, AccountRequestError, isNetworkError } from '../api/accountApi';
import { bootstrapOfflineMode, offlineForced, subscribeOfflineMode } from '../offline/offlineMode';
import { hydrateOfflineProject, offlineProjectKey, pendingSketches, readOfflineProject, SoloProject, validateOfflineProject, type OfflineProjectRecord, type SoloStatus } from '../offline/offlineProject';
import { persistOfflineProject } from '../offline/repository';
import { soloNetworkDependencies, waitForOfflineSync } from '../offline/sync';
import { readOffline, setOfflineAccess, writeOffline } from '../offline/offlineStorage';
import { LiveProject, type ProjectRole, type ProjectSnapshot } from './liveProject';

export type ProjectStatus = 'loading' | 'saving' | 'saved' | 'error' | 'offline' | 'conflict' | 'syncing';
export type ProjectSessionState = {
  project: ProjectDocument;
  ready: boolean;
  status: ProjectStatus;
  error: string;
  connected: boolean;
  canEdit: boolean;
  canManage: boolean;
  role: ProjectRole;
  shared: boolean;
  offlineAllowed: boolean;
  pendingOffline: boolean;
};
export const initialProjectSession = (): ProjectSessionState => ({ project: createDefaultProject(), ready: false, status: 'loading', error: '', connected: false, canEdit: false, canManage: false, role: 'public', shared: false, offlineAllowed: false, pendingOffline: false });

type SessionEvents = {
  changed: (state: ProjectSessionState) => void;
  recovery: (project: ProjectDocument, accountId: string, message: string) => void;
  identityChanged: () => void;
  restart: () => void;
};

/** Owns one account-bound editing session; React only subscribes to its state. */
export class ProjectSession {
  state = initialProjectSession();
  snapshot: Omit<ProjectSnapshot, 'project'> | null = null;
  record: OfflineProjectRecord | null = null;
  live: LiveProject | null = null;
  solo: SoloProject | null = null;
  sketchSaving = false;
  private active = true;
  private startupAccountId?: string;
  private unlock?: () => void;
  private unlockLive?: () => void;
  private lockTask?: Promise<unknown>;
  private liveLockTask?: Promise<unknown>;
  private unsubscribeMode?: () => void;
  private refresh?: ReturnType<typeof setInterval>;

  constructor(private id: string, private events: SessionEvents) {}
  private publish(patch: Partial<ProjectSessionState>) {
    if (!this.active) return;
    this.state = { ...this.state, ...patch }; this.events.changed(this.state);
  }
  failure = (cause: unknown) => this.publish({ error: cause instanceof Error ? cause.message : String(cause), status: 'error' });
  clearError() { this.publish({ error: '' }); }
  finishStatus() { this.publish({ status: this.state.error || !this.state.connected ? 'error' : this.live?.hasPending || this.sketchSaving ? 'saving' : 'saved' }); }
  setSketchSaving(value: boolean) {
    this.sketchSaving = value;
    if (value) this.publish({ error: '', status: 'saving' }); else this.finishStatus();
  }
  setShared(shared: boolean) { this.publish({ shared }); if (this.solo) void this.solo.retry(); }
  change(project: ProjectDocument) {
    if (!this.active || !this.state.canEdit) return false;
    this.clearError();
    if (this.solo) this.solo.change(project);
    else if (this.live) this.live.change(project, this.state.project);
    else return false;
    this.publish({ project }); return true;
  }
  retry = () => {
    if (!this.active) return;
    if (this.solo) void this.solo.retry(); else this.live?.retry();
  };
  private reconnect = () => { if (!offlineForced()) this.retry(); };

  private metadata(snapshot: Omit<ProjectSnapshot, 'project'>) {
    if (!this.active) return;
    this.snapshot = snapshot; this.record = null;
    this.publish({ role: snapshot.role, canEdit: snapshot.canEdit, canManage: snapshot.canManage, shared: snapshot.shared });
  }

  private openLive = (snapshot: ProjectSnapshot) => {
    if (!this.active) return;
    this.solo?.destroy(); this.solo = null;
    this.unlock?.(); this.unlock = undefined; this.unlockLive?.(); this.unlockLive = undefined;
    if (snapshot.accountId && navigator.locks) {
      const release = new Promise<void>(accept => { this.unlockLive = accept; });
      this.liveLockTask = navigator.locks.request('3d-space-live:' + snapshot.accountId + ':' + this.id, { mode: 'shared' }, async () => { if (this.active) await release; }).catch(this.failure);
    }
    setOfflineAccess(this.id, null);
    this.metadata(snapshot);
    this.publish({ offlineAllowed: false, pendingOffline: false, project: validateProjectDocument(snapshot.project), ready: true });
    const url = new URL('/api/rooms/' + encodeURIComponent(this.id) + '/live', window.location.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    let editable = snapshot.canEdit;
    const value = new LiveProject(url.href, {
      recovery: (project, message) => { if (this.active && snapshot.accountId) this.events.recovery(project, snapshot.accountId, message); },
      project: project => this.publish({ project, ready: true }),
      metadata: next => { editable = next.canEdit; this.metadata(next); },
      state: (connected, pending) => this.publish({ connected, canEdit: connected && editable, ...(connected ? { error: '', status: pending || this.sketchSaving ? 'saving' : 'saved' } : { status: 'error' }) }),
      error: (message, denied) => { if (denied) this.publish({ canEdit: false, canManage: false }); this.failure(message); },
    });
    this.live = value; value.connect();
  };

  private async acquire(accountId: string) {
    if (!navigator.locks) return false;
    const release = new Promise<void>(accept => { this.unlock = accept; });
    return new Promise<boolean>((accept, reject) => {
      this.lockTask = navigator.locks.request('3d-space-project:' + offlineProjectKey(accountId, this.id), { ifAvailable: true }, async lock => {
        accept(Boolean(lock)); if (lock) await release;
      });
      void this.lockTask.catch(reject);
    });
  }

  private async openSolo(record: OfflineProjectRecord, offline: boolean) {
    if (record.deleted) throw new Error('Este diseño está pendiente de eliminación.');
    let identity = await readOffline<{ id: string; username?: string; verifiedAt?: number }>('meta', 'identity');
    if (!offline && identity?.id !== record.accountId) {
      const { user } = await accountRequest<{ user: { id: string; username: string } | null }>('/api/auth/session');
      if (!this.active) return;
      if (!user || user.id !== record.accountId) throw new AccountRequestError('Entra con la cuenta de este diseño.', 403);
      identity = { ...user, verifiedAt: Date.now() }; await writeOffline('meta', 'identity', identity);
    }
    if (!this.active) return;
    if (identity?.id !== record.accountId) throw new AccountRequestError('Entra con la cuenta de este diseño.', 403);
    const locked = await this.acquire(record.accountId);
    if (!this.active) { this.unlock?.(); return; }
    if (!locked) {
      if (!navigator.locks && !offline) { this.openLive(record.snapshot); return; }
      this.metadata(record.snapshot);
      this.publish({ project: record.draft ?? record.snapshot.project, ready: true, canEdit: false, status: 'error', error: navigator.locks ? 'Este diseño ya está abierto en otra pestaña. Ciérrala para editar aquí.' : 'Este navegador no permite editar sin conexión.' });
      return;
    }
    const value = new SoloProject(record, {
      ...soloNetworkDependencies(record), collaborative: this.openLive,
      changed: (next, status: SoloStatus, error, durable) => {
        if (!this.active) return;
        const allowed = next.authorized && next.snapshot.offlineAllowed === true;
        this.record = next; this.snapshot = next.snapshot;
        setOfflineAccess(this.id, { accountId: next.accountId, allowed: allowed && status !== 'conflict' });
        this.publish({ project: next.draft ?? next.snapshot.project, role: next.snapshot.role, canManage: next.snapshot.canManage, shared: next.snapshot.shared,
          offlineAllowed: allowed, canEdit: allowed && status !== 'conflict', pendingOffline: Boolean(next.localOnly || next.draft || pendingSketches(next) || next.inflight),
          connected: status !== 'offline' && next.authorized, status: !durable && (status === 'saved' || status === 'offline') ? 'saving' : status, error, ready: true });
      },
    });
    this.solo = value;
    try { await value.initialize(offline); }
    catch (cause) { if (!offline && !value.hasPending) { this.openLive(record.snapshot); return; } throw cause; }
  }

  async start() {
    this.publish({ status: 'loading', ready: false, error: '', canEdit: false, offlineAllowed: false, pendingOffline: false });
    this.unsubscribeMode = subscribeOfflineMode(this.modeChanged);
    this.refresh = setInterval(this.reconnect, 15000);
    window.addEventListener('online', this.reconnect); window.addEventListener('focus', this.reconnect); window.addEventListener('offline', this.disconnect);
    window.addEventListener('space-offline-identity', this.identityChanged);
    try {
      const initialIdentity = await bootstrapOfflineMode();
      if (!this.active) return;
      this.startupAccountId = initialIdentity.identity?.id;
      if (offlineForced()) {
        const cached = await readOfflineProject(this.id);
        if (!cached || cached.deleted) throw new Error('Este diseño no está preparado en este dispositivo.');
        if (!cached.authorized) throw new Error('El acceso a este diseño cambió. Descarga tu copia o abre una copia independiente.');
        await this.openSolo(cached, true); return;
      }
      await waitForOfflineSync();
      if (!this.active) return;
      const local = await readOfflineProject(this.id).catch(() => null);
      if (!this.active) return;
      if (local?.deleted) throw new Error('Este diseño está pendiente de eliminación.');
      if (local?.localOnly) { await this.openSolo(local, false); return; }
      const snapshot = await accountRequest<ProjectSnapshot>('/api/rooms/' + encodeURIComponent(this.id));
      if (!this.active) return;
      const currentIdentity = await readOffline<{ id: string }>('meta', 'identity');
      if (!this.active) return;
      if (snapshot.accountId && currentIdentity && currentIdentity.id !== snapshot.accountId) throw new Error('La cuenta activa cambió. Vuelve a abrir el diseño.');
      if (!snapshot.accountId) { this.openLive(snapshot); return; }
      const stored = validateOfflineProject(await readOffline('projects', offlineProjectKey(snapshot.accountId, this.id)), snapshot.accountId, this.id);
      const cached = stored ? await hydrateOfflineProject(stored) : null;
      if (!this.active) return;
      const pending = cached?.draft || cached?.inflight || cached && pendingSketches(cached);
      if (!snapshot.offlineAllowed && !pending) {
        if (cached) { cached.authorized = false; await persistOfflineProject(cached); }
        this.openLive(snapshot); return;
      }
      const record: OfflineProjectRecord = cached ?? { id: this.id, accountId: snapshot.accountId, snapshot, draft: null, authorized: true, updatedAt: Date.now() };
      if (!pending) {
        for (const [levelId, sketch] of Object.entries(record.sketchBlobs ?? {})) if (!snapshot.sketches[levelId]?.hasSketch || sketch.version !== snapshot.sketches[levelId]?.version) delete record.sketchBlobs![levelId];
        record.snapshot = snapshot; record.authorized = true;
      }
      await this.openSolo(record, false);
    } catch (cause) {
      if (!this.active) return;
      if (isNetworkError(cause)) {
        try {
          const record = await readOfflineProject(this.id);
          if (record?.authorized && !record.deleted) { await this.openSolo(record, true); return; }
        } catch { /* Keep the network error when no local copy can be opened. */ }
      } else if (cause instanceof AccountRequestError && cause.status === 401) {
        const cached = await readOfflineProject(this.id).catch(() => null);
        if (!this.active) return;
        if (cached?.authorized && !cached.deleted) { await this.openSolo(cached, true); this.solo?.offline('Tu sesión terminó. Puedes continuar aquí; entra de nuevo para sincronizar.'); return; }
      } else if (cause instanceof AccountRequestError && [403, 404].includes(cause.status)) {
        setOfflineAccess(this.id, null);
        const cached = await readOfflineProject(this.id).catch(() => null);
        if (!this.active) return;
        if (cached) { cached.authorized = false; await persistOfflineProject(cached).catch(() => {}); }
      }
      this.failure(cause);
    }
  }

  private disconnect = () => {
    if (this.solo) this.solo.offline();
    else if (this.live) { this.live.offline(); this.publish({ connected: false, canEdit: false, status: 'error', error: 'Espera a que se restablezca la conexión.' }); }
  };
  private modeChanged = () => {
    if (!this.active) return;
    void this.destroy().finally(this.events.restart);
  };
  private identityChanged = (event: Event) => {
    const expected = this.snapshot?.accountId ?? this.record?.accountId ?? this.startupAccountId;
    const next = (event as CustomEvent<{ accountId?: string }>).detail?.accountId;
    if (!expected || expected === next) return;
    this.events.identityChanged();
    this.snapshot = null; this.record = null;
    this.publish({ canEdit: false, offlineAllowed: false, canManage: false, ready: false, project: createDefaultProject(), error: 'La cuenta activa cambió. Vuelve a abrir el diseño.', status: 'error' });
    void this.destroy();
  };

  async detachSolo() {
    const previous = this.solo; previous?.destroy(); this.solo = null;
    await previous?.settled();
  }
  async assertDurable() {
    const solo = this.solo;
    if (solo) { await solo.settled(); if (!solo.durable) throw new Error('Guarda los cambios en este dispositivo antes de actualizar.'); }
    else if (this.live?.hasPending || this.sketchSaving) throw new Error('Espera a que terminen de guardarse los cambios antes de actualizar.');
  }
  get hasUndurableWork() { return this.solo ? !this.solo.durable : Boolean(this.live?.hasPending || this.sketchSaving); }

  async destroy() {
    this.active = false;
    this.live?.destroy(); this.live = null;
    const previous = this.solo; previous?.destroy(); this.solo = null;
    const unlock = this.unlock; this.unlock = undefined;
    const lockTask = this.lockTask, liveLockTask = this.liveLockTask; this.lockTask = undefined; this.liveLockTask = undefined;
    this.unlockLive?.(); this.unlockLive = undefined;
    setOfflineAccess(this.id, null);
    this.unsubscribeMode?.(); this.unsubscribeMode = undefined;
    clearInterval(this.refresh);
    window.removeEventListener('online', this.reconnect); window.removeEventListener('focus', this.reconnect); window.removeEventListener('offline', this.disconnect);
    window.removeEventListener('space-offline-identity', this.identityChanged);
    try { await previous?.settled(); } finally { unlock?.(); }
    await Promise.all([lockTask?.catch(() => {}), liveLockTask?.catch(() => {})]);
  }
}
