import * as Y from 'yjs';
import { projectMetadata } from './projectMetadata.js';
import type { ProjectDocument } from './projectDocument.js';
import { sameData as same } from './sameData.js';

const plain = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const collections = ['furniture', 'openings', 'lights', 'walls', 'surfaces', 'points', 'stairs', 'roofs'];
function flatParts(value: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(plain(value) ? value : {}).flatMap(([id, part]) => Object.entries(plain(part) ? part : {}).flatMap(([field, value]) => plain(value) ? Object.entries(value).map(([axis, number]) => [id + '.' + field + '.' + axis, number]) : [[id + '.' + field, value]])));
}
function write(map: Y.Map<unknown>, next: Record<string, unknown>, previous: Record<string, unknown>, entities = false) {
  if (next.type === 'custom' && !map.has('parts')) { map.set('parts', new Y.Map()); map.set('_partsDefined', false); }
  for (const key of Object.keys(previous)) if (!(key in next)) {
    if (key === 'parts' && next.type === 'custom') { (map.get('parts') as Y.Map<unknown>).clear(); map.set('_partsDefined', false); }
    else map.delete(key);
  }
  for (const [key, value] of Object.entries(next)) {
    if (same(value, previous[key])) continue;
    if (entities && Object.hasOwn(previous, key) && !map.has(key)) continue;
    if (key === 'parts' && next.type === 'custom') {
      write(map.get('parts') as Y.Map<unknown>, flatParts(value), flatParts(previous[key])); map.set('_partsDefined', value !== undefined); continue;
    }
    if (plain(value)) {
      let child = map.get(key);
      if (!(child instanceof Y.Map)) { child = new Y.Map(); map.set(key, child); }
      write(child as Y.Map<unknown>, value, plain(previous[key]) ? previous[key] : {});
    } else if (Array.isArray(value) && collections.includes(key)) {
      let child = map.get(key);
      if (!(child instanceof Y.Map)) { child = new Y.Map(); map.set(key, child); }
      write(child as Y.Map<unknown>, Object.fromEntries(value.map(item => [item.id, item])), Object.fromEntries((Array.isArray(previous[key]) ? previous[key] : []).map(item => [item.id, item])), true);
      const order = value.map(item => item.id), previousOrder = (Array.isArray(previous[key]) ? previous[key] : []).map(item => item.id);
      if (!same(order, previousOrder)) (child as Y.Map<unknown>).set('_order', order);
    } else map.set(key, value);
  }
}
function read(value: unknown, key?: string): any {
  if (!(value instanceof Y.Map)) { if (value instanceof Y.AbstractType) throw new Error('Los cambios no son válidos.'); return value; }
  if (value._start || value.has('__proto__')) throw new Error('Los cambios no son válidos.');
  if (key && collections.includes(key)) {
    const order = value.get('_order');
    if (order !== undefined && (!Array.isArray(order) || order.length > 1536 || order.some(id => typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) || new Set(order).size !== order.length)) throw new Error('Los cambios no son válidos.');
    const entries = [...value.entries()].filter(([id]) => id !== '_order');
    const positions = new Map<string, number>((order ?? []).map((id: string, index: number): [string, number] => [id, index]));
    entries.sort(([a], [b]) => ((positions.get(a) ?? Infinity) - (positions.get(b) ?? Infinity)) || (a < b ? -1 : a > b ? 1 : 0));
    return entries.map(([id, child]) => {
      if (!(child instanceof Y.Map) || child.get('id') !== id) throw new Error('La identidad del elemento no es válida.');
      return read(child);
    });
  }
  const result: Record<string, any> = Object.fromEntries([...value.entries()].filter(([name]) => name !== '_partsDefined').map(([name, child]) => [name, read(child, name)]));
  if (result.type === 'custom') {
    if (typeof value.get('_partsDefined') !== 'boolean') throw new Error('El modelo contiene una parte no válida.');
    const parts: Record<string, any> = {};
    for (const [path, number] of Object.entries(result.parts ?? {})) {
      const match = path.match(/^(0|[1-9]\d{0,2})\.(color|material|visible|position|rotation|scale)(?:\.([xyz]))?$/);
      if (!match || Number(match[1]) >= 512) throw new Error('El modelo contiene una parte no válida.');
      const [, id, field, axis] = match; parts[id] ??= {};
      if (axis) { parts[id][field] ??= {}; parts[id][field][axis] = number; } else parts[id][field] = number;
    }
    if (value.get('_partsDefined') === true) result.parts = parts; else { if (Object.keys(parts).length) throw new Error('El modelo contiene una parte no válida.'); delete result.parts; }
  } else if (value.has('_partsDefined')) throw new Error('Los cambios no son válidos.');
  return result;
}
export function writeProjectScope(doc: Y.Doc, next: Record<string, unknown>, previous: Record<string, unknown> = {}) {
  doc.transact(() => write(doc.getMap('data'), next, previous));
}
export const readProjectScope = (doc: Y.Doc): Record<string, unknown> => read(doc.getMap('data'));
export const projectScopes = (project: ProjectDocument): Record<string, Record<string, unknown>> => ({ meta: { ...projectMetadata(project), levelIds: project.levels.map(level => level.id) }, ...Object.fromEntries(project.levels.map(level => [level.id, level])) });
export function assembleProject(scopes: Record<string, Record<string, unknown>>): ProjectDocument {
  const { levelIds, ...meta } = scopes.meta;
  if (!Array.isArray(levelIds)) throw new Error('Los cambios no son válidos.');
  return { ...meta, levels: levelIds.map(id => scopes[String(id)]) } as ProjectDocument;
}
