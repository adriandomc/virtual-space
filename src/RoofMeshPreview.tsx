import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { WebGLRenderer } from 'three/src/renderers/WebGLRenderer.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { fitWorkshopCamera } from './modelWorkshopGeometry';
import { t, useLocale } from './i18n';
import type { RoofFace, RoofVertex } from './projectDocument';
import { transformRoofVertices } from './roofMeshEditing';

type Props = { vertices: RoofVertex[]; faces: RoofFace[]; selectedIds: string[]; selectedFace: string | null; selectionMode: 'vertices' | 'faces'; multi: boolean; tool: 'translate' | 'rotate' | 'scale'; snap: boolean; step: number; resetKey: number; maximumHeight: number; onSelect: (ids: string[], face: string | null) => void; onChange: (vertices: RoofVertex[]) => void; onStart: () => void; disabled?: boolean };
type Runtime = { renderer: WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; transform: TransformControls; proxy: THREE.Object3D; model: THREE.Mesh; points: THREE.InstancedMesh | null; edges: THREE.LineSegments | null; grid: THREE.GridHelper | null; dirty: boolean; dragging: boolean; initial: RoofVertex[]; inverse: THREE.Matrix4; faceIds: string[] };

export default function RoofMeshPreview(props: Props) {
  const locale = useLocale(), mount = useRef<HTMLDivElement>(null), runtime = useRef<Runtime | null>(null), latest = useRef(props);
  const [error, setError] = useState(''), [ready, setReady] = useState(false);
  latest.current = props;
  useEffect(() => {
    const host = mount.current; if (!host) return;
    let renderer: WebGLRenderer | undefined, resize: ResizeObserver | undefined, dispose = () => {};
    try {
      renderer = new WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      renderer.setClearColor('#edf0e7'); host.append(renderer.domElement);
      renderer.domElement.tabIndex = 0;
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, .01, 500), controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true; controls.dampingFactor = .1;
      scene.add(new THREE.HemisphereLight('#ffffff', '#aab19d', 2)); const light = new THREE.DirectionalLight('#fff6df', 2.5); light.position.set(3, 8, 5); scene.add(light);
      const model = new THREE.Mesh(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3)), new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, side: THREE.DoubleSide, roughness: .85, flatShading: true })); model.visible = false; scene.add(model);
      const proxy = new THREE.Object3D(); scene.add(proxy);
      const transform = new TransformControls(camera, renderer.domElement); transform.setColors('#ce756a', '#819968', '#6d97b4', '#d7ab5b'); transform.setSize(matchMedia('(pointer: coarse)').matches ? 1.5 : 1.1); scene.add(transform.getHelper());
      const active: Runtime = { renderer, scene, camera, controls, transform, proxy, model, points: null, edges: null, grid: null, dirty: true, dragging: false, initial: [], inverse: new THREE.Matrix4(), faceIds: [] }; runtime.current = active;
      const fit = () => { const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight); renderer!.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); active.dirty = true; };
      resize = new ResizeObserver(fit); resize.observe(host); fit();
      const begin = (event: { value: unknown }) => {
        active.dragging = !!event.value; controls.enabled = !event.value;
        if (event.value) { latest.current.onStart(); active.initial = structuredClone(latest.current.vertices); proxy.updateMatrixWorld(); active.inverse.copy(proxy.matrixWorld).invert(); }
        else active.initial = [];
        active.dirty = true;
      };
      const change = () => {
        active.dirty = true;
        if (!active.dragging || latest.current.disabled) return;
        proxy.updateMatrixWorld(); const delta = proxy.matrixWorld.clone().multiply(active.inverse);
        latest.current.onChange(transformRoofVertices(active.initial, latest.current.selectedIds, delta, latest.current.maximumHeight));
      };
      transform.addEventListener('dragging-changed', begin); transform.addEventListener('objectChange', change);
      let down: { x: number; y: number; handled: boolean } | null = null;
      const pointerDown = (event: PointerEvent) => { renderer!.domElement.focus({ preventScroll: true }); down = { x: event.clientX, y: event.clientY, handled: transform.dragging || !!transform.axis }; };
      const pointerUp = (event: PointerEvent) => {
        if (!down || down.handled || active.dragging || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6 || latest.current.disabled) { down = null; return; } down = null;
        const rect = renderer!.domElement.getBoundingClientRect(), ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
        if (latest.current.selectionMode === 'vertices' && active.points) {
          // The visible dots stay small; picking uses a 44 CSS-pixel target regardless of zoom or device resolution.
          const hit = latest.current.vertices.map(vertex => { const p = new THREE.Vector3(vertex.x, vertex.y, vertex.z).project(camera); return { id: vertex.id, depth: p.z, distance: Math.hypot(rect.left + (p.x + 1) * rect.width / 2 - event.clientX, rect.top + (1 - p.y) * rect.height / 2 - event.clientY) }; }).filter(vertex => vertex.depth >= -1 && vertex.depth <= 1 && vertex.distance <= 22).sort((a, b) => a.distance - b.distance || a.depth - b.depth)[0];
          if (hit) { const id = hit.id, ids = latest.current.multi || event.shiftKey ? latest.current.selectedIds.includes(id) ? latest.current.selectedIds.filter(value => value !== id) : [...latest.current.selectedIds, id] : [id]; latest.current.onSelect(ids, null); }
        } else { const hit = ray.intersectObject(model)[0], id = hit?.faceIndex !== undefined && hit.faceIndex !== null ? active.faceIds[hit.faceIndex] : undefined; const face = latest.current.faces.find(face => face.id === id); if (face) latest.current.onSelect(face.vertexIds, face.id); }
      };
      renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointerup', pointerUp);
      const keyDown = (event: KeyboardEvent) => {
        if (latest.current.disabled || active.dragging) return;
        const step = latest.current.snap ? latest.current.step : .01, shift = ({ ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, 0, -step], ArrowDown: [0, 0, step], PageUp: [0, step, 0], PageDown: [0, -step, 0] } as Record<string, number[]>)[event.code];
        if (!shift || !latest.current.selectedIds.length) return;
        event.preventDefault(); latest.current.onStart(); latest.current.onChange(transformRoofVertices(latest.current.vertices, latest.current.selectedIds, new THREE.Matrix4().makeTranslation(shift[0], shift[1], shift[2]), latest.current.maximumHeight));
      };
      renderer.domElement.addEventListener('keydown', keyDown);
      renderer.setAnimationLoop(() => { if (document.visibilityState === 'hidden') return; if (controls.update()) active.dirty = true; if (active.dirty) { renderer!.render(scene, camera); active.dirty = false; } });
      dispose = () => { transform.removeEventListener('dragging-changed', begin); transform.removeEventListener('objectChange', change); renderer!.domElement.removeEventListener('pointerdown', pointerDown); renderer!.domElement.removeEventListener('pointerup', pointerUp); renderer!.domElement.removeEventListener('keydown', keyDown); controls.dispose(); transform.dispose(); model.geometry.dispose(); (model.material as THREE.Material).dispose(); active.points?.geometry.dispose(); (active.points?.material as THREE.Material | undefined)?.dispose(); active.edges?.geometry.dispose(); (active.edges?.material as THREE.Material | undefined)?.dispose(); active.grid?.dispose(); };
      setReady(true);
    } catch { setError('No se pudo iniciar la vista 3D. Puedes editar las coordenadas.'); }
    return () => { resize?.disconnect(); renderer?.setAnimationLoop(null); dispose(); renderer?.dispose(); renderer?.domElement.remove(); runtime.current = null; };
  }, []);
  useEffect(() => {
    const active = runtime.current; if (!active || !ready) return;
    active.renderer.domElement.setAttribute('aria-label', t('Forma de cubierta 3D. Selecciona vértices o caras y arrastra sus controles.'));
  }, [locale, ready]);
  useEffect(() => {
    const active = runtime.current; if (!active || !ready) return;
    const positions: number[] = [], colors: number[] = []; active.faceIds = [];
    for (const face of props.faces) for (let index = 1; index < face.vertexIds.length - 1; index++) { const triangle = [face.vertexIds[0], face.vertexIds[index], face.vertexIds[index + 1]].map(id => props.vertices.find(vertex => vertex.id === id)); if (triangle.some(vertex => !vertex)) continue; positions.push(...triangle.flatMap(vertex => [vertex!.x, vertex!.y, vertex!.z])); const color = new THREE.Color(face.id === props.selectedFace ? '#e0b66a' : '#c5b49a'); for (let vertex = 0; vertex < 3; vertex++) colors.push(...color.toArray()); active.faceIds.push(face.id); }
    active.model.geometry.dispose(); active.model.geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)).setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); active.model.geometry.computeVertexNormals();
    active.model.visible = positions.length > 0;
    if (!positions.length) active.model.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0);
    if (active.edges) { active.edges.removeFromParent(); active.edges.geometry.dispose(); (active.edges.material as THREE.Material).dispose(); }
    active.edges = new THREE.LineSegments(new THREE.EdgesGeometry(active.model.geometry), new THREE.LineBasicMaterial({ color: '#65735d' })); active.scene.add(active.edges);
    if (active.points) { active.points.removeFromParent(); active.points.geometry.dispose(); (active.points.material as THREE.Material).dispose(); }
    const bounds = new THREE.Box3().setFromPoints(props.vertices.map(vertex => new THREE.Vector3(vertex.x, vertex.y, vertex.z))), span = bounds.isEmpty() ? 1 : Math.max(.1, bounds.getSize(new THREE.Vector3()).length());
    active.points = new THREE.InstancedMesh(new THREE.SphereGeometry(Math.max(.045, span * .008), 10, 8), new THREE.MeshBasicMaterial({ depthTest: false, transparent: true, opacity: .95 }), props.vertices.length);
    const matrix = new THREE.Matrix4(); props.vertices.forEach((vertex, index) => { active.points!.setMatrixAt(index, matrix.makeTranslation(vertex.x, vertex.y, vertex.z)); active.points!.setColorAt(index, new THREE.Color(props.selectedIds.includes(vertex.id) ? '#d79531' : '#56744b')); }); active.points.renderOrder = 10; active.points.visible = props.selectionMode === 'vertices'; active.scene.add(active.points);
    if (!active.dragging) {
      const selected = props.vertices.filter(vertex => props.selectedIds.includes(vertex.id));
      if (selected.length && !props.disabled) { active.proxy.position.set(0, 0, 0); selected.forEach(vertex => active.proxy.position.add(new THREE.Vector3(vertex.x, vertex.y, vertex.z))); active.proxy.position.divideScalar(selected.length); active.proxy.rotation.set(0, 0, 0); active.proxy.scale.set(1, 1, 1); active.transform.attach(active.proxy); }
      else active.transform.detach();
    }
    active.transform.setMode(props.tool); active.transform.setTranslationSnap(props.snap ? props.step : null); active.transform.setRotationSnap(props.snap ? THREE.MathUtils.degToRad(15) : null); active.transform.setScaleSnap(props.snap ? .1 : null); active.transform.enabled = !props.disabled; active.dirty = true;
    if (!active.grid || active.grid.userData.step !== props.step) { active.grid?.removeFromParent(); active.grid?.dispose(); const size = Math.max(4, Math.ceil(span / (props.step * 10)) * props.step * 10); active.grid = new THREE.GridHelper(size, Math.min(200, Math.round(size / props.step)), '#a5b49a', '#d4dccd'); active.grid.userData.step = props.step; const center = bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3()); active.grid.position.set(center.x, bounds.isEmpty() ? 0 : bounds.min.y - .03, center.z); active.scene.add(active.grid); }
  }, [props.vertices, props.faces, props.selectedIds, props.selectedFace, props.selectionMode, props.tool, props.snap, props.step, props.disabled, ready]);
  useEffect(() => { const active = runtime.current; if (!active || !ready || !props.vertices.length) return; const box = new THREE.Box3().setFromPoints(props.vertices.map(vertex => new THREE.Vector3(vertex.x, vertex.y, vertex.z))); active.controls.target.copy(fitWorkshopCamera(active.camera, box, active.camera.aspect)); active.controls.update(); active.dirty = true; }, [props.resetKey, ready]);
  return <div className="roof-mesh-preview" ref={mount}>{error && <p role="status">{t(error)}</p>}</div>;
}
