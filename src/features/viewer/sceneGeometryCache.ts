import { stableStringify } from '../../shared/sameData';
import { buildRoofGeometry, type RoofGeometry } from '../../domain/project/projectGeometry';
import { projectLevel, type ProjectDocument, type ProjectRoof } from '../../domain/project/projectDocument';

// Only derived, immutable CPU data. Originals remain in the v3 document and are never evicted.
const roofs = new Map<string, { value: RoofGeometry; bytes: number }>();
let bytes = 0;
const MAX_BYTES = 8 * 1024 * 1024;
export function cachedRoofGeometry(project: ProjectDocument, roof: ProjectRoof) {
  const { finish: _finish, undersideFinish: _underside, ...shape } = roof;
  const key = stableStringify([shape, projectLevel(project, roof.levelId).elevation]);
  const existing = roofs.get(key);
  if (existing) { roofs.delete(key); roofs.set(key, existing); return existing.value; }
  const value = buildRoofGeometry(project, roof);
  const size = key.length * 2 + value.vertices.length * 64 + value.triangles.length * 48 + value.uvs.length * 40 + value.underside.length * 48;
  if (size <= MAX_BYTES) {
    roofs.set(key, { value, bytes: size }); bytes += size;
    while (bytes > MAX_BYTES || roofs.size > 64) { const first = roofs.keys().next().value!; bytes -= roofs.get(first)!.bytes; roofs.delete(first); }
  }
  return value;
}
export function clearSceneGeometryCache() { roofs.clear(); bytes = 0; }
export function sceneGeometryCacheUsage() { return { entries: roofs.size, bytes }; }
