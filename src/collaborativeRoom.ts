import * as Y from 'yjs';
import type { Room } from './types.js';

const collections = ['furniture', 'openings', 'lights'] as const;
const groups = ['editing', 'sun'] as const;
const excluded = new Set<string>(['vertices', 'wallColors', ...collections, ...groups]);
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validPartField(path: string, value: unknown) {
  const match = path.match(/^(0|[1-9]\d{0,2})\.(color|material|visible|position|rotation|scale)(?:\.([xyz]))?$/);
  if (!match || Number(match[1]) >= 512) return false;
  const [, , field, axis] = match;
  if (field === 'color') return !axis && typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  if (field === 'material') return !axis && ['wood', 'plastic', 'metal'].includes(String(value));
  if (field === 'visible') return !axis && typeof value === 'boolean';
  const min = field === 'scale' ? 0.1 : field === 'rotation' ? -360 : -20, max = field === 'scale' ? 10 : field === 'rotation' ? 360 : 20;
  return Boolean(axis) && typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function mapAt(parent: Y.Map<unknown>, key: string) {
  const existing = parent.get(key);
  if (existing instanceof Y.Map) return existing as Y.Map<unknown>;
  const map = new Y.Map<unknown>();
  parent.set(key, map);
  return map;
}

function writeFields(target: Y.Map<unknown>, next: Record<string, unknown>, previous: Record<string, unknown>) {
  for (const key of Object.keys(previous)) if (!(key in next)) target.delete(key);
  for (const [key, value] of Object.entries(next)) if (!equal(value, previous[key])) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const old = previous[key];
      writeFields(mapAt(target, key), value as Record<string, unknown>, old && typeof old === 'object' && !Array.isArray(old) ? old as Record<string, unknown> : {});
    } else target.set(key, value);
  }
}

function flatParts(parts: Room['furniture'][number]['parts']) {
  const values: Record<string, unknown> = {};
  for (const [id, part] of Object.entries(parts ?? {})) for (const [field, value] of Object.entries(part)) {
    if (value && typeof value === 'object') for (const [axis, number] of Object.entries(value)) values[id + '.' + field + '.' + axis] = number;
    else values[id + '.' + field] = value;
  }
  return values;
}

/** Use the last displayed room as previous, so unrelated remote changes are not overwritten. */
export function writeYRoom(doc: Y.Doc, next: Room, previous?: Room, origin?: unknown) {
  const root = doc.getMap<unknown>('room');
  previous ??= root.size ? readYRoom(doc) : undefined;
  doc.transact(() => {
    const old = previous as unknown as Record<string, unknown> | undefined;
    const simple = Object.fromEntries(Object.entries(next).filter(([key]) => !excluded.has(key)));
    const oldSimple = old ? Object.fromEntries(Object.entries(old).filter(([key]) => !excluded.has(key))) : {};
    writeFields(root, simple, oldSimple);
    const wallColors = mapAt(root, 'wallColorOverrides');
    // Colours refer to a contour generation, so an old colour edit cannot replace new walls.
    if (!previous || !equal(next.vertices, previous.vertices)) {
      wallColors.clear();
      root.set('topology', { vertices: next.vertices, wallColors: next.wallColors, key: crypto.randomUUID() });
    } else if (!equal(next.wallColors, previous.wallColors)) {
      const topology = root.get('topology') as { vertices: Room['vertices']; key: string };
      if (equal(topology.vertices, next.vertices)) next.wallColors.forEach((color, index) => {
        if (color !== previous.wallColors[index]) mapAt(root, 'wallColorOverrides').set(topology.key + ':' + index, color);
      });
    }
    for (const group of groups) writeFields(mapAt(root, group), next[group], previous?.[group] ?? {});
    for (const collection of collections) {
      const entities = mapAt(root, collection);
      const oldItems = new Map((previous?.[collection] ?? []).map(item => [item.id, item]));
      const nextIds = new Set(next[collection].map(item => item.id));
      for (const id of oldItems.keys()) if (!nextIds.has(id)) entities.delete(id);
      next[collection].forEach((item, index) => {
        const oldItem = oldItems.get(item.id);
        if (oldItem && !entities.has(item.id)) return;
        if (oldItem && equal(item, oldItem)) return;
        const entity = mapAt(entities, item.id);
        if (!oldItem) entity.set('_rank', index);
        if ('type' in item && item.type === 'custom') {
          const { parts, ...fields } = item;
          const oldParts = oldItem && 'parts' in oldItem ? oldItem.parts : undefined;
          const oldFields = oldItem ? Object.fromEntries(Object.entries(oldItem).filter(([key]) => key !== 'parts')) : {};
          writeFields(entity, fields, oldFields);
          writeFields(mapAt(entity, 'parts'), flatParts(parts), flatParts(oldParts));
          if (!oldItem || !equal(parts, oldParts)) entity.set('_partsDefined', parts !== undefined);
        } else writeFields(entity, item, oldItem ?? {});
      });
    }
  }, origin);
}

export function seedYRoom(doc: Y.Doc, room: Room) {
  if (doc.getMap('room').size) throw new Error('El documento ya tiene un proyecto.');
  writeYRoom(doc, room);
}

export function readYRoom(doc: Y.Doc): Room {
  const root = doc.getMap<unknown>('room');
  // A forged list/text update can otherwise hide content from Y.Map.toJSON.
  if (root._start) throw new Error('El documento del proyecto no es válido.');
  const simple = Object.fromEntries([...root.entries()].filter(([key]) => !['topology', 'wallColorOverrides', ...collections, ...groups].includes(key)));
  const topology = root.get('topology');
  if (!topology || typeof topology !== 'object' || Array.isArray(topology)) throw new Error('El contorno del proyecto no es válido.');
  const { vertices, wallColors, key } = topology as { vertices: Room['vertices']; wallColors: string[]; key: string };
  if (!Array.isArray(wallColors) || typeof key !== 'string' || !UUID.test(key) || Object.keys(topology).length !== 3) throw new Error('Los colores del proyecto no son válidos.');
  const overrides = root.get('wallColorOverrides');
  if (overrides !== undefined && (!(overrides instanceof Y.Map) || overrides._start)) throw new Error('Los colores del proyecto no son válidos.');
  if (overrides instanceof Y.Map) for (const [path, value] of overrides.entries()) {
    const separator = path.lastIndexOf(':');
    if (separator < 0 || !UUID.test(path.slice(0, separator)) || !/^(?:[0-9]|1[0-9]|2[0-3])$/.test(path.slice(separator + 1)) || typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('Los colores del proyecto no son válidos.');
  }
  const colors = wallColors.map((color, index) => overrides instanceof Y.Map && overrides.has(key + ':' + index) ? overrides.get(key + ':' + index) : color);
  const result: Record<string, unknown> = { ...simple, vertices, wallColors: colors };
  for (const group of groups) {
    const map = root.get(group);
    if (!(map instanceof Y.Map) || map._start) throw new Error('Los ajustes del proyecto no son válidos.');
    if (map.has('__proto__')) throw new Error('Los ajustes del proyecto no son válidos.');
    result[group] = map.toJSON();
  }
  for (const collection of collections) {
    const entities = root.get(collection);
    if (!(entities instanceof Y.Map) || entities._start) throw new Error('Los elementos del proyecto no son válidos.');
    const values = [...entities.entries()].map(([id, entity]) => {
      if (!(entity instanceof Y.Map) || entity._start || entity.get('id') !== id) throw new Error('La identidad del elemento no es válida.');
      if (entity.has('__proto__')) throw new Error('Los datos del elemento no son válidos.');
      const { _rank, _partsDefined, ...item } = entity.toJSON() as Record<string, unknown>;
      if (item.type === 'custom') {
        const partsMap = entity.get('parts');
        if (typeof _partsDefined !== 'boolean' || !(partsMap instanceof Y.Map) || partsMap._start) throw new Error('Las piezas del modelo no son válidas.');
        for (const [path, value] of (entity.get('parts') as Y.Map<unknown>).entries()) if (!validPartField(path, value)) throw new Error('Las piezas del modelo no son válidas.');
        if (_partsDefined) {
          const parts: Record<string, Record<string, unknown>> = {};
          for (const [path, value] of Object.entries(item.parts as Record<string, unknown>)) {
            const [partId, field, axis] = path.split('.');
            const part = parts[partId] ??= {};
            if (axis) ((part[field] ??= {}) as Record<string, unknown>)[axis] = value;
            else part[field] = value;
          }
          item.parts = parts;
        } else delete item.parts;
      } else if (_partsDefined !== undefined) throw new Error('Las piezas sólo corresponden a modelos propios.');
      if (typeof _rank !== 'number' || !Number.isSafeInteger(_rank) || _rank < 0 || _rank > 200) throw new Error('El orden del elemento no es válido.');
      return { rank: _rank, id, item };
    });
    values.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
    result[collection] = values.map(value => value.item);
  }
  return result as unknown as Room;
}
