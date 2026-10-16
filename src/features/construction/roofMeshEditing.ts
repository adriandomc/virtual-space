import { Matrix4, MathUtils, Vector3 } from 'three';
import type { RoofVertex } from '../../domain/project/projectDocument';

/** Gizmo changes are a draft; stable vertex IDs and untouched vertices retain their identity. */
export function transformRoofVertices(vertices: RoofVertex[], selectedIds: readonly string[], delta: Matrix4, maximumHeight = 28): RoofVertex[] {
  const selected = new Set(selectedIds);
  return vertices.map(vertex => {
    if (!selected.has(vertex.id)) return vertex;
    const point = new Vector3(vertex.x, vertex.y, vertex.z).applyMatrix4(delta);
    if (![point.x, point.y, point.z].every(Number.isFinite)) return vertex;
    return { id: vertex.id, x: MathUtils.clamp(point.x, -50, 50), y: MathUtils.clamp(point.y, .1, maximumHeight), z: MathUtils.clamp(point.z, -50, 50) };
  });
}
