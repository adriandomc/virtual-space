import polygonClipping from 'polygon-clipping';
import type { Pair, MultiPolygon } from 'polygon-clipping';
import { assertRing, cross2, levelOutline, pointInRing, projectId, projectLevel, recalculateElevations, segmentDistance, validateProjectDocument, validateRoofMesh, wallEndpoints, whiteFinish, type MeshRoof, type ParametricRoof, type ProjectDocument, type ProjectLevel, type ProjectRoof, type ProjectStair, type ProjectSurface, type RoofFace, type RoofVertex } from './projectDocument.js';
import { buildStairGeometry, roofToMesh } from './projectGeometry.js';
import type { Point } from './types.js';

const EPS = 1e-6;
const close = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.z - b.z) < EPS;
function atomic(project: ProjectDocument, change: (next: ProjectDocument) => void): ProjectDocument { const next = structuredClone(project); change(next); recalculateElevations(next); return validateProjectDocument(next); }
function pointId(level: ProjectLevel, point: Point): string { const found = level.points.find(p => close(p, point)); if (found) return found.id; const id = projectId(); level.points.push({ id, ...point }); return id; }
function pruneUnusedPoints(level: ProjectLevel): void {
  const used = new Set([...level.outline, ...level.surfaces.flatMap(surface => surface.outline), ...level.walls.flatMap(wall => [wall.startId, wall.endId])]);
  level.points = level.points.filter(point => used.has(point.id));
}
const ring = (points: Point[]): Pair[] => points.map(p => [p.x, p.z]);
function surfacePolygon(level: ProjectLevel, surface: ProjectSurface): Pair[][] { return [surface.outline.map(id => { const p = level.points.find(p => p.id === id)!; return [p.x, p.z] as Pair; }), ...surface.holes.map(hole => ring(hole.vertices))]; }
function stripClosing(points: Pair[]): Point[] { const out = points.map(([x, z]) => ({ x, z })); if (out.length > 1 && close(out[0], out.at(-1)!)) out.pop(); return out; }

export function addLevel(project: ProjectDocument, options: { copy?: boolean; name?: string } = {}): ProjectDocument {
  return atomic(project, next => {
    const original = next.levels.at(-1)!, level = structuredClone(original), ids = new Map<string, string>();
    const remap = (id: string) => { let replacement = ids.get(id); if (!replacement) { replacement = projectId(); ids.set(id, replacement); } return replacement; };
    level.id = remap(original.id); level.name = options.name ?? `Nivel ${next.levels.length + 1}`;
    level.points.forEach(p => { p.id = remap(p.id); }); level.outline = level.outline.map(remap);
    level.walls = options.copy ? level.walls.map(w => ({ ...w, id: remap(w.id), levelId: level.id, startId: remap(w.startId), endId: remap(w.endId) })) : [];
    level.surfaces = level.surfaces.filter(s => s.kind === 'floor').map(s => ({ ...s, id: remap(s.id), levelId: level.id, outline: s.outline.map(remap), holes: s.holes.filter(h => !h.stairId).map(h => ({ ...h, id: remap(h.id) })) }));
    if (!options.copy) { level.surfaces = [{ id: projectId(), levelId: level.id, kind: 'floor', outline: [...level.outline], holes: [], elevation: 0, thickness: .18, finish: whiteFinish(), undersideFinish: whiteFinish() }]; pruneUnusedPoints(level); }
    level.openings = []; level.furniture = []; level.lights = [];
    next.levels.push(level); next.activeLevelId = level.id;
    // The top envelope moves up with the new storey. Explicit lower terraces can be added separately.
    next.roofs.filter(roof => roof.levelId === original.id).forEach(roof => { roof.levelId = level.id; });
  });
}
export function renameLevel(project: ProjectDocument, levelId: string, name: string): ProjectDocument { return atomic(project, next => { projectLevel(next, levelId).name = name; }); }
export function removeLevel(project: ProjectDocument, levelId: string): ProjectDocument {
  return atomic(project, next => {
    if (next.levels.length === 1) throw new Error('El proyecto necesita al menos un nivel.');
    const index = next.levels.findIndex(level => level.id === levelId); if (index < 0) throw new Error('El nivel no existe.');
    const removedStairs = new Set(next.stairs.filter(stair => stair.fromLevelId === levelId || stair.toLevelId === levelId).map(s => s.id));
    next.levels.splice(index, 1); next.stairs = next.stairs.filter(stair => !removedStairs.has(stair.id)); next.roofs = next.roofs.filter(roof => roof.levelId !== levelId);
    next.levels.forEach(level => level.surfaces.forEach(surface => { surface.holes = surface.holes.filter(hole => !hole.stairId || !removedStairs.has(hole.stairId)); }));
    if (next.activeLevelId === levelId) next.activeLevelId = next.levels[Math.min(index, next.levels.length - 1)].id;
    if (!next.roofs.length) { const top = next.levels.at(-1)!; next.roofs.push(defaultRoof(top)); }
  });
}
export function setLevelHeight(project: ProjectDocument, levelId: string, height: number): ProjectDocument {
  return atomic(project, next => { const level = projectLevel(next, levelId), previous = level.height; level.height = height; level.walls.filter(w => Math.abs(w.height - previous) < EPS).forEach(w => { w.height = height; }); next.roofs.filter(r => r.levelId === levelId && r.type !== 'mesh' && Math.abs(r.baseHeight - previous) < EPS).forEach(r => { if (r.type !== 'mesh') r.baseHeight = height; }); });
}

/** Split while preserving the original first segment ID and all opening references. */
function splitWallInPlace(level: ProjectLevel, wallId: string, positions: number[]): void {
  const index = level.walls.findIndex(w => w.id === wallId); if (index < 0) throw new Error('La pared no existe.');
  const wall = level.walls[index], [a, b] = wallEndpoints(level, wall), length = Math.hypot(b.x - a.x, b.z - a.z);
  const stops = [0, ...positions.filter(t => t > EPS && t < 1 - EPS), 1].sort((a, b) => a - b).filter((t, i, all) => !i || t - all[i - 1] > EPS);
  if (stops.length === 2) return;
  for (const opening of level.openings.filter(o => o.wallId === wallId)) if (stops.some(t => t * length > opening.offset + EPS && t * length < opening.offset + opening.width - EPS)) throw new Error('La división atravesaría una puerta o ventana.');
  const ids = stops.map(t => pointId(level, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }));
  const pieces = stops.slice(0, -1).map((_, i) => ({ ...structuredClone(wall), id: i ? projectId() : wall.id, startId: ids[i], endId: ids[i + 1] }));
  for (const opening of level.openings.filter(o => o.wallId === wallId)) { const i = stops.findIndex((t, i) => i < stops.length - 1 && opening.offset >= t * length - EPS && opening.offset + opening.width <= stops[i + 1] * length + EPS); if (i < 0) throw new Error('La división atravesaría una puerta o ventana.'); opening.wallId = pieces[i].id; opening.offset -= stops[i] * length; }
  level.walls.splice(index, 1, ...pieces);
  const replace = (outline: string[]) => { for (let i = 0; i < outline.length; i++) { const current = outline[i], following = outline[(i + 1) % outline.length]; if (current === a.id && following === b.id) { outline.splice(i + 1, 0, ...ids.slice(1, -1)); break; } if (current === b.id && following === a.id) { outline.splice(i + 1, 0, ...ids.slice(1, -1).reverse()); break; } } };
  replace(level.outline); level.surfaces.forEach(surface => replace(surface.outline));
}
export function splitWall(project: ProjectDocument, levelId: string, wallId: string, t: number): ProjectDocument { if (!Number.isFinite(t) || t <= 0 || t >= 1) throw new Error('Selecciona un punto interior de la pared.'); return atomic(project, next => splitWallInPlace(projectLevel(next, levelId), wallId, [t])); }

function addWallInPlace(level: ProjectLevel, a: Point, b: Point): void {
  if (Math.hypot(b.x - a.x, b.z - a.z) < .05) throw new Error('Cada pared debe medir al menos 0.05 m.');
  const incomingStops = [0, 1], existingSplits = new Map<string, number[]>(), dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
  for (const wall of level.walls) {
    const [c, d] = wallEndpoints(level, wall), ex = d.x - c.x, ez = d.z - c.z, den = dx * ez - dz * ex;
    if (Math.abs(den) < EPS) {
      if (Math.abs(cross2(a, b, c)) < EPS) {
        const t0 = ((c.x - a.x) * dx + (c.z - a.z) * dz) / length2, t1 = ((d.x - a.x) * dx + (d.z - a.z) * dz) / length2;
        if (Math.min(1, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)) > EPS) throw new Error('La pared se superpone con una pared existente.');
      }
      continue;
    }
    const t = ((c.x - a.x) * ez - (c.z - a.z) * ex) / den, u = ((c.x - a.x) * dz - (c.z - a.z) * dx) / den;
    if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) { incomingStops.push(Math.max(0, Math.min(1, t))); const splits = existingSplits.get(wall.id) ?? []; splits.push(u); existingSplits.set(wall.id, splits); }
  }
  for (const [id, positions] of existingSplits) splitWallInPlace(level, id, positions);
  const stops = incomingStops.sort((a, b) => a - b).filter((t, i, all) => !i || t - all[i - 1] > EPS);
  for (let i = 0; i < stops.length - 1; i++) { const startId = pointId(level, { x: a.x + dx * stops[i], z: a.z + dz * stops[i] }), endId = pointId(level, { x: a.x + dx * stops[i + 1], z: a.z + dz * stops[i + 1] }); level.walls.push({ id: projectId(), levelId: level.id, startId, endId, thickness: level.thickness, height: level.height, left: whiteFinish(), right: whiteFinish() }); }
}
export function addWall(project: ProjectDocument, levelId: string, a: Point, b: Point): ProjectDocument { return atomic(project, next => addWallInPlace(projectLevel(next, levelId), a, b)); }

/** Add a closed room without replacing the existing construction or its object IDs. */
export function addRoom(project: ProjectDocument, levelId: string, points: Point[]): ProjectDocument {
  assertRing(points, .25);
  return atomic(project, next => {
    const level = projectLevel(next, levelId), union = polygonClipping.union([ring(levelOutline(level))], [ring(points)]);
    if (union.length !== 1) throw new Error('El nuevo cuarto debe tocar la construcción existente.');
    const footprint = stripClosing(union[0][0]); level.outline = footprint.map(p => pointId(level, p));
    // Reuse coincident existing segments; add uncovered pieces, splitting at every intersection.
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length], dx = b.x - a.x, dz = b.z - a.z, length2 = dx * dx + dz * dz;
      const stops = [0, 1]; for (const wall of level.walls) { const [c, d] = wallEndpoints(level, wall); if (Math.abs(cross2(a, b, c)) < EPS && Math.abs(cross2(a, b, d)) < EPS) for (const p of [c, d]) { const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / length2; if (t > EPS && t < 1 - EPS) stops.push(t); } }
      const sorted = stops.sort((a, b) => a - b).filter((t, i, all) => !i || t - all[i - 1] > EPS);
      for (let j = 0; j < sorted.length - 1; j++) { const p = { x: a.x + dx * sorted[j], z: a.z + dz * sorted[j] }, q = { x: a.x + dx * sorted[j + 1], z: a.z + dz * sorted[j + 1] }, middle = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 }; const existing = level.walls.find(w => { const [a, b] = wallEndpoints(level, w); return segmentDistance(middle, a, b) < EPS; }); if (!existing) addWallInPlace(level, p, q); else { const [a, b] = wallEndpoints(level, existing), length2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2; splitWallInPlace(level, existing.id, [p, q].map(p => ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / length2)); } }
    }
    const floors = level.surfaces.filter(s => s.kind === 'floor'), preserved = level.surfaces.filter(s => s.kind !== 'floor'), newSurfaces: ProjectSurface[] = [];
    const make = (geometry: MultiPolygon, source: ProjectSurface) => geometry.forEach((polygon, index) => { const outline = stripClosing(polygon[0]); if (outline.length < 3) return; newSurfaces.push({ ...structuredClone(source), id: index ? projectId() : source.id, outline: outline.map(p => pointId(level, p)), holes: polygon.slice(1).map(r => { const vertices = stripClosing(r), original = source.holes.find(h => h.vertices.length === vertices.length && vertices.every(p => h.vertices.some(q => close(p, q)))); return { id: original?.id ?? projectId(), vertices, ...(original?.stairId ? { stairId: original.stairId } : {}) }; }) }); });
    for (const floor of floors) make(polygonClipping.difference(surfacePolygon(level, floor), [ring(points)]), floor);
    const source = { id: projectId(), levelId, kind: 'floor' as const, outline: [], holes: [], elevation: 0, thickness: .18, finish: whiteFinish(), undersideFinish: whiteFinish() };
    // Existing cut-outs remain holes even when a room is redrawn over them.
    const holes = floors.flatMap(floor => floor.holes).filter(hole => hole.vertices.every(p => pointInRing(p, points)));
    make(polygonClipping.difference([ring(points)], ...holes.map(hole => [ring(hole.vertices)])), { ...source, holes });
    level.surfaces = [...preserved, ...newSurfaces];
  });
}
export function movePoint(project: ProjectDocument, levelId: string, id: string, position: Point): ProjectDocument { return atomic(project, next => { const point = projectLevel(next, levelId).points.find(p => p.id === id); if (!point) throw new Error('El punto no existe.'); point.x = position.x; point.z = position.z; }); }
export function moveWall(project: ProjectDocument, levelId: string, wallId: string, delta: Point): ProjectDocument { return atomic(project, next => { const level = projectLevel(next, levelId), wall = level.walls.find(w => w.id === wallId); if (!wall) throw new Error('La pared no existe.'); for (const p of wallEndpoints(level, wall)) { p.x += delta.x; p.z += delta.z; } }); }
export function deleteWall(project: ProjectDocument, levelId: string, wallId: string): ProjectDocument { return atomic(project, next => { const level = projectLevel(next, levelId); if (!level.walls.some(w => w.id === wallId)) throw new Error('La pared no existe.'); level.walls = level.walls.filter(w => w.id !== wallId); level.openings = level.openings.filter(o => o.wallId !== wallId); pruneUnusedPoints(level); }); }
export function addHole(project: ProjectDocument, levelId: string, surfaceId: string, vertices: Point[]): ProjectDocument { return atomic(project, next => { const surface = projectLevel(next, levelId).surfaces.find(s => s.id === surfaceId); if (!surface) throw new Error('La superficie no existe.'); surface.holes.push({ id: projectId(), vertices: structuredClone(vertices) }); }); }
export function updateHole(project: ProjectDocument, levelId: string, surfaceId: string, holeId: string, vertices: Point[]): ProjectDocument { return atomic(project, next => { const hole = projectLevel(next, levelId).surfaces.find(s => s.id === surfaceId)?.holes.find(h => h.id === holeId); if (!hole) throw new Error('El hueco no existe.'); hole.vertices = structuredClone(vertices); if (hole.stairId) { const stair = next.stairs.find(s => s.id === hole.stairId); if (!stair) throw new Error('La escalera no existe.'); stair.hole = structuredClone(vertices); } }); }
export function deleteHole(project: ProjectDocument, levelId: string, surfaceId: string, holeId: string): ProjectDocument { return atomic(project, next => { const surface = projectLevel(next, levelId).surfaces.find(s => s.id === surfaceId); if (!surface) throw new Error('La superficie no existe.'); if (surface.holes.some(h => h.id === holeId && h.stairId)) throw new Error('El hueco de escalera se modifica con la escalera.'); surface.holes = surface.holes.filter(h => h.id !== holeId); }); }

function syncStairHole(project: ProjectDocument, stair: ProjectStair): void {
  const holeId = project.levels.flatMap(level => level.surfaces).flatMap(surface => surface.holes).find(hole => hole.stairId === stair.id)?.id ?? projectId();
  project.levels.forEach(level => level.surfaces.forEach(surface => { surface.holes = surface.holes.filter(h => h.stairId !== stair.id); }));
  const level = projectLevel(project, stair.toLevelId), geometry = buildStairGeometry(project, stair), vertices = stair.hole ?? geometry.hole;
  const surface = level.surfaces.find(s => s.kind === 'floor' && vertices.every(p => pointInRing(p, s.outline.map(id => level.points.find(point => point.id === id)!))));
  if (!surface) throw new Error('La escalera y su hueco deben caber en el piso del nivel superior.');
  surface.holes.push({ id: holeId, vertices, stairId: stair.id });
}
export function addStair(project: ProjectDocument, parameters: Partial<ProjectStair> & Pick<ProjectStair, 'fromLevelId' | 'toLevelId'>): ProjectDocument {
  return atomic(project, next => {
    const from = projectLevel(next, parameters.fromLevelId), to = projectLevel(next, parameters.toLevelId), stepCount = Math.ceil((to.elevation - from.elevation) / .18), outline = levelOutline(to);
    const minX = Math.min(...outline.map(p => p.x)), maxX = Math.max(...outline.map(p => p.x)), minZ = Math.min(...outline.map(p => p.z)), maxZ = Math.max(...outline.map(p => p.z)), horizontal = maxX - minX > maxZ - minZ;
    const stair: ProjectStair = { id: projectId(), type: 'straight', x: 0, z: 0, rotation: horizontal ? 90 : 0, width: .9, stepCount, run: stepCount * (parameters.type && parameters.type !== 'straight' ? .2 : .25), landingDepth: .9, innerRadius: .2, turns: 1, clockwise: true, thickness: .08, rails: 'both', hole: null, finish: whiteFinish(), ...parameters };
    if (parameters.x === undefined || parameters.z === undefined) {
      const proposal = buildStairGeometry(next, stair).hole, centerX = (Math.min(...proposal.map(p => p.x)) + Math.max(...proposal.map(p => p.x))) / 2, centerZ = (Math.min(...proposal.map(p => p.z)) + Math.max(...proposal.map(p => p.z))) / 2;
      if (parameters.x === undefined) stair.x += (minX + maxX) / 2 - centerX;
      if (parameters.z === undefined) stair.z += (minZ + maxZ) / 2 - centerZ;
    }
    next.stairs.push(stair); syncStairHole(next, stair);
  });
}
export function updateStair(project: ProjectDocument, id: string, patch: Partial<Omit<ProjectStair, 'id'>>): ProjectDocument { return atomic(project, next => { const stair = next.stairs.find(s => s.id === id); if (!stair) throw new Error('La escalera no existe.'); Object.assign(stair, patch); syncStairHole(next, stair); }); }
export function deleteStair(project: ProjectDocument, id: string): ProjectDocument { return atomic(project, next => { next.stairs = next.stairs.filter(s => s.id !== id); next.levels.forEach(level => level.surfaces.forEach(surface => { surface.holes = surface.holes.filter(h => h.stairId !== id); })); }); }
function defaultRoof(level: ProjectLevel): ParametricRoof { return { id: projectId(), levelId: level.id, type: 'flat', footprint: levelOutline(level), baseHeight: level.height, pitch: 0, overhang: 0, rotation: 0, thickness: .15, finish: whiteFinish(), undersideFinish: whiteFinish() }; }
export function addRoof(project: ProjectDocument, levelId: string, parameters: Partial<ParametricRoof> = {}): ProjectDocument { return atomic(project, next => { next.roofs.push({ ...defaultRoof(projectLevel(next, levelId)), ...parameters, levelId }); }); }
export function updateRoof(project: ProjectDocument, id: string, patch: Partial<ProjectRoof>): ProjectDocument { return atomic(project, next => { const index = next.roofs.findIndex(r => r.id === id); if (index < 0) throw new Error('El techo no existe.'); next.roofs[index] = { ...next.roofs[index], ...patch, id } as ProjectRoof; }); }
export function replaceRoofWithTemplate(project: ProjectDocument, id: string, type: ParametricRoof['type']): ProjectDocument { return atomic(project, next => { const index = next.roofs.findIndex(r => r.id === id); if (index < 0) throw new Error('El techo no existe.'); const old = next.roofs[index], level = projectLevel(next, old.levelId); next.roofs[index] = { ...defaultRoof(level), id: old.id, levelId: old.levelId, finish: structuredClone(old.finish), undersideFinish: structuredClone(old.undersideFinish), thickness: old.thickness, type, pitch: type === 'flat' ? 0 : 25 }; }); }
export function deleteRoof(project: ProjectDocument, id: string): ProjectDocument { return atomic(project, next => { next.roofs = next.roofs.filter(r => r.id !== id); }); }
export function convertRoofToMesh(project: ProjectDocument, id: string): ProjectDocument { return atomic(project, next => { const index = next.roofs.findIndex(r => r.id === id); if (index < 0) throw new Error('El techo no existe.'); next.roofs[index] = roofToMesh(next, next.roofs[index]); }); }
export function editRoofMesh(project: ProjectDocument, id: string, vertices: RoofVertex[], faces: RoofFace[]): ProjectDocument { return atomic(project, next => { const roof = next.roofs.find(r => r.id === id); if (!roof || roof.type !== 'mesh') throw new Error('Convierte el techo para editar sus vértices y caras.'); roof.vertices = structuredClone(vertices); roof.faces = structuredClone(faces); validateRoofMesh(roof, projectLevel(next, roof.levelId).height); }); }

/** One command is one undo step, including generated holes and all affected levels. */
export class ProjectHistory {
  private past: ProjectDocument[] = [];
  private future: ProjectDocument[] = [];
  constructor(private current: ProjectDocument, private readonly limit = 30, private readonly byteLimit = 16 * 1024 * 1024) { this.current = validateProjectDocument(current); }
  get value(): ProjectDocument { return structuredClone(this.current); }
  get canUndo(): boolean { return !!this.past.length; }
  get canRedo(): boolean { return !!this.future.length; }
  apply(operation: (project: ProjectDocument) => ProjectDocument): ProjectDocument { const next = validateProjectDocument(operation(this.value)); if (JSON.stringify(next) === JSON.stringify(this.current)) return this.value; this.past.push(this.current); this.current = next; this.future = []; while (this.past.length > this.limit || this.past.length && JSON.stringify(this.past).length * 2 > this.byteLimit) this.past.shift(); return this.value; }
  undo(): ProjectDocument { const previous = this.past.pop(); if (previous) { this.future.push(this.current); this.current = previous; } return this.value; }
  redo(): ProjectDocument { const next = this.future.pop(); if (next) { this.past.push(this.current); this.current = next; } return this.value; }
}
