import { AccountRequestError, isNetworkError } from './accountApi';
import { validateProjectDocument, validateProjectChange, type ProjectDocument } from './projectDocument';
import type { ProjectSnapshot } from './liveProject';
import { listOffline, readOffline } from './offlineStorage';
import { offlineForced } from './offlineMode';
import { sameData as same } from './sameData';

export type SketchDraft = { id: string; blob: Blob | null };
export type OfflineProjectRecord = {
  id: string; accountId: string; snapshot: ProjectSnapshot; draft: ProjectDocument | null;
  sketchDrafts?: Record<string, SketchDraft>;
  sketchBlobs?: Record<string, { blob: Blob; version: number }>;
  inflight?: { project: ProjectDocument; revision: number; id: string };
  inflightSketches?: Record<string, SketchDraft & { version: number }>;
  authorized: boolean; updatedAt: number;
  localOnly?: boolean; creating?: boolean; deleted?: boolean; prepared?: boolean; error?: string;
};
export const pendingSketches = (record: OfflineProjectRecord) => Object.keys(record.sketchDrafts ?? {}).length > 0 || Object.keys(record.inflightSketches ?? {}).length > 0;
export const projectWithoutModels = (project: ProjectDocument): ProjectDocument => ({ ...project, levels: project.levels.map(level => ({ ...level, furniture: [] })) });
export type SoloStatus = 'saved' | 'saving' | 'syncing' | 'offline' | 'conflict' | 'error';
export const offlineProjectKey = (accountId: string, id: string) => `${accountId}:${id}`;

export function validateOfflineProject(value: unknown, accountId: string, id: string): OfflineProjectRecord | null {
  try {
    const record = value as OfflineProjectRecord;
    if (!record || record.accountId !== accountId || record.id !== id || record.snapshot.id !== id || record.snapshot.accountId !== accountId || !record.snapshot.offlineAllowed || record.snapshot.role !== 'owner' || record.snapshot.shared || !Number.isSafeInteger(record.snapshot.revision) || record.snapshot.revision < (record.localOnly ? 0 : 1)) return null;
    const project = validateProjectChange(record.snapshot.project, record.snapshot.project), draft = record.draft ? validateProjectChange(project, record.draft) : null;
    if (project.id !== id || draft && draft.id !== id || !record.snapshot.sketches || !record.snapshot.structureRevisions) return null;
    return { ...record, snapshot: { ...record.snapshot, project }, draft };
  } catch { return null; }
}
export async function readOfflineProject(id: string): Promise<OfflineProjectRecord | null> {
  const identity = await readOffline<{ id: string; verifiedAt: number }>('meta', 'identity');
  if (!identity || !Number.isFinite(identity.verifiedAt) || identity.verifiedAt > Date.now() + 300000) return null;
  const value = validateOfflineProject(await readOffline('projects', offlineProjectKey(identity.id, id)), identity.id, id);
  return value ? hydrateOfflineProject(value) : null;
}
export async function hydrateOfflineProject(record: OfflineProjectRecord) {
  record.sketchBlobs ??= {};
  for (const [levelId, state] of Object.entries(record.snapshot.sketches)) {
    if (!state.hasSketch || record.sketchBlobs[levelId]?.version === state.version) continue;
    const saved = await readOffline<{ blob: Blob }>('blobs', offlineProjectKey(record.accountId, record.id) + ':sketch:' + levelId + ':' + state.version);
    if (saved?.blob) record.sketchBlobs[levelId] = { blob: saved.blob, version: state.version };
  }
  for (const property of ['sketchDrafts', 'inflightSketches'] as const) for (const [levelId, value] of Object.entries(record[property] ?? {})) {
    if (value.blob === undefined) {
      const saved = await readOffline<{ blob: Blob | null }>('blobs', offlineProjectKey(record.accountId, record.id) + ':sketch:' + levelId + ':' + value.id);
      if (!saved) throw new Error('Falta un croquis pendiente en este dispositivo.'); value.blob = saved.blob;
    }
  }
  return record;
}
export async function listOfflineDesigns(accountId: string) {
  const records = await listOffline<OfflineProjectRecord>('projects');
  return records.map(entry => validateOfflineProject(entry, accountId, entry?.id)).filter((entry): entry is OfflineProjectRecord => Boolean(entry && !entry.deleted && (entry.authorized || entry.draft || pendingSketches(entry) || entry.inflight || entry.localOnly))).map(entry => ({
    id: entry.id, name: (entry.draft ?? entry.snapshot.project).name, setupStep: (entry.draft ?? entry.snapshot.project).setupStep,
    role: 'owner' as const, canManage: entry.authorized, canEdit: entry.authorized, shared: false, updatedAt: new Date(entry.updatedAt).toISOString(), offline: true,
  }));
}

type Dependencies = {
  persist: (record: OfflineProjectRecord) => Promise<void>;
  get: () => Promise<ProjectSnapshot>;
  create?: (record: OfflineProjectRecord) => Promise<ProjectSnapshot>;
  put: (project: ProjectDocument, revision: number, operationId: string) => Promise<ProjectSnapshot>;
  assets: (project: ProjectDocument) => Promise<ProjectDocument>;
  finalize?: () => Promise<void>;
  sketch: (value: SketchDraft, snapshot: ProjectSnapshot, levelId: string) => Promise<{ hasSketch: boolean; version: number }>;
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
  get hasPending() { return Boolean(this.record.localOnly || this.record.draft || pendingSketches(this.record) || this.record.inflight); }
  get durable() { return this.persistedGeneration === this.generation; }
  get editable() { return !this.stopped && !this.record.deleted && this.record.authorized && this.record.snapshot.offlineAllowed === true && this.status !== 'conflict'; }
  private report() { if (!this.stopped) this.deps.changed(this.record, this.status, this.message, this.durable); }
  private persist() {
    const pending = this.saving.catch(() => {}).then(async () => {
      if (this.durable) return;
      const generation = this.generation;
      await this.deps.persist({ ...this.record, snapshot: { ...this.record.snapshot }, inflight: this.record.inflight && { ...this.record.inflight }, sketchDrafts: structuredClone(this.record.sketchDrafts ?? {}), inflightSketches: structuredClone(this.record.inflightSketches ?? {}), sketchBlobs: { ...this.record.sketchBlobs } });
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
  change(project: ProjectDocument) {
    if (!this.editable) throw new Error('El diseño necesita revisar su conexión antes de continuar.');
    this.record.draft = validateProjectChange(this.record.draft ?? this.record.snapshot.project, project); this.record.updatedAt = Date.now(); this.generation++;
    this.update(this.status === 'offline' ? 'offline' : 'saving');
    void this.persist().catch(() => this.update('error', 'No se pudo guardar la copia en este dispositivo. Mantén esta página abierta.'));
    this.schedule();
  }
  async changeSketch(blob: Blob | null, levelId: string) {
    if (!this.editable || !(this.record.draft ?? this.record.snapshot.project).levels.some(level => level.id === levelId)) throw new Error('El diseño necesita revisar su conexión antes de continuar.');
    if (blob) await validateSketchBlob(blob);
    if (!this.editable || !(this.record.draft ?? this.record.snapshot.project).levels.some(level => level.id === levelId)) throw new Error('El diseño necesita revisar su conexión antes de continuar.');
    (this.record.sketchDrafts ??= {})[levelId] = { id: crypto.randomUUID(), blob }; this.record.updatedAt = Date.now(); this.generation++;
    this.update(this.status === 'offline' ? 'offline' : 'saving'); await this.persist(); this.schedule();
  }
  async cacheSketch(blob: Blob, version: number, levelId: string) {
    if (this.stopped || this.record.sketchDrafts?.[levelId] || this.record.snapshot.sketches[levelId]?.version !== version) return;
    (this.record.sketchBlobs ??= {})[levelId] = { blob, version }; this.generation++; await this.persist();
  }
  offline(message = '') { if (this.editable) this.update('offline', message); }
  private conflict(message: string) { this.update('conflict', message); }
  private accept(server: ProjectSnapshot) {
    if (same(this.record.snapshot, server) && this.record.authorized) return;
    for (const [levelId, cached] of Object.entries(this.record.sketchBlobs ?? {})) if (!server.sketches[levelId]?.hasSketch || server.sketches[levelId]?.version !== cached.version) delete this.record.sketchBlobs![levelId];
    this.record.snapshot = { ...server, project: validateProjectDocument(server.project) }; this.record.authorized = true;
    this.record.updatedAt = Date.now(); this.generation++;
  }
  async retry() {
    if (this.stopped || this.running) return;
    if (this.record.deleted) { this.update('error', 'Este diseño está pendiente de eliminarse. Vuelve a la biblioteca.'); return; }
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
        if (created.revision !== 1 || Object.values(created.sketches).some(state => state.version !== 0) || !same(created.project, projectWithoutModels(this.record.snapshot.project))) throw new AccountRequestError('El diseño cambió antes de confirmar su creación. Tu copia se conserva.', 409);
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
        const knownSketches = this.record.snapshot.sketches;
        const pending = this.record.inflight;
        if (pending && server.revision === pending.revision + 1 && same(server.project, pending.project)) {
          if (same(this.record.draft, pending.project)) this.record.draft = null;
          this.record.inflight = undefined; this.accept(server); await this.persist();
        } else if (server.revision !== this.record.snapshot.revision) {
          if (this.hasPending) { this.conflict('Otra sesión guardó cambios. Tu copia se conserva en este dispositivo.'); return; }
          this.accept(server); await this.persist();
        }
        for (const [levelId, state] of Object.entries(server.sketches)) {
          const sent = this.record.inflightSketches?.[levelId], draft = this.record.sketchDrafts?.[levelId];
          if (sent?.id === state.mutationId || draft?.id === state.mutationId) {
            const accepted = sent?.id === state.mutationId ? sent! : draft!;
            if (draft?.id === accepted.id) delete this.record.sketchDrafts![levelId];
            if (sent) delete this.record.inflightSketches![levelId];
            if (accepted.blob) (this.record.sketchBlobs ??= {})[levelId] = { blob: accepted.blob, version: state.version }; else delete this.record.sketchBlobs?.[levelId];
            this.generation++;
          } else if (state.version !== knownSketches[levelId]?.version && draft) { this.conflict('El croquis cambió en otra sesión. Tu copia se conserva en este dispositivo.'); return; }
        }
        if (Object.keys(this.record.sketchDrafts ?? {}).some(id => !server.sketches[id] && !this.record.draft?.levels.some(level => level.id === id))) { this.conflict('El nivel del croquis ya no existe. Tu copia se conserva en este dispositivo.'); return; }
        this.accept(server); await this.persist();
        if (this.stopped) return;
        if (!this.record.draft) await this.deps.assets(this.record.snapshot.project);
        if (this.stopped) return;
        if (this.record.draft) {
          const selected = this.record.draft;
          const project = await this.deps.assets(selected);
          if (this.stopped) return;
          this.record.inflight = { project, revision: server.revision, id: crypto.randomUUID() }; this.generation++; await this.persist();
          if (this.stopped) return;
          const result = await this.deps.put(project, server.revision, this.record.inflight.id);
          if (this.stopped) return;
          if (same(this.record.draft, selected)) this.record.draft = null;
          this.record.inflight = undefined;
          this.accept(result); await this.persist();
          continue;
        }
        const entry = Object.entries(this.record.sketchDrafts ?? {})[0];
        if (entry) {
          const [levelId, selected] = entry, state = server.sketches[levelId];
          if (!state) { this.conflict('El nivel del croquis ya no existe. Tu copia se conserva en este dispositivo.'); return; }
          (this.record.inflightSketches ??= {})[levelId] = { ...selected, version: state.version }; this.generation++; await this.persist();
          if (this.stopped) return;
          const result = await this.deps.sketch(selected, server, levelId); if (this.stopped) return;
          if (this.record.sketchDrafts?.[levelId]?.id === selected.id) delete this.record.sketchDrafts[levelId];
          delete this.record.inflightSketches![levelId];
          if (selected.blob) (this.record.sketchBlobs ??= {})[levelId] = { blob: selected.blob, version: result.version }; else delete this.record.sketchBlobs?.[levelId];
          this.accept({ ...server, sketches: { ...server.sketches, [levelId]: { ...result, mutationId: selected.id } } }); await this.persist(); continue;
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
    this.record.draft = null; this.record.inflight = undefined; this.record.sketchDrafts = {}; this.record.inflightSketches = {}; this.record.sketchBlobs = {};
    if (!server.offlineAllowed) { this.record.authorized = false; this.generation++; await this.persist(); this.deps.collaborative(server); }
    else { this.accept(server); this.generation++; await this.persist(); this.update('saved'); }
  }
  destroy() { this.stopped = true; if (this.timer) clearTimeout(this.timer); }
  settled() { return this.saving.catch(() => {}); }
}
import { validateSketchBlob } from './imageValidation';
