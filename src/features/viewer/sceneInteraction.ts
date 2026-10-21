import * as THREE from 'three/webgpu';
import { TransformControlsGizmo } from 'three/addons/controls/TransformControls.js';
import type { RoomSceneProps, SceneRuntime } from './sceneRuntime';
import { sceneDiagnosticsEnabled } from './sceneFrame';
import { selectionKey } from './sceneSelection';

const treadCenters = new WeakMap<THREE.BufferGeometry, THREE.Vector3[]>();
function stairPoints(geometry: THREE.BufferGeometry) {
  let points = treadCenters.get(geometry);
  if (points) return points;
  points = [];
  const positions = geometry.getAttribute('position'), index = geometry.index!;
  for (let face = 0; face < index.count; face += 3) {
    const [a, b, c] = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(positions, index.getX(face + offset)));
    if (new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).y > 1e-7 && Math.abs(a.y - b.y) + Math.abs(a.y - c.y) < 1e-5) points.push(a.add(b).add(c).divideScalar(3));
  }
  points = points.filter((_, index, all) => index % Math.max(1, Math.ceil(all.length / 16)) === 0);
  treadCenters.set(geometry, points); return points;
}

// Read-only screen geometry accompanies the existing renderer diagnostics for real pointer regressions.
export function updateSceneInteraction(runtime: SceneRuntime, props: RoomSceneProps) {
  const canvas = runtime.renderer.domElement;
  if (!sceneDiagnosticsEnabled()) return;
  if (props.mode !== 'orbit') { delete canvas.dataset.sceneInteraction; return; }
  const rect = canvas.getBoundingClientRect();
  const project = (point: THREE.Vector3) => { point.project(runtime.camera); return { x: (point.x + 1) * rect.width / 2, y: (1 - point.y) * rect.height / 2 }; };
  const stairs = [...runtime.objects].filter(([key, object]) => key.startsWith('stair:') && object.layers.test(runtime.camera.layers)).map(([key, object]) => {
    const mesh = object.children[0] as THREE.Mesh;
    const points = stairPoints(mesh.geometry).map(point => project(point.clone().applyMatrix4(mesh.matrixWorld)));
    return { id: key.slice(6), point: project(new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3())), points };
  });
  const gizmo = runtime.transform.getHelper().children.find(child => child instanceof TransformControlsGizmo) as TransformControlsGizmo | undefined;
  const handles = runtime.transform.enabled && gizmo ? gizmo.gizmo[runtime.transform.getMode()].children.filter(object => object.visible && ['X', 'Y', 'Z', 'XZ'].includes(object.name) && object instanceof THREE.Mesh).map(object => {
    const mesh = object as THREE.Mesh, positions = mesh.geometry.getAttribute('position');
    let points: { x: number; y: number }[];
    if (runtime.transform.getMode() === 'rotate') {
      points = []; for (let index = 0; index < positions.count; index += Math.max(1, Math.floor(positions.count / 16))) points.push(project(new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld)));
    } else { mesh.geometry.computeBoundingBox(); points = [project(mesh.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(object.matrixWorld))]; }
    return { axis: object.name, points };
  }) : [];
  const selected = props.selection ? runtime.objects.get(selectionKey(props.selection)) : undefined;
  const selectedGeometryIds: string[] = [];
  selected?.traverse(object => { if (object instanceof THREE.Mesh) selectedGeometryIds.push(object.geometry.uuid); });
  const selectedPoint = selected ? project(new THREE.Box3().setFromObject(selected).getCenter(new THREE.Vector3())) : null;
  const value = JSON.stringify({ stairs, handles, selection: props.selection, selectedGeometryIds, selectedPoint, dragging: runtime.transform.dragging || runtime.directDragging, invalid: !!runtime.stairEdit?.error });
  if (canvas.dataset.sceneInteraction !== value) canvas.dataset.sceneInteraction = value;
}
