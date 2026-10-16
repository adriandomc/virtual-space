import { buildRoofGeometry, buildStairGeometry, roofHeightAt, triangulatePolygon, type Triangle3, type Vec3, type WalkSurface } from '../../domain/project/projectGeometry.js';
import { levelOutline, pointInRing, projectLevel, segmentDistance, wallEndpoints, type ProjectDocument, type ProjectFurniture, type ProjectLevel, type ProjectWall } from '../../domain/project/projectDocument.js';
import type { Point } from '../../domain/project/types.js';

export type WalkState = Vec3 & { surfaceId: string; levelId: string; eyeY: number; blocked: boolean };
export type NavigationOptions = { radius?: number; height?: number; eyeHeight?: number; maxStep?: number };
type CachedSurface = WalkSurface & { triangles: Triangle3[]; minX: number; maxX: number; minZ: number; maxZ: number };
type WallCollider = { level: ProjectLevel; wall: ProjectWall; a: Point; b: Point; minX: number; maxX: number; minZ: number; maxZ: number };
type FurnitureCollider = { level: ProjectLevel; item: ProjectFurniture; minX: number; maxX: number; minZ: number; maxZ: number };
const EPS = 1e-6;
const CELL = 4;
function bounds(points: Point[]) { return { minX: Math.min(...points.map(p => p.x)), maxX: Math.max(...points.map(p => p.x)), minZ: Math.min(...points.map(p => p.z)), maxZ: Math.max(...points.map(p => p.z)) }; }
function triangleHeight([a, b, c]: Triangle3, p: Point): number | null { const den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z); if (Math.abs(den) < EPS) return null; const u = ((b.z - c.z) * (p.x - c.x) + (c.x - b.x) * (p.z - c.z)) / den, v = ((c.z - a.z) * (p.x - c.x) + (a.x - c.x) * (p.z - c.z)) / den; return u >= -EPS && v >= -EPS && u + v <= 1 + EPS ? u * a.y + v * b.y + (1 - u - v) * c.y : null; }
function heightOn(surface: CachedSurface, point: Point): number | null { if (point.x < surface.minX - EPS || point.x > surface.maxX + EPS || point.z < surface.minZ - EPS || point.z > surface.maxZ + EPS) return null; if (surface.holes?.some(hole => pointInRing(point, hole))) return null; for (const triangle of surface.triangles) { const y = triangleHeight(triangle, point); if (y !== null) return y; } return null; }
function cacheSurface(surface: WalkSurface): CachedSurface {
  const { points, triangles } = triangulatePolygon(surface.vertices, surface.holes);
  const vertices = points.map(p => { const original = surface.vertices.find(v => Math.hypot(v.x - p.x, v.z - p.z) < EPS); return original ?? { ...p, y: surface.vertices[0].y }; });
  return { ...surface, ...bounds(surface.vertices), triangles: triangles.map(t => t.map(i => vertices[i]) as Triangle3) };
}
class SpatialIndex<T extends { minX: number; maxX: number; minZ: number; maxZ: number }> {
  private cells = new Map<string, T[]>();
  add(item: T): void { for (let x = Math.floor(item.minX / CELL); x <= Math.floor(item.maxX / CELL); x++) for (let z = Math.floor(item.minZ / CELL); z <= Math.floor(item.maxZ / CELL); z++) { const key = `${x}:${z}`, values = this.cells.get(key) ?? []; values.push(item); this.cells.set(key, values); } }
  near(point: Point, radius: number): T[] { const values = new Set<T>(); for (let x = Math.floor((point.x - radius) / CELL); x <= Math.floor((point.x + radius) / CELL); x++) for (let z = Math.floor((point.z - radius) / CELL); z <= Math.floor((point.z + radius) / CELL); z++) for (const item of this.cells.get(`${x}:${z}`) ?? []) values.add(item); return [...values]; }
}

/** Derived, disposable navigation data; never write it into a project or a Yjs document. */
export class ArchitecturalNavigation {
  readonly radius: number;
  readonly height: number;
  readonly eyeHeight: number;
  readonly maxStep: number;
  private surfaces = new Map<string, CachedSurface>();
  private walls = new SpatialIndex<WallCollider>();
  private furniture = new SpatialIndex<FurnitureCollider>();
  private overhead: Triangle3[] = [];
  private stairCeilings: { stairId: string; triangles: Triangle3[] }[] = [];
  constructor(private readonly project: ProjectDocument, options: NavigationOptions = {}) {
    this.radius = options.radius ?? .18; this.height = options.height ?? 1.7; this.eyeHeight = options.eyeHeight ?? 1.6; this.maxStep = options.maxStep ?? .25;
    for (const level of project.levels) {
      for (const surface of level.surfaces) {
        const vertices = surface.outline.map(id => { const p = level.points.find(p => p.id === id)!; return { x: p.x, y: level.elevation + surface.elevation, z: p.z }; });
        if (surface.kind === 'floor') { const support = cacheSurface({ id: surface.id, levelId: level.id, vertices, holes: surface.holes.map(h => h.vertices), neighbors: [], kind: 'floor' }); this.surfaces.set(support.id, support); }
        if (level.elevation > 0 || surface.kind === 'ceiling') { const y = level.elevation + surface.elevation - (surface.kind === 'floor' ? surface.thickness : 0), { points, triangles } = triangulatePolygon(vertices, surface.holes.map(h => h.vertices)); this.overhead.push(...triangles.map(t => t.map(i => ({ ...points[i], y })) as Triangle3)); }
      }
      for (const wall of level.walls) { const [a, b] = wallEndpoints(level, wall), margin = Math.max(wall.thickness / 2, ...level.openings.filter(o => o.wallId === wall.id && o.type === 'door' && o.open).map(o => o.width)); this.walls.add({ level, wall, a, b, minX: Math.min(a.x, b.x) - margin, maxX: Math.max(a.x, b.x) + margin, minZ: Math.min(a.z, b.z) - margin, maxZ: Math.max(a.z, b.z) + margin }); }
      for (const item of level.furniture) { const radius = Math.hypot(item.width, item.depth) / 2; this.furniture.add({ level, item, minX: item.x - radius, maxX: item.x + radius, minZ: item.z - radius, maxZ: item.z + radius }); }
    }
    for (const roof of project.roofs) this.overhead.push(...buildRoofGeometry(project, roof).underside);
    for (const stair of project.stairs) {
      const geometry = buildStairGeometry(project, stair);
      for (const surface of geometry.surfaces) this.surfaces.set(surface.id, cacheSurface(surface));
      this.stairCeilings.push({ stairId: stair.id, triangles: geometry.triangles });
      const first = geometry.surfaces[0], last = geometry.surfaces.at(-1); if (!first || !last) continue;
      const link = (support: WalkSurface, levelId: string) => { for (const floor of this.surfaces.values()) if (floor.kind === 'floor' && floor.levelId === levelId) { this.surfaces.get(support.id)!.neighbors.push(floor.id); floor.neighbors.push(support.id); } };
      link(first, stair.fromLevelId); link(last, stair.toLevelId);
    }
    // Adjacent room surfaces are connected, while stacked floors never connect by X/Z alone.
    const floors = [...this.surfaces.values()].filter(s => s.kind === 'floor');
    for (let i = 0; i < floors.length; i++) for (let j = i + 1; j < floors.length; j++) if (floors[i].levelId === floors[j].levelId && Math.abs(floors[i].vertices[0].y - floors[j].vertices[0].y) < EPS) { floors[i].neighbors.push(floors[j].id); floors[j].neighbors.push(floors[i].id); }
  }
  headroom(point: Vec3, stairId?: string): number {
    let ceiling = Infinity;
    // Capsule footprint samples catch sloping roofs over a shoulder as well as directly above the eye.
    for (const sample of [{ x: 0, z: 0 }, { x: this.radius, z: 0 }, { x: -this.radius, z: 0 }, { x: 0, z: this.radius }, { x: 0, z: -this.radius }]) {
      const x = point.x + sample.x, z = point.z + sample.z, y = roofHeightAt(this.overhead, x, z, point.y + .03);
      if (y !== null) ceiling = Math.min(ceiling, y - point.y);
      for (const stair of this.stairCeilings) if (stair.stairId !== stairId) { const y = roofHeightAt(stair.triangles, x, z, point.y + .03); if (y !== null) ceiling = Math.min(ceiling, y - point.y); }
    }
    return ceiling;
  }
  hasSurface(id: string): boolean { return this.surfaces.has(id); }
  private blocked(point: Vec3, support: CachedSurface): boolean {
    if (this.headroom(point, support.stairId) < this.height - EPS) return true;
    for (const collider of this.walls.near(point, this.radius)) {
      const { level, wall, a, b } = collider; if (point.y + this.height <= level.elevation || point.y >= level.elevation + wall.height - EPS) continue;
      const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz), along = ((point.x - a.x) * dx + (point.z - a.z) * dz) / length;
      for (const door of level.openings.filter(o => o.wallId === wall.id && o.type === 'door' && o.open && o.doorStyle !== 'frame')) {
        const direction = door.doorStyle === 'left' ? -1 : 1, normal = { x: -dz / length, z: dx / length }, midpoint = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, innerSide = pointInRing({ x: midpoint.x + normal.x * .01, z: midpoint.z + normal.z * .01 }, levelOutline(level)) ? 1 : -1;
        const frame = .055, hingeOffset = door.offset + (direction === 1 ? frame : door.width - frame), angle = direction * innerSide * -Math.PI * .4;
        const hinge = { x: a.x + dx / length * hingeOffset + normal.x * innerSide * wall.thickness / 2, z: a.z + dz / length * hingeOffset + normal.z * innerSide * wall.thickness / 2 };
        const leafX = direction * (door.width - frame * 2) * Math.cos(angle), leafZ = -direction * (door.width - frame * 2) * Math.sin(angle), tip = { x: hinge.x + dx / length * leafX + normal.x * leafZ, z: hinge.z + dz / length * leafX + normal.z * leafZ };
        if (point.y < level.elevation + door.height && segmentDistance(point, hinge, tip) < this.radius + .025) return true;
      }
      if (segmentDistance(point, a, b) >= this.radius + wall.thickness / 2 - EPS) continue;
      const passage = level.openings.find(opening => opening.wallId === wall.id && opening.type === 'door' && (opening.doorStyle === 'frame' || opening.open) && along >= opening.offset + this.radius && along <= opening.offset + opening.width - this.radius && point.y >= level.elevation + opening.sill - .01 && point.y + this.height <= level.elevation + opening.sill + opening.height + EPS);
      if (!passage) return true;
    }
    for (const { item, level } of this.furniture.near(point, this.radius)) {
      if (point.y >= level.elevation + item.height - EPS || point.y + this.height <= level.elevation) continue;
      const angle = -item.rotation * Math.PI / 180, dx = point.x - item.x, dz = point.z - item.z, x = dx * Math.cos(angle) - dz * Math.sin(angle), z = dx * Math.sin(angle) + dz * Math.cos(angle);
      if (Math.abs(x) < item.width / 2 + this.radius && Math.abs(z) < item.depth / 2 + this.radius) return true;
    }
    // Keep the body on supported floor space; stair edges use their continuous corridor width.
    if (support.kind === 'floor') {
      const level = projectLevel(this.project, support.levelId), outline = levelOutline(level);
      if (outline.some((p, i) => segmentDistance(point, p, outline[(i + 1) % outline.length]) < this.radius - EPS)) return true;
      for (const hole of support.holes ?? []) if (hole.some((p, i) => segmentDistance(point, p, hole[(i + 1) % hole.length]) < this.radius - EPS) && !support.neighbors.some(id => { const candidate = this.surfaces.get(id); return candidate?.stairId && heightOn(candidate, point) !== null; })) return true;
    }
    return false;
  }
  start(levelId: string, preferred?: Point): WalkState | null {
    const level = projectLevel(this.project, levelId), outline = levelOutline(level), box = bounds(outline), candidates: Point[] = preferred ? [preferred] : [];
    candidates.push({ x: (box.minX + box.maxX) / 2, z: (box.minZ + box.maxZ) / 2 });
    for (let x = 1; x < 24; x++) for (let z = 1; z < 24; z++) candidates.push({ x: box.minX + (box.maxX - box.minX) * x / 24, z: box.minZ + (box.maxZ - box.minZ) * z / 24 });
    for (const p of candidates) for (const surface of this.surfaces.values()) if (surface.levelId === levelId) { const y = heightOn(surface, p); if (y === null || Math.abs(y - level.elevation) > this.maxStep) continue; const point = { ...p, y }; if (!this.blocked(point, surface)) return { ...point, surfaceId: surface.id, levelId, eyeY: y + this.eyeHeight, blocked: false }; }
    return null;
  }
  move(state: WalkState, delta: Point): WalkState {
    if (!Number.isFinite(delta.x) || !Number.isFinite(delta.z)) return { ...state, blocked: true };
    const distance = Math.hypot(delta.x, delta.z), steps = Math.max(1, Math.ceil(distance / Math.min(.06, this.radius / 2)));
    if (steps > 4096) return { ...state, blocked: true };
    let current = { ...state, blocked: false };
    for (let i = 0; i < steps; i++) {
      const support = this.surfaces.get(current.surfaceId); if (!support) return { ...current, blocked: true };
      const point = { x: current.x + delta.x / steps, z: current.z + delta.z / steps };
      const candidates = [support, ...support.neighbors.map(id => this.surfaces.get(id)!).filter(Boolean)];
      // A floor also exists below the first tread; entering its connected ramp must win over remaining on that floor.
      if (support.kind === 'floor') candidates.sort((a, b) => Number(!!b.stairId) - Number(!!a.stairId));
      else if (support.kind === 'landing') candidates.sort((a, b) => Number(b.kind === 'stair') - Number(a.kind === 'stair'));
      else candidates.sort((a, b) => {
        const ay = heightOn(a, point), by = heightOn(b, point);
        if (ay === null) return 1; if (by === null) return -1;
        if (a.id === support.id) return -1; if (b.id === support.id) return 1;
        return Math.abs(ay - current.y) - Math.abs(by - current.y);
      });
      let accepted = false;
      for (const surface of candidates) {
        const y = heightOn(surface, point); if (y === null || Math.abs(y - current.y) > this.maxStep + EPS) continue;
        const position = { ...point, y }; if (this.blocked(position, surface)) continue;
        let levelId = surface.levelId;
        if (surface.stairId) { const stair = this.project.stairs.find(s => s.id === surface.stairId)!; levelId = y >= projectLevel(this.project, stair.toLevelId).elevation - .01 ? stair.toLevelId : stair.fromLevelId; }
        current = { ...position, surfaceId: surface.id, levelId, eyeY: y + this.eyeHeight, blocked: false }; accepted = true; break;
      }
      if (!accepted) return { ...current, blocked: true };
    }
    return current;
  }
}
