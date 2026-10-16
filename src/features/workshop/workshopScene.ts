import * as THREE from 'three';
import { WebGLRenderer } from 'three/src/renderers/WebGLRenderer.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { disposeWorkshopModel, getEditableVertices } from './modelWorkshopGeometry';
import type { snapWorkshopPiece } from './workshopAlignment';
import { createSelectionProxy, type WorkshopSelectionTransform } from './workshopGrouping';

export type WorkshopPanel = 'add' | 'model' | 'pieces' | 'alignment' | 'geometry';

export type WorkshopTool = 'translate' | 'rotate' | 'scale';

export type WorkshopGeometryTool = 'vertices' | 'faces';

export type WorkshopSceneRuntime = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: WebGLRenderer;
  controls: OrbitControls;
  transform: TransformControls;
  content: THREE.Group;
  proxy: THREE.Object3D;
  selectionProxy: THREE.Mesh | null;
  selectionTransform: WorkshopSelectionTransform | null;
  selectionOutlines: THREE.BoxHelper[];
  outline: THREE.BoxHelper | null;
  toolOutline: THREE.BoxHelper | null;
  snapGuide: THREE.LineSegments | null;
  points: THREE.Points | null;
  face: THREE.Mesh | null;
  dragged: boolean;
  vertexIndices: number[];
  vertexMesh: THREE.Mesh | null;
  vertexId: number;
  pendingNormals: boolean;
};

export const AXES = ['x', 'y', 'z'] as const;

export function removeHelper(runtime: WorkshopSceneRuntime, key: 'points' | 'face' | 'outline' | 'toolOutline' | 'snapGuide') {
  const object = runtime[key];
  if (!object) return;
  object.removeFromParent(); object.geometry.dispose();
  (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
  runtime[key] = null;
}

export function clearSelectionHelpers(active: WorkshopSceneRuntime) {
  for (const outline of active.selectionOutlines) { outline.removeFromParent(); outline.geometry.dispose(); (outline.material as THREE.Material).dispose(); }
  active.selectionOutlines = [];
  if (active.selectionProxy) { active.selectionProxy.removeFromParent(); active.selectionProxy.geometry.dispose(); (active.selectionProxy.material as THREE.Material).dispose(); }
  active.selectionProxy = null; active.selectionTransform = null;
}

export function showSnapGuide(active: WorkshopSceneRuntime, piece: THREE.Mesh, matches: ReturnType<typeof snapWorkshopPiece>) {
  removeHelper(active, 'snapGuide');
  const points: number[] = [];
  for (const match of matches) {
    if (!match.reference) continue;
    const bounds = new THREE.Box3().setFromObject(piece).union(new THREE.Box3().setFromObject(match.reference)).expandByScalar(.08);
    const other = AXES.filter(axis => axis !== match.axis), center = bounds.getCenter(new THREE.Vector3());
    center[match.axis] = match.value;
    for (const axis of other) { const start = center.clone(), end = center.clone(); start[axis] = bounds.min[axis]; end[axis] = bounds.max[axis]; points.push(...start.toArray(), ...end.toArray()); }
  }
  if (!points.length) return;
  active.snapGuide = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(points, 3)), new THREE.LineBasicMaterial({ color: '#4a935c', depthTest: false, transparent: true, opacity: .9 }));
  active.snapGuide.renderOrder = 20; active.scene.add(active.snapGuide);
}

export function createWorkshopScene(host: HTMLElement, label: string): WorkshopSceneRuntime {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio)); renderer.setClearColor('#edf0e8'); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, .01, 1000), content = new THREE.Group(), proxy = new THREE.Object3D();
  scene.add(content, proxy, new THREE.HemisphereLight('#ffffff', '#68705e', 2.4));
  const sun = new THREE.DirectionalLight('#fff6e5', 3); sun.position.set(4, 7, 5); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); scene.add(sun);
  const grid = new THREE.GridHelper(10, 10, '#a0ac98', '#d3dbca'); grid.position.y = -.006; scene.add(grid);
  const canvas = renderer.domElement; canvas.setAttribute('aria-label', label); canvas.tabIndex = 0; host.append(canvas);
  const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = .08;
  camera.position.set(1.8, 1.2, 1.8); controls.target.set(0, .25, 0); controls.update();
  const transform = new TransformControls(camera, canvas); transform.setSize(window.matchMedia('(pointer: coarse)').matches ? 1.35 : 1.05); transform.setColors('#ce756a', '#819968', '#6d97b4', '#d7ab5b'); scene.add(transform.getHelper());
  return { scene, camera, renderer, controls, transform, content, proxy, selectionProxy: null, selectionTransform: null, selectionOutlines: [], outline: null, toolOutline: null, snapGuide: null, points: null, face: null, dragged: false, vertexIndices: [], vertexMesh: null, vertexId: 0, pendingNormals: false };
}

export function disposeWorkshopScene(active: WorkshopSceneRuntime) {
  active.renderer.setAnimationLoop(null); active.transform.detach(); clearSelectionHelpers(active); active.scene.remove(active.transform.getHelper()); active.transform.dispose(); active.controls.dispose(); disposeWorkshopModel(active.scene); active.renderer.dispose(); active.renderer.domElement.remove();
}

export function releaseWorkshopSource(source: THREE.Group) {
  const dispose = source.userData.disposeEditorModel as (() => void) | undefined;
  if (dispose) dispose(); else disposeWorkshopModel(source);
}

type SelectionState = {
  panel: WorkshopPanel;
  tool: WorkshopTool;
  geometryTool: WorkshopGeometryTool;
  selected: string | null;
  selectedIds: string[];
  second: string;
  reference: THREE.Mesh | undefined;
  vertexId: number;
  faceId: number;
  saving: boolean;
  computing: boolean;
  previewing: boolean;
};

export function updateWorkshopSelection(active: WorkshopSceneRuntime, { panel, tool, geometryTool, selected, selectedIds, second, reference, vertexId, faceId, saving, computing, previewing }: SelectionState) {
  active.transform.detach(); active.vertexMesh = null; active.vertexIndices = [];
  clearSelectionHelpers(active);
  for (const key of ['points', 'face', 'outline', 'toolOutline', 'snapGuide'] as const) removeHelper(active, key);
  if (previewing) return;
  if (panel === 'pieces' && second) { const cutter = active.content.children.find(piece => piece.uuid === second); if (cutter) { active.toolOutline = new THREE.BoxHelper(cutter, '#678cb4'); active.scene.add(active.toolOutline); } }
  if (panel === 'alignment' && reference) { active.toolOutline = new THREE.BoxHelper(reference, '#678cb4'); active.scene.add(active.toolOutline); }
  const object = active.content.children.find(object => object.uuid === selected);
  if (!(object instanceof THREE.Mesh)) return;
  const members = active.content.children.filter((piece): piece is THREE.Mesh => piece instanceof THREE.Mesh && selectedIds.includes(piece.uuid));
  if (members.length > 1 && panel !== 'geometry') {
    const proxy = createSelectionProxy(members); active.content.parent!.add(proxy); active.selectionProxy = proxy;
    active.selectionOutlines = members.map(piece => { const outline = new THREE.BoxHelper(piece, '#b88a3d'); active.scene.add(outline); return outline; });
    active.transform.enabled = !saving && !computing;
    active.transform.setMode(tool === 'scale' ? 'translate' : tool); active.transform.setSpace('world'); active.transform.attach(proxy);
    return;
  }
  active.outline = new THREE.BoxHelper(object, '#b88a3d'); active.scene.add(active.outline);
  active.transform.enabled = !saving && !computing;
  if (panel === 'geometry') {
    if (geometryTool === 'vertices') {
      const editable = getEditableVertices(object.geometry), vertex = editable[Math.min(vertexId, Math.max(0, editable.length - 1))];
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(editable.flatMap(vertex => vertex.position), 3));
      const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#4369a1', size: 5, sizeAttenuation: false, depthTest: false }));
      object.updateWorldMatrix(true, false); points.matrix.copy(object.matrixWorld); points.matrixAutoUpdate = false; points.renderOrder = 10; active.scene.add(points); active.points = points;
      if (vertex) { active.proxy.position.set(...vertex.position).applyMatrix4(object.matrixWorld); active.vertexMesh = object; active.vertexIndices = vertex.indices; active.vertexId = vertex.id; active.transform.setMode('translate'); active.transform.setSpace('world'); active.transform.attach(active.proxy); }
    } else {
      const indices = object.geometry.index, position = object.geometry.getAttribute('position'), count = indices?.count ?? position.count;
      if (faceId * 3 + 2 < count) {
        const positions: number[] = [];
        for (let i = 0; i < 3; i++) { const index = indices?.getX(faceId * 3 + i) ?? faceId * 3 + i; const point = new THREE.Vector3().fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld); positions.push(...point.toArray()); }
        const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        active.face = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#edb84c', transparent: true, opacity: .65, side: THREE.DoubleSide, depthTest: false })); active.face.renderOrder = 15; active.scene.add(active.face);
      }
    }
  } else { active.transform.setMode(tool); active.transform.setSpace(tool === 'translate' ? 'world' : 'local'); active.transform.attach(object); }
}
