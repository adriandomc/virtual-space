import polygonClipping, { type Pair } from 'polygon-clipping';
import { pointInRing, type ProjectLevel } from './projectDocument';
import type { Point } from './types';

const ring = (points: Point[]): Pair[] => points.map(point => [point.x, point.z]);
export function planFloorRegions(level: ProjectLevel) {
  return level.surfaces.filter(surface => surface.kind === 'floor').sort((a, b) => a.elevation - b.elevation).map(surface => ({ surface, outline: surface.outline.map(id => level.points.find(point => point.id === id)!), holes: surface.holes.map(hole => hole.vertices) }));
}

/** Region partition rings are not apertures when another floor fills their area. */
export function planVisibleHoles(level: ProjectLevel) {
  const floors = planFloorRegions(level);
  return floors.flatMap(({ surface }) => surface.holes.flatMap(hole => {
    const other = floors.filter(region => region.surface.id !== surface.id && region.surface.elevation >= surface.elevation - 1e-7);
    const partitionFill = other.filter(region => region.outline.every(point => pointInRing(point, hole.vertices)));
    if (partitionFill.length && !polygonClipping.difference([ring(hole.vertices)], ...partitionFill.map(region => [ring(region.outline)])).length) return [];
    const polygons = other.length ? polygonClipping.difference([ring(hole.vertices)], ...other.map(region => [ring(region.outline), ...region.holes.map(ring)])) : [[ring(hole.vertices)]];
    if (!polygons.length) return [];
    return [{ surfaceId: surface.id, hole, polygons: polygons.map(polygon => polygon.map(points => points.map(([x, z]) => ({ x, z })))) }];
  }));
}
