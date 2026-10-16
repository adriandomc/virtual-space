import * as THREE from 'three';
import { ADDITION, Brush, Evaluator, HalfEdgeMap, INTERSECTION, SUBTRACTION } from 'three-bvh-csg';
import { MeshBVH } from 'three-mesh-bvh';

export type WorkshopBooleanOperation = 'union' | 'subtract' | 'intersect';
export const BOOLEAN_INPUT_TRIANGLES = 20000;
export const BOOLEAN_OUTPUT_TRIANGLES = 100000;
const EPSILON = 1e-6;
const fail = (message: string): never => { throw new Error(message); };
type ConnectedEdges = HalfEdgeMap & { matchDisjointEdges: boolean; useDrawRange: boolean; unmatchedEdges: number; degenerateEpsilon: number };
type SolidGeometry = THREE.BufferGeometry & { halfEdges?: ConnectedEdges | null; groupIndices?: Uint16Array | null };

function countTriangles(geometry: THREE.BufferGeometry) {
  const available = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
  const start = geometry.drawRange.start, count = Math.min(available - start, geometry.drawRange.count);
  if (!Number.isSafeInteger(start) || start < 0 || start % 3 || !Number.isSafeInteger(count) || count <= 0 || count % 3) fail('La pieza no contiene caras triangulares válidas.');
  return { start, count, triangles: count / 3 };
}
function validMatrix(matrix: THREE.Matrix4) {
  if (!matrix.elements.every(Number.isFinite) || Math.abs(matrix.determinant()) < 1e-12) fail('Revisa el tamaño de las piezas antes de combinarlas.');
}

function relativeMatrix(mesh: THREE.Mesh, parent: THREE.Object3D | null, inverse: THREE.Matrix4) {
  const matrix = mesh.matrix.clone();
  let ancestor = mesh.parent;
  while (ancestor && ancestor !== parent) { matrix.premultiply(ancestor.matrix); ancestor = ancestor.parent; }
  if (ancestor !== parent) matrix.copy(inverse).multiply(mesh.matrixWorld);
  // Inverting a rotated parent can produce 1e-15 translations or shears, which
  // a coplanar triangle splitter otherwise mistakes for actual intersections.
  matrix.elements.forEach((value, index) => { matrix.elements[index] = Math.abs(value) < 1e-12 ? 0 : Math.abs(value - 1) < 1e-12 ? 1 : Math.abs(value + 1) < 1e-12 ? -1 : value; });
  return matrix;
}

function reverseWinding(geometry: THREE.BufferGeometry) {
  const index = geometry.getIndex()!;
  for (let i = 0; i < index.count; i += 3) { const value = index.getX(i); index.setX(i, index.getX(i + 1)); index.setX(i + 1, value); }
  index.needsUpdate = true;
}

function prepare(source: THREE.Mesh, matrix: THREE.Matrix4, color: boolean, uv1: boolean): SolidGeometry {
  const original = source.geometry, { start, count } = countTriangles(original), positions = original.getAttribute('position');
  if (!positions || positions.itemSize !== 3) fail('La pieza no contiene vértices válidos.');
  const geometry = new THREE.BufferGeometry();
  try {
    const oldIndices: number[] = [], indices: number[] = [], remap = new Map<number, number>();
    for (let i = start; i < start + count; i++) {
      const old = original.index?.getX(i) ?? i;
      if (!Number.isSafeInteger(old) || old < 0 || old >= positions.count) fail('La pieza contiene una cara no válida.');
      if (!remap.has(old)) { remap.set(old, oldIndices.length); oldIndices.push(old); }
      indices.push(remap.get(old)!);
    }
    const fields: [string, number][] = [['position', 3], ['normal', 3], ['uv', 2], ...(uv1 ? [['uv1', 2] as [string, number]] : []), ...(color ? [['color', 4] as [string, number]] : [])];
    for (const [name, size] of fields) {
      const sourceAttribute = original.getAttribute(name);
      if (sourceAttribute && (sourceAttribute.count !== positions.count || sourceAttribute.itemSize !== size && !(name === 'color' && sourceAttribute.itemSize === 3))) fail('Los atributos de la pieza no son válidos.');
      if (!sourceAttribute && name === 'normal') continue;
      const values = new Float32Array(oldIndices.length * size);
      oldIndices.forEach((old, current) => {
        for (let component = 0; component < size; component++) {
          const value = sourceAttribute && component < sourceAttribute.itemSize ? sourceAttribute.getComponent(old, component) : name === 'color' ? 1 : 0;
          if (!Number.isFinite(value) || name === 'position' && Math.abs(value) > 10000) fail('La pieza contiene coordenadas no válidas.');
          values[current * size + component] = value;
        }
      });
      geometry.setAttribute(name, new THREE.BufferAttribute(values, size));
    }
    geometry.setIndex(indices);
    if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
    const materials = Array.isArray(source.material) ? source.material : [source.material];
    if (!materials.length || materials.length > 128) fail('La pieza contiene demasiados materiales.');
    if (!Array.isArray(source.material)) geometry.addGroup(0, count, 0);
    else {
      const covered = new Uint8Array(count / 3);
      for (const group of original.groups) {
        if (![group.start, group.count, group.materialIndex ?? 0].every(Number.isSafeInteger) || group.start % 3 || group.count % 3 || group.count < 0 || (group.materialIndex ?? 0) < 0 || (group.materialIndex ?? 0) >= materials.length) fail('Los materiales de las caras no son válidos.');
        const first = Math.max(start, group.start), last = Math.min(start + count, group.start + group.count);
        if (last <= first) continue;
        for (let triangle = (first - start) / 3; triangle < (last - start) / 3; triangle++) { if (covered[triangle]++) fail('Una cara tiene más de un material asignado.'); }
        geometry.addGroup(first - start, last - first, group.materialIndex ?? 0);
      }
      if (covered.some(value => value !== 1)) fail('Asigna un material a todas las caras antes de combinar.');
    }
    geometry.applyMatrix4(matrix);
    if (matrix.determinant() < 0) reverseWinding(geometry);
    geometry.computeBoundingBox();
    return geometry;
  } catch (error) { geometry.dispose(); throw error; }
}

function coplanarOverlap(a: THREE.Triangle, b: THREE.Triangle, normal: THREE.Vector3) {
  const discard = Math.abs(normal.x) > Math.abs(normal.y) && Math.abs(normal.x) > Math.abs(normal.z) ? 0 : Math.abs(normal.y) > Math.abs(normal.z) ? 1 : 2;
  const project = (point: THREE.Vector3): [number, number] => discard === 0 ? [point.y, point.z] : discard === 1 ? [point.x, point.z] : [point.x, point.y];
  const triangle = [a.a, a.b, a.c].map(project);
  let polygon = [b.a, b.b, b.c].map(project);
  const cross = (p: number[], q: number[], r: number[]) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const sign = Math.sign(cross(triangle[0], triangle[1], triangle[2]));
  for (let edge = 0; edge < 3 && polygon.length; edge++) {
    const start = triangle[edge], end = triangle[(edge + 1) % 3], next: [number, number][] = [];
    for (let i = 0; i < polygon.length; i++) {
      const first = polygon[i], last = polygon[(i + 1) % polygon.length], one = sign * cross(start, end, first), two = sign * cross(start, end, last);
      if (one >= -1e-10) next.push(first);
      if ((one > 1e-10 && two < -1e-10) || (one < -1e-10 && two > 1e-10)) { const fraction = one / (one - two); next.push([first[0] + (last[0] - first[0]) * fraction, first[1] + (last[1] - first[1]) * fraction]); }
    }
    polygon = next;
  }
  let area = 0;
  for (let i = 0; i < polygon.length; i++) { const first = polygon[i], last = polygon[(i + 1) % polygon.length]; area += first[0] * last[1] - last[0] * first[1]; }
  const longestEdge = (triangle: THREE.Triangle) => Math.max(triangle.a.distanceTo(triangle.b), triangle.b.distanceTo(triangle.c), triangle.c.distanceTo(triangle.a));
  // Adjacent Float32 faces can overlap by a few nanometres after clipping.
  // Use the same positional tolerance as edge welding, rather than treating
  // that narrow shared boundary as an intersecting surface.
  return Math.abs(area) > EPSILON * Math.min(longestEdge(a), longestEdge(b));
}

function boundaryPoint(point: THREE.Vector3, triangle: THREE.Triangle) {
  const line = new THREE.Line3(), closest = new THREE.Vector3();
  for (const [start, end] of [[triangle.a, triangle.b], [triangle.b, triangle.c], [triangle.c, triangle.a]]) {
    line.set(start, end).closestPointToPoint(point, true, closest);
    if (closest.distanceToSquared(point) <= EPSILON * EPSILON) return true;
  }
  return false;
}

function assertNoCrossing(geometry: THREE.BufferGeometry) {
  const tree = new MeshBVH(geometry, { indirect: true, maxLeafSize: 6 }), plane = new THREE.Plane(), otherPlane = new THREE.Plane(), segment = new THREE.Line3(), middle = new THREE.Vector3();
  let comparisons = 0;
  let problem = '';
  tree.bvhcast(tree, new THREE.Matrix4(), { intersectsTriangles: (first, second, a, b) => {
    if (a >= b) return false;
    if (++comparisons > 300000) { problem = 'La pieza es demasiado compleja para combinarla.'; return true; }
    first.getPlane(plane); second.getPlane(otherPlane);
    if (Math.abs(plane.normal.dot(otherPlane.normal)) > 1 - 1e-9 && Math.abs(plane.distanceToPoint(second.a)) < 1e-7) {
      if (coplanarOverlap(first, second, plane.normal)) { problem = 'La pieza tiene caras superpuestas. Usa un sólido cerrado sin cruces.'; return true; }
      return false;
    }
    if (!first.intersectsTriangle(second, segment)) return false;
    middle.addVectors(segment.start, segment.end).multiplyScalar(0.5);
    if ([segment.start, segment.end, middle].every(point => boundaryPoint(point, first) && boundaryPoint(point, second))) return false;
    problem = 'La pieza tiene caras que se cruzan. Usa un sólido cerrado sin cruces.'; return true;
  } });
  if (problem) fail(problem);
}

// CDT may leave zero-width fragments where coplanar faces meet. Remove only
// collapsed or exactly repeated triangles, then validate the remaining boundary.
function discardCollapsedOutput(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute('position'), source = geometry.index!, { count } = countTriangles(geometry), indices: number[] = [], groups: { start: number; count: number; materialIndex: number }[] = [], faces = new Set<string>();
  const point = new THREE.Vector3(), hash = (id: number) => point.fromBufferAttribute(positions, id).toArray().map(value => Math.round(value / EPSILON)).join(',');
  let groupIndex = 0;
  for (let i = 0; i < count; i += 3) {
    while (groupIndex < geometry.groups.length - 1 && i >= geometry.groups[groupIndex].start + geometry.groups[groupIndex].count) groupIndex++;
    const ids = [source.getX(i), source.getX(i + 1), source.getX(i + 2)], hashes = ids.map(hash), face = [...hashes].sort().join('|');
    if (new Set(hashes).size !== 3 || faces.has(face)) continue;
    faces.add(face);
    const materialIndex = geometry.groups[groupIndex]?.materialIndex ?? 0, previous = groups.at(-1);
    if (previous?.materialIndex === materialIndex) previous.count += 3; else groups.push({ start: indices.length, count: 3, materialIndex });
    indices.push(...ids);
  }
  geometry.setIndex(indices); geometry.clearGroups(); groups.forEach(group => geometry.addGroup(group.start, group.count, group.materialIndex));
}

function assertSolid(geometry: SolidGeometry, output = false) {
  const { triangles, count } = countTriangles(geometry), positions = geometry.getAttribute('position'), index = geometry.index!;
  if (triangles > (output ? BOOLEAN_OUTPUT_TRIANGLES : BOOLEAN_INPUT_TRIANGLES)) fail(output ? 'El resultado tiene demasiadas caras. Simplifica las piezas.' : 'Las piezas admiten como máximo 20 000 caras para combinar.');
  const first = new THREE.Vector3(), second = new THREE.Vector3(), third = new THREE.Vector3(), cross = new THREE.Vector3();
  const edges = new Map<string, number>(), faces = new Set<string>();
  let volume = 0;
  const hash = (point: THREE.Vector3) => point.toArray().map(value => Math.round(value / EPSILON)).join(',');
  for (let i = 0; i < count; i += 3) {
    first.fromBufferAttribute(positions, index.getX(i)); second.fromBufferAttribute(positions, index.getX(i + 1)); third.fromBufferAttribute(positions, index.getX(i + 2));
    if (![...first.toArray(), ...second.toArray(), ...third.toArray()].every(Number.isFinite)) fail('La pieza contiene coordenadas no válidas.');
    if (cross.subVectors(second, first).cross(new THREE.Vector3().subVectors(third, first)).lengthSq() < 1e-22) fail('La pieza contiene caras sin superficie.');
    volume += first.dot(cross.crossVectors(second, third)) / 6;
    const hashes = [hash(first), hash(second), hash(third)], face = [...hashes].sort().join('|');
    if (new Set(hashes).size !== 3 || faces.has(face)) fail('La pieza contiene caras repetidas o demasiado pequeñas.');
    faces.add(face);
    for (let edge = 0; edge < 3; edge++) {
      const a = hashes[edge], b = hashes[(edge + 1) % 3], key = a < b ? a + '|' + b : b + '|' + a, value = (edges.get(key) ?? 0) + 1;
      if (value > 2) fail('La pieza tiene bordes compartidos por demasiadas caras.');
      edges.set(key, value);
    }
  }
  if (Math.abs(volume) < 1e-10) fail('La pieza debe ser un sólido cerrado con volumen.');
  if (volume < 0) { reverseWinding(geometry); const normals = geometry.getAttribute('normal'); for (let i = 0; i < normals.count; i++) normals.setXYZ(i, -normals.getX(i), -normals.getY(i), -normals.getZ(i)); }
  const connection = new HalfEdgeMap() as ConnectedEdges;
  connection.matchDisjointEdges = true; connection.useDrawRange = false; connection.degenerateEpsilon = 1e-7; connection.updateFrom(geometry);
  if (connection.unmatchedEdges !== 0) fail(output ? 'No se pudo obtener un sólido cerrado. Ajusta las piezas e inténtalo de nuevo.' : 'Esta pieza tiene bordes abiertos. Cierra sus caras antes de combinar.');
  geometry.halfEdges = connection;
  assertNoCrossing(geometry);
}

/** Evaluate only cloned, bounded solids; a failed operation never changes either input. */
export function combineWorkshopMeshes(base: THREE.Mesh, tool: THREE.Mesh, operation: WorkshopBooleanOperation): THREE.Mesh {
  if (base === tool || !['union', 'subtract', 'intersect'].includes(operation)) fail('Selecciona dos piezas distintas y una operación válida.');
  if (countTriangles(base.geometry).triangles + countTriangles(tool.geometry).triangles > BOOLEAN_INPUT_TRIANGLES) fail('Las dos piezas admiten como máximo 20 000 caras para combinar.');
  base.updateWorldMatrix(true, false); tool.updateWorldMatrix(true, false);
  const parent = base.parent?.matrixWorld.clone() ?? new THREE.Matrix4(); validMatrix(parent);
  const inverse = parent.invert(), baseMatrix = relativeMatrix(base, base.parent, inverse), toolMatrix = relativeMatrix(tool, base.parent, inverse);
  validMatrix(baseMatrix); validMatrix(toolMatrix);
  const colors = !!base.geometry.getAttribute('color') || !!tool.geometry.getAttribute('color'), uv1 = !!base.geometry.getAttribute('uv1') || !!tool.geometry.getAttribute('uv1');
  let first: SolidGeometry | undefined, second: SolidGeometry | undefined, target: Brush | undefined;
  const temporaryMaterials = new Set<THREE.Material>();
  try {
    first = prepare(base, baseMatrix, colors, uv1); second = prepare(tool, toolMatrix, colors, uv1);
    const bounds = first.boundingBox!.clone().union(second.boundingBox!), center = bounds.getCenter(new THREE.Vector3()), span = Math.max(...bounds.getSize(new THREE.Vector3()).toArray());
    if (!Number.isFinite(span) || span < 1e-5 || span > 20000) fail('Revisa las dimensiones de las piezas.');
    const normalize = new THREE.Matrix4().makeScale(1 / span, 1 / span, 1 / span).multiply(new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z));
    first.applyMatrix4(normalize); second.applyMatrix4(normalize);
    assertSolid(first); assertSolid(second);
    const materialCopies = (mesh: THREE.Mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => { const copy = material.clone(); temporaryMaterials.add(copy); return copy; });
    const a = new Brush(first, materialCopies(base)), b = new Brush(second, materialCopies(tool)); a.updateMatrixWorld(true); b.updateMatrixWorld(true);
    const evaluator = new Evaluator(); evaluator.attributes = ['position', 'normal', 'uv', ...(uv1 ? ['uv1'] : []), ...(colors ? ['color'] : [])]; evaluator.useGroups = true;
    (evaluator as Evaluator & { useCDTClipping: boolean }).useCDTClipping = true;
    const emptyMaterial = new THREE.MeshStandardMaterial(); temporaryMaterials.add(emptyMaterial);
    target = new Brush(new THREE.BufferGeometry(), emptyMaterial);
    evaluator.evaluate(a, b, operation === 'union' ? ADDITION : operation === 'subtract' ? SUBTRACTION : INTERSECTION, target);
    const output = target.geometry as SolidGeometry;
    if (!(output.index?.count ?? output.getAttribute('position')?.count ?? 0)) fail(operation === 'intersect' ? 'Las piezas no comparten volumen.' : 'El corte elimina toda la pieza.');
    if (countTriangles(output).triangles > BOOLEAN_OUTPUT_TRIANGLES) fail('El resultado tiene demasiadas caras. Simplifica las piezas.');
    if (!output.index) output.setIndex(Array.from({ length: output.getAttribute('position').count }, (_, i) => i));
    discardCollapsedOutput(output);
    assertSolid(output, true);
    output.applyMatrix4(normalize.invert()); output.computeBoundingBox();
    const pivot = output.boundingBox!.getCenter(new THREE.Vector3()); output.translate(-pivot.x, -pivot.y, -pivot.z); output.computeBoundingBox(); output.computeBoundingSphere();
    const materials = Array.isArray(target.material) ? target.material : [target.material];
    if (materials.length > 128 || output.groups.length > 512) fail('El resultado tiene demasiados materiales.');
    materials.forEach(material => temporaryMaterials.delete(material));
    output.halfEdges = null; delete output.boundsTree; output.groupIndices = null;
    const result = new THREE.Mesh(output, materials.length === 1 ? materials[0] : materials); result.position.copy(pivot); result.name = base.name; result.castShadow = base.castShadow; result.receiveShadow = base.receiveShadow;
    result.userData = { booleanOperation: operation }; target = undefined;
    return result;
  } finally {
    if (first) { first.halfEdges = null; delete first.boundsTree; first.groupIndices = null; first.dispose(); }
    if (second) { second.halfEdges = null; delete second.boundsTree; second.groupIndices = null; second.dispose(); }
    target?.geometry.dispose(); temporaryMaterials.forEach(material => material.dispose());
  }
}
