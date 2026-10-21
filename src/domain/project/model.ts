import type { BedSize, FloorFinish, FurnitureItem, ModelPart, Opening, Point, Room, Selection } from './types.js';
import { getFurniturePreset, isFurnitureVariant } from '../models/furnitureCatalog.js';
import { SpatialIndex } from '../../shared/spatialIndex.js';

const EPS = 1e-7;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const itemId = () => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');

export const BED_SIZES: Record<BedSize, { label: string; width: number; depth: number }> = {
  single: { label: 'Individual', width: 1, depth: 1.9 },
  double: { label: 'Matrimonial', width: 1.35, depth: 1.9 },
  queen: { label: 'Queen', width: 1.5, depth: 1.9 },
  king: { label: 'King', width: 2, depth: 1.9 },
};
export const FURNITURE_LABELS: Record<FurnitureItem['type'], string> = { bed: 'Cama', wardrobe: 'Ropero', vanity: 'Tocador', nightstand: 'Buró', custom: 'Modelo' };
export const FURNITURE_COLORS: Record<FurnitureItem['type'], string> = { bed: '#b8a084', wardrobe: '#b8a084', vanity: '#b8a084', nightstand: '#b8a084', custom: '#b8a084' };

export function createDefaultRoom(): Room {
  return {
    version: 3, name: 'Mi habitación',
    vertices: [{ x: -2.5, z: -2 }, { x: 2.5, z: -2 }, { x: 2.5, z: 2 }, { x: -2.5, z: 2 }],
    wallColors: ['#f5f5f2', '#f5f5f2', '#f5f5f2', '#f5f5f2'],
    height: 2.8, thickness: 0.15, floorColor: '#edede8', ceilingColor: '#ffffff', floorFinish: 'concrete', renderQuality: 'standard', editing: { snap: true, step: 0.1, bounds: true }, furniture: [],
    openings: [],
    lights: [{ id: 'light-1', name: 'Luz principal', x: 0, y: 2.5, z: 0, lumens: 800, temperature: 2700, enabled: true }],
    sun: { enabled: true, hour: 15, azimuth: 54, intensity: 3 },
  };
}

export function bounds(vertices: Point[]) {
  const minX = Math.min(...vertices.map(p => p.x));
  const maxX = Math.max(...vertices.map(p => p.x));
  const minZ = Math.min(...vertices.map(p => p.z));
  const maxZ = Math.max(...vertices.map(p => p.z));
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ };
}

function signedArea(vertices: Point[]) {
  return vertices.reduce((sum, p, i) => {
    const next = vertices[(i + 1) % vertices.length];
    return sum + p.x * next.z - next.x * p.z;
  }, 0) / 2;
}

export const polygonArea = (vertices: Point[]) => Math.abs(signedArea(vertices));
export function wallCount(room: Room) { return room.wallSegments?.length ?? room.vertices.length; }
export function roomWallEndpoints(room: Room, index: number): [Point, Point] {
  const segment = room.wallSegments?.[index];
  if (segment) return [segment.start, segment.end];
  const a = room.vertices[index], b = room.vertices[(index + 1) % room.vertices.length];
  if (!a || !b) throw new Error('La pared ya no existe.');
  return [a, b];
}
export function wallLength(room: Room, index: number) {
  const [a, b] = roomWallEndpoints(room, index);
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function segmentDistance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}

export function pointInPolygon(point: Point, vertices: Point[]) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const a = vertices[i], b = vertices[j];
    if (segmentDistance(point, a, b) < EPS) return true;
    if ((a.z > point.z) !== (b.z > point.z) && point.x < (b.x - a.x) * (point.z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function walkablePoint(point: Point, vertices: Point[], margin = 0.2) {
  return pointInPolygon(point, vertices) && vertices.every((p, i) => segmentDistance(point, p, vertices[(i + 1) % vertices.length]) >= margin - EPS);
}

export function interiorPoint(vertices: Point[], margin = 0.2): Point {
  const area = signedArea(vertices);
  const centroid = vertices.reduce((p, a, i) => {
    const b = vertices[(i + 1) % vertices.length], cross = a.x * b.z - b.x * a.z;
    return { x: p.x + (a.x + b.x) * cross / (6 * area), z: p.z + (a.z + b.z) * cross / (6 * area) };
  }, { x: 0, z: 0 });
  if (walkablePoint(centroid, vertices, margin)) return centroid;
  const box = bounds(vertices);
  let best = { ...vertices[0] }, clearance = -1;
  const consider = (point: Point) => {
    if (!pointInPolygon(point, vertices)) return;
    const distance = Math.min(...vertices.map((p, i) => segmentDistance(point, p, vertices[(i + 1) % vertices.length])));
    if (distance > clearance) { best = point; clearance = distance; }
  };
  consider(centroid);
  vertices.forEach((a, i) => {
    const b = vertices[(i + 1) % vertices.length], length = Math.hypot(b.x - a.x, b.z - a.z), direction = Math.sign(area);
    for (const inset of [0.1, 0.01, 0.001, 0.0001]) consider({ x: (a.x + b.x) / 2 - (b.z - a.z) / length * direction * inset, z: (a.z + b.z) / 2 + (b.x - a.x) / length * direction * inset });
  });
  // shortcut: la cuadrícula aproxima el margen en pasillos estrechos; usar triangulación si se requieren plantas de precisión arquitectónica.
  for (let x = 1; x < 40; x++) for (let z = 1; z < 40; z++) {
    const point = { x: box.minX + box.width * x / 40, z: box.minZ + box.depth * z / 40 };
    consider(point);
  }
  return best;
}

function cross(a: Point, b: Point, c: Point) {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  const ac = cross(a, b, c), ad = cross(a, b, d), ca = cross(c, d, a), cb = cross(c, d, b);
  return ((ac > EPS && ad < -EPS || ac < -EPS && ad > EPS) && (ca > EPS && cb < -EPS || ca < -EPS && cb > EPS)) ||
    segmentDistance(a, c, d) < EPS || segmentDistance(b, c, d) < EPS || segmentDistance(c, a, b) < EPS || segmentDistance(d, a, b) < EPS;
}

export function furnitureCorners(item: FurnitureItem): Point[] {
  const angle = item.rotation * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => {
    const dx = x * item.width / 2, dz = z * item.depth / 2;
    return { x: item.x + dx * cosine + dz * sine, z: item.z - dx * sine + dz * cosine };
  });
}

export function furnitureContains(point: Point, item: FurnitureItem, margin = 0.15) {
  const angle = item.rotation * Math.PI / 180, dx = point.x - item.x, dz = point.z - item.z;
  return Math.abs(dx * Math.cos(angle) - dz * Math.sin(angle)) < item.width / 2 + margin - EPS && Math.abs(dx * Math.sin(angle) + dz * Math.cos(angle)) < item.depth / 2 + margin - EPS;
}

export function furnitureInside(item: FurnitureItem, vertices: Point[], margin = 0) {
  if (vertices.length < 3 || ![item.x, item.z, item.width, item.depth, item.rotation, margin].every(Number.isFinite) || item.width <= 0 || item.depth <= 0 || margin < 0) return false;
  return footprintInside(furnitureCorners(item), vertices, margin);
}

function footprintInside(corners: Point[], vertices: Point[], margin = 0) {
  if (!corners.every(p => pointInPolygon(p, vertices))) return false;
  return corners.every((a, i) => {
    const b = corners[(i + 1) % corners.length], dx = b.x - a.x, dz = b.z - a.z, cuts = [0, 1];
    for (let j = 0; j < vertices.length; j++) {
      const c = vertices[j], d = vertices[(j + 1) % vertices.length], ex = d.x - c.x, ez = d.z - c.z;
      if (margin > 0 && (segmentsIntersect(a, b, c, d) || Math.min(segmentDistance(a, c, d), segmentDistance(b, c, d), segmentDistance(c, a, b), segmentDistance(d, a, b)) < margin - EPS)) return false;
      const denominator = dx * ez - dz * ex;
      if (Math.abs(denominator) < EPS) {
        if (Math.abs(cross(a, b, c)) < EPS) for (const p of [c, d]) {
          const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz);
          if (t > 0 && t < 1) cuts.push(t);
        }
      } else {
        const t = ((c.x - a.x) * ez - (c.z - a.z) * ex) / denominator;
        const u = ((c.x - a.x) * dz - (c.z - a.z) * dx) / denominator;
        if (t > 0 && t < 1 && u >= -EPS && u <= 1 + EPS) cuts.push(t);
      }
    }
    cuts.sort((x, y) => x - y);
    return cuts.slice(1).every((end, j) => {
      const middle = (cuts[j] + end) / 2;
      return pointInPolygon({ x: a.x + dx * middle, z: a.z + dz * middle }, vertices);
    });
  });
}

function polygonsOverlap(ca: Point[], cb: Point[]) {
  return [ca, cb].every(corners => corners.every((p, i) => {
    const next = corners[(i + 1) % corners.length], axis = { x: next.z - p.z, z: p.x - next.x };
    const pa = ca.map(p => p.x * axis.x + p.z * axis.z), pb = cb.map(p => p.x * axis.x + p.z * axis.z);
    return Math.min(...pa) < Math.max(...pb) - EPS && Math.min(...pb) < Math.max(...pa) - EPS;
  }));
}

function furnitureOverlaps(a: FurnitureItem, b: FurnitureItem) {
  return polygonsOverlap(furnitureCorners(a), furnitureCorners(b));
}

export function furniturePlacementIssues(room: Room, item: FurnitureItem): { outside: boolean; overlap: boolean } {
  return {
    outside: !furnitureInside(item, room.vertices, room.thickness / 2),
    overlap: room.furniture.some(other => other.id !== item.id && furnitureOverlaps(item, other)),
  };
}

type PlacementCache = { index: SpatialIndex; items: Map<string, { signature: string; item: FurnitureItem; box: ReturnType<typeof bounds> }>; invalid: Set<string>; outline: string };
const placementCaches = new Map<string, PlacementCache>();
export function invalidFurnitureIds(room: Room): Set<string> {
  const key = room.levelId ?? 'preview', cache = placementCaches.get(key) ?? { index: new SpatialIndex(), items: new Map(), invalid: new Set(), outline: '' };
  placementCaches.delete(key); placementCaches.set(key, cache);
  while (placementCaches.size > 24) placementCaches.delete(placementCaches.keys().next().value!);
  const affected = new Set<string>(), ids = new Set(room.furniture.map(item => item.id)), outline = JSON.stringify([room.vertices, room.thickness]);
  for (const [id, previous] of cache.items) if (!ids.has(id)) { for (const neighbor of cache.index.query(previous.box)) affected.add(neighbor); cache.index.remove(id); cache.items.delete(id); cache.invalid.delete(id); }
  for (const item of room.furniture) {
    const signature = [item.x, item.z, item.width, item.depth, item.rotation].join(','), previous = cache.items.get(item.id);
    if (previous?.signature === signature) continue;
    if (previous) for (const neighbor of cache.index.query(previous.box)) affected.add(neighbor);
    const box = bounds(furnitureCorners(item)); cache.index.set(item.id, box); cache.items.set(item.id, { signature, item, box }); affected.add(item.id);
    for (const neighbor of cache.index.query(box)) affected.add(neighbor);
  }
  if (cache.outline !== outline) { cache.outline = outline; for (const id of ids) affected.add(id); }
  for (const id of affected) {
    const entry = cache.items.get(id); if (!entry) continue;
    const overlap = [...cache.index.query(entry.box)].some(otherId => otherId !== id && furnitureOverlaps(entry.item, cache.items.get(otherId)!.item));
    if (overlap || !furnitureInside(entry.item, room.vertices, room.thickness / 2)) cache.invalid.add(id); else cache.invalid.delete(id);
  }
  return new Set(cache.invalid);
}

export function furnitureWalkable(point: Point, room: Room, margin = Math.max(0.2, room.thickness / 2 + 0.12)) {
  return walkablePoint(point, room.vertices, margin) && room.furniture.every(item => !furnitureContains(point, item, margin));
}

export function interiorWalkPoint(room: Room): Point | null {
  const center = interiorPoint(room.vertices);
  if (furnitureWalkable(center, room)) return center;
  const box = bounds(room.vertices);
  for (let x = 1; x < 40; x++) for (let z = 1; z < 40; z++) {
    const point = { x: box.minX + box.width * x / 40, z: box.minZ + box.depth * z / 40 };
    if (furnitureWalkable(point, room)) return point;
  }
  return null;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}: debe ser un objeto.`);
  return value as Record<string, unknown>;
}
function number(value: unknown, min: number, max: number, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min - EPS || value > max + EPS) throw new Error(`${label}: usa un número entre ${min} y ${max}.`);
  return value;
}
function text(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) throw new Error(`${label}: escribe un texto de 1 a 100 caracteres.`);
  return value;
}
function color(value: unknown, label: string) {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`${label}: usa un color hexadecimal de seis cifras.`);
  return value;
}
function boolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`${label}: debe ser verdadero o falso.`);
  return value;
}
function array(value: unknown, min: number, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) throw new Error(`${label}: admite entre ${min} y ${max} elementos.`);
  return value;
}

function readFurniture(value: unknown, height: number, index = 0): FurnitureItem {
  const p = record(value, `Mueble ${index + 1}`);
  if (typeof p.type !== 'string' || !Object.hasOwn(FURNITURE_LABELS, p.type)) throw new Error('El mueble debe ser cama, ropero, tocador o buró.');
  const type = p.type as FurnitureItem['type'];
  const minSize = type === 'custom' ? 0.01 : 0.1;
  let bedSize: BedSize | undefined;
  if (type === 'bed') {
    const size = p.bedSize;
    if (typeof size !== 'string' || !Object.hasOwn(BED_SIZES, size)) throw new Error('El tamaño de cama debe ser individual, matrimonial, queen o king.');
    bedSize = size as BedSize;
  } else if (p.bedSize !== undefined) throw new Error('El tamaño de cama solo corresponde a las camas.');
  const material = p.material;
  if (!(type === 'custom' && material === null) && material !== 'wood' && material !== 'plastic' && material !== 'metal') throw new Error('El material de mueble debe ser madera, plástico o metal.');
  const id = text(p.id, 'Identificador de mueble');
  if (id.length > 64) throw new Error('El identificador de mueble admite hasta 64 caracteres.');
  if (type === 'wardrobe' || type === 'vanity' || type === 'nightstand') {
    if (!isFurnitureVariant(type, p.variant)) throw new Error('Selecciona un modelo válido de esta categoría.');
  } else if (p.variant !== undefined) throw new Error('Este elemento no admite variantes de catálogo.');
  let asset: Pick<FurnitureItem, 'assetId' | 'name' | 'parts'> = {};
  if (type === 'custom') {
    if (typeof p.assetId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p.assetId)) throw new Error('El modelo necesita un archivo válido.');
    const name = text(p.name, 'Nombre del modelo');
    if (name.length > 80) throw new Error('El nombre del modelo admite hasta 80 caracteres.');
    const parts: Record<string, ModelPart> = {};
    if (p.parts !== undefined) {
      const values = record(p.parts, 'Las piezas');
      if (Object.keys(values).length > 512) throw new Error('El modelo admite hasta 512 piezas.');
      for (const [key, value] of Object.entries(values)) {
        if (!/^(0|[1-9]\d{0,2})$/.test(key) || Number(key) >= 512) throw new Error('Selecciona una pieza válida.');
        const part = record(value, 'La pieza'), result: ModelPart = {};
        if (part.color !== undefined) result.color = color(part.color, 'Color de pieza');
        if (part.material !== undefined) { if (typeof part.material !== 'string' || !['wood', 'plastic', 'metal'].includes(part.material)) throw new Error('Selecciona un material válido.'); result.material = part.material as ModelPart['material']; }
        if (part.visible !== undefined) result.visible = boolean(part.visible, 'Visibilidad de pieza');
        for (const field of ['position', 'rotation', 'scale'] as const) {
          if (part[field] === undefined) continue;
          const vector = record(part[field], 'Transformación de pieza'), min = field === 'scale' ? 0.1 : field === 'rotation' ? -360 : -20, max = field === 'scale' ? 10 : field === 'rotation' ? 360 : 20;
          result[field] = { x: number(vector.x, min, max, field), y: number(vector.y, min, max, field), z: number(vector.z, min, max, field) };
        }
        parts[key] = result;
      }
    }
    asset = { assetId: p.assetId, name, ...(p.parts === undefined ? {} : { parts }) };
  } else if (p.assetId !== undefined || p.parts !== undefined || p.name !== undefined) throw new Error('El archivo y sus piezas sólo corresponden a modelos propios.');
  return { id, type, ...asset, ...(p.variant === undefined ? {} : { variant: String(p.variant) }), ...(bedSize ? { bedSize } : {}), material, color: type === 'custom' && p.color === null ? null : color(p.color, `Color de mueble ${index + 1}`), x: number(p.x, -50, 50, `Mueble ${index + 1}, X`), z: number(p.z, -50, 50, `Mueble ${index + 1}, Z`), width: number(p.width, minSize, 10, `Ancho de mueble ${index + 1}`), depth: number(p.depth, minSize, 10, `Fondo de mueble ${index + 1}`), height: number(p.height, minSize, height, `Altura de mueble ${index + 1}`), rotation: number(p.rotation, 0, 360, `Giro de mueble ${index + 1}`) };
}

function placeFurniture(room: Room, rawItem: FurnitureItem, avoid: FurnitureItem[]): FurnitureItem {
  const item = readFurniture(rawItem, room.height), box = bounds(room.vertices), offsets = furnitureCorners({ ...item, x: 0, z: 0 }), footprint = bounds(offsets);
  const margin = room.thickness / 2 + 0.02;
  const minX = box.minX - footprint.minX + margin, maxX = box.maxX - footprint.maxX - margin, minZ = box.minZ - footprint.minZ + margin, maxZ = box.maxZ - footprint.maxZ - margin;
  const fits = (point: Point) => {
    const candidate = { ...item, ...point };
    return furnitureInside(candidate, room.vertices, margin) && avoid.every(other => !furnitureOverlaps(candidate, other));
  };
  if (minX <= maxX + EPS && minZ <= maxZ + EPS) {
    const candidates = [item, { x: clamp(item.x, minX, maxX), z: clamp(item.z, minZ, maxZ) }, interiorPoint(room.vertices), ...room.vertices.flatMap(p => offsets.map(offset => ({ x: clamp(p.x - offset.x, minX, maxX), z: clamp(p.z - offset.z, minZ, maxZ) })))];
    const position = candidates.find(fits);
    if (position) return { ...item, x: position.x, z: position.z };
    // shortcut: las posiciones candidatas y cuadrícula aproximan el ajuste; usar encaje exacto si se requieren tolerancias milimétricas.
    for (let x = 0; x <= 32; x++) for (let z = 0; z <= 32; z++) {
      const point = { x: minX + (maxX - minX) * x / 32, z: minZ + (maxZ - minZ) * z / 32 };
      if (fits(point)) return { ...item, ...point };
    }
  }
  return { ...item, ...interiorPoint(room.vertices) };
}

export function fitFurniture(room: Room, item: FurnitureItem): FurnitureItem {
  return readFurniture(item, room.height);
}
const overlapping = (a: Opening, b: Opening) => a.wall === b.wall && a.offset < b.offset + b.width - EPS && b.offset < a.offset + a.width - EPS && a.sill < b.sill + b.height - EPS && b.sill < a.sill + a.height - EPS;

export function validateRoom(value: unknown): Room {
  const raw = record(value, 'El proyecto');
  if (raw.version !== 3) throw new Error('La versión del proyecto no es compatible.');
  if ('showFurniture' in raw) throw new Error('El proyecto contiene campos de una versión anterior.');
  if (raw.setupStep !== undefined && raw.setupStep !== 0 && raw.setupStep !== 1 && raw.setupStep !== 2 && raw.setupStep !== 3) throw new Error('El paso de preparación no es válido.');
  const vertices = array(raw.vertices, 3, raw.levelId ? 256 : 24, 'El contorno').map((value, i) => {
    const p = record(value, `Punto ${i + 1}`);
    return { x: number(p.x, -50, 50, `Punto ${i + 1}, X`), z: number(p.z, -50, 50, `Punto ${i + 1}, Z`) };
  });
  const box = bounds(vertices);
  if (box.width < 0.5 || box.depth < 0.5 || box.width > 50 || box.depth > 50 || polygonArea(vertices) < 0.25) throw new Error('El cuarto debe medir entre 0.5 y 50 m por lado y tener al menos 0.25 m².');
  for (let i = 0; i < vertices.length; i++) {
    const next = (i + 1) % vertices.length;
    if (Math.hypot(vertices[i].x - vertices[next].x, vertices[i].z - vertices[next].z) < 0.2 - EPS) throw new Error('Cada pared debe medir al menos 0.2 m.');
    const prev = vertices[(i - 1 + vertices.length) % vertices.length];
    if (Math.abs(cross(prev, vertices[i], vertices[next])) < EPS && (prev.x - vertices[i].x) * (vertices[next].x - vertices[i].x) + (prev.z - vertices[i].z) * (vertices[next].z - vertices[i].z) > 0) throw new Error('El contorno tiene paredes superpuestas.');
    for (let j = i + 1; j < vertices.length; j++) {
      if (j === next || (j + 1) % vertices.length === i) continue;
      if (segmentsIntersect(vertices[i], vertices[next], vertices[j], vertices[(j + 1) % vertices.length])) throw new Error('El contorno no puede cruzarse ni tocarse a sí mismo.');
    }
  }
  const height = number(raw.height, 1.8, 8, 'La altura');
  const editingRaw = record(raw.editing, 'El ajuste del editor');
  const editing = { snap: boolean(editingRaw.snap, 'El ajuste a cuadrícula'), step: number(editingRaw.step, 0.01, 1, 'El paso de cuadrícula'), bounds: boolean(editingRaw.bounds, 'Los límites del cuarto') };
  const floorFinish = raw.floorFinish;
  if (!['wood', 'tile-grid', 'tile-brick', 'tile-checker', 'marble', 'concrete'].includes(floorFinish as string)) throw new Error('Selecciona un acabado de piso válido.');
  const renderQuality = raw.renderQuality;
  if (renderQuality !== 'standard' && renderQuality !== 'realistic' && renderQuality !== 'hyperrealistic') throw new Error('Selecciona una calidad visual válida.');
  const wallSegments = raw.wallSegments === undefined ? undefined : array(raw.wallSegments, 0, 256, 'Las paredes').map(value => {
    const segment = record(value, 'La pared'), start = record(segment.start, 'Inicio de pared'), end = record(segment.end, 'Final de pared');
    const result = { id: text(segment.id, 'Identificador de pared'), start: { x: number(start.x, -50, 50, 'Inicio X'), z: number(start.z, -50, 50, 'Inicio Z') }, end: { x: number(end.x, -50, 50, 'Final X'), z: number(end.z, -50, 50, 'Final Z') }, thickness: number(segment.thickness, .05, .6, 'Espesor de pared'), height: number(segment.height, .2, 8, 'Altura de pared'), leftColor: color(segment.leftColor, 'Color interior'), rightColor: color(segment.rightColor, 'Color exterior') };
    if (Math.hypot(result.end.x - result.start.x, result.end.z - result.start.z) < .05) throw new Error('La pared es demasiado corta.');
    return result;
  });
  const count = wallSegments?.length ?? vertices.length;
  const wallColors = array(raw.wallColors, count, count, 'Los colores de pared').map((c, i) => color(c, `Color de pared ${i + 1}`));
  const openings = array(raw.openings, 0, raw.levelId ? 96 : 48, 'Las puertas y ventanas').map((value, i): Opening => {
    const p = record(value, `Abertura ${i + 1}`);
    if (p.type !== 'door' && p.type !== 'window') throw new Error('El tipo de abertura debe ser puerta o ventana.');
    const doorStyle = p.doorStyle;
    if (p.type === 'door') {
      if (doorStyle !== 'right' && doorStyle !== 'left' && doorStyle !== 'frame') throw new Error('La apertura de puerta debe ser derecha, izquierda o sólo marco.');
      if (doorStyle === 'frame' && 'open' in p) throw new Error('Un marco no admite estado de puerta.');
      if (doorStyle !== 'frame') boolean(p.open, 'El estado de puerta');
    } else if ('doorStyle' in p || 'open' in p) throw new Error('El estilo y estado de puerta sólo corresponde a las puertas.');
    const wall = number(p.wall, 0, count - 1, `Pared de abertura ${i + 1}`);
    if (!Number.isInteger(wall)) throw new Error('El índice de pared debe ser entero.');
    const a = wallSegments?.[wall]?.start ?? vertices[wall], b = wallSegments?.[wall]?.end ?? vertices[(wall + 1) % vertices.length];
    const length = Math.hypot(a.x - b.x, a.z - b.z);
    const width = number(p.width, 0.3, length, `Ancho de abertura ${i + 1}`);
    const openingHeight = number(p.height, 0.3, height, `Altura de abertura ${i + 1}`);
    const sill = number(p.sill, 0, height - openingHeight, `Antepecho de abertura ${i + 1}`);
    if (p.type === 'door' && sill !== 0) throw new Error('Las puertas deben comenzar en el piso.');
    return { id: text(p.id, 'Identificador de abertura'), type: p.type, ...(Object.hasOwn(p, 'color') ? { color: color(p.color, 'El color') } : {}), ...(doorStyle === undefined ? {} : { doorStyle: doorStyle as Opening['doorStyle'] }), ...(p.type === 'door' && doorStyle !== 'frame' ? { open: p.open as boolean } : {}), wall, width, height: openingHeight, sill, offset: number(p.offset, 0, length - width, `Posición de abertura ${i + 1}`) };
  });
  for (let i = 0; i < openings.length; i++) for (let j = i + 1; j < openings.length; j++) {
    if (openings[i].id === openings[j].id) throw new Error('Las aberturas necesitan identificadores únicos.');
    if (overlapping(openings[i], openings[j])) throw new Error(`Dos aberturas se superponen en la pared ${openings[i].wall + 1}.`);
  }
  const lights = array(raw.lights, 0, 24, 'Las luces').map((value, i) => {
    const p = record(value, `Luz ${i + 1}`);
    const position = { x: number(p.x, -50, 50, `Luz ${i + 1}, X`), z: number(p.z, -50, 50, `Luz ${i + 1}, Z`) };
    if (editing.bounds && !pointInPolygon(position, vertices)) throw new Error(`La luz ${i + 1} debe estar dentro del cuarto.`);
    return { ...position, ...(Object.hasOwn(p, 'color') ? { color: color(p.color, 'El color') } : {}), id: text(p.id, 'Identificador de luz'), name: text(p.name, 'Nombre de luz'), y: number(p.y, 0.1, height, `Altura de luz ${i + 1}`), lumens: number(p.lumens, 0, 20000, `Lúmenes de luz ${i + 1}`), temperature: number(p.temperature, 1000, 12000, `Temperatura de luz ${i + 1}`), enabled: boolean(p.enabled, 'Interruptor de luz') };
  });
  if (new Set(lights.map(p => p.id)).size !== lights.length) throw new Error('Las luces necesitan identificadores únicos.');
  const furniture = array(raw.furniture, 0, 64, 'Los muebles').map((value, i) => readFurniture(value, height, i));
  if (new Set(furniture.map(p => p.id)).size !== furniture.length) throw new Error('Los muebles necesitan identificadores únicos.');
  const sun = record(raw.sun, 'El sol');
  return {
    ...(raw.levelId === undefined ? {} : { levelId: text(raw.levelId, 'Nivel'), elevation: number(raw.elevation, 0, 96, 'Elevación'), wallIds: wallSegments?.map(wall => wall.id), wallSegments, surfaces: raw.surfaces as Room['surfaces'], roofIds: raw.roofIds as Room['roofIds'] }),
    version: 3, ...(raw.setupStep === undefined ? {} : { setupStep: raw.setupStep }), name: text(raw.name, 'El nombre'), vertices, wallColors, height,
    thickness: number(raw.thickness, 0.05, 0.6, 'El espesor'), floorColor: color(raw.floorColor, 'El color de piso'), ceilingColor: color(raw.ceilingColor, 'El color de techo'), floorFinish: floorFinish as FloorFinish, renderQuality, editing, furniture, openings, lights,
    sun: { enabled: boolean(sun.enabled, 'El sol'), hour: number(sun.hour, 0, 24, 'La hora'), azimuth: number(sun.azimuth, 0, 360, 'La orientación solar'), intensity: number(sun.intensity, 0, 10, 'La intensidad solar') },
  };
}

export function fitRoom(room: Room): Room {
  validateRoom({ ...room, openings: [], lights: [], furniture: [] });
  const fitted = room.openings.map(opening => {
    if (!Number.isInteger(opening.wall) || opening.wall < 0 || opening.wall >= wallCount(room)) throw new Error('La pared de una abertura ya no existe.');
    const length = wallLength(room, opening.wall);
    if (length < 0.3) throw new Error('Una pared es demasiado corta para conservar su abertura.');
    const width = clamp(opening.width, 0.3, length);
    const height = clamp(opening.height, 0.3, room.height);
    const sill = opening.type === 'door' ? 0 : clamp(opening.sill, 0, room.height - height);
    return { ...opening, width, height, sill, offset: clamp(opening.offset, 0, length - width) };
  });
  const packed: Opening[] = [];
  for (let wall = 0; wall < wallCount(room); wall++) {
    const items = fitted.filter(p => p.wall === wall).sort((a, b) => a.offset - b.offset);
    const pack = (preserve: boolean) => {
      const placed: Opening[] = [];
      for (const item of items) {
        const limit = wallLength(room, wall) - item.width;
        const candidates = [...(preserve ? [item.offset] : []), 0, ...placed.flatMap(p => [p.offset + p.width, p.offset - item.width]), limit];
        const offset = candidates.find(offset => offset >= -EPS && offset <= limit + EPS && placed.every(p => !overlapping(p, { ...item, offset })));
        if (offset === undefined) return null;
        placed.push({ ...item, offset: clamp(offset, 0, limit) });
      }
      return placed;
    };
    const placed = pack(true) ?? pack(false);
    if (!placed) throw new Error(`Las aberturas ya no caben en la pared ${wall + 1}. Reduce su ancho antes de achicar el cuarto.`);
    packed.push(...placed);
  }
  const interior = interiorPoint(room.vertices);
  const furniture = room.furniture.map(item => readFurniture(item, room.height));
  return validateRoom({ ...room, furniture, openings: room.openings.map(p => packed.find(item => item.id === p.id)!), lights: room.lights.map(light => ({ ...light, ...(room.editing.bounds === false || pointInPolygon(light, room.vertices) ? {} : interior), y: clamp(light.y, 0.1, room.height) })) });
}

export function resizeRoom(room: Room, width: number, depth: number): Room {
  number(width, 0.5, 50, 'El ancho'); number(depth, 0.5, 50, 'El fondo');
  const box = bounds(room.vertices), cx = (box.minX + box.maxX) / 2, cz = (box.minZ + box.maxZ) / 2;
  const scale = (p: Point) => ({ x: cx + (p.x - cx) * width / box.width, z: cz + (p.z - cz) * depth / box.depth });
  const vertices = room.vertices.map(scale);
  const scaled = { ...room, vertices, ...(room.wallSegments ? { wallSegments: room.wallSegments.map(segment => ({ ...segment, start: scale(segment.start), end: scale(segment.end) })) } : {}) };
  return fitRoom({ ...scaled, openings: room.openings.map(p => ({ ...p, offset: p.offset * wallLength(scaled, p.wall) / wallLength(room, p.wall) })), lights: room.lights.map(p => ({ ...p, ...scale(p) })) });
}

export function addOpening(room: Room, type: 'door' | 'window', wall: number, options: { width: number; height: number; sill?: number; doorStyle?: 'right' | 'left' | 'frame' }): Room {
  if (!Number.isInteger(wall) || wall < 0 || wall >= wallCount(room)) throw new Error('Selecciona una pared válida.');
  const height = number(options?.height, 0.3, room.height, 'La altura de abertura');
  const sill = number(options.sill ?? 0, 0, room.height - height, 'La altura desde piso');
  const doorStyle = type === 'door' ? options.doorStyle ?? 'right' : undefined;
  if (type === 'window' && options.doorStyle !== undefined) throw new Error('El estilo de puerta sólo corresponde a las puertas.');
  if (type === 'door' && sill !== 0) throw new Error('Las puertas deben comenzar en el piso.');
  const items = room.openings.filter(p => p.wall === wall && p.sill < sill + height - EPS && sill < p.sill + p.height - EPS).sort((a, b) => a.offset - b.offset);
  const gaps: { start: number; width: number }[] = [];
  let end = 0;
  for (const item of items) { gaps.push({ start: end, width: item.offset - end }); end = Math.max(end, item.offset + item.width); }
  gaps.push({ start: end, width: wallLength(room, wall) - end });
  const gap = gaps.sort((a, b) => b.width - a.width)[0];
  const width = number(options.width, 0.3, wallLength(room, wall), 'El ancho de abertura');
  if (width < 0.3) throw new Error('No queda espacio suficiente en esta pared para otra abertura.');
  if (width > gap.width + EPS) throw new Error('No queda espacio suficiente en esta pared para otra abertura.');
  return validateRoom({ ...room, openings: [...room.openings, { id: itemId(), type, ...(doorStyle === undefined ? {} : { doorStyle }), ...(type === 'door' && doorStyle !== 'frame' ? { open: false } : {}), wall, offset: gap.start + (gap.width - width) / 2, width, height, sill }] });
}

export function toggleSceneInteraction(room: Room, selection: Selection): Room {
  if (selection.kind === 'light') {
    const item = room.lights.find(p => p.id === selection.id);
    return item ? validateRoom({ ...room, lights: room.lights.map(p => p.id === item.id ? { ...p, enabled: !p.enabled } : p) }) : room;
  }
  if (selection.kind !== 'opening') return room;
  const item = room.openings.find(p => p.id === selection.id);
  if (!item || item.type !== 'door' || item.doorStyle === 'frame') return room;
  return validateRoom({ ...room, openings: room.openings.map(p => p.id === item.id ? { ...p, open: !p.open } : p) });
}

export function addLight(room: Room, name = `Luz ${room.lights.length + 1}`): Room {
  const point = interiorPoint(room.vertices);
  return validateRoom({ ...room, lights: [...room.lights, { ...point, id: itemId(), name, y: room.height - 0.3, lumens: 800, temperature: 2700, enabled: true }] });
}

export function addFurniture(room: Room, type: FurnitureItem['type'], bedSize: BedSize = 'double', variant?: string): Room {
  if (!Object.hasOwn(FURNITURE_LABELS, type)) throw new Error('Selecciona un tipo de mueble válido.');
  if (type === 'custom') throw new Error('Selecciona o sube un modelo.');
  if (variant !== undefined && !isFurnitureVariant(type, variant)) throw new Error('Selecciona un modelo válido de esta categoría.');
  if (!Object.hasOwn(BED_SIZES, bedSize)) throw new Error('Selecciona un tamaño de cama válido.');
  const preset = type === 'bed' ? undefined : getFurniturePreset(type, variant ?? `${type}-classic`)!;
  const dimensions = type === 'bed' ? { ...BED_SIZES[bedSize], height: 1.1 } : preset!;
  const point = interiorPoint(room.vertices);
  const item = placeFurniture(room, { id: itemId(), type, ...(preset ? { variant: preset.id } : {}), ...(type === 'bed' ? { bedSize } : {}), material: 'wood', color: FURNITURE_COLORS[type], ...point, width: dimensions.width, depth: dimensions.depth, height: Math.min(dimensions.height, room.height), rotation: 0 }, room.furniture);
  return validateRoom({ ...room, furniture: [...(room.furniture), item] });
}

export function addCustomFurniture(room: Room, asset: { id: string; name: string; width: number; depth: number; height: number }): Room {
  number(asset.width, 0.01, 10000, 'El ancho del modelo'); number(asset.depth, 0.01, 10000, 'El fondo del modelo'); number(asset.height, 0.01, 10000, 'La altura del modelo');
  const factor = Math.min(1, 10 / asset.width, 10 / asset.depth, room.height / asset.height);
  const item = placeFurniture(room, { id: itemId(), type: 'custom', assetId: asset.id, name: asset.name, material: null, color: null, ...interiorPoint(room.vertices), width: Math.max(0.01, asset.width * factor), depth: Math.max(0.01, asset.depth * factor), height: Math.max(0.01, asset.height * factor), rotation: 0 }, room.furniture);
  return validateRoom({ ...room, furniture: [...room.furniture, item] });
}

export function snapPlanPoint(previous: Point | null, point: Point, options: { grid: boolean; step: number; angles: boolean; angleStep?: number }): Point {
  if (![point.x, point.z, ...(previous ? [previous.x, previous.z] : [])].every(Number.isFinite)) throw new Error('Las coordenadas deben ser números finitos.');
  const step = number(options.step, 0.01, 1, 'El paso de cuadrícula');
  if (!options.grid && !options.angles) return { ...point };
  const snap = (value: number) => options.grid ? Math.round(value / step) * step : value;
  if (previous && options.angles) {
    const dx = point.x - previous.x, dz = point.z - previous.z, angleStep = number(options.angleStep ?? 15, 1, 180, 'El paso angular') * Math.PI / 180;
    const angle = Math.round(Math.atan2(dz, dx) / angleStep) * angleStep, length = snap(Math.hypot(dx, dz));
    return { x: Number((previous.x + Math.cos(angle) * length).toFixed(6)), z: Number((previous.z + Math.sin(angle) * length).toFixed(6)) };
  }
  return { x: Number(snap(point.x).toFixed(6)), z: Number(snap(point.z).toFixed(6)) };
}

export function itemWorldPosition(room: Room, selection: Selection): { x: number; y: number; z: number } | null {
  if (selection.kind === 'wall') {
    const [a, b] = roomWallEndpoints(room, selection.index);
    return a && b ? { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, y: room.height / 2 } : null;
  }
  if (selection.kind === 'floor' || selection.kind === 'ceiling') return { ...interiorPoint(room.vertices), y: selection.kind === 'floor' ? 0 : room.height };
  if (selection.kind === 'light') {
    const item = room.lights.find(p => p.id === selection.id);
    return item ? { x: item.x, y: item.y, z: item.z } : null;
  }
  if (selection.kind === 'furniture') {
    const item = room.furniture.find(p => p.id === selection.id);
    return item ? { x: item.x, y: item.height / 2, z: item.z } : null;
  }
  if (selection.kind !== 'opening') return null;
  const item = room.openings.find(p => p.id === selection.id);
  if (!item) return null;
  const [a, b] = roomWallEndpoints(room, item.wall), t = (item.offset + item.width / 2) / wallLength(room, item.wall);
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, y: item.sill + item.height / 2 };
}

function boundedMove(previous: Point, target: Point, pathIsClear: (point: Point) => boolean): Point | null {
  if (pathIsClear(target)) return target;
  if (!pathIsClear(previous)) return null;
  let low = 0, high = 1;
  for (let i = 0; i < 18; i++) {
    const middle = (low + high) / 2, point = { x: previous.x + (target.x - previous.x) * middle, z: previous.z + (target.z - previous.z) * middle };
    if (pathIsClear(point)) low = middle; else high = middle;
  }
  return { x: previous.x + (target.x - previous.x) * low, z: previous.z + (target.z - previous.z) * low };
}

/** Previews derive finite, clamped transforms from an already validated room without copying unrelated data. */
export function previewSceneItemMove(room: Room, selection: Selection, target: Point & { y?: number; rotation?: number }): Room {
  if (![target.x, target.z, ...(target.y === undefined ? [] : [target.y]), ...(target.rotation === undefined ? [] : [target.rotation])].every(Number.isFinite)) throw new Error('La posición y el giro deben ser números finitos.');
  const editing = room.editing;
  const snap = (value: number) => editing.snap ? Number((Math.round(value / editing.step) * editing.step).toFixed(6)) : value;
  const coordinate = (value: number) => clamp(snap(value), -50, 50);
  const position = { x: coordinate(target.x), z: coordinate(target.z) };
  if (selection.kind === 'furniture') {
    const item = room.furniture.find(p => p.id === selection.id);
    if (!item) throw new Error('Este mueble ya no existe.');
    const rotation = target.rotation === undefined ? item.rotation : ((target.rotation % 360) + 360) % 360;
    const moved = { ...item, ...position, rotation };
    if (moved.x === item.x && moved.z === item.z && moved.rotation === item.rotation) return room;
    return { ...room, furniture: room.furniture.map(p => p.id === item.id ? moved : p) };
  }
  if (selection.kind === 'light') {
    const item = room.lights.find(p => p.id === selection.id);
    if (!item) throw new Error('Esta luz ya no existe.');
    const point = editing.bounds ? boundedMove(item, position, p => footprintInside([item, { x: coordinate(p.x), z: coordinate(p.z) }], room.vertices)) : position;
    if (!point) return room;
    const moved = { ...item, x: coordinate(point.x), z: coordinate(point.z), y: target.y === undefined ? item.y : clamp(snap(target.y), 0.1, room.height) };
    return { ...room, lights: room.lights.map(p => p.id === item.id ? moved : p) };
  }
  if (selection.kind !== 'opening') return room;
  const item = room.openings.find(p => p.id === selection.id);
  if (!item) throw new Error('Esta abertura ya no existe.');
  const sill = item.type === 'door' ? 0 : target.y === undefined ? item.sill : clamp(snap(target.y - item.height / 2), 0, room.height - item.height);
  let closest: Opening | null = null, distance = Infinity;
  for (let wall = 0; wall < wallCount(room); wall++) {
    const length = wallLength(room, wall);
    if (length < item.width) continue;
    const [a, b] = roomWallEndpoints(room, wall), dx = (b.x - a.x) / length, dz = (b.z - a.z) / length;
    const desired = clamp(snap((position.x - a.x) * dx + (position.z - a.z) * dz - item.width / 2), 0, length - item.width);
    const others = room.openings.filter(p => p.id !== item.id && p.wall === wall);
    const offsets = [desired, 0, length - item.width, ...others.flatMap(p => [p.offset + p.width, p.offset - item.width])].filter(offset => offset >= -EPS && offset <= length - item.width + EPS).sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired));
    const offset = offsets.find(offset => others.every(p => !overlapping(p, { ...item, wall, offset, sill })));
    if (offset === undefined) continue;
    const center = { x: a.x + dx * (offset + item.width / 2), z: a.z + dz * (offset + item.width / 2) }, error = Math.hypot(center.x - position.x, center.z - position.z);
    if (error < distance) { distance = error; closest = { ...item, wall, offset: clamp(offset, 0, length - item.width), sill }; }
  }
  if (!closest) throw new Error('No queda espacio en una pared para mover esta abertura sin superponerla.');
  return { ...room, openings: room.openings.map(p => p.id === item.id ? closest! : p) };
}

/** Persistence and authoritative operations always validate the complete proposed room. */
export function moveSceneItem(room: Room, selection: Selection, target: Point & { y?: number; rotation?: number }): Room {
  const next = previewSceneItemMove(room, selection, target);
  return next === room ? room : validateRoom(next);
}
