import type { BedSize, FurnitureItem, Opening, Point, Room } from './types.js';

const EPS = 1e-7;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const itemId = () => crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16).padStart(8, '0')).join('');

export const BED_SIZES: Record<BedSize, { label: string; width: number; depth: number }> = {
  single: { label: 'Individual', width: 1, depth: 1.9 },
  double: { label: 'Matrimonial', width: 1.35, depth: 1.9 },
  queen: { label: 'Queen', width: 1.5, depth: 1.9 },
  king: { label: 'King', width: 2, depth: 1.9 },
};
export const FURNITURE_LABELS: Record<FurnitureItem['type'], string> = { bed: 'Cama', wardrobe: 'Ropero', vanity: 'Tocador', nightstand: 'Buró' };

export function createDefaultRoom(): Room {
  return {
    version: 1, name: 'Mi habitación',
    vertices: [{ x: -2.5, z: -2 }, { x: 2.5, z: -2 }, { x: 2.5, z: 2 }, { x: -2.5, z: 2 }],
    wallColors: ['#9cae98', '#eee9df', '#eee9df', '#eee9df'],
    height: 2.8, thickness: 0.15, floorColor: '#b49b7d', showFurniture: true, furniture: [],
    openings: [
      { id: 'door-1', type: 'door', wall: 3, offset: 0.35, width: 0.9, height: 2.1, sill: 0 },
      { id: 'window-1', type: 'window', wall: 1, offset: 1.1, width: 1.8, height: 1.3, sill: 0.85 },
    ],
    lights: [{ id: 'light-1', name: 'Luz principal', x: 0, y: 2.5, z: 0, lumens: 800, temperature: 2700, enabled: false }],
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
export function wallLength(room: Room, index: number) {
  const a = room.vertices[index];
  const b = room.vertices[(index + 1) % room.vertices.length];
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
  const corners = furnitureCorners(item);
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

function furnitureOverlaps(a: FurnitureItem, b: FurnitureItem) {
  const ca = furnitureCorners(a), cb = furnitureCorners(b);
  return [ca, cb].every(corners => [0, 1].every(i => {
    const axis = { x: corners[i + 1].z - corners[i].z, z: corners[i].x - corners[i + 1].x };
    const pa = ca.map(p => p.x * axis.x + p.z * axis.z), pb = cb.map(p => p.x * axis.x + p.z * axis.z);
    return Math.min(...pa) < Math.max(...pb) - EPS && Math.min(...pb) < Math.max(...pa) - EPS;
  }));
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
  let bedSize: BedSize | undefined;
  if (type === 'bed') {
    const size = p.bedSize === undefined ? 'double' : p.bedSize;
    if (typeof size !== 'string' || !Object.hasOwn(BED_SIZES, size)) throw new Error('El tamaño de cama debe ser individual, matrimonial, queen o king.');
    bedSize = size as BedSize;
  } else if (p.bedSize !== undefined) throw new Error('El tamaño de cama solo corresponde a las camas.');
  const id = text(p.id, 'Identificador de mueble');
  if (id.length > 64) throw new Error('El identificador de mueble admite hasta 64 caracteres.');
  return { id, type, ...(bedSize ? { bedSize } : {}), x: number(p.x, -50, 50, `Mueble ${index + 1}, X`), z: number(p.z, -50, 50, `Mueble ${index + 1}, Z`), width: number(p.width, 0.1, 10, `Ancho de mueble ${index + 1}`), depth: number(p.depth, 0.1, 10, `Fondo de mueble ${index + 1}`), height: number(p.height, 0.1, height, `Altura de mueble ${index + 1}`), rotation: number(p.rotation, 0, 360, `Giro de mueble ${index + 1}`) };
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
  throw new Error(avoid.length ? 'No queda espacio libre para añadir este mueble. Reduce sus dimensiones o mueve los muebles existentes.' : `${FURNITURE_LABELS[item.type]} no cabe en la planta. Reduce sus dimensiones antes de achicar el cuarto.`);
}

export function fitFurniture(room: Room, item: FurnitureItem): FurnitureItem {
  const valid = readFurniture(item, room.height);
  return furnitureInside(valid, room.vertices) ? valid : placeFurniture(room, valid, []);
}
const overlapping = (a: Opening, b: Opening) => a.wall === b.wall && a.offset < b.offset + b.width - EPS && b.offset < a.offset + a.width - EPS && a.sill < b.sill + b.height - EPS && b.sill < a.sill + a.height - EPS;

export function validateRoom(value: unknown): Room {
  const raw = record(value, 'El proyecto');
  if (raw.version !== 1) throw new Error('La versión del proyecto no es compatible.');
  const vertices = array(raw.vertices, 3, 24, 'El contorno').map((value, i) => {
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
  const wallColors = array(raw.wallColors, vertices.length, vertices.length, 'Los colores de pared').map((c, i) => color(c, `Color de pared ${i + 1}`));
  const openings = array(raw.openings, 0, 48, 'Las puertas y ventanas').map((value, i): Opening => {
    const p = record(value, `Abertura ${i + 1}`);
    if (p.type !== 'door' && p.type !== 'window') throw new Error('El tipo de abertura debe ser puerta o ventana.');
    const wall = number(p.wall, 0, vertices.length - 1, `Pared de abertura ${i + 1}`);
    if (!Number.isInteger(wall)) throw new Error('El índice de pared debe ser entero.');
    const length = Math.hypot(vertices[wall].x - vertices[(wall + 1) % vertices.length].x, vertices[wall].z - vertices[(wall + 1) % vertices.length].z);
    const width = number(p.width, 0.3, length, `Ancho de abertura ${i + 1}`);
    const openingHeight = number(p.height, 0.3, height, `Altura de abertura ${i + 1}`);
    const sill = number(p.sill, 0, height - openingHeight, `Antepecho de abertura ${i + 1}`);
    if (p.type === 'door' && sill !== 0) throw new Error('Las puertas deben comenzar en el piso.');
    return { id: text(p.id, 'Identificador de abertura'), type: p.type, wall, width, height: openingHeight, sill, offset: number(p.offset, 0, length - width, `Posición de abertura ${i + 1}`) };
  });
  for (let i = 0; i < openings.length; i++) for (let j = i + 1; j < openings.length; j++) {
    if (openings[i].id === openings[j].id) throw new Error('Las aberturas necesitan identificadores únicos.');
    if (overlapping(openings[i], openings[j])) throw new Error(`Dos aberturas se superponen en la pared ${openings[i].wall + 1}.`);
  }
  const lights = array(raw.lights, 0, 24, 'Las luces').map((value, i) => {
    const p = record(value, `Luz ${i + 1}`);
    const position = { x: number(p.x, -50, 50, `Luz ${i + 1}, X`), z: number(p.z, -50, 50, `Luz ${i + 1}, Z`) };
    if (!pointInPolygon(position, vertices)) throw new Error(`La luz ${i + 1} debe estar dentro del cuarto.`);
    return { ...position, id: text(p.id, 'Identificador de luz'), name: text(p.name, 'Nombre de luz'), y: number(p.y, 0.1, height, `Altura de luz ${i + 1}`), lumens: number(p.lumens, 0, 20000, `Lúmenes de luz ${i + 1}`), temperature: number(p.temperature, 1000, 12000, `Temperatura de luz ${i + 1}`), enabled: boolean(p.enabled, 'Interruptor de luz') };
  });
  if (new Set(lights.map(p => p.id)).size !== lights.length) throw new Error('Las luces necesitan identificadores únicos.');
  const furniture = array(raw.furniture === undefined ? [] : raw.furniture, 0, 64, 'Los muebles').map((value, i) => readFurniture(value, height, i));
  if (new Set(furniture.map(p => p.id)).size !== furniture.length) throw new Error('Los muebles necesitan identificadores únicos.');
  for (const item of furniture) if (!furnitureInside(item, vertices)) throw new Error(`${FURNITURE_LABELS[item.type]} debe quedar completamente dentro del cuarto.`);
  const sun = record(raw.sun, 'El sol');
  return {
    version: 1, name: text(raw.name, 'El nombre'), vertices, wallColors, height,
    thickness: number(raw.thickness, 0.05, 0.6, 'El espesor'), floorColor: color(raw.floorColor, 'El color de piso'), showFurniture: raw.showFurniture === undefined ? true : boolean(raw.showFurniture, 'Los muebles'), furniture, openings, lights,
    sun: { enabled: boolean(sun.enabled, 'El sol'), hour: number(sun.hour, 0, 24, 'La hora'), azimuth: number(sun.azimuth, 0, 360, 'La orientación solar'), intensity: number(sun.intensity, 0, 10, 'La intensidad solar') },
  };
}

export function fitRoom(room: Room): Room {
  validateRoom({ ...room, openings: [], lights: [], furniture: [] });
  const fitted = room.openings.map(opening => {
    if (!Number.isInteger(opening.wall) || opening.wall < 0 || opening.wall >= room.vertices.length) throw new Error('La pared de una abertura ya no existe.');
    const length = wallLength(room, opening.wall);
    if (length < 0.3) throw new Error('Una pared es demasiado corta para conservar su abertura.');
    const width = clamp(opening.width, 0.3, length);
    const height = clamp(opening.height, 0.3, room.height);
    const sill = opening.type === 'door' ? 0 : clamp(opening.sill, 0, room.height - height);
    return { ...opening, width, height, sill, offset: clamp(opening.offset, 0, length - width) };
  });
  const packed: Opening[] = [];
  for (let wall = 0; wall < room.vertices.length; wall++) {
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
  return validateRoom({ ...room, furniture: (room.furniture ?? []).map(item => fitFurniture(room, item)), openings: room.openings.map(p => packed.find(item => item.id === p.id)!), lights: room.lights.map(light => ({ ...light, ...(pointInPolygon(light, room.vertices) ? {} : interior), y: clamp(light.y, 0.1, room.height) })) });
}

export function resizeRoom(room: Room, width: number, depth: number): Room {
  number(width, 0.5, 50, 'El ancho'); number(depth, 0.5, 50, 'El fondo');
  const box = bounds(room.vertices), cx = (box.minX + box.maxX) / 2, cz = (box.minZ + box.maxZ) / 2;
  const scale = (p: Point) => ({ x: cx + (p.x - cx) * width / box.width, z: cz + (p.z - cz) * depth / box.depth });
  const vertices = room.vertices.map(scale);
  return fitRoom({ ...room, vertices, furniture: (room.furniture ?? []).map(p => ({ ...p, ...scale(p) })), openings: room.openings.map(p => ({ ...p, offset: p.offset * wallLength({ ...room, vertices }, p.wall) / wallLength(room, p.wall) })), lights: room.lights.map(p => ({ ...p, ...scale(p) })) });
}

export function addOpening(room: Room, type: 'door' | 'window', wall: number): Room {
  if (!Number.isInteger(wall) || wall < 0 || wall >= room.vertices.length) throw new Error('Selecciona una pared válida.');
  const items = room.openings.filter(p => p.wall === wall).sort((a, b) => a.offset - b.offset);
  const gaps: { start: number; width: number }[] = [];
  let end = 0;
  for (const item of items) { gaps.push({ start: end, width: item.offset - end }); end = Math.max(end, item.offset + item.width); }
  gaps.push({ start: end, width: wallLength(room, wall) - end });
  const gap = gaps.sort((a, b) => b.width - a.width)[0];
  const width = Math.min(type === 'door' ? 0.9 : 1.5, gap.width - 0.1);
  if (width < 0.3) throw new Error('No queda espacio suficiente en esta pared para otra abertura.');
  const height = Math.min(type === 'door' ? 2.1 : 1.3, room.height - 0.1);
  return validateRoom({ ...room, openings: [...room.openings, { id: itemId(), type, wall, offset: gap.start + (gap.width - width) / 2, width, height, sill: type === 'door' ? 0 : Math.min(0.85, room.height - height - 0.05) }] });
}

export function addLight(room: Room): Room {
  const point = interiorPoint(room.vertices);
  return validateRoom({ ...room, lights: [...room.lights, { ...point, id: itemId(), name: `Luz ${room.lights.length + 1}`, y: room.height - 0.3, lumens: 800, temperature: 2700, enabled: true }] });
}

export function addFurniture(room: Room, type: FurnitureItem['type'], bedSize: BedSize = 'double'): Room {
  if (!Object.hasOwn(FURNITURE_LABELS, type)) throw new Error('Selecciona un tipo de mueble válido.');
  if (!Object.hasOwn(BED_SIZES, bedSize)) throw new Error('Selecciona un tamaño de cama válido.');
  const dimensions = type === 'bed' ? { ...BED_SIZES[bedSize], height: 1.1 } : {
    wardrobe: { width: 1.4, depth: 0.6, height: 2 },
    vanity: { width: 1, depth: 0.45, height: 1.5 },
    nightstand: { width: 0.5, depth: 0.45, height: 0.55 },
  }[type];
  const point = interiorPoint(room.vertices);
  const item = placeFurniture(room, { id: itemId(), type, ...(type === 'bed' ? { bedSize } : {}), ...point, width: dimensions.width, depth: dimensions.depth, height: dimensions.height, rotation: 0 }, room.furniture ?? []);
  return validateRoom({ ...room, furniture: [...(room.furniture ?? []), item] });
}
