import { t, useLocale } from './i18n';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { WebGLRenderer } from 'three/src/renderers/WebGLRenderer.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Copy, Focus, Group, LoaderCircle, Magnet, Move, PanelRight, Pencil, Plus, Redo2, RotateCw, Scaling, Trash2, Undo2, Ungroup, X } from 'lucide-react';
import FurnitureCatalog from './FurnitureCatalog.tsx';
import type { FurniturePreset } from './furnitureCatalog';
import { createFurnitureModel } from './RoomScene';
import { loadEditableModel, uploadModel } from './customModel';
import type { ModelAsset } from './customModel';
import type { FurnitureItem, FurnitureMaterial } from './types';
import useFieldDraft from './useFieldDraft';
import { parseColor, parseName, parseNumber } from './fieldDraft';
import { addModelFace, addModelVertex, clampWorkshopScale, cloneWorkshopModel, deleteModelFace, deleteModelVertex, disposeWorkshopModel, exportWorkshopGLB, fitWorkshopCamera, getEditableVertices, getModelFaces, moveModelVertex, setWorkshopColor, setWorkshopMaterial, workshopSurface } from './modelWorkshopGeometry';
import { createWorkshopPiece, WORKSHOP_PIECES, type WorkshopPiecePreset } from './workshopPieces';
import { captureWorkshopSnapshot, WorkshopHistory, type WorkshopSnapshot } from './workshopHistory';
import { startWorkshopBoolean } from './workshopBooleanClient';
import type { WorkshopBooleanOperation } from './workshopBoolean';
import { alignWorkshopPiece, snapWorkshopPiece, type WorkshopAxis, type WorkshopAlignment } from './workshopAlignment';
import { applySelectionTransform, captureSelectionTransform, createSelectionProxy, duplicateWorkshopPieces, groupWorkshopPieces, ungroupWorkshopPieces, workshopGroup, workshopSelectionUnit, type WorkshopSelectionTransform } from './workshopGrouping';
import './modelWorkshop.css';
import { registerBeforeAppUpdate } from './appOffline';

type Props = { item?: FurnitureItem; roomId: string; onSaved: (asset: ModelAsset) => boolean | void; onClose: () => void };
type Panel = 'add' | 'model' | 'pieces' | 'alignment' | 'geometry';
type Tool = 'translate' | 'rotate' | 'scale';
type GeometryTool = 'vertices' | 'faces';
type Runtime = { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: WebGLRenderer; controls: OrbitControls; transform: TransformControls; content: THREE.Group; proxy: THREE.Object3D; selectionProxy: THREE.Mesh | null; selectionTransform: WorkshopSelectionTransform | null; selectionOutlines: THREE.BoxHelper[]; outline: THREE.BoxHelper | null; toolOutline: THREE.BoxHelper | null; snapGuide: THREE.LineSegments | null; points: THREE.Points | null; face: THREE.Mesh | null; dragged: boolean; vertexIndices: number[]; vertexMesh: THREE.Mesh | null; vertexId: number; pendingNormals: boolean };
const AXES = ['x', 'y', 'z'] as const;
const numberFormat = (value: number) => Number(value.toFixed(4)).toString();
const firstMaterial = (mesh: THREE.Mesh) => (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
const OPERATIONS = [['union', 'Unir'], ['subtract', 'Restar'], ['intersect', 'Intersección']] as const;
const faceCount = (object: THREE.Mesh) => (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
const ALIGNMENT_LABELS = {
  x: ['Izquierda', 'Centro', 'Derecha', 'Al lado izquierdo', 'Al lado derecho'],
  y: ['Abajo', 'Centro', 'Arriba', 'Debajo', 'Encima'],
  z: ['Frente', 'Centro', 'Fondo', 'Delante', 'Detrás'],
};
const ALIGNMENTS: WorkshopAlignment[] = ['min', 'center', 'max', 'before', 'after'];

function NumberControl({ label, value, onChange, min = -10000, max = 10000, integer = false }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; integer?: boolean }) {
  const field = useFieldDraft({ value, format: numberFormat, parse: raw => { const next = parseNumber(raw, min, max); return next !== null && (!integer || Number.isInteger(next)) ? next : null; }, onCommit: onChange });
  return <label className="workshop-number"><span>{label}</span><input inputMode={integer ? 'numeric' : 'decimal'} {...field.inputProps} /></label>;
}

function NameControl({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const field = useFieldDraft({ value, parse: raw => parseName(raw), onCommit: onChange });
  return <label className="workshop-field"><span>{label}</span><input maxLength={80} {...field.inputProps} /></label>;
}

function ColorControl({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const field = useFieldDraft({ value, parse: parseColor, onCommit: onChange });
  return <label className="workshop-field"><span>{t('Color')}</span><span className="workshop-color"><input type="color" value={value} aria-label={t('Elegir color')} onChange={event => onChange(event.target.value)} /><input aria-label={t('Color hexadecimal')} maxLength={7} {...field.inputProps} /></span></label>;
}

function PieceThumbnail({ preset }: { preset: WorkshopPiecePreset }) {
  const longest = Math.max(preset.width, preset.height, preset.depth), w = Math.max(6, preset.width / longest * 45), h = Math.max(4, preset.height / longest * 48), d = Math.max(5, preset.depth / longest * 22);
  const x = 60 - (w + d) / 2, y = 44 + h / 2;
  return <svg viewBox="0 0 120 90" aria-hidden="true" className="workshop-piece-thumbnail" fill="#c5b49a" stroke="#98876f" strokeWidth="1.2">
    {preset.id === 'handle' ? <><rect x="27" y="38" width="66" height="13" rx="6" /><ellipse cx="88" cy="44.5" rx="5" ry="6.5" fill="#b5a186" /></> : preset.shape === 'wedge' ? <><path d="M34 64V22L80 64Z" /><path d="M34 22L49 14L95 56L80 64Z" fill="#dfcfb8" /><path d="M80 64L95 56V61L80 69Z" fill="#b5a186" /></> : preset.id === 'rosette' ? <path d="M60 18 66 29 80 24 78 38 91 44 78 50 80 65 66 59 60 71 54 59 40 65 42 50 29 44 42 38 40 24 54 29Z" /> : preset.shape === 'sphere' ? <><circle cx="60" cy="44" r="25" /><ellipse cx="60" cy="44" rx="13" ry="25" fill="none" /><path d="M36 42Q60 54 84 42" fill="none" /></> : preset.shape === 'torus' ? <><ellipse cx="60" cy="44" rx="32" ry="25" /><ellipse cx="60" cy="44" rx="19" ry="13" fill="#fcfdf9" /></> : preset.shape === 'cylinder' ? <g transform={preset.id === 'handle' ? 'rotate(90 60 44)' : undefined}><path d={`M${60 - w / 2} ${y - h}v${h}a${w / 2} ${d / 3} 0 0 0 ${w} 0v-${h}`} /><ellipse cx="60" cy={y - h} rx={w / 2} ry={d / 3} fill="#dfcfb8" /></g> : preset.shape === 'cone' ? <><path d={`M60 ${y - h}L${60 - w / 2} ${y}Q60 ${y + d / 2} ${60 + w / 2} ${y}Z`} /><path d={`M${60 - w / 2} ${y}Q60 ${y - d / 2} ${60 + w / 2} ${y}`} fill="none" /></> : <><path d={`M${x} ${y - h}l${d} -${d / 2} ${w} ${d / 2}v${h}l-${d} ${d / 2} -${w} -${d / 2}Z`} /><path d={`M${x} ${y - h}l${w} ${d / 2} ${d} -${d / 2} -${w} -${d / 2}Z`} fill="#dfcfb8" /><path d={`M${x + w} ${y - h + d / 2}v${h}l${d} -${d / 2}v-${h}Z`} fill="#b5a186" /></>}
  </svg>;
}

function removeHelper(runtime: Runtime, key: 'points' | 'face' | 'outline' | 'toolOutline' | 'snapGuide') {
  const object = runtime[key];
  if (!object) return;
  object.removeFromParent(); object.geometry.dispose();
  (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
  runtime[key] = null;
}

function clearSelectionHelpers(active: Runtime) {
  for (const outline of active.selectionOutlines) { outline.removeFromParent(); outline.geometry.dispose(); (outline.material as THREE.Material).dispose(); }
  active.selectionOutlines = [];
  if (active.selectionProxy) { active.selectionProxy.removeFromParent(); active.selectionProxy.geometry.dispose(); (active.selectionProxy.material as THREE.Material).dispose(); }
  active.selectionProxy = null; active.selectionTransform = null;
}

function showSnapGuide(active: Runtime, piece: THREE.Mesh, matches: ReturnType<typeof snapWorkshopPiece>) {
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

export default function ModelWorkshop({ item, roomId, onSaved, onClose }: Props) {
  const locale = useLocale();
  useEffect(() => registerBeforeAppUpdate(async () => { throw new Error('Guarda o cierra el modelo antes de actualizar la aplicación.'); }), []);
  const dialog = useRef<HTMLDialogElement>(null), mount = useRef<HTMLDivElement>(null), panelContent = useRef<HTMLDivElement>(null), runtime = useRef<Runtime | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [saving, setSaving] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!revision) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [revision]);
  const [selected, setSelected] = useState<string | null>(null), [panel, setPanel] = useState<Panel>(item ? 'model' : 'add'), [tool, setTool] = useState<Tool>('translate'), [geometryTool, setGeometryTool] = useState<GeometryTool>('vertices');
  const [selectedIds, setSelectedIds] = useState<string[]>([]), [multiSelect, setMultiSelect] = useState(false);
  const [palette, setPalette] = useState<'primitives' | 'prefabs' | 'furniture'>('prefabs'), [second, setSecond] = useState(''), [operation, setOperation] = useState<WorkshopBooleanOperation>('union');
  const [computing, setComputing] = useState(false), [previewing, setPreviewing] = useState(false);
  const history = useRef(new WorkshopHistory()), dragSnapshot = useRef<WorkshopSnapshot | null>(null);
  const booleanJob = useRef<ReturnType<typeof startWorkshopBoolean> | null>(null);
  const booleanSequence = useRef(0);
  const preview = useRef<{ result: THREE.Mesh; base: THREE.Mesh; cutter: THREE.Mesh; visibility: [boolean, boolean] } | null>(null);
  const [vertexId, setVertexId] = useState(0), [faceId, setFaceId] = useState(0), [faceVertices, setFaceVertices] = useState<[number, number, number]>([0, 1, 2]);
  const [name, setName] = useState(item?.name ?? t('Mi modelo'));
  const [panelOpen, setPanelOpen] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true), [snapGrid, setSnapGrid] = useState(true), [snapPieces, setSnapPieces] = useState(true), [gridStep, setGridStep] = useState(.05), [angleStep, setAngleStep] = useState(15);
  const [alignmentReference, setAlignmentReference] = useState(''), [alignmentAxis, setAlignmentAxis] = useState<WorkshopAxis>('x');
  const latest = useRef({ selected, selectedIds, multiSelect, panel, tool, geometryTool, vertexId, faceId, saving, computing, previewing, name, snapEnabled, snapGrid, snapPieces, gridStep });
  latest.current = { selected, selectedIds, multiSelect, panel, tool, geometryTool, vertexId, faceId, saving, computing, previewing, name, snapEnabled, snapGrid, snapPieces, gridStep };
  const change = () => { setRevision(value => value + 1); setError(''); };
  const pieces = (runtime.current?.content.children ?? []).filter((object): object is THREE.Mesh => object instanceof THREE.Mesh);
  const mesh = pieces.find(piece => piece.uuid === selected);
  const selection = pieces.filter(piece => selectedIds.includes(piece.uuid));
  const isMultiple = selection.length > 1;
  const commonGroup = isMultiple && mesh && workshopGroup(mesh) && selection.every(piece => workshopGroup(piece)?.id === workshopGroup(mesh)?.id) ? workshopGroup(mesh) : null;
  const vertices = mesh && panel === 'geometry' ? getEditableVertices(mesh.geometry) : [];
  const faces = mesh && panel === 'geometry' && geometryTool === 'faces' ? getModelFaces(mesh.geometry) : [];
  const vertex = vertices[Math.min(vertexId, Math.max(0, vertices.length - 1))];
  const reference = pieces.find(piece => piece.uuid === alignmentReference && !selectedIds.includes(piece.uuid));

  useEffect(() => {
    runtime.current?.renderer.domElement.setAttribute('aria-label', t('Editor de modelo 3D. Selecciona una pieza y arrastra los controles para editarla.'));
  }, [locale, ready]);

  function selectIds(ids: string[], primary = ids[0] ?? null) {
    setSelectedIds(ids); setSelected(primary); setSecond(value => ids.includes(value) ? '' : value);
    setVertexId(0); setFaceId(0); setFaceVertices([0, 1, 2]);
  }
  function selectPiece(piece: THREE.Mesh | null, options: { toggle?: boolean; individual?: boolean } = {}) {
    const all = (runtime.current?.content.children ?? []).filter((object): object is THREE.Mesh => object instanceof THREE.Mesh);
    if (piece && latest.current.selected && piece.uuid !== latest.current.selected) setAlignmentReference(latest.current.selected);
    const unit = piece ? options.individual ? [piece] : workshopSelectionUnit(piece, all) : [];
    if (options.toggle) {
      const unitIds = unit.map(value => value.uuid), current = latest.current.selectedIds;
      const ids = unitIds.some(id => current.includes(id)) ? current.filter(id => !unitIds.includes(id)) : [...new Set([...current, ...unitIds])];
      selectIds(ids, piece && ids.includes(piece.uuid) ? piece.uuid : ids[0]);
    } else selectIds(unit.map(value => value.uuid), piece?.uuid);
  }
  function discardPreview() {
    booleanSequence.current++;
    booleanJob.current?.cancel(); booleanJob.current = null;
    const value = preview.current;
    if (value) { value.base.visible = value.visibility[0]; value.cutter.visible = value.visibility[1]; value.result.removeFromParent(); disposeWorkshopModel(new THREE.Group().add(value.result)); preview.current = null; }
    setPreviewing(false); setComputing(false);
  }
  function restore(snapshot: WorkshopSnapshot) {
    const active = runtime.current;
    if (!active) { disposeWorkshopModel(snapshot.content); return; }
    active.transform.detach();
    clearSelectionHelpers(active);
    for (const key of ['points', 'face', 'outline', 'toolOutline', 'snapGuide'] as const) removeHelper(active, key);
    disposeWorkshopModel(active.content);
    while (snapshot.content.children.length) active.content.add(snapshot.content.children[0]);
    setName(snapshot.name); setSelected(snapshot.selected); setSelectedIds(snapshot.selectedIds); setSecond(''); setVertexId(0); setFaceId(0); change();
  }
  function run(action: () => void | boolean, key?: string) {
    const active = runtime.current;
    if (!active || active.transform.dragging || latest.current.saving || latest.current.computing || latest.current.previewing) return;
    const before = captureWorkshopSnapshot(active.content, latest.current.selected, latest.current.name, latest.current.selectedIds);
    try { if (action() === false) { disposeWorkshopModel(before.content); return; } if (active.content.children.reduce((sum, piece) => sum + faceCount(piece as THREE.Mesh), 0) > 200000) throw new Error('El modelo admite hasta 200 000 caras.'); history.current.record(before, key); change(); }
    catch (cause) { restore(before); setError(cause instanceof Error ? cause.message : "No se pudo hacer el cambio."); }
  }
  function travelHistory(direction: 'undo' | 'redo') {
    const active = runtime.current;
    if (!active || active.transform.dragging || latest.current.saving || latest.current.computing) return;
    discardPreview();
    const current = captureWorkshopSnapshot(active.content, selected, name, selectedIds);
    const previous = history.current[direction](current);
    if (previous) restore(previous);
  }
  async function previewBoolean() {
    const active = runtime.current, cutter = pieces.find(piece => piece.uuid === second);
    if (!active || active.transform.dragging || !mesh || !cutter || computing || isMultiple) return;
    discardPreview(); const sequence = booleanSequence.current; setError(''); setComputing(true);
    try {
      const job = startWorkshopBoolean(mesh, cutter, operation); booleanJob.current = job;
      const result = await job.promise;
      if (booleanJob.current !== job || runtime.current !== active) { disposeWorkshopModel(new THREE.Group().add(result)); return; }
      booleanJob.current = null;
      preview.current = { result, base: mesh, cutter, visibility: [mesh.visible, cutter.visible] };
      mesh.visible = cutter.visible = false; active.scene.add(result); active.transform.detach();
      for (const key of ['points', 'face', 'outline', 'toolOutline', 'snapGuide'] as const) removeHelper(active, key);
      setPreviewing(true); setComputing(false);
    } catch (cause) {
      if (runtime.current === active && booleanSequence.current === sequence) { booleanJob.current = null; setError(cause instanceof Error ? cause.message : "No se pudo combinar las piezas."); setComputing(false); }
    }
  }
  function applyBoolean() {
    const value = preview.current, active = runtime.current;
    if (!value || !active) return;
    if (pieces.filter(piece => piece !== value.base && piece !== value.cutter).reduce((sum, piece) => sum + faceCount(piece), faceCount(value.result)) > 200000) { setError('El resultado supera las 200 000 caras del modelo.'); return; }
    value.base.visible = value.visibility[0]; value.cutter.visible = value.visibility[1];
    const before = captureWorkshopSnapshot(active.content, selected, name, selectedIds);
    const group = workshopGroup(value.base);
    if (group) value.result.userData.workshopGroup = group;
    active.transform.detach(); value.base.removeFromParent(); value.cutter.removeFromParent();
    disposeWorkshopModel(new THREE.Group().add(value.base, value.cutter));
    active.content.add(value.result); preview.current = null;
    setPreviewing(false); setSecond(''); selectPiece(value.result); history.current.record(before); change();
  }
  function frameModel() {
    const active = runtime.current;
    if (!active || !active.content.children.length) return;
    active.content.updateWorldMatrix(true, true);
    const host = mount.current, aspect = host && host.clientHeight ? host.clientWidth / host.clientHeight : active.camera.aspect;
    const center = fitWorkshopCamera(active.camera, new THREE.Box3().setFromObject(active.content), aspect);
    active.controls.target.copy(center); active.controls.update();
  }

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  useEffect(() => { if (panelContent.current) panelContent.current.scrollTop = 0; }, [panel]);

  useEffect(() => {
    const host = mount.current;
    if (!host) return;
    let cancelled = false, source: THREE.Group | null = null;
    let active: Runtime | null = null, observer: ResizeObserver | null = null;
    let removeEvents = () => {};
    void (async () => {
      try {
        const renderer = new WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(2, window.devicePixelRatio)); renderer.setClearColor('#edf0e8'); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
        const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 1, .01, 1000), content = new THREE.Group(), proxy = new THREE.Object3D();
        scene.add(content, proxy, new THREE.HemisphereLight('#ffffff', '#68705e', 2.4));
        const sun = new THREE.DirectionalLight('#fff6e5', 3); sun.position.set(4, 7, 5); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); scene.add(sun);
        const grid = new THREE.GridHelper(10, 10, '#a0ac98', '#d3dbca'); grid.position.y = -.006; scene.add(grid);
        const canvas = renderer.domElement; canvas.setAttribute('aria-label', t('Editor de modelo 3D. Selecciona una pieza y arrastra los controles para editarla.')); canvas.tabIndex = 0; host.append(canvas);
        const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = .08;
        camera.position.set(1.8, 1.2, 1.8); controls.target.set(0, .25, 0); controls.update();
        const transform = new TransformControls(camera, canvas); transform.setSize(window.matchMedia('(pointer: coarse)').matches ? 1.35 : 1.05); transform.setColors('#ce756a', '#819968', '#6d97b4', '#d7ab5b'); scene.add(transform.getHelper());
        active = { scene, camera, renderer, controls, transform, content, proxy, selectionProxy: null, selectionTransform: null, selectionOutlines: [], outline: null, toolOutline: null, snapGuide: null, points: null, face: null, dragged: false, vertexIndices: [], vertexMesh: null, vertexId: 0, pendingNormals: false };
        runtime.current = active;
        const value = active;
        const resize = () => {
          const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight); renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
          const focused = document.activeElement;
          if (focused instanceof HTMLInputElement && dialog.current?.contains(focused)) requestAnimationFrame(() => { if (focused.isConnected && document.activeElement === focused) focused.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
        };
        observer = new ResizeObserver(resize); observer.observe(host); resize();
        let down = { x: 0, y: 0 };
        const pointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; value.dragged = false; };
        const pointerUp = (event: PointerEvent) => {
          if (latest.current.saving || latest.current.computing || latest.current.previewing || value.dragged || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
          const rect = canvas.getBoundingClientRect(), ray = new THREE.Raycaster();
          ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
          if (latest.current.panel === 'geometry' && latest.current.geometryTool === 'vertices') {
            const selectedMesh = content.children.find(object => object.uuid === latest.current.selected);
            if (selectedMesh instanceof THREE.Mesh) {
              let nearest: { id: number; distance: number; depth: number } | null = null;
              const limit = window.matchMedia('(pointer: coarse)').matches ? 20 : 12;
              for (const vertex of getEditableVertices(selectedMesh.geometry)) {
                const point = new THREE.Vector3(...vertex.position).applyMatrix4(selectedMesh.matrixWorld).project(camera);
                if (point.z < -1 || point.z > 1) continue;
                const distance = ((point.x + 1) / 2 * rect.width - (event.clientX - rect.left)) ** 2 + ((1 - point.y) / 2 * rect.height - (event.clientY - rect.top)) ** 2;
                if (distance <= limit * limit && (!nearest || distance < nearest.distance - .01 || Math.abs(distance - nearest.distance) < .01 && point.z < nearest.depth)) nearest = { id: vertex.id, distance, depth: point.z };
              }
              if (nearest) { setVertexId(nearest.id); return; }
            }
          }
          const hit = ray.intersectObjects(content.children, false)[0];
          if (!hit || !(hit.object instanceof THREE.Mesh)) return;
          const selectedMesh = hit.object;
          if (latest.current.panel === 'geometry' && selectedMesh.uuid === latest.current.selected) {
            if (latest.current.geometryTool === 'faces') setFaceId(hit.faceIndex ?? 0);
            else if (hit.face) {
              const indices = [hit.face.a, hit.face.b, hit.face.c], position = selectedMesh.geometry.getAttribute('position');
              indices.sort((a, b) => new THREE.Vector3().fromBufferAttribute(position, a).applyMatrix4(selectedMesh.matrixWorld).distanceToSquared(hit.point) - new THREE.Vector3().fromBufferAttribute(position, b).applyMatrix4(selectedMesh.matrixWorld).distanceToSquared(hit.point));
              const id = getEditableVertices(selectedMesh.geometry).find(vertex => vertex.indices.includes(indices[0]))?.id;
              if (id !== undefined) setVertexId(id);
            }
          } else {
            selectPiece(selectedMesh, { toggle: latest.current.panel !== 'geometry' && (event.shiftKey || event.ctrlKey || event.metaKey || latest.current.multiSelect), individual: latest.current.panel === 'geometry' });
            if (latest.current.panel === 'add') setPanel('model');
          }
        };
        const changed = () => {
          if (latest.current.saving || latest.current.computing || latest.current.previewing) return;
          value.dragged = true;
          if (value.transform.object === proxy && value.vertexMesh) {
            const target = value.vertexMesh, local = target.worldToLocal(proxy.position.clone()), position = target.geometry.getAttribute('position');
            if (!local.toArray().every(component => Number.isFinite(component) && Math.abs(component) <= 10000)) return;
            for (const index of value.vertexIndices) position.setXYZ(index, ...local.toArray() as [number, number, number]);
            position.needsUpdate = true; value.pendingNormals = true;
            if (value.points) { value.points.geometry.getAttribute('position').setXYZ(value.vertexId, ...local.toArray() as [number, number, number]); value.points.geometry.getAttribute('position').needsUpdate = true; }
          } else {
            const object = value.transform.object;
            if (object) {
              for (const axis of AXES) object.position[axis] = THREE.MathUtils.clamp(object.position[axis], -10000, 10000); clampWorkshopScale(object.scale);
              if (object instanceof THREE.Mesh && value.transform.mode === 'translate' && latest.current.snapEnabled) {
                const axes = AXES.filter(axis => value.transform.axis?.includes(axis.toUpperCase()));
                const tolerance = THREE.MathUtils.clamp(2 * camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.max(1, host.clientHeight) * (window.matchMedia('(pointer: coarse)').matches ? 14 : 8), .002, .06);
                showSnapGuide(value, object, snapWorkshopPiece(object, content.children.filter((piece): piece is THREE.Mesh => piece instanceof THREE.Mesh && (object !== value.selectionProxy || !latest.current.selectedIds.includes(piece.uuid))), axes, { grid: latest.current.snapGrid ? latest.current.gridStep : null, pieces: latest.current.snapPieces, tolerance }));
              } else removeHelper(value, 'snapGuide');
              if (object === value.selectionProxy && value.selectionTransform) applySelectionTransform(value.selectionTransform, object.position, object.quaternion);
            }
          }
          value.outline?.update();
        };
        const dragging = (event: { value: unknown }) => {
          controls.enabled = !event.value;
          if (event.value) {
            value.dragged = false; dragSnapshot.current = captureWorkshopSnapshot(content, latest.current.selected, latest.current.name, latest.current.selectedIds);
            if (value.selectionProxy) value.selectionTransform = captureSelectionTransform(content.children.filter((piece): piece is THREE.Mesh => piece instanceof THREE.Mesh && latest.current.selectedIds.includes(piece.uuid)));
          }
          if (!event.value) {
            removeHelper(value, 'snapGuide');
            if (value.pendingNormals && value.vertexMesh) { value.vertexMesh.geometry.computeVertexNormals(); value.vertexMesh.geometry.computeBoundingBox(); value.vertexMesh.geometry.computeBoundingSphere(); const raw = value.vertexIndices[0]; const welded = getEditableVertices(value.vertexMesh.geometry).find(vertex => vertex.indices.includes(raw)); if (welded) setVertexId(welded.id); value.pendingNormals = false; }
            if (dragSnapshot.current) {
              const moved = content.children.some(object => { const before = dragSnapshot.current!.content.children.find(piece => piece.uuid === object.uuid); return before && (!object.position.equals(before.position) || !object.quaternion.equals(before.quaternion) || !object.scale.equals(before.scale)); });
              if (value.dragged && (value.vertexMesh || moved)) history.current.record(dragSnapshot.current); else disposeWorkshopModel(dragSnapshot.current.content);
              dragSnapshot.current = null;
            }
            change();
          }
        };
        canvas.addEventListener('pointerdown', pointerDown, true); canvas.addEventListener('pointerup', pointerUp);
        transform.addEventListener('objectChange', changed); transform.addEventListener('dragging-changed', dragging);
        removeEvents = () => { canvas.removeEventListener('pointerdown', pointerDown, true); canvas.removeEventListener('pointerup', pointerUp); transform.removeEventListener('objectChange', changed); transform.removeEventListener('dragging-changed', dragging); };
        renderer.setAnimationLoop(() => { if (!cancelled) { controls.update(); value.outline?.update(); value.toolOutline?.update(); value.selectionOutlines.forEach(outline => outline.update()); renderer.render(scene, camera); } });
        if (item) source = item.type === 'custom' ? await loadEditableModel(item, roomId) : createFurnitureModel(item);
        else source = new THREE.Group();
        if (cancelled) { releaseSource(source); source = null; return; }
        const model = cloneWorkshopModel(source);
        if (item && item.type !== 'custom') model.children.forEach((piece, index) => {
          piece.name = piece.name === `Pieza ${index + 1}` ? t('Pieza {{number}}', { number: index + 1 }) : t(piece.name);
        });
        while (model.children.length) content.add(model.children[0]);
        selectPiece(content.children[0] as THREE.Mesh ?? null); setReady(true); change(); requestAnimationFrame(frameModel);
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : "No se pudo abrir el modelo."); }
    })();
    return () => {
      cancelled = true; observer?.disconnect(); removeEvents();
      booleanSequence.current++; booleanJob.current?.cancel(); booleanJob.current = null; preview.current = null;
      history.current.clear(); if (dragSnapshot.current) disposeWorkshopModel(dragSnapshot.current.content); dragSnapshot.current = null;
      if (active) { active.renderer.setAnimationLoop(null); active.transform.detach(); clearSelectionHelpers(active); active.scene.remove(active.transform.getHelper()); active.transform.dispose(); active.controls.dispose(); disposeWorkshopModel(active.scene); active.renderer.dispose(); active.renderer.domElement.remove(); }
      if (source) releaseSource(source);
      runtime.current = null;
    };
  }, [item?.id, roomId]);

  function releaseSource(source: THREE.Group) {
    const dispose = source.userData.disposeEditorModel as (() => void) | undefined;
    if (dispose) dispose(); else disposeWorkshopModel(source);
  }

  useEffect(() => {
    const active = runtime.current;
    if (!active || !ready) return;
    active.transform.setTranslationSnap(snapEnabled && snapGrid && panel === 'geometry' ? gridStep : null);
    active.transform.setRotationSnap(snapEnabled ? THREE.MathUtils.degToRad(angleStep) : null);
    if (!snapEnabled) removeHelper(active, 'snapGuide');
  }, [ready, snapEnabled, snapGrid, gridStep, angleStep, panel]);

  useEffect(() => {
    const active = runtime.current;
    if (!active || !ready || !snapEnabled || !snapGrid) return;
    const size = Math.min(10, gridStep * 200), grid = new THREE.GridHelper(size, Math.round(size / gridStep), '#bdc9b1', '#dce3d5');
    grid.position.y = -.004; active.scene.add(grid);
    return () => { grid.removeFromParent(); grid.geometry.dispose(); (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach(material => material.dispose()); };
  }, [ready, snapEnabled, snapGrid, gridStep]);

  useEffect(() => {
    const active = runtime.current;
    if (!active || !ready) return;
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
  }, [ready, selected, selectedIds, second, alignmentReference, panel, tool, geometryTool, vertexId, faceId, revision, saving, computing, previewing]);

  function addPiece(id: string) {
    run(() => {
      const content = runtime.current?.content;
      if (!content) return;
      if (content.children.length >= 511) throw new Error('El modelo admite hasta 511 piezas.');
      const first = !content.children.length;
      const piece = createWorkshopPiece(id);
      piece.name = t(piece.name);
      if (mesh) { piece.position.x = mesh.position.x + .15; piece.position.z = mesh.position.z + .15; }
      content.add(piece); selectPiece(piece); setPanel('model');
      if (first) requestAnimationFrame(frameModel);
    });
  }
  function addFurniture(preset: FurniturePreset) {
    const active = runtime.current;
    if (!active) return;
    run(() => {
      const original = createFurnitureModel({ id: crypto.randomUUID(), type: preset.type, variant: preset.id, material: 'wood', color: '#b8a084', width: preset.width, height: preset.height, depth: preset.depth, x: 0, z: 0, rotation: 0 });
      const model = cloneWorkshopModel(original); releaseSource(original);
      if (active.content.children.length + model.children.length > 511) { disposeWorkshopModel(model); throw new Error('El modelo admite hasta 511 piezas.'); }
      const first = model.children[0] as THREE.Mesh;
      const offset = active.content.children.length ? new THREE.Box3().setFromObject(active.content).max.x + preset.width / 2 + .15 : 0;
      for (const piece of model.children) { piece.position.x += offset; piece.name = `${t(preset.label)} · ${t(piece.name)}`.slice(0, 80); }
      while (model.children.length) active.content.add(model.children[0]);
      selectPiece(first); setPanel('model'); frameModel();
    });
  }
  function duplicatePiece() {
    if (!selection.length) return;
    run(() => {
      const content = runtime.current!.content;
      if (content.children.length + selection.length > 511) throw new Error('El modelo admite hasta 511 piezas.');
      const copies = duplicateWorkshopPieces(selection);
      copies.forEach((copy, index) => {
        copy.name = t('{{name}} copia', { name: selection[index].name }).slice(0, 80);
        const group = workshopGroup(copy), original = workshopGroup(selection[index]);
        if (group && original) copy.userData.workshopGroup = { ...group, name: t('{{name}} copia', { name: original.name }).slice(0, 80) };
      });
      content.add(...copies); selectIds(copies.map(piece => piece.uuid));
    });
  }
  function deletePiece() {
    if (!selection.length) return;
    run(() => { const active = runtime.current!; active.transform.detach(); for (const piece of selection) piece.removeFromParent(); disposeWorkshopModel(new THREE.Group().add(...selection)); selectPiece(active.content.children[0] as THREE.Mesh ?? null); });
  }
  function groupSelection() {
    run(() => {
      const count = new Set(pieces.map(piece => workshopGroup(piece)?.id).filter(Boolean)).size;
      return groupWorkshopPieces(selection, t('Grupo {{number}}', { number: count + 1 }));
    });
  }
  function ungroupSelection() {
    run(() => { const ids = new Set(selection.map(piece => workshopGroup(piece)?.id).filter(Boolean)); ungroupWorkshopPieces(pieces.filter(piece => ids.has(workshopGroup(piece)?.id))); });
  }
  function moveSelection(axis: WorkshopAxis, value: number) {
    run(() => { const snapshot = captureSelectionTransform(selection), position = snapshot.center.clone(); position[axis] = value; return applySelectionTransform(snapshot, position); }, `selection-position-${selectedIds.join('-')}-${axis}`);
  }
  function alignSelection(alignment: WorkshopAlignment) {
    if (!reference || !selection.length) return;
    run(() => {
      if (selection.length === 1) return alignWorkshopPiece(selection[0], reference, alignmentAxis, alignment);
      const proxy = createSelectionProxy(selection), snapshot = captureSelectionTransform(selection); runtime.current!.content.add(proxy);
      try { if (!alignWorkshopPiece(proxy, reference, alignmentAxis, alignment)) return false; return applySelectionTransform(snapshot, proxy.position); }
      finally { proxy.removeFromParent(); proxy.geometry.dispose(); (proxy.material as THREE.Material).dispose(); }
    });
  }
  async function save() {
    const active = runtime.current, modelName = parseName(name);
    if (!active || active.transform.dragging || saving || computing || previewing) return;
    if (!modelName) { setError('Escribe el nombre del modelo.'); return; }
    setSaving(true); setError('');
    try { const bytes = await exportWorkshopGLB(active.content), file = new File([bytes], `${modelName}.glb`, { type: 'model/gltf-binary' }); const asset = await uploadModel(file, roomId); if (onSaved(asset) === false) { setError('El modelo está guardado en Modelos propios. No se pudo añadir al diseño.'); setSaving(false); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el modelo."); setSaving(false); }
  }
  function setVertexCoordinate(axis: number, value: number) {
    if (!mesh || !vertex) return;
    run(() => { const point: [number, number, number] = [...vertex.position]; point[axis] = value; const raw = vertex.indices[0]; moveModelVertex(mesh.geometry, vertex.id, point); setVertexId(getEditableVertices(mesh.geometry).find(next => next.indices.includes(raw))!.id); }, `vertex-${mesh.uuid}-${vertex.indices[0]}-${axis}`);
  }
  function addVertex() {
    if (!mesh) return;
    run(() => {
      const point: [number, number, number] = vertex ? [...vertex.position] : [0, .25, 0];
      const existing = getEditableVertices(mesh.geometry);
      point[0] += .1;
      while (existing.some(candidate => candidate.position.every((value, i) => Math.abs(value - point[i]) < .000001))) point[0] += .1;
      setVertexId(addModelVertex(mesh.geometry, point));
    });
  }

  const locked = saving || computing || previewing;
  if (mesh && !mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const dimensions = mesh ? mesh.geometry.boundingBox!.getSize(new THREE.Vector3()) : new THREE.Vector3();
  const openPanel = (next: Panel) => { if (locked) return; if (next === 'geometry' && mesh) { selectPiece(mesh, { individual: true }); setMultiSelect(false); } setPanel(next); setPanelOpen(true); };
  const selectionCenter = isMultiple ? captureSelectionTransform(selection).center : null;
  const selectionActions = <div className="workshop-selection-actions">
    <button type="button" disabled={selection.length < 2 || !!commonGroup} onClick={groupSelection}><Group size={17} />{t('Agrupar')}</button>
    <button type="button" disabled={!selection.some(piece => workshopGroup(piece))} onClick={ungroupSelection}><Ungroup size={17} />{t('Desagrupar')}</button>
    <button type="button" disabled={!selection.length} onClick={duplicatePiece}><Copy size={17} />{t('Duplicar')}</button>
    <button type="button" disabled={!selection.length} onClick={deletePiece}><Trash2 size={17} />{t('Eliminar')}</button>
  </div>;
  const alignmentPanel = <>
    <div className="workshop-snap-options">
      <details className="workshop-transforms"><summary>{t('Opciones de snap')}</summary>
        <label className="workshop-toggle"><input type="checkbox" checked={snapEnabled} onChange={event => setSnapEnabled(event.target.checked)} />{t('Snap al mover y girar')}</label>
        <div className="workshop-snap-targets"><label className="workshop-toggle"><input type="checkbox" checked={snapGrid} onChange={event => setSnapGrid(event.target.checked)} />{t('Cuadrícula')}</label><label className="workshop-toggle"><input type="checkbox" checked={snapPieces} onChange={event => setSnapPieces(event.target.checked)} />{t('Entre piezas')}</label></div>
        <div className="workshop-snap-steps"><label className="workshop-field"><span>{t('Paso')}</span><select value={gridStep} onChange={event => setGridStep(Number(event.target.value))}>{[.01, .05, .1, .25].map(step => <option value={step} key={step}>{step * 100} cm</option>)}</select></label><label className="workshop-field"><span>{t('Giro')}</span><select value={angleStep} onChange={event => setAngleStep(Number(event.target.value))}>{[5, 15, 30, 45, 90].map(step => <option value={step} key={step}>{step}°</option>)}</select></label></div>
      </details>
    </div>
    <div className="workshop-align-targets"><label className="workshop-field"><span>{isMultiple ? t('{{count}} piezas a mover', { count: selection.length }) : t('Pieza a mover')}</span><select value={selected ?? ''} onChange={event => selectPiece(pieces.find(piece => piece.uuid === event.target.value) ?? null)}><option value="" disabled>{t('Seleccionar')}</option>{pieces.map((piece, index) => <option key={piece.uuid} value={piece.uuid}>{piece.name} · {index + 1}</option>)}</select></label>
    <label className="workshop-field"><span>{t('Alinear con')}</span><select value={reference?.uuid ?? ''} onChange={event => setAlignmentReference(event.target.value)}><option value="">{t('Seleccionar pieza')}</option>{pieces.filter(piece => !selectedIds.includes(piece.uuid)).map(piece => <option key={piece.uuid} value={piece.uuid}>{piece.name} · {pieces.indexOf(piece) + 1}</option>)}</select></label></div>
    <div className="workshop-alignment-axis" role="group" aria-label={t('Eje de alineación')}>{([['x', "Ancho"], ['y', "Altura"], ['z', "Fondo"]] as const).map(([axis, label]) => <button type="button" key={axis} aria-pressed={alignmentAxis === axis} onClick={() => setAlignmentAxis(axis)}>{t(label)}</button>)}</div>
    <div className="workshop-align-buttons" role="group" aria-label={t('Alinear bordes o centro')}>{ALIGNMENTS.slice(0, 3).map((alignment, index) => <button type="button" key={alignment} disabled={!mesh || !reference} onClick={() => alignSelection(alignment)}>{t(ALIGNMENT_LABELS[alignmentAxis][index])}</button>)}</div>
    <div className="workshop-align-buttons is-contact" role="group" aria-label={t('Juntar piezas')}>{ALIGNMENTS.slice(3).map((alignment, index) => <button type="button" key={alignment} disabled={!mesh || !reference} onClick={() => alignSelection(alignment)}>{t(ALIGNMENT_LABELS[alignmentAxis][index + 3])}</button>)}</div>
  </>;
  const geometryPanel = mesh ? <>
    <label className="workshop-field"><span>{t('Pieza')}</span><select value={selected ?? ''} onChange={event => selectPiece(pieces.find(piece => piece.uuid === event.target.value) ?? null, { individual: true })}>{pieces.map((piece, i) => <option key={piece.uuid} value={piece.uuid}>{piece.name} · {i + 1}</option>)}</select></label>
    <div className="workshop-geometry-tabs"><button type="button" aria-pressed={geometryTool === 'vertices'} onClick={() => setGeometryTool('vertices')}>{t('Vértices')}</button><button type="button" aria-pressed={geometryTool === 'faces'} onClick={() => setGeometryTool('faces')}>{t('Caras')}</button></div>
    {geometryTool === 'vertices' ? <>
      {vertex && <><NumberControl label={t('Vértice (0–{{max}})', { max: vertices.length - 1 })} value={vertex.id} min={0} max={vertices.length - 1} integer onChange={setVertexId} /><div className="workshop-coordinates">{AXES.map((axis, i) => <NumberControl key={axis} label={axis.toUpperCase()} value={vertex.position[i]} onChange={value => setVertexCoordinate(i, value)} />)}</div></>}
      <div className="workshop-piece-actions"><button type="button" onClick={addVertex}>{t('Agregar vértice')}</button><button type="button" disabled={!vertex} onClick={() => run(() => { deleteModelVertex(mesh.geometry, vertex!.id); setVertexId(0); })}><Trash2 size={17} />{t('Eliminar')}</button></div>
    </> : <>
      {faces.length > 0 && <><NumberControl label={t('Cara (0–{{max}})', { max: faces.length - 1 })} value={Math.min(faceId, faces.length - 1)} min={0} max={faces.length - 1} integer onChange={setFaceId} /><span className="workshop-face-vertices">{t('Vértices: {{vertices}}', { vertices: (faces[Math.min(faceId, faces.length - 1)] ?? []).join(', ') })}</span><button type="button" className="workshop-delete-face" onClick={() => run(() => { deleteModelFace(mesh.geometry, Math.min(faceId, faces.length - 1)); setFaceId(0); })}><Trash2 size={17} />{t('Eliminar cara')}</button></>}
      <div className="workshop-group"><span>{t('Nueva cara')}</span><div className="workshop-coordinates">{faceVertices.map((value, i) => <NumberControl key={i} label={t('Vértice {{number}}', { number: i + 1 })} value={value} min={0} max={Math.max(0, vertices.length - 1)} integer onChange={next => setFaceVertices(previous => previous.map((value, index) => index === i ? next : value) as [number, number, number])} />)}</div><button type="button" onClick={() => run(() => { addModelFace(mesh.geometry, faceVertices); setFaceId(getModelFaces(mesh.geometry).length - 1); })}>{t('Agregar cara')}</button></div>
    </>}
  </> : <p className="workshop-empty">{t('Selecciona una pieza.')}</p>;

  return <dialog ref={dialog} className={'model-workshop' + (!pieces.length ? ' is-empty' : '') + (panel === 'alignment' || panel === 'pieces' ? ' is-aligning' : '')} aria-labelledby="workshop-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }} onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !(event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) { event.preventDefault(); travelHistory(event.shiftKey ? 'redo' : 'undo'); }
  }}>
    <header className="workshop-header"><h2 id="workshop-title">{item ? t('Editar modelo') : t('Crear modelo')}</h2><button type="button" className="workshop-save primary-button" onClick={() => void save()} disabled={!ready || locked || !pieces.length}>{saving && <LoaderCircle size={17} className="saving-spinner" />}{saving ? t('Guardando') : item ? t('Guardar copia') : t('Guardar modelo')}</button><button type="button" className="icon-button" aria-label={t('Cerrar editor de modelo')} onClick={onClose} disabled={saving}><X size={22} /></button></header>
    {(computing || previewing) && <div className="workshop-operation-status" role="status"><span>{computing ? <><LoaderCircle size={17} className="saving-spinner" />{t('Calculando…')}</> : t('Vista previa')}</span>{previewing && <button type="button" className="primary-button" onClick={applyBoolean}>{t('Aplicar')}</button>}<button type="button" className="outline-button" onClick={discardPreview}>{t('Cancelar')}</button></div>}
    <div className={`workshop-workspace${panelOpen ? '' : ' is-panel-hidden'}`}>
      <section className="workshop-viewport"><div ref={mount} className="workshop-canvas" />{!ready && !error && <div className="workshop-loading"><LoaderCircle size={24} className="saving-spinner" /></div>}
        <div className="workshop-tools" aria-label={t('Herramientas de modelo')}>
          <button type="button" className="workshop-add" onClick={() => openPanel('add')} disabled={!ready || locked} aria-label={t('Agregar pieza')}><Plus size={18} /><span>{t('Agregar')}</span></button>
          <button type="button" aria-label={t('Deshacer')} title={t('Deshacer (Ctrl+Z)')} disabled={!ready || saving || computing || !history.current.canUndo} onClick={() => travelHistory('undo')}><Undo2 size={20} /></button>
          <button type="button" aria-label={t('Rehacer')} title={t('Rehacer (Ctrl+Mayús+Z)')} disabled={!ready || locked || !history.current.canRedo} onClick={() => travelHistory('redo')}><Redo2 size={20} /></button>
          {([['translate', Move, "Mover"], ['rotate', RotateCw, "Girar"], ['scale', Scaling, "Tamaño"]] as const).map(([mode, Icon, label]) => <button type="button" key={mode} aria-label={t(label)} title={t(label)} aria-pressed={tool === mode && panel !== 'geometry' && (!isMultiple || mode !== 'scale')} disabled={locked || panel === 'geometry' || !mesh || isMultiple && mode === 'scale'} onClick={() => setTool(mode)}><Icon size={20} /></button>)}
          <button type="button" className="workshop-snap" aria-label={t('Snap')} title={snapEnabled ? t('Desactivar snap') : t('Activar snap')} aria-pressed={snapEnabled} disabled={!ready || locked} onClick={() => setSnapEnabled(value => !value)}><Magnet size={19} /><span>{t('Snap')}</span></button>
          <button type="button" className="workshop-center" aria-label={t('Centrar')} title={t('Centrar')} onClick={frameModel} disabled={!ready || !pieces.length}><Focus size={20} /><span>{t('Centrar')}</span></button><button type="button" aria-label={panelOpen ? t('Ocultar panel') : t('Mostrar panel')} title={panelOpen ? t('Ocultar panel') : t('Mostrar panel')} aria-expanded={panelOpen} aria-controls="workshop-panel" onClick={() => setPanelOpen(value => !value)}><PanelRight size={20} /></button>
        </div>
      </section>
      <aside id="workshop-panel" className="workshop-panel" hidden={!panelOpen}>
        <nav className="workshop-tabs" aria-label={t('Panel del modelo')}>{([['add', "Agregar"], ['model', "Editar"], ['pieces', "Piezas"], ['alignment', "Alinear"], ['geometry', "Geometría"]] as const).map(([tab, label]) => <button key={tab} type="button" disabled={locked} aria-pressed={panel === tab} onClick={() => openPanel(tab)}>{t(label)}</button>)}</nav>
        <div ref={panelContent} className="workshop-panel-content"><fieldset disabled={!ready || locked}>
          {panel !== 'add' && panel !== 'geometry' && <div className="workshop-selection-bar"><label className="workshop-toggle"><input type="checkbox" checked={multiSelect} onChange={event => setMultiSelect(event.target.checked)} />{t('Seleccionar varias')}</label><span aria-live="polite">{t('{{count}} seleccionadas', { count: selection.length })}</span></div>}
          {panel === 'add' ? <>
            <nav className="workshop-palette-tabs" aria-label={t('Tipo de pieza')}>{([['primitives', "Formas"], ['prefabs', "Piezas"], ['furniture', "Muebles"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={palette === value} onClick={() => setPalette(value)}>{t(label)}</button>)}</nav>
            {palette === 'furniture' ? <FurnitureCatalog onSelect={addFurniture} /> : <div className="workshop-piece-grid">{WORKSHOP_PIECES.filter(preset => preset.category === palette).map(preset => <button type="button" key={preset.id} aria-label={t('Agregar {{name}}', { name: t(preset.label) })} onClick={() => addPiece(preset.id)}><PieceThumbnail preset={preset} /><span>{t(preset.label)}</span></button>)}</div>}
          </> : panel === 'model' ? <>
            <NameControl label={t('Nombre del modelo')} value={name} onChange={value => run(() => setName(value), 'model-name')} />
            {mesh ? <>
              {commonGroup ? <NameControl label={t('Grupo')} value={commonGroup.name} onChange={value => run(() => { for (const piece of selection) piece.userData.workshopGroup = { ...commonGroup, name: value }; }, `group-name-${commonGroup.id}`)} /> : !isMultiple && <NameControl label={t('Pieza')} value={mesh.name} onChange={value => run(() => { mesh.name = value; }, `piece-name-${mesh.uuid}`)} />}
              <label className="workshop-field"><span>{isMultiple ? t('Material de la selección') : t('Material')}</span><select value={workshopSurface(firstMaterial(mesh))} onChange={event => run(() => { for (const piece of selection) setWorkshopMaterial(piece, event.target.value as FurnitureMaterial, '#' + firstMaterial(piece).color.getHexString()); })}><option value="wood">{t('Madera')}</option><option value="plastic">{t('Plástico')}</option><option value="metal">{t('Metal')}</option></select></label>
              <ColorControl value={'#' + firstMaterial(mesh).color.getHexString()} onChange={value => run(() => { for (const piece of selection) setWorkshopColor(piece, value); }, `color-${selectedIds.join('-')}`)} />
              {isMultiple ? <div className="workshop-group"><span>{t('Posición (m)')}</span><div className="workshop-coordinates">{AXES.map(axis => <NumberControl key={axis} label={axis.toUpperCase()} value={selectionCenter![axis]} onChange={value => moveSelection(axis, value)} />)}</div></div> : <>
                <div className="workshop-group"><span>{t('Tamaño (m)')}</span><div className="workshop-coordinates">{([['x', "Ancho"], ['y', "Alto"], ['z', "Fondo"]] as const).filter(([axis]) => dimensions[axis] > .000001).map(([axis, label]) => <NumberControl key={axis} label={t(label)} value={dimensions[axis] * Math.abs(mesh.scale[axis])} min={.001} max={Math.min(10000, dimensions[axis] * 1000)} onChange={value => run(() => { mesh.scale[axis] = (Math.sign(mesh.scale[axis]) || 1) * value / dimensions[axis]; }, `size-${mesh.uuid}-${axis}`)} />)}</div></div>
                <details className="workshop-transforms"><summary>{t('Posición y giro')}</summary>{([['position', "Posición (m)"], ['rotation', "Giro (°)"]] as const).map(([attribute, label]) => <div className="workshop-group" key={attribute}><span>{t(label)}</span><div className="workshop-coordinates">{AXES.map(axis => <NumberControl key={axis} label={axis.toUpperCase()} value={attribute === 'rotation' ? THREE.MathUtils.radToDeg(mesh.rotation[axis]) : mesh.position[axis]} onChange={value => run(() => { if (attribute === 'rotation') mesh.rotation[axis] = THREE.MathUtils.degToRad(value); else mesh.position[axis] = value; }, `${attribute}-${mesh.uuid}-${axis}`)} />)}</div></div>)}</details>
              </>}
              {selectionActions}
            </> : <p className="workshop-empty">{t('Agrega o selecciona una pieza.')}</p>}
          </> : panel === 'alignment' ? alignmentPanel : panel === 'pieces' ? <>
            {selectionActions}
            <div className="workshop-list-actions"><button type="button" disabled={!pieces.length} onClick={() => selectIds(pieces.map(piece => piece.uuid))}>{t('Seleccionar todo')}</button><button type="button" disabled={!selection.length} onClick={() => selectIds([])}>{t('Quitar selección')}</button></div>
            <div className="workshop-pieces" aria-label={t('Piezas del modelo')}>{pieces.map((piece, i) => <div className="workshop-piece-row" key={piece.uuid} data-selected={selectedIds.includes(piece.uuid)}><label className="workshop-piece-check"><input type="checkbox" aria-label={t('Seleccionar {{name}} {{number}}', { name: piece.name, number: i + 1 })} checked={selectedIds.includes(piece.uuid)} onChange={() => selectPiece(piece, { toggle: true })} /></label><button type="button" aria-pressed={selectedIds.includes(piece.uuid)} onClick={() => selectPiece(piece, { toggle: multiSelect })}><span>{piece.name}{workshopGroup(piece) && <small>{workshopGroup(piece)!.name}</small>}</span><span>{i + 1}</span></button><button type="button" className="workshop-edit-piece" aria-label={t('Editar solo {{name}} {{number}}', { name: piece.name, number: i + 1 })} title={t('Editar solo esta pieza')} onClick={() => { selectPiece(piece, { individual: true }); setPanel('model'); setMultiSelect(false); }}><Pencil size={16} /></button></div>)}</div>
            {mesh && !isMultiple && pieces.length > 1 && <details className="workshop-transforms"><summary>{t('Combinar con otra pieza')}</summary><section className="workshop-booleans" aria-label={t('Combinar piezas')}><label className="workshop-field"><span>{t('Segunda pieza')}</span><select aria-label={t('Segunda pieza')} value={second} onChange={event => setSecond(event.target.value)}><option value="">{t('Seleccionar')}</option>{pieces.filter(piece => piece !== mesh).map(piece => <option key={piece.uuid} value={piece.uuid}>{piece.name} · {pieces.indexOf(piece) + 1}</option>)}</select></label><div className="workshop-boolean-choices" role="group" aria-label={t('Operación')}>{OPERATIONS.map(([value, label]) => <button type="button" key={value} aria-pressed={operation === value} onClick={() => setOperation(value)}><svg viewBox="0 0 48 30" aria-hidden="true"><circle cx="18" cy="15" r="12" fill={value === 'intersect' ? '#edf1e6' : '#96ac81'} /><circle cx="30" cy="15" r="12" fill={value === 'union' ? '#96ac81' : '#edf1e6'} stroke="#637b4e" />{value === 'intersect' && <path d="M24 4.6a12 12 0 0 1 0 20.8 12 12 0 0 1 0-20.8" fill="#96ac81" />}</svg><span>{t(label)}</span></button>)}</div>{operation === 'subtract' && second && <p className="workshop-operation-hint">{t('Se resta {{cutter}} de {{base}}.', { cutter: pieces.find(piece => piece.uuid === second)?.name, base: mesh.name })}</p>}<button type="button" className="primary-button" disabled={!second} onClick={() => void previewBoolean()}>{t('Ver resultado')}</button></section></details>}
          </> : geometryPanel}
        </fieldset></div>
      </aside>
    </div>
    {error && <p className="workshop-error" role="alert">{t(error)}</p>}
  </dialog>;
}
