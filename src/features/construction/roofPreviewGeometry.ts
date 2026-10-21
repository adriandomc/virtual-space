import * as THREE from 'three';
import type { RoofFace, RoofVertex } from '../../domain/project/projectDocument';

export type RoofPreviewGeometry = { scene: THREE.Scene; model: THREE.Mesh; points: THREE.InstancedMesh | null; edges: THREE.LineSegments | null; faceIds: string[] };

export function updateRoofPreviewGeometry(active: RoofPreviewGeometry, vertices: RoofVertex[], faces: RoofFace[]) {
  const positions: number[] = [], byId = new Map(vertices.map(vertex => [vertex.id, vertex])); active.faceIds = [];
  for (const face of faces) for (let index = 1; index < face.vertexIds.length - 1; index++) {
    const triangle = [face.vertexIds[0], face.vertexIds[index], face.vertexIds[index + 1]].map(id => byId.get(id));
    if (triangle.some(vertex => !vertex)) continue;
    positions.push(...triangle.flatMap(vertex => [vertex!.x, vertex!.y, vertex!.z])); active.faceIds.push(face.id);
  }
  let position = active.model.geometry.getAttribute('position') as THREE.BufferAttribute;
  if (position.array.length !== positions.length) {
    active.model.geometry.dispose();
    active.model.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)).setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(positions.length), 3));
    position = active.model.geometry.getAttribute('position') as THREE.BufferAttribute;
  } else { position.set(positions); position.needsUpdate = true; }
  active.model.geometry.computeVertexNormals(); active.model.geometry.computeBoundingBox(); active.model.geometry.computeBoundingSphere();
  active.model.visible = positions.length > 0;
  if (!active.edges) { active.edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: '#65735d' })); active.scene.add(active.edges); }
  active.edges.geometry.dispose(); active.edges.geometry = new THREE.EdgesGeometry(active.model.geometry);
  if (!active.points || active.points.count !== vertices.length) {
    if (active.points) { active.points.removeFromParent(); active.points.geometry.dispose(); (active.points.material as THREE.Material).dispose(); }
    active.points = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ depthTest: false, transparent: true, opacity: .95 }), vertices.length);
    active.points.renderOrder = 10; active.scene.add(active.points);
  }
  const bounds = new THREE.Box3().setFromPoints(vertices.map(vertex => new THREE.Vector3(vertex.x, vertex.y, vertex.z))), span = bounds.isEmpty() ? 1 : Math.max(.1, bounds.getSize(new THREE.Vector3()).length());
  const radius = Math.max(.045, span * .008), matrix = new THREE.Matrix4(), scale = new THREE.Vector3(radius, radius, radius);
  vertices.forEach((vertex, index) => active.points!.setMatrixAt(index, matrix.makeScale(scale.x, scale.y, scale.z).setPosition(vertex.x, vertex.y, vertex.z)));
  active.points.instanceMatrix.needsUpdate = true; active.points.computeBoundingSphere();
}

/** Picking/selection and tools do not change topology or allocate vertex buffers. */
export function updateRoofPreviewSelection(active: RoofPreviewGeometry, vertices: RoofVertex[], selectedIds: string[], selectedFace: string | null, mode: 'vertices' | 'faces') {
  const color = active.model.geometry.getAttribute('color'), base = new THREE.Color('#c5b49a'), selected = new THREE.Color('#e0b66a');
  if (color) {
    active.faceIds.forEach((id, index) => { const value = id === selectedFace ? selected : base; for (let vertex = 0; vertex < 3; vertex++) color.setXYZ(index * 3 + vertex, value.r, value.g, value.b); }); color.needsUpdate = true;
  }
  if (active.points) {
    const ids = new Set(selectedIds), normal = new THREE.Color('#56744b'), chosen = new THREE.Color('#d79531');
    vertices.forEach((vertex, index) => active.points!.setColorAt(index, ids.has(vertex.id) ? chosen : normal));
    if (active.points.instanceColor) active.points.instanceColor.needsUpdate = true;
    active.points.visible = mode === 'vertices';
  }
}
