import { ShapeUtils, Vector2 } from 'three';
import polygonClipping from 'polygon-clipping';
import { expandedRoofFootprint, projectLevel, wallEndpoints, signedRingArea, type ProjectDocument, type ProjectRoof, type ProjectStair, type ProjectSurface, type ProjectLevel, type MeshRoof } from './projectDocument.js';
import type { Point } from './types.js';

export type Vec3 = { x: number; y: number; z: number };
export type Triangle3 = [Vec3, Vec3, Vec3];
export type GeometryBox = { id: string; center: Vec3; size: Vec3; rotation: number };
export type WalkPathPoint = Vec3 & { width: number };
export type WalkSurface = { id: string; levelId: string; vertices: Vec3[]; neighbors: string[]; kind: 'floor' | 'stair' | 'landing'; holes?: Point[][]; stairId?: string };
export type StairGeometry = { steps: GeometryBox[]; rails: GeometryBox[]; path: WalkPathPoint[]; hole: Point[]; surfaces: WalkSurface[]; triangles: Triangle3[] };
export type RoofGeometry = { vertices: Vec3[]; triangles: [number, number, number][]; underside: Triangle3[]; uvs: [number, number][] };

const EPS = 1e-7;
const localToWorld = (p: Vec3, x: number, z: number, degrees: number): Vec3 => { const angle = degrees * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle); return { x: x + p.x * c + p.z * s, y: p.y, z: z - p.x * s + p.z * c }; };
export function triangulatePolygon(outline: Point[], holes: Point[][] = []): { points: Point[]; triangles: [number, number, number][] } {
  const points = [...outline, ...holes.flat()];
  return { points, triangles: ShapeUtils.triangulateShape(outline.map(p => new Vector2(p.x, p.z)), holes.map(ring => ring.map(p => new Vector2(p.x, p.z)))).map(face => face as [number, number, number]) };
}
export function surfaceGeometry(level: ProjectLevel, surface: ProjectSurface): { vertices: Vec3[]; triangles: [number, number, number][] } {
  const outline = surface.outline.map(id => level.points.find(p => p.id === id)!);
  const { points, triangles } = triangulatePolygon(outline, surface.holes.map(h => h.vertices));
  return { vertices: points.map(p => ({ ...p, y: level.elevation + surface.elevation })), triangles: triangles.map(([a, b, c]) => [c, b, a]) };
}
function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.z - b.z).filter((p, i, a) => !i || Math.hypot(p.x - a[i - 1].x, p.z - a[i - 1].z) > EPS);
  const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const lower: Point[] = [], upper: Point[] = [];
  for (const p of sorted) { while (lower.length > 1 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= EPS) lower.pop(); lower.push(p); }
  for (const p of [...sorted].reverse()) { while (upper.length > 1 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= EPS) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].map(p => ({ x: p.x, z: p.z }));
}
function boxTriangles(center: Vec3, size: Vec3, rotation: number): Triangle3[] {
  const vertices = [-1, 1].flatMap(y => [-1, 1].flatMap(z => [-1, 1].map(x => localToWorld({ x: x * size.x / 2, y: center.y + y * size.y / 2, z: z * size.z / 2 }, center.x, center.z, rotation))));
  return [[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1], [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]].map(face => face.map(i => vertices[i]) as Triangle3);
}
/** Visible treads and a separate, connected walking ramp share the same dimensions. */
export function buildStairGeometry(project: ProjectDocument, stair: ProjectStair): StairGeometry {
  const from = projectLevel(project, stair.fromLevelId), to = projectLevel(project, stair.toLevelId), rise = to.elevation - from.elevation;
  const geometry: StairGeometry = { steps: [], rails: [], path: [], hole: [], surfaces: [], triangles: [] };
  const world = (p: Vec3) => localToWorld({ ...p, y: p.y + from.elevation }, stair.x, stair.z, stair.rotation);
  const half = stair.width / 2;
  const addSurface = (vertices: Vec3[], kind: 'stair' | 'landing', suffix: string) => { const id = `${stair.id}:${suffix}`; const previous = geometry.surfaces.at(-1); const surface: WalkSurface = { id, levelId: from.id, vertices: vertices.map(world), neighbors: previous ? [previous.id] : [], kind, stairId: stair.id }; if (previous) previous.neighbors.push(id); geometry.surfaces.push(surface); };
  if (stair.type === 'spiral') {
    const direction = stair.clockwise ? 1 : -1, total = Math.PI * 2 * stair.turns * direction, radius = stair.innerRadius + half;
    for (let i = 0; i <= stair.stepCount; i++) { const angle = total * i / stair.stepCount; geometry.path.push({ ...world({ x: Math.cos(angle) * radius, y: rise * i / stair.stepCount, z: Math.sin(angle) * radius }), width: stair.width }); }
    for (let i = 0; i < stair.stepCount; i++) {
      const a = total * i / stair.stepCount, b = total * (i + 1) / stair.stepCount, h0 = rise * i / stair.stepCount, h1 = rise * (i + 1) / stair.stepCount;
      const point = (angle: number, radius: number, y: number) => ({ x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius });
      addSurface([point(a, stair.innerRadius, h0), point(a, stair.innerRadius + stair.width, h0), point(b, stair.innerRadius + stair.width, h1), point(b, stair.innerRadius, h1)], 'stair', `step-${i}`);
      const top = [point(a, stair.innerRadius, h1), point(a, stair.innerRadius + stair.width, h1), point(b, stair.innerRadius + stair.width, h1), point(b, stair.innerRadius, h1)].map(world);
      const bottom = top.map(p => ({ ...p, y: p.y - stair.thickness }));
      for (const face of [[0, 1, 2], [0, 2, 3], [4, 6, 5], [4, 7, 6], [0, 4, 5], [0, 5, 1], [1, 5, 6], [1, 6, 2], [2, 6, 7], [2, 7, 3], [3, 7, 4], [3, 4, 0]]) geometry.triangles.push(face.map(index => [...top, ...bottom][index]) as Triangle3);
    }
    const radiusHole = stair.innerRadius + stair.width;
    geometry.hole = Array.from({ length: 48 }, (_, i) => { const p = world({ x: Math.cos(i * Math.PI / 24) * radiusHole, y: 0, z: Math.sin(i * Math.PI / 24) * radiusHole }); return { x: p.x, z: p.z }; });
  } else {
    const n1 = Math.floor(stair.stepCount / 2), n2 = stair.stepCount - n1, firstRun = stair.run * n1 / stair.stepCount, secondRun = stair.run - firstRun, midHeight = rise * n1 / stair.stepCount;
    type Flight = { start: Vec3; direction: Point; run: number; count: number; low: number; high: number };
    const flights: Flight[] = stair.type === 'straight' ? [{ start: { x: 0, y: 0, z: 0 }, direction: { x: 0, z: 1 }, run: stair.run, count: stair.stepCount, low: 0, high: rise }] : [{ start: { x: 0, y: 0, z: 0 }, direction: { x: 0, z: 1 }, run: firstRun, count: n1, low: 0, high: midHeight }];
    if (stair.type !== 'straight') {
      const start: Vec3 = stair.type === 'u' ? { x: stair.width + stair.landingDepth, y: midHeight, z: firstRun } : stair.type === 'l' ? { x: stair.landingDepth, y: midHeight, z: firstRun + stair.landingDepth } : { x: 0, y: midHeight, z: firstRun + stair.landingDepth };
      flights.push({ start, direction: stair.type === 'u' ? { x: 0, z: -1 } : stair.type === 'l' ? { x: 1, z: 0 } : { x: 0, z: 1 }, run: secondRun, count: n2, low: midHeight, high: rise });
    }
    flights.forEach((flight, flightIndex) => {
      if (flightIndex) {
        const previous = flights[flightIndex - 1], end = { x: previous.start.x + previous.direction.x * previous.run, y: midHeight, z: previous.start.z + previous.direction.z * previous.run };
        const minX = Math.min(end.x, flight.start.x) - half, maxX = Math.max(end.x, flight.start.x) + half, minZ = Math.min(end.z, flight.start.z) - half, maxZ = Math.max(end.z, flight.start.z) + half;
        const vertices = [{ x: minX, y: midHeight, z: minZ }, { x: maxX, y: midHeight, z: minZ }, { x: maxX, y: midHeight, z: maxZ }, { x: minX, y: midHeight, z: maxZ }]; addSurface(vertices, 'landing', 'landing');
        const center = world({ x: (minX + maxX) / 2, y: midHeight - stair.thickness / 2, z: (minZ + maxZ) / 2 }), size = { x: maxX - minX, y: stair.thickness, z: maxZ - minZ };
        const box = { id: `${stair.id}:landing`, center, size, rotation: stair.rotation }; geometry.steps.push(box); geometry.triangles.push(...boxTriangles(center, size, stair.rotation));
        geometry.path.push({ ...world(flight.start), width: stair.width });
      }
      for (let i = 0; i <= flight.count; i++) {
        const t = i / flight.count, p = { x: flight.start.x + flight.direction.x * flight.run * t, y: flight.low + (flight.high - flight.low) * t, z: flight.start.z + flight.direction.z * flight.run * t };
        geometry.path.push({ ...world(p), width: stair.width });
        if (i === flight.count) break;
        const next = { x: p.x + flight.direction.x * flight.run / flight.count, y: flight.low + (flight.high - flight.low) * (i + 1) / flight.count, z: p.z + flight.direction.z * flight.run / flight.count };
        const dx = flight.direction.z * half, dz = -flight.direction.x * half;
        addSurface([{ x: p.x - dx, y: p.y, z: p.z - dz }, { x: p.x + dx, y: p.y, z: p.z + dz }, { x: next.x + dx, y: next.y, z: next.z + dz }, { x: next.x - dx, y: next.y, z: next.z - dz }], 'stair', `${flightIndex}-${i}`);
        const center = world({ x: (p.x + next.x) / 2, y: next.y - stair.thickness / 2, z: (p.z + next.z) / 2 }), size = { x: stair.width, y: stair.thickness, z: flight.run / flight.count };
        const rotation = stair.rotation + Math.atan2(flight.direction.x, flight.direction.z) * 180 / Math.PI;
        geometry.steps.push({ id: `${stair.id}:tread-${flightIndex}-${i}`, center, size, rotation }); geometry.triangles.push(...boxTriangles(center, size, rotation));
      }
    });
    geometry.hole = convexHull(geometry.surfaces.flatMap(surface => surface.vertices));
  }
  // Landings extend the traversal beyond the slab cut, so the final tread can actually reach the upper floor.
  const start = geometry.path[0], end = geometry.path.at(-1)!;
  const appendLanding = (at: WalkPathPoint, direction: Point, levelId: string, first: boolean) => {
    const length = Math.hypot(direction.x, direction.z), dx = direction.x / length, dz = direction.z / length, half = stair.width / 2, extension = first && stair.type === 'spiral' ? half + .35 : .45;
    const outer = { x: at.x + dx * extension, y: at.y, z: at.z + dz * extension }, vertices = [{ x: at.x - dz * half, y: at.y, z: at.z + dx * half }, { x: at.x + dz * half, y: at.y, z: at.z - dx * half }, { x: outer.x + dz * half, y: at.y, z: outer.z - dx * half }, { x: outer.x - dz * half, y: at.y, z: outer.z + dx * half }];
    const adjacent = first ? geometry.surfaces[0] : geometry.surfaces.at(-1)!;
    const surface: WalkSurface = { id: `${stair.id}:${first ? 'entry' : 'exit'}`, levelId, vertices, neighbors: [adjacent.id], kind: 'landing', stairId: stair.id }; adjacent.neighbors.push(surface.id);
    if (first) geometry.surfaces.unshift(surface); else geometry.surfaces.push(surface);
    if (first) geometry.path.unshift({ ...outer, width: stair.width }); else geometry.path.push({ ...outer, width: stair.width });
    const rotation = Math.atan2(dx, dz) * 180 / Math.PI, center = { x: (at.x + outer.x) / 2, y: at.y - stair.thickness / 2, z: (at.z + outer.z) / 2 }, size = { x: stair.width, y: stair.thickness, z: extension };
    geometry.steps.push({ id: surface.id, center, size, rotation }); geometry.triangles.push(...boxTriangles(center, size, rotation));
  };
  if (stair.type === 'spiral') {
    // Use radial landings; the upper exit spans the outer rim of the circular aperture.
    const at = { ...end }, radius = Math.hypot(end.x - stair.x, end.z - stair.z), dx = (end.x - stair.x) / radius, dz = (end.z - stair.z) / radius;
    const outer = { ...at, x: at.x + dx * (half + .25), z: at.z + dz * (half + .25) };
    const adjacent = geometry.surfaces.at(-1)!, vertices = [{ x: at.x - dz * half, y: at.y, z: at.z + dx * half }, { x: at.x + dz * half, y: at.y, z: at.z - dx * half }, { x: outer.x + dz * half, y: at.y, z: outer.z - dx * half }, { x: outer.x - dz * half, y: at.y, z: outer.z + dx * half }];
    const surface: WalkSurface = { id: `${stair.id}:exit`, levelId: to.id, vertices, neighbors: [adjacent.id], kind: 'landing', stairId: stair.id }; adjacent.neighbors.push(surface.id); geometry.surfaces.push(surface); geometry.path.push({ ...outer, width: stair.width });
    const center = { x: (at.x + outer.x) / 2, y: at.y - stair.thickness / 2, z: (at.z + outer.z) / 2 }, size = { x: stair.width, y: stair.thickness, z: half + .25 }, rotation = Math.atan2(dx, dz) * 180 / Math.PI;
    geometry.steps.push({ id: surface.id, center, size, rotation }); geometry.triangles.push(...boxTriangles(center, size, rotation));
    const radiusStart = Math.hypot(start.x - stair.x, start.z - stair.z); appendLanding(start, { x: (start.x - stair.x) / radiusStart, z: (start.z - stair.z) / radiusStart }, from.id, true);
  } else {
    const second = geometry.path[1], beforeEnd = geometry.path.at(-2)!;
    appendLanding(start, { x: start.x - second.x, z: start.z - second.z }, from.id, true);
    appendLanding(end, { x: end.x - beforeEnd.x, z: end.z - beforeEnd.z }, to.id, false);
  }
  // Rails are separate from the treads so renderers can use their own material and quality budget.
  if (stair.rails !== 'none') for (let i = 0; i < geometry.path.length - 1; i++) {
    const a = geometry.path[i], b = geometry.path[i + 1], length = Math.hypot(b.x - a.x, b.z - a.z); if (length < EPS) continue;
    const sideX = (b.z - a.z) / length * half, sideZ = -(b.x - a.x) / length * half;
    for (const side of [-1, 1]) if (stair.rails === 'both' || stair.rails === (side < 0 ? 'left' : 'right')) {
      const center = { x: (a.x + b.x) / 2 + sideX * side, y: (a.y + b.y) / 2 + .95, z: (a.z + b.z) / 2 + sideZ * side };
      geometry.rails.push({ id: `${stair.id}:rail-${i}-${side}`, center, size: { x: .04, y: .04, z: length + .02 }, rotation: Math.atan2(b.x - a.x, b.z - a.z) * 180 / Math.PI });
      geometry.rails.push({ id: `${stair.id}:post-${i}-${side}`, center: { x: a.x + sideX * side, y: a.y + .475, z: a.z + sideZ * side }, size: { x: .04, y: .95, z: .04 }, rotation: 0 });
    }
  }
  return geometry;
}

/** Closed roof solids, with the actual underside exposed to rendering and headroom queries. */
export function buildRoofGeometry(project: ProjectDocument, roof: ProjectRoof): RoofGeometry {
  const level = projectLevel(project, roof.levelId);
  const result: RoofGeometry = { vertices: [], triangles: [], underside: [], uvs: [] };
  const addTriangle = (a: Vec3, b: Vec3, c: Vec3, underside = false) => {
    const index = result.vertices.length; result.vertices.push(a, b, c);
    const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
    const normal = { x: uy * vz - uz * vy, y: uz * vx - ux * vz, z: ux * vy - uy * vx }, length = Math.hypot(normal.x, normal.y, normal.z) || 1; normal.x /= length; normal.y /= length; normal.z /= length;
    // World-anchored planar UVs measure real meters, including pitch and fascia; coplanar triangles share a basis.
    const axis = Math.abs(normal.x) < .95 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 }, dot = axis.x * normal.x + axis.y * normal.y + axis.z * normal.z;
    const u = { x: axis.x - normal.x * dot, y: axis.y - normal.y * dot, z: axis.z - normal.z * dot }, uLength = Math.hypot(u.x, u.y, u.z) || 1; u.x /= uLength; u.y /= uLength; u.z /= uLength;
    const v = { x: normal.y * u.z - normal.z * u.y, y: normal.z * u.x - normal.x * u.z, z: normal.x * u.y - normal.y * u.x };
    for (const p of [a, b, c]) result.uvs.push([p.x * u.x + p.y * u.y + p.z * u.z, p.x * v.x + p.y * v.y + p.z * v.z]);
    result.triangles.push([index, index + 1, index + 2]); if (underside) result.underside.push([a, b, c]);
  };
  if (roof.type === 'mesh') {
    const map = new Map(roof.vertices.map(p => [p.id, { x: p.x, y: p.y + level.elevation, z: p.z }]));
    for (const face of roof.faces) { const [a, b, c] = face.vertexIds.map(id => map.get(id)!); const normalY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z); addTriangle(a, b, c, normalY < -EPS); }
    return result;
  }
  const outline = expandedRoofFootprint(roof.footprint, roof.overhang), angle = roof.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle), slope = Math.tan(roof.pitch * Math.PI / 180);
  const coordinates = outline.map(p => ({ x: p.x * c - p.z * s, z: p.x * s + p.z * c }));
  const min = Math.min(...coordinates.map(p => p.x)), max = Math.max(...coordinates.map(p => p.x)), ridge = (min + max) / 2;
  const heightAt = (p: Point) => roof.baseHeight + (roof.type === 'flat' ? 0 : roof.type === 'shed' ? (p.x * c - p.z * s - min) * slope : roof.type === 'gable' ? (Math.min(p.x * c - p.z * s - min, max - (p.x * c - p.z * s))) * slope : Math.min(...outline.map((a, i) => { const b = outline[(i + 1) % outline.length]; return Math.abs((b.x - a.x) * (a.z - p.z) - (a.x - p.x) * (b.z - a.z)) / Math.hypot(b.x - a.x, b.z - a.z); })) * slope);
  let pieces: Point[][] = [outline];
  if (roof.type === 'gable') {
    const local = (x: number, z: number): [number, number] => [x * c + z * s, -x * s + z * c];
    const half = (x0: number, x1: number) => [[local(x0, -200), local(x1, -200), local(x1, 200), local(x0, 200)]];
    const subject: [number, number][][] = [outline.map(p => [p.x, p.z])];
    pieces = [...polygonClipping.intersection(subject, half(-200, ridge)), ...polygonClipping.intersection(subject, half(ridge, 200))].map(polygon => polygon[0].slice(0, -1).map(([x, z]) => ({ x, z })));
  }
  if (roof.type === 'hip') {
    // Rectangular hips have a ridge, not a pyramidal approximation: divide by nearest eave using clipping.
    pieces = [];
    const center = { x: outline.reduce((s, p) => s + p.x, 0) / 4, z: outline.reduce((s, p) => s + p.z, 0) / 4 };
    const a = outline[0], b = outline[1], d = outline[3], w = Math.hypot(b.x - a.x, b.z - a.z), h = Math.hypot(d.x - a.x, d.z - a.z), axis = w >= h ? { x: (b.x - a.x) / w, z: (b.z - a.z) / w } : { x: (d.x - a.x) / h, z: (d.z - a.z) / h }, length = Math.abs(w - h) / 2;
    const r0 = { x: center.x - axis.x * length, z: center.z - axis.z * length }, r1 = { x: center.x + axis.x * length, z: center.z + axis.z * length };
    for (let i = 0; i < 4; i++) { const p = outline[i], q = outline[(i + 1) % 4], middle = { x: (p.x + q.x) / 2, z: (p.z + q.z) / 2 }; const nearest = Math.hypot(middle.x - r0.x, middle.z - r0.z) < Math.hypot(middle.x - r1.x, middle.z - r1.z) ? r0 : r1; const edgeLength = Math.hypot(p.x - q.x, p.z - q.z); pieces.push(Math.abs(edgeLength - Math.max(w, h)) < EPS && length > EPS ? [p, q, ...(Math.hypot(q.x - r0.x, q.z - r0.z) < Math.hypot(q.x - r1.x, q.z - r1.z) ? [r0, r1] : [r1, r0])] : [p, q, nearest]); }
  }
  for (const piece of pieces) {
    const { points, triangles } = triangulatePolygon(piece);
    for (const [i, j, k] of triangles) {
      const a = points[i], b = points[j], c = points[k], ay = level.elevation + heightAt(a), by = level.elevation + heightAt(b), cy = level.elevation + heightAt(c);
      // TriangulateShape operates in X/Z; reverse its top winding to face upward.
      addTriangle({ ...c, y: cy + roof.thickness }, { ...b, y: by + roof.thickness }, { ...a, y: ay + roof.thickness });
      addTriangle({ ...a, y: ay }, { ...b, y: by }, { ...c, y: cy }, true);
    }
  }
  for (let i = 0; i < outline.length; i++) {
    const start = outline[i], end = outline[(i + 1) % outline.length], dx = end.x - start.x, dz = end.z - start.z, length2 = dx * dx + dz * dz;
    const stops = [0, 1]; for (const p of pieces.flat()) { const along = ((p.x - start.x) * dx + (p.z - start.z) * dz) / length2, cross = dx * (p.z - start.z) - dz * (p.x - start.x); if (Math.abs(cross) < EPS && along > EPS && along < 1 - EPS) stops.push(along); }
    const sorted = stops.sort((a, b) => a - b).filter((t, i, all) => !i || t - all[i - 1] > EPS);
    for (let j = 0; j < sorted.length - 1; j++) { const a = { x: start.x + dx * sorted[j], z: start.z + dz * sorted[j] }, b = { x: start.x + dx * sorted[j + 1], z: start.z + dz * sorted[j + 1] }, ay = level.elevation + heightAt(a), by = level.elevation + heightAt(b); const p = { ...a, y: ay }, q = { ...b, y: by }, r = { ...b, y: by + roof.thickness }, t = { ...a, y: ay + roof.thickness }; if (signedRingArea(outline) > 0) { addTriangle(p, r, q); addTriangle(p, t, r); } else { addTriangle(p, q, r); addTriangle(p, r, t); } }
  }
  return result;
}

export function roofToMesh(project: ProjectDocument, roof: ProjectRoof): MeshRoof {
  if (roof.type === 'mesh') return structuredClone(roof);
  const geometry = buildRoofGeometry(project, roof), level = projectLevel(project, roof.levelId), ids = new Map<string, string>(), vertices: MeshRoof['vertices'] = [];
  const vertexId = (v: Vec3) => { const key = [v.x, v.y, v.z].map(n => n.toFixed(7)).join(':'); let id = ids.get(key); if (!id) { id = crypto.randomUUID(); ids.set(key, id); vertices.push({ id, x: v.x, y: v.y - level.elevation, z: v.z }); } return id; };
  return { id: roof.id, levelId: roof.levelId, type: 'mesh', thickness: roof.thickness, finish: structuredClone(roof.finish), undersideFinish: structuredClone(roof.undersideFinish), vertices, faces: geometry.triangles.map(triangle => ({ id: crypto.randomUUID(), vertexIds: triangle.map(i => vertexId(geometry.vertices[i])) })) };
}

export function roofHeightAt(triangles: Triangle3[], x: number, z: number, above = -Infinity): number | null {
  let height = Infinity;
  for (const [a, b, c] of triangles) { const den = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z); if (Math.abs(den) < EPS) continue; const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / den, v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / den; if (u < -EPS || v < -EPS || u + v > 1 + EPS) continue; const y = u * a.y + v * b.y + (1 - u - v) * c.y; if (y >= above - EPS) height = Math.min(height, y); }
  return Number.isFinite(height) ? height : null;
}

export function projectRoofUndersideAt(project: ProjectDocument, levelId: string, x: number, z: number): number | null { return roofHeightAt(project.roofs.filter(r => r.levelId === levelId).flatMap(r => buildRoofGeometry(project, r).underside), x, z); }

/** Per-wall maximum height follows the real roof skin; renderer may sample the endpoints/ridge intersections. */
export function wallRoofProfile(project: ProjectDocument, levelId: string, wallId: string, preparedUnderside?: Triangle3[]): { t: number; height: number }[] {
  const level = projectLevel(project, levelId), wall = level.walls.find(w => w.id === wallId); if (!wall) return [];
  const [a, b] = wallEndpoints(level, wall), boundary = level.outline.some((id, i) => id === a.id && level.outline[(i + 1) % level.outline.length] === b.id || id === b.id && level.outline[(i + 1) % level.outline.length] === a.id);
  if (!boundary || Math.abs(wall.height - level.height) > EPS) return [{ t: 0, height: wall.height }, { t: 1, height: wall.height }];
  const roofs = preparedUnderside ?? project.roofs.filter(r => r.levelId === levelId).flatMap(r => buildRoofGeometry(project, r).underside);
  const values = new Set([0, 1]);
  for (const triangle of roofs) for (let i = 0; i < 3; i++) { const c = triangle[i], d = triangle[(i + 1) % 3], dx = b.x - a.x, dz = b.z - a.z, ex = d.x - c.x, ez = d.z - c.z, den = dx * ez - dz * ex; if (Math.abs(den) < EPS) continue; const t = ((c.x - a.x) * ez - (c.z - a.z) * ex) / den, u = ((c.x - a.x) * dz - (c.z - a.z) * dx) / den; if (t > EPS && t < 1 - EPS && u >= -EPS && u <= 1 + EPS) values.add(t); }
  return [...values].sort((a, b) => a - b).map(t => ({ t, height: (roofHeightAt(roofs, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t) ?? level.elevation + wall.height) - level.elevation }));
}
export function wallTopProfile(project: ProjectDocument, levelId: string, wallId: string): { offset: number; height: number }[] { const level = projectLevel(project, levelId), wall = level.walls.find(w => w.id === wallId); if (!wall) return []; const [a, b] = wallEndpoints(level, wall), length = Math.hypot(a.x - b.x, a.z - b.z); return wallRoofProfile(project, levelId, wallId).map(({ t, height }) => ({ offset: t * length, height })); }
