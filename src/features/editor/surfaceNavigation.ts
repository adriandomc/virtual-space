import type { ProjectLevel } from '../../domain/project/projectDocument';
import type { Point } from '../../domain/project/types';

export function surfaceMap(level: ProjectLevel) {
  const width = 280, height = 180, padding = 25;
  const xs = level.points.map(point => point.x), zs = level.points.map(point => point.z);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const scale = Math.min((width - padding * 2) / Math.max(.01, maxX - minX), (height - padding * 2) / Math.max(.01, maxZ - minZ));
  const position = (point: Point) => ({ x: width / 2 + (point.x - (minX + maxX) / 2) * scale, z: height / 2 + (point.z - (minZ + maxZ) / 2) * scale });
  const points = new Map(level.points.map(point => [point.id, point]));
  return {
    width, height,
    walls: level.walls.map((wall, index) => {
      const start = points.get(wall.startId)!, end = points.get(wall.endId)!;
      return { id: wall.id, index, start: position(start), end: position(end), length: Math.hypot(end.x - start.x, end.z - start.z) };
    }),
    floors: level.surfaces.filter(surface => surface.kind === 'floor').map(surface => ({
      id: surface.id, color: surface.finish.color,
      path: [surface.outline.map(id => points.get(id)!), ...surface.holes.map(hole => hole.vertices)].map(ring => ring.map((point, index) => { const p = position(point); return `${index ? 'L' : 'M'} ${p.x} ${p.z}`; }).join(' ') + ' Z').join(' '),
    })),
  };
}

export function closestSurfaceWall(map: ReturnType<typeof surfaceMap>, point: Point, tolerance: number) {
  let closest: (typeof map.walls)[number] | undefined, distance = tolerance;
  for (const wall of map.walls) {
    const dx = wall.end.x - wall.start.x, dz = wall.end.z - wall.start.z, squared = dx * dx + dz * dz;
    const ratio = squared ? Math.max(0, Math.min(1, ((point.x - wall.start.x) * dx + (point.z - wall.start.z) * dz) / squared)) : 0;
    const next = Math.hypot(point.x - wall.start.x - dx * ratio, point.z - wall.start.z - dz * ratio);
    if (next <= distance) { distance = next; closest = wall; }
  }
  return closest;
}
