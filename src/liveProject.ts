import * as Y from 'yjs';
import { readYRoom, writeYRoom } from './collaborativeRoom';
import { validateRoom } from './model';
import type { Room } from './types';

export type ProjectRole = 'owner' | 'editor' | 'reader' | 'public';
export type ProjectSnapshot = { id: string; room: Room; revision: number; canEdit: boolean; canManage: boolean; role: ProjectRole; hasSketch: boolean; sketchVersion: number; shared: boolean };
type Edit = { previous: Room; next: Room; update: Uint8Array; id: string; batch?: string };
const encode = (data: Uint8Array) => {
  let value = ''; for (let i = 0; i < data.length; i += 8192) value += String.fromCharCode(...data.subarray(i, i + 8192));
  return btoa(value);
};
const decode = (data: string) => Uint8Array.from(atob(data), value => value.charCodeAt(0));

export class LiveProject {
  private doc = new Y.Doc();
  private socket: WebSocket | null = null;
  private pending: Edit[] = [];
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private flush: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private synchronized = false;
  private serial = 0;
  private prefix = crypto.randomUUID();
  private editable = false;
  constructor(private url: string, private callbacks: {
    room: (room: Room) => void;
    metadata: (snapshot: Omit<ProjectSnapshot, 'room'>) => void;
    state: (connected: boolean, pending: boolean) => void;
    error: (message: string, denied?: boolean) => void;
  }, private factory: (url: string) => WebSocket = address => new WebSocket(address)) {}

  connect() {
    if (this.stopped || this.socket && this.socket.readyState < 2) return;
    this.socket = this.factory(this.url);
    const socket = this.socket;
    socket.onmessage = event => {
      if (this.stopped || socket !== this.socket) return;
      try {
        const message = JSON.parse(String(event.data));
        if (message.type === 'sync') {
          this.replace(message.update);
          this.synchronized = true; this.editable = message.canEdit === true;
          this.callbacks.metadata(message);
          if (!this.editable) this.pending = [];
          const dropped = this.replay(); this.publish(); this.sendPending();
          if (dropped) this.callbacks.error('Un cambio pendiente ya no cabe en el diseño actualizado. Se conservó la última versión válida.');
        } else if (message.type === 'update') {
          Y.applyUpdate(this.doc, decode(message.update));
          try { this.publish(); }
          catch {
            this.synchronized = false; this.report();
            socket.send(JSON.stringify({ type: 'sync' }));
          }
        } else if (message.type === 'ack') {
          this.pending = this.pending.filter(edit => edit.batch !== message.id);
          this.report(); this.armTimeout();
        } else if (message.type === 'metadata') {
          const wasEditable = this.editable;
          this.editable = message.canEdit === true; this.callbacks.metadata(message);
          if (wasEditable && !this.editable) {
            this.pending = []; this.synchronized = false;
            if (this.flush) { clearTimeout(this.flush); this.flush = undefined; }
            if (this.timeout) clearTimeout(this.timeout);
            socket.send(JSON.stringify({ type: 'sync' }));
          }
          this.report();
        } else if (message.type === 'error') {
          this.pending = this.pending.filter(edit => edit.batch !== (message.requestId ?? message.id));
          if (message.update) { this.replace(message.update); this.editable = message.canEdit === true; this.callbacks.metadata(message); if (!this.editable) this.pending = []; this.replay(); this.publish(); this.sendPending(); }
          this.callbacks.error(message.error || 'No se pudo guardar el cambio.', message.status === 401 || message.status === 403);
        } else if (message.type === 'access') {
          this.editable = false; this.synchronized = false; this.callbacks.state(false, this.pending.length > 0);
          this.callbacks.error(message.error || 'Tu acceso a este diseño terminó.', true); this.stopped = true; socket.close();
        }
      } catch { this.callbacks.error('No se pudo recibir el diseño. Reintenta la conexión.'); socket.close(); }
    };
    socket.onclose = event => {
      if (socket !== this.socket || this.stopped) return;
      this.synchronized = false; this.callbacks.state(false, this.pending.length > 0);
      if (event.code === 4003 || event.code === 1008) { this.callbacks.error('Tu sesión o tu acceso terminaron.', true); this.stopped = true; return; }
      this.callbacks.error('Conexión interrumpida. Reconectando…');
      this.reconnect = setTimeout(() => this.connect(), 1500);
    };
    socket.onerror = () => { if (!this.stopped) this.callbacks.error('No se pudo conectar. Reconectando…'); };
  }

  change(next: Room, previous: Room) {
    if (!this.synchronized || !this.editable || this.socket?.readyState !== WebSocket.OPEN) throw new Error('Espera a que se restablezca la conexión.');
    if (this.pending.length >= 128) throw new Error('Espera a que terminen de guardarse los cambios.');
    const candidate = new Y.Doc();
    let update: Uint8Array;
    let accepted = false;
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(this.doc));
      candidate.clientID = this.doc.clientID;
      const before = Y.encodeStateVector(candidate);
      writeYRoom(candidate, validateRoom(next), previous);
      validateRoom(readYRoom(candidate));
      update = Y.encodeStateAsUpdate(candidate, before);
      this.doc.destroy(); this.doc = candidate; accepted = true;
    } finally { if (!accepted) candidate.destroy(); }
    const edit = { next, previous, update, id: this.prefix + ':' + ++this.serial };
    this.pending.push(edit); this.publish(); this.report();
    if (!this.flush) this.flush = setTimeout(() => { this.flush = undefined; this.sendPending(); }, 85);
  }
  private replace(update: string) { this.doc.destroy(); this.doc = new Y.Doc(); Y.applyUpdate(this.doc, decode(update)); }
  private replay() {
    let dropped = false;
    this.pending = this.pending.filter(edit => {
      const candidate = new Y.Doc();
      let accepted = false;
      try {
        Y.applyUpdate(candidate, Y.encodeStateAsUpdate(this.doc));
        candidate.clientID = this.doc.clientID;
        const before = Y.encodeStateVector(candidate);
        writeYRoom(candidate, edit.next, edit.previous);
        validateRoom(readYRoom(candidate));
        edit.update = Y.encodeStateAsUpdate(candidate, before); edit.batch = undefined;
        this.doc.destroy(); this.doc = candidate; accepted = true;
        return true;
      } catch { dropped = true; return false; }
      finally { if (!accepted) candidate.destroy(); }
    });
    return dropped;
  }
  private sendPending() {
    const unsent = this.pending.filter(edit => !edit.batch);
    if (this.editable && this.synchronized && this.socket?.readyState === WebSocket.OPEN && unsent.length) {
      const id = this.prefix + ':batch:' + ++this.serial;
      unsent.forEach(edit => { edit.batch = id; });
      this.socket.send(JSON.stringify({ type: 'update', id, update: encode(Y.mergeUpdates(unsent.map(edit => edit.update))) }));
    }
    this.report(); this.armTimeout();
  }
  private publish() { this.callbacks.room(validateRoom(readYRoom(this.doc))); }
  private report() { this.callbacks.state(this.synchronized, this.pending.length > 0); }
  private armTimeout() {
    if (this.timeout) clearTimeout(this.timeout);
    if (this.pending.length) this.timeout = setTimeout(() => { this.callbacks.error('El guardado tardó demasiado. Reconectando…'); this.socket?.close(); }, 15000);
  }
  get hasPending() { return this.pending.length > 0; }
  retry() { if (this.reconnect) clearTimeout(this.reconnect); this.stopped = false; if (this.socket?.readyState === WebSocket.OPEN) this.sendPending(); else this.connect(); }
  destroy() { this.stopped = true; if (this.reconnect) clearTimeout(this.reconnect); if (this.timeout) clearTimeout(this.timeout); if (this.flush) clearTimeout(this.flush); this.socket?.close(); this.doc.destroy(); }
}
