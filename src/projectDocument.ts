import type { EditingSettings, FloorFinish, FurnitureItem, Opening, Point, Room, RoomLight } from './types.js';
import { isFurnitureVariant } from './furnitureCatalog.js';
import { stableStringify } from './sameData.js';

/** The only persisted/imported project format. Room is an internal level projection. */
export type SurfaceFinish = { color: string; material: FloorFinish };
export type ProjectPoint = Point & { id: string };
export type ProjectWall = { id: string; levelId: string; startId: string; endId: string; thickness: number; height: number; left: SurfaceFinish; right: SurfaceFinish };
export type SurfaceHole = { id: string; vertices: Point[]; stairId?: string };
type SurfaceBase = { id: string; levelId: string; outline: string[]; holes: SurfaceHole[]; elevation: number; thickness: number; finish: SurfaceFinish };
export type ProjectSurface = SurfaceBase & ({ kind: 'floor'; undersideFinish: SurfaceFinish } | { kind: 'ceiling'; undersideFinish?: never });
export type ProjectOpening = Omit<Opening, 'wall'> & { levelId: string; wallId: string };
export type ProjectFurniture = FurnitureItem & { levelId: string };
export type ProjectLight = RoomLight & { levelId: string };
export type ProjectLevel = { id: string; name: string; elevation: number; height: number; thickness: number; points: ProjectPoint[]; outline: string[]; walls: ProjectWall[]; surfaces: ProjectSurface[]; openings: ProjectOpening[]; furniture: ProjectFurniture[]; lights: ProjectLight[] };
export type ProjectStair = { id: string; type: 'straight' | 'landing' | 'l' | 'u' | 'spiral'; fromLevelId: string; toLevelId: string; x: number; z: number; rotation: number; width: number; stepCount: number; run: number; landingDepth: number; innerRadius: number; turns: number; clockwise: boolean; thickness: number; rails: 'none' | 'left' | 'right' | 'both'; hole: Point[] | null; finish: SurfaceFinish };
export type RoofVertex = { id: string; x: number; y: number; z: number };
export type RoofFace = { id: string; vertexIds: string[] };
type RoofBase = { id: string; levelId: string; thickness: number; finish: SurfaceFinish; undersideFinish: SurfaceFinish };
export type ParametricRoof = RoofBase & { type: 'flat' | 'shed' | 'gable' | 'hip'; footprint: Point[]; baseHeight: number; pitch: number; overhang: number; rotation: number };
export type MeshRoof = RoofBase & { type: 'mesh'; vertices: RoofVertex[]; faces: RoofFace[] };
export type ProjectRoof = ParametricRoof | MeshRoof;
export type ProjectDocument = { version: 3; id: string; name: string; setupStep?: 0 | 1 | 2 | 3; activeLevelId: string; levels: ProjectLevel[]; stairs: ProjectStair[]; roofs: ProjectRoof[]; renderQuality: Room['renderQuality']; editing: EditingSettings; sun: Room['sun'] };

export const PROJECT_LIMITS = Object.freeze({ levels: 12, pointsPerLevel: 256, wallsPerLevel: 256, surfacesPerLevel: 64, furniturePerLevel: 64, lightsPerLevel: 24, openingsPerLevel: 96, stairs: 32, roofs: 24, roofVertices: 256, roofFaces: 512, furniture: 64, lights: 24, openings: 96, points: 1536, walls: 1536, surfaces: 192, holes: 96, holeVertices: 2048, totalRoofVertices: 1536, totalRoofFaces: 3072, partOverrides: 2048 });
export const projectId = () => crypto.randomUUID();
export const whiteFinish = (): SurfaceFinish => ({ color: '#ffffff', material: 'concrete' });
export function projectLevel(project: ProjectDocument, id = project.activeLevelId): ProjectLevel {
  const level = project.levels.find(value => value.id === id);
  if (!level) throw new Error('El nivel no existe.');
  return level;
}
export function levelOutline(level: ProjectLevel): Point[] {
  const points = new Map(level.points.map(point => [point.id, point]));
  return level.outline.map(id => { const point = points.get(id); if (!point) throw new Error('La planta contiene una referencia inválida.'); return { x: point.x, z: point.z }; });
}
export function wallEndpoints(level: ProjectLevel, wall: ProjectWall): [ProjectPoint, ProjectPoint] {
  const a = level.points.find(p => p.id === wall.startId), b = level.points.find(p => p.id === wall.endId);
  if (!a || !b) throw new Error('La pared contiene una referencia inválida.');
  return [a, b];
}
export function projectAssetIds(project: ProjectDocument): string[] { return [...new Set(project.levels.flatMap(level => level.furniture.flatMap(item => item.assetId ? [item.assetId] : [])))]; }

export function createDefaultProject(name = 'Mi diseño', lightName = 'Luz principal', id: string = projectId(), levelName = 'Planta baja'): ProjectDocument {
  const levelId = projectId();
  const points = [{ x: -2.5, z: -2 }, { x: 2.5, z: -2 }, { x: 2.5, z: 2 }, { x: -2.5, z: 2 }].map(p => ({ ...p, id: projectId() }));
  const outline = points.map(p => p.id);
  return { version: 3, id, name, activeLevelId: levelId, levels: [{ id: levelId, name: levelName, elevation: 0, height: 2.8, thickness: .15, points, outline, walls: points.map((p, i) => ({ id: projectId(), levelId, startId: p.id, endId: points[(i + 1) % points.length].id, thickness: .15, height: 2.8, left: whiteFinish(), right: whiteFinish() })), surfaces: [{ id: projectId(), levelId, kind: 'floor', outline: [...outline], holes: [], elevation: 0, thickness: .18, finish: whiteFinish(), undersideFinish: whiteFinish() }], openings: [], furniture: [], lights: [{ id: projectId(), levelId, name: lightName, x: 0, y: 2.5, z: 0, lumens: 800, temperature: 2700, enabled: true }] }], stairs: [], roofs: [{ id: projectId(), levelId, type: 'flat', footprint: points.map(({ x, z }) => ({ x, z })), baseHeight: 2.8, pitch: 0, overhang: 0, rotation: 0, thickness: .15, finish: whiteFinish(), undersideFinish: whiteFinish() }], renderQuality: 'standard', editing: { snap: true, step: .1, bounds: true }, sun: { enabled: true, hour: 15, azimuth: 54, intensity: 3 } };
}

export type CeilingFinishTarget = { kind: 'surface' | 'roof'; levelId: string; id: string; side: 'finish' | 'undersideFinish'; finish: SurfaceFinish };
/** The visible ceiling belongs to a real ceiling, the next slab, or this level's roof. */
export function ceilingFinishTargets(project: ProjectDocument, levelId: string): CeilingFinishTarget[] {
  const level = projectLevel(project, levelId), explicit = level.surfaces.filter(surface => surface.kind === 'ceiling');
  if (explicit.length) return explicit.map(surface => ({ kind: 'surface', levelId, id: surface.id, side: 'finish', finish: surface.finish }));
  const above = project.levels[project.levels.indexOf(level) + 1];
  if (above) return above.surfaces.filter(surface => surface.kind === 'floor').map(surface => ({ kind: 'surface', levelId: above.id, id: surface.id, side: 'undersideFinish', finish: surface.undersideFinish }));
  return project.roofs.filter(roof => roof.levelId === levelId).map(roof => ({ kind: 'roof', levelId, id: roof.id, side: 'undersideFinish', finish: roof.undersideFinish }));
}
export function updateCeilingFinish(project: ProjectDocument, levelId: string, patch: Partial<SurfaceFinish>, targetId?: string): ProjectDocument {
  const targets = ceilingFinishTargets(project, levelId).filter(target => targetId === undefined || target.id === targetId);
  if (!targets.length) return project;
  const byId = new Map(targets.map(target => [target.id, target]));
  const next = { ...project, levels: project.levels.map(level => !targets.some(target => target.kind === 'surface' && target.levelId === level.id) ? level : { ...level, surfaces: level.surfaces.map(surface => {
    const target = byId.get(surface.id); if (!target) return surface;
    return surface.kind === 'floor' && target.side === 'undersideFinish' ? { ...surface, undersideFinish: { ...surface.undersideFinish, ...patch } } : { ...surface, finish: { ...surface.finish, ...patch } };
  }) }), roofs: project.roofs.map(roof => byId.has(roof.id) ? { ...roof, undersideFinish: { ...roof.undersideFinish, ...patch } } : roof) };
  return validateDocument(next, false);
}

export function projectToRoom(project: ProjectDocument, levelId = project.activeLevelId): Room {
  const level = projectLevel(project, levelId), floor = level.surfaces.find(s => s.kind === 'floor');
  return { version: 3, ...(project.setupStep === undefined ? {} : { setupStep: project.setupStep }), name: project.name, vertices: levelOutline(level), wallColors: level.walls.map(w => w.left.color), height: level.height, thickness: level.thickness, floorColor: floor?.finish.color ?? '#ffffff', ceilingColor: ceilingFinishTargets(project, levelId)[0]?.finish.color ?? '#ffffff', floorFinish: floor?.finish.material ?? 'concrete', renderQuality: project.renderQuality, editing: { ...project.editing }, sun: { ...project.sun }, furniture: level.furniture.map(({ levelId: _levelId, ...item }) => structuredClone(item)), lights: level.lights.map(({ levelId: _levelId, ...item }) => ({ ...item })), openings: level.openings.map(({ levelId: _levelId, wallId, ...opening }) => ({ ...opening, wall: level.walls.findIndex(w => w.id === wallId) })), levelId, elevation: level.elevation, wallIds: level.walls.map(w => w.id), wallSegments: level.walls.map(w => { const [start, end] = wallEndpoints(level, w); return { id: w.id, start: { x: start.x, z: start.z }, end: { x: end.x, z: end.z }, leftColor: w.left.color, rightColor: w.right.color, thickness: w.thickness, height: w.height }; }), surfaces: structuredClone(level.surfaces), roofIds: project.roofs.filter(r => r.levelId === levelId).map(r => r.id) };
}

/** Apply ordinary editor fields without changing another level or severing stable wall references. */
export function updateProjectRoom(project: ProjectDocument, levelId: string, room: Room): ProjectDocument {
  const previous = projectToRoom(project, levelId); let next: ProjectDocument = { ...project, levels: project.levels.map(level => level.id === levelId ? structuredClone(level) : level), roofs: project.roofs.map(roof => roof.levelId === levelId ? structuredClone(roof) : roof) }; const level = projectLevel(next, levelId);
  next.name = room.name; next.renderQuality = room.renderQuality; next.editing = { ...room.editing }; next.sun = { ...room.sun };
  if (room.setupStep === undefined) delete next.setupStep; else next.setupStep = room.setupStep;
  if (room.vertices.length !== level.outline.length) throw new Error('Los cambios de planta requieren una operación de construcción.');
  level.outline.forEach((id, index) => { const point = level.points.find(p => p.id === id)!; point.x = room.vertices[index].x; point.z = room.vertices[index].z; });
  if (room.wallSegments) {
    const positions = new Map<string, Point>();
    for (const segment of room.wallSegments) {
      const wall = level.walls.find(w => w.id === segment.id); if (!wall) throw new Error('La pared no existe.');
      for (const [id, position] of [[wall.startId, segment.start], [wall.endId, segment.end]] as const) { const previous = positions.get(id); if (previous && Math.hypot(previous.x - position.x, previous.z - position.z) > 1e-7) throw new Error('Las paredes conectadas deben compartir el mismo punto.'); positions.set(id, position); }
    }
    positions.forEach((position, id) => { const point = level.points.find(p => p.id === id)!; point.x = position.x; point.z = position.z; });
  }
  const previousHeight = level.height, previousThickness = level.thickness; level.height = room.height; level.thickness = room.thickness;
  level.walls.forEach((wall, index) => { if (Math.abs(wall.height - previousHeight) < 1e-7) wall.height = room.height; if (Math.abs(wall.thickness - previousThickness) < 1e-7) wall.thickness = room.thickness; if (room.wallColors[index]) wall.left.color = room.wallColors[index]; });
  level.surfaces.forEach(surface => { if (surface.kind === 'floor') { if (room.floorColor !== previous.floorColor) surface.finish.color = room.floorColor; if (room.floorFinish !== previous.floorFinish) surface.finish.material = room.floorFinish; } });
  next.roofs.filter(roof => roof.levelId === levelId).forEach(roof => { if (roof.type !== 'mesh' && Math.abs(roof.baseHeight - previousHeight) < 1e-7) roof.baseHeight = room.height; });
  level.furniture = room.furniture.map(item => ({ ...structuredClone(item), levelId })); level.lights = room.lights.map(light => ({ ...light, levelId }));
  level.openings = room.openings.map(({ wall, ...opening }) => { const wallId = room.wallIds?.[wall] ?? level.walls[wall]?.id; if (!wallId || !level.walls.some(w => w.id === wallId)) throw new Error('La abertura necesita una pared válida.'); return { ...opening, levelId, wallId }; });
  if (room.height !== previousHeight) { next.levels = next.levels.map(level => level.id === levelId ? level : { ...level }); recalculateElevations(next); }
  if (room.ceilingColor !== previous.ceilingColor) next = updateCeilingFinish(next, levelId, { color: room.ceilingColor });
  return validateDocument(next, false);
}

export function recalculateElevations(project: ProjectDocument): void { let elevation = 0; for (const level of project.levels) { level.elevation = elevation; elevation += level.height; } }

// Validation is implemented below; no prior project version is interpreted here.
export function validateProjectDocument(value: unknown): ProjectDocument {
  return validateDocument(value);
}

const EPS = 1e-7;
const FINISHES: FloorFinish[] = ['wood', 'tile-grid', 'tile-brick', 'tile-checker', 'marble', 'concrete'];
// Exact content keys, never entity IDs: mutating coordinates/topology always invalidates validation reuse.
const geometryChecks = new Map<string, number>();
let geometryCheckBytes = 0;
const GEOMETRY_CACHE_BYTES = 8 * 1024 * 1024, GEOMETRY_CACHE_ENTRIES = 1024;
function knownGeometry(key: string): boolean { const bytes = geometryChecks.get(key); if (bytes === undefined) return false; geometryChecks.delete(key); geometryChecks.set(key, bytes); return true; }
function rememberGeometry(key: string): void { const bytes = key.length * 2; if (bytes > GEOMETRY_CACHE_BYTES || geometryChecks.has(key)) return; while (geometryChecks.size >= GEOMETRY_CACHE_ENTRIES || geometryCheckBytes + bytes > GEOMETRY_CACHE_BYTES) { const oldest = geometryChecks.entries().next().value; if (!oldest) break; geometryChecks.delete(oldest[0]); geometryCheckBytes -= oldest[1]; } geometryChecks.set(key, bytes); geometryCheckBytes += bytes; }
function fail(message = 'El proyecto contiene datos inválidos.'): never { throw new Error(message); }
function object(value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail();
  const prototype = Object.getPrototypeOf(value); if (prototype !== Object.prototype && prototype !== null) return fail();
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some(key => !keys.includes(key) && !optional.includes(key)) || keys.some(key => !Object.hasOwn(item, key))) return fail('El proyecto contiene campos ausentes o desconocidos.');
  return item;
}
function num(value: unknown, min: number, max: number): asserts value is number { if (typeof value !== 'number' || !Number.isFinite(value) || value < min - EPS || value > max + EPS) fail('Las medidas del proyecto están fuera de los límites permitidos.'); }
function bool(value: unknown): asserts value is boolean { if (typeof value !== 'boolean') fail(); }
function text(value: unknown): asserts value is string { if (typeof value !== 'string' || !value.trim() || value.length > 100 || /[\u0000-\u001f\u007f]/.test(value)) fail('Escribe un nombre válido de hasta 100 caracteres.'); }
function id(value: unknown): asserts value is string { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value)) fail('El identificador no es válido.'); }
function list(value: unknown, min: number, max: number): asserts value is unknown[] { if (!Array.isArray(value) || value.length < min || value.length > max) fail('El proyecto supera los límites de elementos permitidos.'); }
function color(value: unknown): asserts value is string { if (typeof value !== 'string' || !/^#[a-f\d]{6}$/i.test(value)) fail('Usa un color hexadecimal de seis cifras.'); }
function finish(value: unknown): void { const p = object(value, ['color', 'material']); color(p.color); if (!FINISHES.includes(p.material as FloorFinish)) fail('Selecciona un acabado válido.'); }
export function cross2(a: Point, b: Point, c: Point): number { return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x); }
export function segmentDistance(point: Point, a: Point, b: Point): number { const dx = b.x - a.x, dz = b.z - a.z, l = dx * dx + dz * dz; const t = l ? Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.z - a.z) * dz) / l)) : 0; return Math.hypot(point.x - a.x - dx * t, point.z - a.z - dz * t); }
export function pointInRing(p: Point, points: Point[]): boolean { let inside = false; for (let i = 0, j = points.length - 1; i < points.length; j = i++) { const a = points[i], b = points[j]; if (segmentDistance(p, a, b) < EPS) return true; if ((a.z > p.z) !== (b.z > p.z) && p.x < (b.x - a.x) * (p.z - a.z) / (b.z - a.z) + a.x) inside = !inside; } return inside; }
export function signedRingArea(points: Point[]): number { return points.reduce((sum, a, i) => { const b = points[(i + 1) % points.length]; return sum + a.x * b.z - b.x * a.z; }, 0) / 2; }
export function segmentsCross(a: Point, b: Point, c: Point, d: Point, includeTouch = true): boolean {
  const x = cross2(a, b, c), y = cross2(a, b, d), u = cross2(c, d, a), v = cross2(c, d, b);
  if (((x > EPS && y < -EPS) || (x < -EPS && y > EPS)) && ((u > EPS && v < -EPS) || (u < -EPS && v > EPS))) return true;
  return includeTouch && (segmentDistance(a, c, d) < EPS || segmentDistance(b, c, d) < EPS || segmentDistance(c, a, b) < EPS || segmentDistance(d, a, b) < EPS);
}
export function assertRing(points: Point[], minimumArea = .01, maximumCoordinate = 50): void {
  if (points.length < 3 || points.length > 256 || Math.abs(signedRingArea(points)) < minimumArea) fail('El polígono necesita al menos tres puntos y una superficie válida.');
  for (const p of points) { num(p.x, -maximumCoordinate, maximumCoordinate); num(p.z, -maximumCoordinate, maximumCoordinate); }
  const key = 'ring:' + minimumArea + ':' + maximumCoordinate + ':' + JSON.stringify(points.map(p => [p.x, p.z]));
  if (knownGeometry(key)) return;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    if (Math.hypot(a.x - b.x, a.z - b.z) < .001) fail('El polígono contiene puntos repetidos.');
    for (let j = i + 1; j < points.length; j++) if (j !== i + 1 && !(i === 0 && j === points.length - 1) && segmentsCross(a, b, points[j], points[(j + 1) % points.length])) fail('El polígono no puede cruzarse ni tocarse a sí mismo.');
  }
  rememberGeometry(key);
}
function checkPlainPoints(value: unknown): asserts value is Point[] { list(value, 3, 256); value.forEach(p => { const a = object(p, ['x', 'z']); num(a.x, -50, 50); num(a.z, -50, 50); }); assertRing(value as Point[]); }
function ringRefs(value: unknown, points: ProjectPoint[]): asserts value is string[] { list(value, 3, 256); const map = new Map(points.map(p => [p.id, p])); if (new Set(value).size !== value.length || value.some(key => typeof key !== 'string' || !map.has(key))) fail('La planta contiene una referencia inválida.'); assertRing(value.map(key => map.get(key as string)!)); }
function checkFurniture(raw: unknown, level: ProjectLevel): void {
  const p = object(raw, ['id', 'levelId', 'type', 'material', 'color', 'x', 'z', 'width', 'depth', 'height', 'rotation'], ['variant', 'bedSize', 'assetId', 'name', 'parts']);
  if (!['bed', 'wardrobe', 'vanity', 'nightstand', 'custom'].includes(p.type as string)) fail('Selecciona un tipo de mueble válido.');
  if (p.levelId !== level.id) fail('El elemento pertenece a otro nivel.');
  id(p.id); num(p.x, -50, 50); num(p.z, -50, 50); num(p.rotation, 0, 360);
  const custom = p.type === 'custom';
  for (const key of ['width', 'depth', 'height']) num(p[key], custom ? .01 : .1, key === 'height' ? level.height : 10);
  if (!(custom && p.material === null) && !['wood', 'plastic', 'metal'].includes(p.material as string)) fail('Selecciona un material válido.');
  if (!(custom && p.color === null)) color(p.color);
  if (p.type === 'bed') { if (!['single', 'double', 'queen', 'king'].includes(p.bedSize as string)) fail('Selecciona un tamaño de cama válido.'); } else if ('bedSize' in p) fail();
  if (p.type === 'wardrobe' || p.type === 'vanity' || p.type === 'nightstand') { if (!isFurnitureVariant(p.type, p.variant)) fail('Selecciona un modelo válido de esta categoría.'); } else if ('variant' in p) fail();
  if (custom) {
    if (typeof p.assetId !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(p.assetId)) fail('El modelo necesita un archivo válido.');
    text(p.name);
    if (p.parts !== undefined) {
      if (!p.parts || typeof p.parts !== 'object' || Array.isArray(p.parts) || Object.keys(p.parts).length > 512) fail('El modelo admite hasta 512 piezas.');
      for (const [key, rawPart] of Object.entries(p.parts)) {
        if (!/^(0|[1-9]\d{0,2})$/.test(key) || +key >= 512) fail('Selecciona una pieza válida.');
        const part = object(rawPart, [], ['color', 'material', 'visible', 'position', 'rotation', 'scale']);
        if (part.color !== undefined) color(part.color); if (part.visible !== undefined) bool(part.visible);
        if (part.material !== undefined && !['wood', 'plastic', 'metal'].includes(part.material as string)) fail('Selecciona un material válido.');
        for (const key of ['position', 'rotation', 'scale']) if (part[key] !== undefined) { const vector = object(part[key], ['x', 'y', 'z']); for (const coordinate of Object.values(vector)) num(coordinate, key === 'scale' ? .1 : key === 'rotation' ? -360 : -20, key === 'scale' ? 10 : key === 'rotation' ? 360 : 20); }
      }
    }
  } else if ('assetId' in p || 'name' in p || 'parts' in p) fail();
}
function validateDocument(value: unknown, copy = true): ProjectDocument {
  const raw = object(value, ['version', 'id', 'name', 'activeLevelId', 'levels', 'stairs', 'roofs', 'renderQuality', 'editing', 'sun'], ['setupStep']);
  if (raw.version !== 3) fail('La versión del proyecto no es compatible.');
  id(raw.id); text(raw.name); id(raw.activeLevelId);
  if (raw.setupStep !== undefined && ![0, 1, 2, 3].includes(raw.setupStep as number)) fail('El paso de preparación no es válido.');
  if (!['standard', 'realistic', 'hyperrealistic'].includes(raw.renderQuality as string)) fail('Selecciona una calidad visual válida.');
  const editing = object(raw.editing, ['snap', 'step', 'bounds']); bool(editing.snap); bool(editing.bounds); num(editing.step, .01, 1);
  const sun = object(raw.sun, ['enabled', 'hour', 'azimuth', 'intensity']); bool(sun.enabled); num(sun.hour, 0, 24); num(sun.azimuth, 0, 360); num(sun.intensity, 0, 10);
  list(raw.levels, 1, PROJECT_LIMITS.levels); list(raw.stairs, 0, PROJECT_LIMITS.stairs); list(raw.roofs, 0, PROJECT_LIMITS.roofs);
  // Count instance overrides before polygon/solid checks. Asset reuse does not make per-instance edits free.
  let partOverrides = 0;
  for (const input of raw.levels) if (input && typeof input === 'object' && Array.isArray((input as Record<string, unknown>).furniture)) for (const item of (input as { furniture: unknown[] }).furniture) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const parts = (item as Record<string, unknown>).parts;
    if (parts && typeof parts === 'object' && !Array.isArray(parts)) partOverrides += Object.keys(parts).length;
    if (partOverrides > PROJECT_LIMITS.partOverrides) fail('El proyecto tiene demasiadas modificaciones de piezas de modelos.');
  }
  const identifiers = new Set<string>();
  const unique = (key: unknown) => { id(key); if (identifiers.has(key)) fail('Los elementos necesitan identificadores únicos.'); identifiers.add(key); };
  let elevation = 0, totalFurniture = 0, totalLights = 0, totalOpenings = 0;
  for (const input of raw.levels) {
    const r = object(input, ['id', 'name', 'elevation', 'height', 'thickness', 'points', 'outline', 'walls', 'surfaces', 'openings', 'furniture', 'lights']);
    unique(r.id); if (r.id === 'meta') fail('El identificador del nivel está reservado.'); text(r.name); num(r.height, 1.8, 8); num(r.thickness, .05, .6); num(r.elevation, 0, 96);
    if (Math.abs((r.elevation as number) - elevation) > EPS) fail('La elevación del nivel no coincide con la altura de los niveles anteriores.'); elevation += r.height as number;
    list(r.points, 3, PROJECT_LIMITS.pointsPerLevel); for (const input of r.points) { const p = object(input, ['id', 'x', 'z']); unique(p.id); num(p.x, -50, 50); num(p.z, -50, 50); }
    const level = r as unknown as ProjectLevel; ringRefs(r.outline, level.points);
    list(r.walls, 0, PROJECT_LIMITS.wallsPerLevel);
    for (const input of r.walls) {
      const w = object(input, ['id', 'levelId', 'startId', 'endId', 'thickness', 'height', 'left', 'right']); unique(w.id); if (w.levelId !== r.id) fail('La pared pertenece a otro nivel.');
      const [a, b] = wallEndpoints(level, w as unknown as ProjectWall); if (a.id === b.id || Math.hypot(a.x - b.x, a.z - b.z) < .05) fail('Cada pared debe medir al menos 0.05 m.');
      num(w.thickness, .05, .6); num(w.height, .1, level.height); finish(w.left); finish(w.right);
    }
    // Every intersection is a shared point; overlapping centerlines are not valid topology.
    const topologyKey = 'walls:' + JSON.stringify([level.points.map(p => [p.id, p.x, p.z]), level.walls.map(w => [w.startId, w.endId])]);
    const pointMap = new Map(level.points.map(point => [point.id, point]));
    if (!knownGeometry(topologyKey)) {
    for (let i = 0; i < level.walls.length; i++) for (let j = i + 1; j < level.walls.length; j++) {
      const wa = level.walls[i], wb = level.walls[j], a = pointMap.get(wa.startId)!, b = pointMap.get(wa.endId)!, c = pointMap.get(wb.startId)!, d = pointMap.get(wb.endId)!;
      const shared = [wa.startId, wa.endId].some(id => id === wb.startId || id === wb.endId);
      if ((!shared && segmentsCross(a, b, c, d)) || (Math.abs(cross2(a, b, c)) < EPS && Math.abs(cross2(a, b, d)) < EPS && (segmentDistance(a, c, d) < EPS && a.id !== c.id && a.id !== d.id || segmentDistance(b, c, d) < EPS && b.id !== c.id && b.id !== d.id || wa.startId === wb.endId && wa.endId === wb.startId || wa.startId === wb.startId && wa.endId === wb.endId))) fail('Las paredes deben dividirse en sus intersecciones y no superponerse.');
    }
    rememberGeometry(topologyKey);
    }
    list(r.surfaces, 1, PROJECT_LIMITS.surfacesPerLevel);
    if (!level.surfaces.some(s => s.kind === 'floor')) fail('El nivel necesita una superficie de piso.');
    for (const input of r.surfaces) {
      const kind = input && typeof input === 'object' ? (input as { kind?: unknown }).kind : undefined;
      const s = object(input, ['id', 'levelId', 'kind', 'outline', 'holes', 'elevation', 'thickness', 'finish', ...(kind === 'floor' ? ['undersideFinish'] : [])]); unique(s.id); if (s.levelId !== level.id || !['floor', 'ceiling'].includes(s.kind as string)) fail('La superficie no es válida.');
      ringRefs(s.outline, level.points); num(s.elevation, 0, level.height); num(s.thickness, .02, .6); finish(s.finish); list(s.holes, 0, 64);
      if (s.kind === 'floor') finish(s.undersideFinish);
      const outline = (s.outline as string[]).map(id => level.points.find(p => p.id === id)!);
      for (const holeInput of s.holes) {
        const hole = object(holeInput, ['id', 'vertices'], ['stairId']); unique(hole.id); checkPlainPoints(hole.vertices); if (hole.stairId !== undefined) id(hole.stairId);
        const ring = hole.vertices as Point[];
        if (ring.some(p => !pointInRing(p, outline)) || ring.some((p, i) => outline.some((a, j) => segmentsCross(p, ring[(i + 1) % ring.length], a, outline[(j + 1) % outline.length], false)))) fail('El hueco debe quedar dentro de la superficie.');
      }
      for (let i = 0; i < (s.holes as SurfaceHole[]).length; i++) for (let j = i + 1; j < (s.holes as SurfaceHole[]).length; j++) { const a = (s.holes as SurfaceHole[])[i].vertices, b = (s.holes as SurfaceHole[])[j].vertices; if (a.some(p => pointInRing(p, b)) || b.some(p => pointInRing(p, a)) || a.some((p, i) => b.some((q, j) => segmentsCross(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length])))) fail('Los huecos no pueden superponerse.'); }
    }
    list(r.openings, 0, PROJECT_LIMITS.openingsPerLevel); totalOpenings += r.openings.length;
    for (const input of r.openings) {
      const p = object(input, ['id', 'levelId', 'wallId', 'type', 'offset', 'width', 'height', 'sill'], ['doorStyle', 'open']); unique(p.id); const wall = level.walls.find(w => w.id === p.wallId); if (!wall || p.levelId !== level.id) fail('La abertura necesita una pared válida.');
      const [a, b] = wallEndpoints(level, wall), length = Math.hypot(a.x - b.x, a.z - b.z); num(p.width, .3, length); num(p.offset, 0, length - (p.width as number)); num(p.height, .3, wall.height); num(p.sill, 0, wall.height - (p.height as number));
      if (p.type === 'door') { if (p.sill !== 0 || !['right', 'left', 'frame'].includes(p.doorStyle as string)) fail('La puerta no es válida.'); if (p.doorStyle === 'frame') { if ('open' in p) fail('Un marco no admite estado de puerta.'); } else bool(p.open); } else if (p.type !== 'window' || 'doorStyle' in p || 'open' in p) fail('La ventana no admite propiedades de puerta.');
    }
    for (let i = 0; i < level.openings.length; i++) for (let j = i + 1; j < level.openings.length; j++) { const a = level.openings[i], b = level.openings[j]; if (a.wallId === b.wallId && a.offset < b.offset + b.width - EPS && b.offset < a.offset + a.width - EPS && a.sill < b.sill + b.height - EPS && b.sill < a.sill + a.height - EPS) fail('Dos aberturas se superponen.'); }
    list(r.furniture, 0, PROJECT_LIMITS.furniturePerLevel); totalFurniture += r.furniture.length; for (const p of r.furniture) { checkFurniture(p, level); unique((p as ProjectFurniture).id); }
    list(r.lights, 0, PROJECT_LIMITS.lightsPerLevel); totalLights += r.lights.length;
    for (const input of r.lights) { const p = object(input, ['id', 'levelId', 'name', 'x', 'y', 'z', 'lumens', 'temperature', 'enabled']); unique(p.id); text(p.name); if (p.levelId !== level.id) fail('La luz pertenece a otro nivel.'); num(p.x, -50, 50); num(p.z, -50, 50); num(p.y, .1, level.height); num(p.lumens, 0, 20000); num(p.temperature, 1000, 12000); bool(p.enabled); if (editing.bounds && !pointInRing({ x: p.x, z: p.z }, levelOutline(level))) fail('La luz debe estar dentro de la planta.'); }
  }
  if (totalFurniture > PROJECT_LIMITS.furniture || totalLights > PROJECT_LIMITS.lights || totalOpenings > PROJECT_LIMITS.openings) fail('El proyecto supera los límites de elementos permitidos.');
  const project = raw as unknown as ProjectDocument; projectLevel(project, project.activeLevelId);
  const allSurfaces = project.levels.flatMap(level => level.surfaces), allHoles = allSurfaces.flatMap(surface => surface.holes);
  if (project.levels.reduce((sum, level) => sum + level.points.length, 0) > PROJECT_LIMITS.points || project.levels.reduce((sum, level) => sum + level.walls.length, 0) > PROJECT_LIMITS.walls || allSurfaces.length > PROJECT_LIMITS.surfaces || allHoles.length > PROJECT_LIMITS.holes || allHoles.reduce((sum, hole) => sum + hole.vertices.length, 0) > PROJECT_LIMITS.holeVertices) fail('El proyecto supera los límites de geometría permitidos.');
  for (const input of raw.stairs) {
    const s = object(input, ['id', 'type', 'fromLevelId', 'toLevelId', 'x', 'z', 'rotation', 'width', 'stepCount', 'run', 'landingDepth', 'innerRadius', 'turns', 'clockwise', 'thickness', 'rails', 'hole', 'finish']); unique(s.id);
    if (!['straight', 'landing', 'l', 'u', 'spiral'].includes(s.type as string)) fail('Selecciona una forma de escalera válida.');
    const from = projectLevel(project, s.fromLevelId as string), to = projectLevel(project, s.toLevelId as string); if (project.levels.indexOf(to) !== project.levels.indexOf(from) + 1) fail('La escalera debe conectar niveles consecutivos.');
    num(s.x, -50, 50); num(s.z, -50, 50); num(s.rotation, 0, 360); num(s.width, .6, 4); num(s.stepCount, 3, 64); if (!Number.isInteger(s.stepCount)) fail('El número de peldaños debe ser entero.'); num(s.run, .6, 20); num(s.landingDepth, .6, 4); num(s.innerRadius, .1, 4); num(s.turns, .25, 3); bool(s.clockwise); num(s.thickness, .03, .5); finish(s.finish);
    if (!['none', 'left', 'right', 'both'].includes(s.rails as string)) fail('Selecciona los barandales de la escalera.');
    if (s.hole !== null) checkPlainPoints(s.hole);
    const rise = to.elevation - from.elevation; if (rise / (s.stepCount as number) > .24 + EPS || rise / (s.stepCount as number) < .08 - EPS) fail('La altura de cada peldaño debe estar entre 0.08 y 0.24 m.');
    if (s.type === 'spiral' && rise / (s.turns as number) < 1.95 + (s.thickness as number)) fail('La escalera de caracol no tiene altura libre suficiente entre vueltas.');
    if (s.type !== 'spiral' && (s.run as number) / (s.stepCount as number) < .2) fail('La huella de cada peldaño debe medir al menos 0.2 m.');
    if (allHoles.filter(hole => hole.stairId === s.id).length !== 1) fail('Cada escalera necesita un hueco en el nivel superior.');
  }
  for (const level of project.levels) for (const surface of level.surfaces) for (const hole of surface.holes) if (hole.stairId !== undefined && !project.stairs.some(s => s.id === hole.stairId && s.toLevelId === level.id)) fail('El hueco de escalera contiene una referencia inválida.');
  for (const input of raw.roofs) {
    const value = input as Record<string, unknown>; const mesh = value?.type === 'mesh';
    const r = object(input, ['id', 'levelId', 'type', 'thickness', 'finish', 'undersideFinish', ...(mesh ? ['vertices', 'faces'] : ['footprint', 'baseHeight', 'pitch', 'overhang', 'rotation'])]); unique(r.id); const level = projectLevel(project, r.levelId as string); num(r.thickness, .03, .6); finish(r.finish); finish(r.undersideFinish);
    if (mesh) validateRoofMesh(r as unknown as MeshRoof, level.height);
    else {
      if (!['flat', 'shed', 'gable', 'hip'].includes(r.type as string)) fail('Selecciona una forma de techo válida.'); checkPlainPoints(r.footprint); num(r.baseHeight, .3, level.height + 8); num(r.pitch, 0, 75); num(r.overhang, 0, 2); num(r.rotation, 0, 360); if (r.type === 'flat' && r.pitch !== 0) fail('El techo plano debe tener inclinación cero.'); if (r.type === 'hip' && !isRectangularRing(r.footprint as Point[])) fail('El techo a cuatro aguas necesita una base rectangular.');
      const outline = expandedRoofFootprint(r.footprint as Point[], r.overhang as number); assertRing(outline, .01, 52);
      const angle = (r.rotation as number) * Math.PI / 180, projections = outline.map(p => p.x * Math.cos(angle) - p.z * Math.sin(angle)), span = Math.max(...projections) - Math.min(...projections);
      const hipSpan = Math.min(...outline.map((p, i) => Math.hypot(p.x - outline[(i + 1) % outline.length].x, p.z - outline[(i + 1) % outline.length].z)));
      const rise = (r.type === 'flat' ? 0 : r.type === 'hip' ? hipSpan / 2 : r.type === 'gable' ? span / 2 : span) * Math.tan((r.pitch as number) * Math.PI / 180);
      num((r.baseHeight as number) + rise + (r.thickness as number), .1, level.height + 20);
    }
  }
  const meshRoofs = project.roofs.filter((roof): roof is MeshRoof => roof.type === 'mesh');
  if (meshRoofs.reduce((sum, roof) => sum + roof.vertices.length, 0) > PROJECT_LIMITS.totalRoofVertices || meshRoofs.reduce((sum, roof) => sum + roof.faces.length, 0) > PROJECT_LIMITS.totalRoofFaces) fail('El proyecto supera los límites de geometría permitidos.');
  return copy ? structuredClone(project) : project;
}

export function isRectangularRing(points: Point[]): boolean { return points.length === 4 && points.every((p, i) => { const a = points[(i + 3) % 4], b = points[(i + 1) % 4]; return Math.abs((a.x - p.x) * (b.x - p.x) + (a.z - p.z) * (b.z - p.z)) < 1e-6; }); }
export function expandedRoofFootprint(footprint: Point[], overhang: number): Point[] {
  if (!overhang) return footprint.map(p => ({ x: p.x, z: p.z }));
  const sign = Math.sign(signedRingArea(footprint));
  return footprint.map((p, i) => {
    const a = footprint[(i + footprint.length - 1) % footprint.length], b = footprint[(i + 1) % footprint.length], ux = p.x - a.x, uz = p.z - a.z, vx = b.x - p.x, vz = b.z - p.z, ulen = Math.hypot(ux, uz), vlen = Math.hypot(vx, vz);
    const ax = p.x + sign * uz / ulen * overhang, az = p.z - sign * ux / ulen * overhang, bx = p.x + sign * vz / vlen * overhang, bz = p.z - sign * vx / vlen * overhang, denominator = ux * vz - uz * vx;
    if (Math.abs(denominator) < EPS) return { x: (ax + bx) / 2, z: (az + bz) / 2 };
    const t = ((bx - ax) * vz - (bz - az) * vx) / denominator; return { x: ax + t * ux, z: az + t * uz };
  });
}
export function validateRoofMesh(roof: MeshRoof, height = 8): void {
  list(roof.vertices, 4, PROJECT_LIMITS.roofVertices); list(roof.faces, 4, PROJECT_LIMITS.roofFaces);
  const ids = new Set<string>(), map = new Map<string, RoofVertex>();
  for (const input of roof.vertices) { const p = object(input, ['id', 'x', 'y', 'z']); id(p.id); if (ids.has(p.id)) fail('Los vértices del techo necesitan identificadores únicos.'); ids.add(p.id); num(p.x, -52, 52); num(p.z, -52, 52); num(p.y, .1, height + 20); map.set(p.id, p as RoofVertex); }
  const faceIds = new Set<string>(), triangleKeys = new Set<string>(), edges = new Map<string, number[]>();
  for (const input of roof.faces) {
    const face = object(input, ['id', 'vertexIds']); id(face.id); if (faceIds.has(face.id)) fail('Las caras del techo necesitan identificadores únicos.'); faceIds.add(face.id); list(face.vertexIds, 3, 3);
    const vertices = face.vertexIds as string[]; if (new Set(vertices).size !== 3 || vertices.some(v => !map.has(v))) fail('La cara del techo contiene una referencia inválida.');
    const key = [...vertices].sort().join('|'); if (triangleKeys.has(key)) fail('El techo contiene caras duplicadas.'); triangleKeys.add(key);
    const [a, b, c] = vertices.map(v => map.get(v)!); const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-7) fail('El techo contiene caras sin superficie.');
    for (let i = 0; i < 3; i++) { const a = vertices[i], b = vertices[(i + 1) % 3], key = a < b ? `${a}|${b}` : `${b}|${a}`; const values = edges.get(key) ?? []; values.push(a < b ? 1 : -1); edges.set(key, values); }
  }
  if ([...edges.values()].some(values => values.length !== 2 || values[0] + values[1] !== 0)) fail('El techo debe ser un sólido cerrado con caras orientadas correctamente.');
  let volume = 0; for (const face of roof.faces) { const [a, b, c] = face.vertexIds.map(v => map.get(v)!); volume += a.x * (b.y * c.z - b.z * c.y) + a.y * (b.z * c.x - b.x * c.z) + a.z * (b.x * c.y - b.y * c.x); }
  if (volume < 1e-6) fail('El techo necesita un volumen válido y caras orientadas hacia fuera.');
  const geometryKey = 'roof:' + JSON.stringify([roof.vertices.map(p => [p.id, p.x, p.y, p.z]), roof.faces.map(face => face.vertexIds)]);
  if (knownGeometry(geometryKey)) return;
  const triangles = roof.faces.map(face => face.vertexIds.map(id => map.get(id)!));
  for (let i = 0; i < triangles.length; i++) for (let j = i + 1; j < triangles.length; j++) {
    const a = triangles[i], b = triangles[j];
    if (['x', 'y', 'z'].some(axis => Math.max(...a.map(p => p[axis as 'x'])) < Math.min(...b.map(p => p[axis as 'x'])) - EPS || Math.max(...b.map(p => p[axis as 'x'])) < Math.min(...a.map(p => p[axis as 'x'])) - EPS)) continue;
    if (triangleIntersects(a, b)) fail('Las caras del techo no pueden atravesarse ni superponerse.');
  }
  rememberGeometry(geometryKey);
}

function triangleIntersects(a: RoofVertex[], b: RoofVertex[]): boolean {
  const sub = (a: RoofVertex, b: RoofVertex) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const cross = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const dot = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => a.x * b.x + a.y * b.y + a.z * b.z;
  const normal = cross(sub(b[1], b[0]), sub(b[2], b[0]));
  const coplanar = a.every(p => Math.abs(dot(sub(p, b[0]), normal)) < EPS);
  if (coplanar) {
    const axes = Math.abs(normal.y) >= Math.max(Math.abs(normal.x), Math.abs(normal.z)) ? ['x', 'z'] as const : Math.abs(normal.x) >= Math.abs(normal.z) ? ['y', 'z'] as const : ['x', 'y'] as const;
    const project = (p: RoofVertex): Point => ({ x: p[axes[0]], z: p[axes[1]] }), pa = a.map(project), pb = b.map(project);
    const strictInside = (p: Point, tri: Point[]) => { const values = tri.map((v, i) => cross2(v, tri[(i + 1) % 3], p)); return values.every(n => n > EPS) || values.every(n => n < -EPS); };
    if (pa.some(p => strictInside(p, pb)) || pb.some(p => strictInside(p, pa))) return true;
    return pa.some((p, i) => pb.some((q, j) => segmentsCross(p, pa[(i + 1) % 3], q, pb[(j + 1) % 3], false)));
  }
  const edgeHit = (p: RoofVertex, q: RoofVertex, tri: RoofVertex[]) => {
    const direction = sub(q, p), e1 = sub(tri[1], tri[0]), e2 = sub(tri[2], tri[0]), h = cross(direction, e2), determinant = dot(e1, h); if (Math.abs(determinant) < EPS) return false;
    const s = sub(p, tri[0]), u = dot(s, h) / determinant; if (u < -EPS || u > 1 + EPS) return false;
    const v = dot(direction, cross(s, e1)) / determinant; if (v < -EPS || u + v > 1 + EPS) return false;
    const t = dot(e2, cross(s, e1)) / determinant;
    return t > EPS && t < 1 - EPS;
  };
  return a.some((p, i) => edgeHit(p, a[(i + 1) % 3], b)) || b.some((p, i) => edgeHit(p, b[(i + 1) % 3], a));
}

/** Global references/budgets are checked even when a protocol narrows its changed scopes. */
export function validateProjectChange(_previous: ProjectDocument, next: unknown, _changedLevels?: string[]): ProjectDocument { return validateDocument(next, false); }

/** Structural transactions require a revision receipt; appearance/ordinary object edits do not. */
export function projectStructure(project: ProjectDocument): string {
  return stableStringify({ levels: project.levels.map(level => ({ id: level.id, elevation: level.elevation, height: level.height, thickness: level.thickness, points: level.points, outline: level.outline, walls: level.walls.map(({ left: _left, right: _right, ...wall }) => wall), surfaces: level.surfaces.map(({ finish: _finish, undersideFinish: _undersideFinish, ...surface }) => surface) })), stairs: project.stairs.map(({ finish: _finish, ...stair }) => stair), roofs: project.roofs.map(({ finish: _finish, undersideFinish: _undersideFinish, ...roof }) => roof) });
}
