import { AccountRequestError, isNetworkError } from './accountApi';
import { validateRoom } from './model';
import type { ProjectSnapshot } from './liveProject';
import type { Room } from './types';
import { listOffline, readOffline } from './offlineStorage';
import { offlineForced } from './offlineMode';

export type OfflineProjectRecord = {
  id: string; accountId: string; snapshot: ProjectSnapshot; draft: Room | null;
  sketchDraft?: { id: string; blob: Blob | null };
  sketchBlob?: Blob;
  inflight?: { room: Room; revision: number };
  inflightSketch?: { id: string; blob: Blob | null; version: number };
  authorized: boolean; updatedAt: number;
  localOnly?: boolean; creating?: boolean; deleted?: boolean; prepared?: boolean; error?: string;
  sketchBlobVersion?: number;
};
export type SoloStatus = 'saved' | 'saving' | 'syncing' | 'offline' | 'conflict' | 'error';
export const offlineProjectKey = (accountId: string, id: string) => `${accountId}:${id}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function validateOfflineProject(value: unknown, accountId: string, id: string): OfflineProjectRecord | null {
  try {
    const record = value as OfflineProjectRecord;
    if (!record || record.accountId !== accountId || record.id !== id || record.snapshot.id !== id || record.snapshot.accountId !== accountId || !record.snapshot.offlineAllowed || record.snapshot.role !== 'owner' || record.snapshot.shared || !Number.isSafeInteger(record.snapshot.revision) || record.snapshot.revision < (record.localOnly ? 0 : 1)) return null;
    return { ...record, snapshot: { ...record.snapshot, room: validateRoom(record.snapshot.room) }, draft: record.draft ? validateRoom(record.draft) : null };
  } catch { return null; }
}
export async function readOfflineProject(id: string): Promise<OfflineProjectRecord | null> {
  const identity = await readOffline<{ id: string; verifiedAt: number }>('meta', 'identity');
  if (!identity || !Number.isFinite(identity.verifiedAt) || identity.verifiedAt > Date.now() + 300000) return null;
  const value = validateOfflineProject(await readOffline('projects', offlineProjectKey(identity.id, id)), identity.id, id);
  return value ? hydrateOfflineProject(value) : null;
}
export async function hydrateOfflineProject(record: OfflineProjectRecord) {
  const base = await readOffline<{ blob: Blob; version: number }>('blobs', offlineProjectKey(record.accountId, record.id) + ':sketch');
  if (base && base.version === record.snapshot.sketchVersion) { record.sketchBlob = base.blob; record.sketchBlobVersion = base.version; }
  for (const property of ['sketchDraft', 'inflightSketch'] as const) {
    const value = record[property];
    if (value && value.blob === undefined) {
      const saved = await readOffline<{ blob: Blob | null }>('blobs', offlineProjectKey(record.accountId, record.id) + ':sketch:' + value.id);
      if (!saved) throw new Error('Falta un croquis pendiente en este dispositivo.');
      value.blob = saved.blob;
    }
  }
  return record;
}
export async function listOfflineDesigns(accountId: string) {
  const records = await listOffline<OfflineProjectRecord>('projects');
  return records.map(entry => validateOfflineProject(entry, accountId, entry?.id)).filter((entry): entry is OfflineProjectRecord => Boolean(entry && !entry.deleted && (entry.authorized || entry.draft || entry.sketchDraft || entry.inflight || entry.inflightSketch || entry.localOnly))).map(entry => ({
    id: entry.id, name: (entry.draft ?? entry.snapshot.room).name, setupStep: (entry.draft ?? entry.snapshot.room).setupStep,
    role: 'owner' as const, canManage: entry.authorized, canEdit: entry.authorized, shared: false, updatedAt: new Date(entry.updatedAt).toISOString(), offline: true,
  }));
}

type Dependencies = {
  persist: (record: OfflineProjectRecord) => Promise<void>;
  get: () => Promise<ProjectSnapshot>;
  create?: (record: OfflineProjectRecord) => Promise<ProjectSnapshot>;
  put: (room: Room, revision: number) => Promise<{ room: Room; revision: number }>;
  assets: (room: Room) => Promise<Room>;
  finalize?: () => Promise<void>;
  sketch: (value: { id: string; blob: Blob | null }, snapshot: ProjectSnapshot) => Promise<{ hasSketch: boolean; sketchVersion: number }>;
  changed: (record: OfflineProjectRecord, status: SoloStatus, message: string, durable: boolean) => void;
  collaborative: (snapshot: ProjectSnapshot) => void;
};

/** One durable, coalesced draft. A server revision always wins over implicit merging. */
export class SoloProject {
  private saving: Promise<void> = Promise.resolve();
  private running = false;
  private stopped = false;
  private generation = 0;
  private persistedGeneration = -1;
  private timer?: ReturnType<typeof setTimeout>;
  private status: SoloStatus = 'saved';
  private message = '';
  constructor(public record: OfflineProjectRecord, private deps: Dependencies) { this.report(); }
  get hasPending() { return Boolean(this.record.localOnly || this.record.draft || this.record.sketchDraft || this.record.inflight || this.record.inflightSketch); }
  get durable() { return this.persistedGeneration === this.generation; }
  get editable() { return !this.stopped && this.record.authorized && this.record.snapshot.offlineAllowed === true && this.status !== 'conflict'; }
  private report() { if (!this.stopped) this.deps.changed(this.record, this.status, this.message, this.durable); }
  private persist() {
    const pending = this.saving.catch(() => {}).then(async () => {
      if (this.durable) return;
      const generation = this.generation;
      await this.deps.persist(structuredClone(this.record));
      this.persistedGeneration = generation; this.report();
    });
    this.saving = pending;
    return pending;
  }
  private update(status: SoloStatus, message = '') { this.status = status; this.message = message; this.report(); }
  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = undefined; void this.retry(); }, 300);
  }
  async initialize(offline = false) { await this.persist(); if (offline) this.update('offline'); else void this.retry(); }
  change(room: Room) {
    if (!this.editable) throw new Error('El diseño necesita revisar su conexión antes de continuar.');
    this.record.draft = validateRoom(room); this.record.updatedAt = Date.now(); this.generation++;
    this.update(this.status === 'offline' ? 'offline' : 'saving');
    void this.persist().catch(() => this.update('error', 'No se pudo guardar la copia en este dispositivo. Mantén esta página abierta.'));
    this.schedule();
  }
  async changeSketch(blob: Blob | null) {
    if (!this.editable) throw new Error('El diseño necesita revisar su conexión antes de continuar.');
    this.record.sketchDraft = { id: crypto.randomUUID(), blob }; this.record.updatedAt = Date.now(); this.generation++;
    this.update(this.status === 'offline' ? 'offline' : 'saving');
    await this.persist(); this.schedule();
  }
  async cacheSketch(blob: Blob, version: number) {
    if (this.stopped || this.record.sketchDraft || this.record.snapshot.sketchVersion !== version) return;
    this.record.sketchBlob = blob; this.record.sketchBlobVersion = version; this.generation++; await this.persist();
  }
  offline(message = '') { if (this.editable) this.update('offline', message); }
  private conflict(message: string) { this.update('conflict', message); }
  private accept(server: ProjectSnapshot) {
    if (same(this.record.snapshot, server) && this.record.authorized) return;
    if (!server.hasSketch || this.record.sketchBlobVersion !== server.sketchVersion) { this.record.sketchBlob = undefined; this.record.sketchBlobVersion = undefined; }
    this.record.snapshot = { ...server, room: validateRoom(server.room) }; this.record.authorized = true;
    this.record.updatedAt = Date.now(); this.generation++;
  }
  async retry() {
    if (this.stopped || this.running) return;
    if (offlineForced()) { await this.persist(); this.update('offline'); return; }
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.running = true;
    this.update('syncing');
    try {
      await this.persist();
      if (this.record.localOnly) {
        if (!this.deps.create) throw new Error('Este diseño todavía no puede sincronizarse.');
        this.record.creating = true; this.generation++; await this.persist();
        const created = await this.deps.create(this.record);
        if (this.stopped) return;
        if (created.accountId !== this.record.accountId || !created.offlineAllowed) throw new AccountRequestError('Entra con la cuenta de este diseño.', 403);
        if (created.revision !== 1 || created.sketchVersion !== 0 || !same(created.room, { ...this.record.snapshot.room, furniture: [] })) throw new AccountRequestError('El diseño cambió antes de confirmar su creación. Tu copia se conserva.', 409);
        this.record.localOnly = false; this.record.creating = undefined; this.accept(created); this.generation++; await this.persist();
      }
      while (!this.stopped) {
        const server = await this.deps.get();
        if (this.stopped) return;
        if (server.accountId !== this.record.accountId) throw new AccountRequestError('La cuenta activa cambió. Vuelve a entrar con la cuenta de este diseño.', 403);
        if (!server.offlineAllowed || server.role !== 'owner' || server.shared) {
          this.record.authorized = false; this.generation++; await this.persist();
          if (this.hasPending) this.conflict('El diseño tiene colaboración activa. Tu copia se conserva; descárgala antes de abrir la versión compartida.');
          else this.deps.collaborative(server);
          return;
        }
        const knownSketchVersion = this.record.snapshot.sketchVersion;
        const pending = this.record.inflight;
        if (pending && server.revision === pending.revision + 1 && same(server.room, pending.room)) {
          if (same(this.record.draft, pending.room)) this.record.draft = null;
          this.record.inflight = undefined; this.accept(server); await this.persist();
        } else if (server.revision !== this.record.snapshot.revision) {
          if (this.hasPending) { this.conflict('Otra sesión guardó cambios. Tu copia se conserva en este dispositivo.'); return; }
          this.accept(server); await this.persist();
        }
        const sentSketch = this.record.inflightSketch;
        if (sentSketch && sentSketch.id === server.sketchMutationId) {
          if (this.record.sketchDraft?.id === sentSketch.id) this.record.sketchDraft = undefined;
          this.record.inflightSketch = undefined; this.record.sketchBlob = sentSketch.blob ?? undefined; this.record.sketchBlobVersion = server.sketchVersion;
          this.accept(server); await this.persist();
        } else if (this.record.sketchDraft && this.record.sketchDraft.id === server.sketchMutationId) {
          this.record.sketchBlob = this.record.sketchDraft.blob ?? undefined; this.record.sketchBlobVersion = server.sketchVersion;
          this.record.sketchDraft = undefined; this.accept(server); await this.persist();
        } else if (server.sketchVersion !== knownSketchVersion && this.record.sketchDraft) {
          this.conflict('El croquis cambió en otra sesión. Tu copia se conserva en este dispositivo.'); return;
        }
        this.accept(server); await this.persist();
        if (this.stopped) return;
        if (!this.record.draft) await this.deps.assets(this.record.snapshot.room);
        if (this.stopped) return;
        if (this.record.draft) {
          const selected = this.record.draft;
          const room = await this.deps.assets(selected);
          if (this.stopped) return;
          this.record.inflight = { room, revision: server.revision }; this.generation++; await this.persist();
          if (this.stopped) return;
          const result = await this.deps.put(room, server.revision);
          if (this.stopped) return;
          if (same(this.record.draft, selected)) this.record.draft = null;
          this.record.inflight = undefined;
          this.accept({ ...server, room: result.room, revision: result.revision }); await this.persist();
          continue;
        }
        if (this.record.sketchDraft) {
          const selected = this.record.sketchDraft;
          this.record.inflightSketch = { ...selected, version: server.sketchVersion }; this.generation++; await this.persist();
          if (this.stopped) return;
          const result = await this.deps.sketch(selected, server);
          if (this.stopped) return;
          if (this.record.sketchDraft?.id === selected.id) this.record.sketchDraft = undefined;
          this.record.inflightSketch = undefined;
          this.record.sketchBlob = selected.blob ?? undefined; this.record.sketchBlobVersion = result.sketchVersion;
          this.accept({ ...server, ...result, sketchMutationId: selected.id }); await this.persist();
          continue;
        }
        await this.deps.finalize?.();
        this.update('saved'); return;
      }
    } catch (cause) {
      if (this.stopped) return;
      if (isNetworkError(cause)) this.update('offline');
      else if (cause instanceof AccountRequestError && cause.status === 401) {
        this.update('offline', 'Tu sesión terminó. Puedes continuar aquí; entra de nuevo para sincronizar.');
      } else if (cause instanceof AccountRequestError && [403, 404].includes(cause.status)) {
        this.record.authorized = false; this.generation++;
        await this.persist().catch(() => {});
        this.update('error', cause.message);
      } else if (cause instanceof AccountRequestError && cause.status === 409) this.conflict(cause.message);
      else this.update('error', cause instanceof Error ? cause.message : 'No se pudieron guardar los cambios.');
    } finally { this.running = false; }
  }
  async discard() {
    if (this.running) throw new Error('Espera a que termine la sincronización.');
    const server = await this.deps.get();
    if (server.accountId !== this.record.accountId) throw new Error('Entra con la cuenta de este diseño.');
    this.record.draft = null; this.record.inflight = undefined; this.record.sketchDraft = undefined; this.record.inflightSketch = undefined;
    this.record.sketchBlob = undefined;
    if (!server.offlineAllowed) { this.record.authorized = false; this.generation++; await this.persist(); this.deps.collaborative(server); }
    else { this.accept(server); this.generation++; await this.persist(); this.update('saved'); }
  }
  destroy() { this.stopped = true; if (this.timer) clearTimeout(this.timer); }
  settled() { return this.saving.catch(() => {}); }
}
