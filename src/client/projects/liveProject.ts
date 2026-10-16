import * as Y from 'yjs';
import { assembleProject, projectScopes, readProjectScope, writeProjectScope } from '../../domain/collaboration/collaborativeProject';
import { validateProjectDocument, validateProjectChange, type ProjectDocument } from '../../domain/project/projectDocument';
import { structureCommand, type StructureCommand } from '../../domain/project/projectProtocol';

export type ProjectRole = 'owner' | 'editor' | 'reader' | 'public';
export type SketchState = { hasSketch: boolean; version: number; mutationId: string | null };
export type ProjectSnapshot = { id: string; project: ProjectDocument; revision: number; structureRevision: number; structureRevisions: Record<string, number>; sketches: Record<string, SketchState>; canEdit: boolean; canManage: boolean; role: ProjectRole; shared: boolean; accountId?: string | null; offlineAllowed?: boolean };
type Edit = { id: string; scope?: string; update?: string; command?: StructureCommand; next: ProjectDocument; previous: ProjectDocument; sent?: boolean };
const encode = (data: Uint8Array) => { let value = ''; for (let i = 0; i < data.length; i += 8192) value += String.fromCharCode(...data.subarray(i, i + 8192)); return btoa(value); };
const decode = (data: string) => Uint8Array.from(atob(data), value => value.charCodeAt(0));

/** Ordinary updates touch one level document; geometry uses confirmed structural commands. */
export class LiveProject {
  private docs = new Map<string, Y.Doc>();
  private socket: WebSocket | null = null;
  private pending: Edit[] = [];
  private reconnect?: ReturnType<typeof setTimeout>;
  private timeout?: ReturnType<typeof setTimeout>;
  private flush?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private paused = false;
  private synchronized = false;
  private editable = false;
  private snapshot?: ProjectSnapshot;
  private recovery: ProjectDocument | null = null;
  constructor(private url: string, private callbacks: {
    project: (project: ProjectDocument) => void;
    metadata: (snapshot: Omit<ProjectSnapshot, 'project'>) => void;
    state: (connected: boolean, pending: boolean) => void;
    error: (message: string, denied?: boolean) => void;
    recovery?: (project: ProjectDocument, reason: string) => void;
  }, private factory: (url: string) => WebSocket = address => new WebSocket(address)) {}
  connect() {
    if (this.stopped || this.paused || this.socket && this.socket.readyState < 2) return;
    const socket = this.socket = this.factory(this.url);
    socket.onmessage = event => {
      if (this.stopped || this.paused || socket !== this.socket) return;
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'sync' || message.type === 'error' && message.states) {
          if (message.type === 'error') {
            const rejected = this.pending.find(edit => edit.id === message.requestId);
            if (rejected) {
              this.preserveRecovery(message.error || 'No se pudo guardar el cambio.');
              // Later updates from the same scope may depend on this rejected actor
              // clock. Keep them in the recovery instead of resending invalid bytes.
              this.pending = this.pending.filter(edit => edit.id !== rejected.id && (rejected.scope === undefined || edit.scope !== rejected.scope));
            }
          }
          this.replace(message.states); this.snapshot = message;
          this.synchronized = true; this.editable = message.canEdit === true; this.callbacks.metadata(message);
          if (!this.editable) { this.preserveRecovery('Tu acceso a este diseño cambió.'); this.pending = []; }
          if (this.pending.some(edit => edit.scope && !this.docs.has(edit.scope))) {
            this.preserveRecovery('El nivel de tus cambios ya no existe. Tu copia se conserva.');
            this.pending = this.pending.filter(edit => !edit.scope || this.docs.has(edit.scope));
          }
          // Keep sent bytes/operation IDs so lost confirmations cannot duplicate commands.
          for (const edit of this.pending) if (!edit.command && edit.scope && edit.update && this.docs.has(edit.scope)) Y.applyUpdate(this.docs.get(edit.scope)!, decode(edit.update));
          this.publish(); this.sendPending(true);
          if (message.type === 'error') this.callbacks.error(message.error || 'No se pudo guardar el cambio.', message.status === 401 || message.status === 403);
        } else if (message.type === 'update') {
          const doc = this.docs.get(message.scope); if (!doc) throw new Error();
          Y.applyUpdate(doc, decode(message.update)); this.updateRevision(message); this.publish();
        } else if (message.type === 'ack') {
          this.pending = this.pending.filter(edit => edit.id !== message.id); this.updateRevision(message); this.sendPending();
        } else if (message.type === 'metadata') {
          if (this.snapshot) this.snapshot = { ...this.snapshot, ...message };
          const lost = this.editable && !message.canEdit; this.editable = message.canEdit === true; this.callbacks.metadata(message);
          if (lost) { this.preserveRecovery('Tu acceso a este diseño cambió.'); this.pending = []; socket.send(JSON.stringify({ type: 'sync' })); }
          this.report();
        } else if (message.type === 'access') {
          this.preserveRecovery(message.error || 'Tu acceso a este diseño terminó.'); this.pending = [];
          this.editable = false; this.synchronized = false; this.report(); this.callbacks.error(message.error || 'Tu acceso a este diseño terminó.', true); this.stopped = true; socket.close();
        }
      } catch { this.callbacks.error('No se pudo recibir el diseño. Reintenta la conexión.'); socket.close(); }
    };
    socket.onclose = event => {
      if (socket !== this.socket || this.stopped) return;
      this.synchronized = false; this.report();
      if (this.paused) return;
      if (event.code === 4003 || event.code === 1008) { this.preserveRecovery('Tu sesión o tu acceso terminaron.'); this.pending = []; this.report(); this.callbacks.error('Tu sesión o tu acceso terminaron.', true); this.stopped = true; return; }
      this.callbacks.error('Conexión interrumpida. Reconectando…'); this.reconnect = setTimeout(() => this.connect(), 1500);
    };
    socket.onerror = () => { if (!this.stopped && !this.paused) this.callbacks.error('No se pudo conectar. Reconectando…'); };
  }
  change(next: ProjectDocument, previous: ProjectDocument) {
    if (this.recovery) throw new Error('Recupera o descarta la copia pendiente antes de continuar.');
    if (!this.synchronized || !this.editable || this.socket?.readyState !== WebSocket.OPEN || !this.snapshot) throw new Error('Espera a que se restablezca la conexión.');
    if (this.pending.length >= 128 || this.pending.some(edit => edit.command)) throw new Error('Espera a que terminen de guardarse los cambios.');
    validateProjectChange(previous, next);
    const command = structureCommand(previous, next, this.snapshot.structureRevisions, this.snapshot.structureRevision);
    if (command) {
      if (this.pending.length) throw new Error('Espera a que terminen de guardarse los cambios.');
      this.pending.push({ id: crypto.randomUUID(), command, next, previous }); this.callbacks.project(next); this.sendPending(); return;
    }
    const before = projectScopes(previous), after = projectScopes(next);
    for (const [scope, value] of Object.entries(after)) {
      if (value === before[scope] || JSON.stringify(value) === JSON.stringify(before[scope])) continue;
      const doc = this.docs.get(scope); if (!doc) throw new Error('Los cambios requieren sincronizar el diseño.');
      const vector = Y.encodeStateVector(doc); writeProjectScope(doc, value, before[scope]);
      const update = Y.encodeStateAsUpdate(doc, vector);
      let queued: Edit | undefined;
      for (let index = this.pending.length - 1; index >= 0; index--) if (!this.pending[index].sent && this.pending[index].scope === scope) { queued = this.pending[index]; break; }
      if (queued) { queued.update = encode(Y.mergeUpdates([decode(queued.update!), update])); queued.next = next; }
      else this.pending.push({ id: crypto.randomUUID(), scope, update: encode(update), next, previous });
    }
    this.callbacks.project(next); this.report();
    if (!this.flush) this.flush = setTimeout(() => { this.flush = undefined; this.sendPending(); }, 85);
  }
  private updateRevision(message: any) {
    if (this.snapshot) {
      this.snapshot.revision = Math.max(this.snapshot.revision, Number.isSafeInteger(message.revision) ? message.revision : 0);
      this.snapshot.structureRevision = Math.max(this.snapshot.structureRevision, Number.isSafeInteger(message.structureRevision) ? message.structureRevision : 0);
      this.callbacks.metadata(this.snapshot);
    }
    this.report();
  }
  private replace(states: Record<string, string>) {
    for (const doc of this.docs.values()) doc.destroy(); this.docs.clear();
    for (const [scope, update] of Object.entries(states)) { const doc = new Y.Doc(); Y.applyUpdate(doc, decode(update)); this.docs.set(scope, doc); }
  }
  private sendPending(resend = false) {
    const edit = this.pending[0];
    if (edit && !this.paused && this.editable && this.synchronized && this.socket?.readyState === WebSocket.OPEN && (!edit.sent || resend)) {
      edit.sent = true; this.socket.send(JSON.stringify(edit.command ? { ...edit.command, id: edit.id } : { type: 'update', id: edit.id, scope: edit.scope, update: edit.update }));
    }
    this.report(); if (this.timeout) clearTimeout(this.timeout);
    if (this.pending.length && !this.paused) this.timeout = setTimeout(() => { this.callbacks.error('El guardado tardó demasiado. Reconectando…'); this.socket?.close(); }, 15000);
  }
  private publish() { this.callbacks.project(validateProjectDocument(assembleProject(Object.fromEntries([...this.docs].map(([scope, doc]) => [scope, readProjectScope(doc)]))))); }
  private preserveRecovery(reason: string) {
    if (this.recovery || !this.pending.length) return;
    this.recovery = validateProjectDocument(this.pending[this.pending.length - 1].next);
    this.callbacks.recovery?.(this.recovery, reason);
  }
  private report() { this.callbacks.state(this.synchronized, this.pending.length > 0); }
  get hasPending() { return this.pending.length > 0; }
  get recoveryProject() { return this.recovery; }
  clearRecovery() { this.recovery = null; this.report(); }
  offline() {
    this.paused = true; this.synchronized = false;
    if (this.reconnect) clearTimeout(this.reconnect); this.reconnect = undefined;
    if (this.timeout) clearTimeout(this.timeout); this.timeout = undefined;
    if (this.flush) clearTimeout(this.flush); this.flush = undefined;
    this.socket?.close(); this.report();
  }
  retry() { if (this.reconnect) clearTimeout(this.reconnect); this.stopped = false; this.paused = false; if (this.socket?.readyState === WebSocket.OPEN && this.synchronized) this.sendPending(true); else if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'sync' })); else this.connect(); }
  destroy() { this.stopped = true; if (this.reconnect) clearTimeout(this.reconnect); if (this.timeout) clearTimeout(this.timeout); if (this.flush) clearTimeout(this.flush); this.socket?.close(); for (const doc of this.docs.values()) doc.destroy(); }
}
