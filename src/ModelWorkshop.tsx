import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { WebGLRenderer } from 'three/src/renderers/WebGLRenderer.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Copy, LoaderCircle, Move, PanelRight, RotateCw, Scaling, Trash2, X } from 'lucide-react';
import { createFurnitureModel } from './RoomScene';
import { loadEditableModel, uploadModel } from './customModel';
import type { ModelAsset } from './customModel';
import type { FurnitureItem, FurnitureMaterial } from './types';
import useFieldDraft from './useFieldDraft';
import { parseColor, parseName, parseNumber } from './fieldDraft';
import { addModelFace, addModelVertex, cloneWorkshopModel, deleteModelFace, deleteModelVertex, disposeWorkshopModel, exportWorkshopGLB, getEditableVertices, getModelFaces, moveModelVertex, setWorkshopColor, setWorkshopMaterial, workshopSurface } from './modelWorkshopGeometry';
import './modelWorkshop.css';

type Props = { item?: FurnitureItem; roomId: string; onSaved: (asset: ModelAsset) => void; onClose: () => void };
type Panel = 'model' | 'pieces' | 'geometry';
type Tool = 'translate' | 'rotate' | 'scale';
type GeometryTool = 'vertices' | 'faces';
type Runtime = { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: WebGLRenderer; controls: OrbitControls; transform: TransformControls; content: THREE.Group; proxy: THREE.Object3D; outline: THREE.BoxHelper | null; points: THREE.Points | null; face: THREE.Mesh | null; dragged: boolean; vertexIndices: number[]; vertexMesh: THREE.Mesh | null; vertexId: number; pendingNormals: boolean };
const AXES = ['x', 'y', 'z'] as const;
const numberFormat = (value: number) => Number(value.toFixed(4)).toString();
const firstMaterial = (mesh: THREE.Mesh) => (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;

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
  return <label className="workshop-field"><span>Color</span><span className="workshop-color"><input type="color" value={value} aria-label="Elegir color" onChange={event => onChange(event.target.value)} /><input aria-label="Color hexadecimal" maxLength={7} {...field.inputProps} /></span></label>;
}

function removeHelper(runtime: Runtime, key: 'points' | 'face' | 'outline') {
  const object = runtime[key];
  if (!object) return;
  object.removeFromParent(); object.geometry.dispose();
  (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => material.dispose());
  runtime[key] = null;
}

export default function ModelWorkshop({ item, roomId, onSaved, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), mount = useRef<HTMLDivElement>(null), runtime = useRef<Runtime | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [saving, setSaving] = useState(false), [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<string | null>(null), [panel, setPanel] = useState<Panel>('model'), [tool, setTool] = useState<Tool>('translate'), [geometryTool, setGeometryTool] = useState<GeometryTool>('vertices');
  const [vertexId, setVertexId] = useState(0), [faceId, setFaceId] = useState(0), [faceVertices, setFaceVertices] = useState<[number, number, number]>([0, 1, 2]);
  const [name, setName] = useState(item?.name ?? 'Mi modelo');
  const [panelOpen, setPanelOpen] = useState(true);
  const latest = useRef({ selected, panel, tool, geometryTool, vertexId, faceId, saving });
  latest.current = { selected, panel, tool, geometryTool, vertexId, faceId, saving };
  const change = () => { setRevision(value => value + 1); setError(''); };
  const pieces = (runtime.current?.content.children ?? []).filter((object): object is THREE.Mesh => object instanceof THREE.Mesh);
  const mesh = pieces.find(piece => piece.uuid === selected);
  const vertices = mesh && panel === 'geometry' ? getEditableVertices(mesh.geometry) : [];
  const faces = mesh && panel === 'geometry' && geometryTool === 'faces' ? getModelFaces(mesh.geometry) : [];
  const vertex = vertices[Math.min(vertexId, Math.max(0, vertices.length - 1))];

  function selectPiece(piece: THREE.Mesh | null) { setSelected(piece?.uuid ?? null); setVertexId(0); setFaceId(0); setFaceVertices([0, 1, 2]); }
  function run(action: () => void) { try { action(); change(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo hacer el cambio.'); } }
  function frameModel() {
    const active = runtime.current;
    if (!active || !active.content.children.length) return;
    active.content.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(active.content), center = box.getCenter(new THREE.Vector3()), span = Math.max(.3, ...box.getSize(new THREE.Vector3()).toArray());
    active.camera.position.copy(center).add(new THREE.Vector3(span * 1.1, span * .8, span * 1.2));
    active.camera.near = Math.max(.005, span / 1000); active.camera.far = Math.max(100, span * 100); active.camera.updateProjectionMatrix();
    active.controls.target.copy(center); active.controls.update();
  }

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

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
        const grid = new THREE.GridHelper(10, 40, '#a0ac98', '#d3dbca'); grid.position.y = -.006; scene.add(grid);
        const canvas = renderer.domElement; canvas.setAttribute('aria-label', 'Editor de modelo 3D. Selecciona una pieza y arrastra los controles para editarla.'); canvas.tabIndex = 0; host.append(canvas);
        const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = .08;
        const transform = new TransformControls(camera, canvas); transform.setSize(window.matchMedia('(pointer: coarse)').matches ? 1.35 : 1.05); transform.setColors('#ce756a', '#819968', '#6d97b4', '#d7ab5b'); scene.add(transform.getHelper());
        active = { scene, camera, renderer, controls, transform, content, proxy, outline: null, points: null, face: null, dragged: false, vertexIndices: [], vertexMesh: null, vertexId: 0, pendingNormals: false };
        runtime.current = active;
        const value = active;
        const resize = () => { const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight); renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); };
        observer = new ResizeObserver(resize); observer.observe(host); resize();
        let down = { x: 0, y: 0 };
        const pointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; value.dragged = false; };
        const pointerUp = (event: PointerEvent) => {
          if (latest.current.saving || value.dragged || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
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
          } else selectPiece(selectedMesh);
        };
        const changed = () => {
          if (latest.current.saving) return;
          value.dragged = true;
          if (value.transform.object === proxy && value.vertexMesh) {
            const target = value.vertexMesh, local = target.worldToLocal(proxy.position.clone()), position = target.geometry.getAttribute('position');
            if (!local.toArray().every(component => Number.isFinite(component) && Math.abs(component) <= 10000)) return;
            for (const index of value.vertexIndices) position.setXYZ(index, ...local.toArray() as [number, number, number]);
            position.needsUpdate = true; value.pendingNormals = true;
            if (value.points) { value.points.geometry.getAttribute('position').setXYZ(value.vertexId, ...local.toArray() as [number, number, number]); value.points.geometry.getAttribute('position').needsUpdate = true; }
          } else {
            const object = value.transform.object;
            if (object) { for (const axis of AXES) { object.position[axis] = THREE.MathUtils.clamp(object.position[axis], -10000, 10000); object.scale[axis] = THREE.MathUtils.clamp(object.scale[axis], .001, 1000); } }
          }
          value.outline?.update();
        };
        const dragging = (event: { value: unknown }) => {
          controls.enabled = !event.value;
          if (!event.value) {
            if (value.pendingNormals && value.vertexMesh) { value.vertexMesh.geometry.computeVertexNormals(); value.vertexMesh.geometry.computeBoundingBox(); value.vertexMesh.geometry.computeBoundingSphere(); value.pendingNormals = false; }
            change();
          }
        };
        canvas.addEventListener('pointerdown', pointerDown, true); canvas.addEventListener('pointerup', pointerUp);
        transform.addEventListener('objectChange', changed); transform.addEventListener('dragging-changed', dragging);
        removeEvents = () => { canvas.removeEventListener('pointerdown', pointerDown, true); canvas.removeEventListener('pointerup', pointerUp); transform.removeEventListener('objectChange', changed); transform.removeEventListener('dragging-changed', dragging); };
        renderer.setAnimationLoop(() => { if (!cancelled) { controls.update(); value.outline?.update(); renderer.render(scene, camera); } });
        if (item) source = item.type === 'custom' ? await loadEditableModel(item, roomId) : createFurnitureModel(item);
        else { source = new THREE.Group(); const cube = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, .5), new THREE.MeshStandardMaterial({ color: '#b8a084', roughness: .7 })); setWorkshopMaterial(cube, 'wood', '#b8a084'); cube.position.y = .25; cube.name = 'Cubo'; source.add(cube); }
        if (cancelled) { releaseSource(source); source = null; return; }
        const model = cloneWorkshopModel(source);
        while (model.children.length) content.add(model.children[0]);
        selectPiece(content.children[0] as THREE.Mesh ?? null); frameModel(); setReady(true); change();
      } catch (cause) { if (!cancelled) setError(cause instanceof Error ? cause.message : 'No se pudo abrir el modelo.'); }
    })();
    return () => {
      cancelled = true; observer?.disconnect(); removeEvents();
      if (active) { active.renderer.setAnimationLoop(null); active.transform.detach(); active.scene.remove(active.transform.getHelper()); active.transform.dispose(); active.controls.dispose(); disposeWorkshopModel(active.scene); active.renderer.dispose(); active.renderer.domElement.remove(); }
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
    active.transform.detach(); active.vertexMesh = null; active.vertexIndices = [];
    for (const key of ['points', 'face', 'outline'] as const) removeHelper(active, key);
    const object = active.content.children.find(object => object.uuid === selected);
    if (!(object instanceof THREE.Mesh)) return;
    active.outline = new THREE.BoxHelper(object, '#b88a3d'); active.scene.add(active.outline);
    active.transform.enabled = !saving;
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
  }, [ready, selected, panel, tool, geometryTool, vertexId, faceId, revision, saving]);

  function addPiece(kind: 'box' | 'cylinder' | 'sphere') {
    run(() => {
      const content = runtime.current?.content;
      if (!content) return;
      if (content.children.length >= 511) throw new Error('El modelo admite hasta 511 piezas.');
      const geometry = kind === 'box' ? new THREE.BoxGeometry(.5, .5, .5) : kind === 'cylinder' ? new THREE.CylinderGeometry(.25, .25, .5, 24) : new THREE.SphereGeometry(.25, 24, 16);
      const piece = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#b8a084', roughness: .7 }));
      setWorkshopMaterial(piece, 'wood', '#b8a084');
      piece.name = kind === 'box' ? 'Cubo' : kind === 'cylinder' ? 'Cilindro' : 'Esfera'; piece.position.y = .25; piece.castShadow = piece.receiveShadow = true; content.add(piece); selectPiece(piece);
    });
  }
  function duplicatePiece() {
    if (!mesh) return;
    run(() => {
      const content = runtime.current!.content;
      if (content.children.length >= 511) throw new Error('El modelo admite hasta 511 piezas.');
      const copy = mesh.clone(); copy.geometry = mesh.geometry.clone(); copy.material = Array.isArray(mesh.material) ? mesh.material.map(material => material.clone()) : mesh.material.clone(); copy.name = `${mesh.name} copia`.slice(0, 80); copy.position.x += .15; content.add(copy); selectPiece(copy);
    });
  }
  function deletePiece() {
    if (!mesh) return;
    run(() => { runtime.current!.transform.detach(); mesh.removeFromParent(); disposeWorkshopModel(new THREE.Group().add(mesh)); selectPiece(runtime.current!.content.children[0] as THREE.Mesh ?? null); });
  }
  async function save() {
    const active = runtime.current, modelName = parseName(name);
    if (!active || saving) return;
    if (!modelName) { setError('Escribe el nombre del modelo.'); return; }
    setSaving(true); setError('');
    try { const bytes = await exportWorkshopGLB(active.content), file = new File([bytes], `${modelName}.glb`, { type: 'model/gltf-binary' }); const asset = await uploadModel(file, roomId); onSaved(asset); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar el modelo.'); setSaving(false); }
  }
  function setVertexCoordinate(axis: number, value: number) {
    if (!mesh || !vertex) return;
    run(() => { const point: [number, number, number] = [...vertex.position]; point[axis] = value; moveModelVertex(mesh.geometry, vertex.id, point); });
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

  return <dialog ref={dialog} className="model-workshop" aria-labelledby="workshop-title" onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}><header className="workshop-header"><h2 id="workshop-title">{item ? 'Editar modelo' : 'Crear modelo'}</h2><button type="button" className="workshop-save primary-button" onClick={() => void save()} disabled={!ready || saving}>{saving && <LoaderCircle size={17} className="saving-spinner" />}{saving ? 'Guardando' : 'Guardar modelo'}</button><button type="button" className="icon-button" aria-label="Cerrar editor de modelo" onClick={onClose} disabled={saving}><X size={22} /></button></header><div className={`workshop-workspace${panelOpen ? '' : ' is-panel-hidden'}`}><section className="workshop-viewport"><div ref={mount} className="workshop-canvas" />{!ready && !error && <div className="workshop-loading"><LoaderCircle size={24} className="saving-spinner" /></div>}<div className="workshop-tools" aria-label="Herramientas de modelo">{([['translate', Move, 'Mover'], ['rotate', RotateCw, 'Girar'], ['scale', Scaling, 'Tamaño']] as const).map(([mode, Icon, label]) => <button type="button" key={mode} aria-label={label} title={label} aria-pressed={tool === mode && panel !== 'geometry'} disabled={saving || panel === 'geometry'} onClick={() => setTool(mode)}><Icon size={20} /></button>)}<button type="button" onClick={frameModel} disabled={!ready}>Centrar</button><button type="button" aria-label={panelOpen ? 'Ocultar panel' : 'Mostrar panel'} title={panelOpen ? 'Ocultar panel' : 'Mostrar panel'} aria-expanded={panelOpen} aria-controls="workshop-panel" onClick={() => setPanelOpen(value => !value)}><PanelRight size={20} /></button></div></section><aside id="workshop-panel" className="workshop-panel" hidden={!panelOpen}><nav className="workshop-tabs" aria-label="Panel del modelo">{([['model', 'Modelo'], ['pieces', 'Piezas'], ['geometry', 'Geometría']] as const).map(([tab, label]) => <button key={tab} type="button" aria-pressed={panel === tab} onClick={() => setPanel(tab)}>{label}</button>)}</nav><div className="workshop-panel-content"><fieldset disabled={!ready || saving}>{panel === 'model' ? <><NameControl label="Nombre del modelo" value={name} onChange={setName} />{mesh && <><NameControl label="Pieza" value={mesh.name} onChange={value => run(() => { mesh.name = value; })} /><label className="workshop-field"><span>Material</span><select value={workshopSurface(firstMaterial(mesh))} onChange={event => run(() => setWorkshopMaterial(mesh, event.target.value as FurnitureMaterial, '#' + firstMaterial(mesh).color.getHexString()))}><option value="wood">Madera</option><option value="plastic">Plástico</option><option value="metal">Metal</option></select></label><ColorControl value={'#' + firstMaterial(mesh).color.getHexString()} onChange={value => run(() => setWorkshopColor(mesh, value))} />{([['position', 'Posición'], ['rotation', 'Giro'], ['scale', 'Escala']] as const).map(([attribute, label]) => <div className="workshop-group" key={attribute}><span>{label}</span><div className="workshop-coordinates">{AXES.map(axis => <NumberControl key={axis} label={axis.toUpperCase()} value={attribute === 'rotation' ? THREE.MathUtils.radToDeg(mesh.rotation[axis]) : mesh[attribute][axis]} min={attribute === 'scale' ? .001 : -10000} max={attribute === 'scale' ? 1000 : 10000} onChange={value => run(() => { mesh[attribute][axis] = attribute === 'rotation' ? THREE.MathUtils.degToRad(value) : value; })} />)}</div></div>)}</>}</> : panel === 'pieces' ? <><div className="workshop-primitives"><button type="button" onClick={() => addPiece('box')}>Cubo</button><button type="button" onClick={() => addPiece('cylinder')}>Cilindro</button><button type="button" onClick={() => addPiece('sphere')}>Esfera</button></div><div className="workshop-pieces" aria-label="Piezas del modelo">{pieces.map(piece => <button type="button" key={piece.uuid} aria-pressed={selected === piece.uuid} onClick={() => selectPiece(piece)}>{piece.name}</button>)}</div>{mesh && <div className="workshop-piece-actions"><button type="button" onClick={duplicatePiece}><Copy size={17} />Duplicar</button><button type="button" onClick={deletePiece}><Trash2 size={17} />Eliminar</button></div>}</> : mesh ? <><label className="workshop-field"><span>Pieza</span><select value={selected ?? ''} onChange={event => selectPiece(pieces.find(piece => piece.uuid === event.target.value) ?? null)}>{pieces.map(piece => <option key={piece.uuid} value={piece.uuid}>{piece.name}</option>)}</select></label><div className="workshop-geometry-tabs"><button type="button" aria-pressed={geometryTool === 'vertices'} onClick={() => setGeometryTool('vertices')}>Vértices</button><button type="button" aria-pressed={geometryTool === 'faces'} onClick={() => setGeometryTool('faces')}>Caras</button></div>{geometryTool === 'vertices' ? <>{vertex && <><NumberControl label={`Vértice (0–${vertices.length - 1})`} value={vertex.id} min={0} max={vertices.length - 1} integer onChange={setVertexId} /><div className="workshop-coordinates">{AXES.map((axis, i) => <NumberControl key={axis} label={axis.toUpperCase()} value={vertex.position[i]} onChange={value => setVertexCoordinate(i, value)} />)}</div></>}<div className="workshop-piece-actions"><button type="button" onClick={addVertex}>Agregar vértice</button><button type="button" disabled={!vertex} onClick={() => run(() => { deleteModelVertex(mesh.geometry, vertex!.id); setVertexId(0); })}><Trash2 size={17} />Eliminar</button></div></> : <>{faces.length > 0 && <><NumberControl label={`Cara (0–${faces.length - 1})`} value={Math.min(faceId, faces.length - 1)} min={0} max={faces.length - 1} integer onChange={setFaceId} /><span className="workshop-face-vertices">Vértices: {(faces[Math.min(faceId, faces.length - 1)] ?? []).join(', ')}</span><button type="button" className="workshop-delete-face" onClick={() => run(() => { deleteModelFace(mesh.geometry, Math.min(faceId, faces.length - 1)); setFaceId(0); })}><Trash2 size={17} />Eliminar cara</button></>}<div className="workshop-group"><span>Nueva cara</span><div className="workshop-coordinates">{faceVertices.map((value, i) => <NumberControl key={i} label={`Vértice ${i + 1}`} value={value} min={0} max={Math.max(0, vertices.length - 1)} integer onChange={next => setFaceVertices(previous => previous.map((value, index) => index === i ? next : value) as [number, number, number])} />)}</div><button type="button" onClick={() => run(() => { addModelFace(mesh.geometry, faceVertices); setFaceId(getModelFaces(mesh.geometry).length - 1); })}>Agregar cara</button></div></>}</> : <p className="workshop-empty">Selecciona una pieza.</p>}</fieldset></div></aside></div>{error && <p className="workshop-error" role="alert">{error}</p>}</dialog>;
}
