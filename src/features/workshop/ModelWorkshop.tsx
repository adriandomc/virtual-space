import { t, useLocale } from '../../shared/i18n/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Copy, Group, LoaderCircle, Pencil, Trash2, Ungroup, X } from 'lucide-react';
import FurnitureCatalog from '../models/FurnitureCatalog.tsx';
import type { FurniturePreset } from '../../domain/models/furnitureCatalog';
import { createFurnitureModel } from '../viewer/furnitureRendering';
import { loadEditableModel } from '../viewer/customModel';
import { uploadModel } from '../../client/models/modelRepository';
import type { ModelAsset } from '../../domain/models/glbValidation';
import type { FurnitureItem, FurnitureMaterial } from '../../domain/project/types';
import { parseName } from '../../shared/ui/fieldDraft';
import ColorPicker from '../../shared/ui/ColorPicker';
import { addModelFace, addModelVertex, clampWorkshopScale, cloneWorkshopModel, deleteModelFace, deleteModelVertex, disposeWorkshopModel, exportWorkshopGLB, fitWorkshopCamera, getEditableVertices, getModelFaces, moveModelVertex, setWorkshopColor, setWorkshopMaterial, workshopSurface } from './modelWorkshopGeometry';
import { createWorkshopPiece, WORKSHOP_PIECES } from './workshopPieces';
import { applyWorkshopPatch, captureWorkshopPatch, captureWorkshopSnapshot, compactWorkshopVertexPatch, disposeWorkshopSnapshot, WorkshopHistory, type WorkshopPatchSpec, type WorkshopSnapshot } from './workshopHistory';
import { startWorkshopBoolean } from './workshopBooleanClient';
import type { WorkshopBooleanOperation } from './workshopBoolean';
import { alignWorkshopPiece, snapWorkshopPiece, type WorkshopAxis, type WorkshopAlignment } from './workshopAlignment';
import { applySelectionTransform, captureSelectionTransform, createSelectionProxy, duplicateWorkshopPieces, groupWorkshopPieces, ungroupWorkshopPieces, workshopGroup, workshopSelectionUnit } from './workshopGrouping';
import './modelWorkshop.css';
import { NumberControl, NameControl, PieceThumbnail } from './WorkshopFields';
import WorkshopToolbar from './WorkshopToolbar';
import { AXES, createWorkshopScene, disposeWorkshopScene, releaseWorkshopSource, updateWorkshopSelection, removeHelper, clearSelectionHelpers, showSnapGuide, type WorkshopPanel, type WorkshopTool, type WorkshopGeometryTool, type WorkshopSceneRuntime } from './workshopScene';
import { createDemandFrames } from '../../client/graphics/demandFrames';
import { getGraphicsProfile, subscribeGraphicsSettings } from '../../client/graphics/graphicsSettings';
import { beginAppActivity, registerBeforeAppUpdate, registerAppActivity } from '../../client/pwa/appOffline';

type Props = { item?: FurnitureItem; roomId: string; onSaved: (asset: ModelAsset) => boolean | void; onClose: () => void };
const firstMaterial = (mesh: THREE.Mesh) => (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
const OPERATIONS = [['union', 'Unir'], ['subtract', 'Restar'], ['intersect', 'Intersección']] as const;
const faceCount = (object: THREE.Mesh) => (object.geometry.index?.count ?? object.geometry.getAttribute('position').count) / 3;
const ALIGNMENT_LABELS = {
  x: ['Izquierda', 'Centro', 'Derecha', 'Al lado izquierdo', 'Al lado derecho'],
  y: ['Abajo', 'Centro', 'Arriba', 'Debajo', 'Encima'],
  z: ['Frente', 'Centro', 'Fondo', 'Delante', 'Detrás'],
};
const ALIGNMENTS: WorkshopAlignment[] = ['min', 'center', 'max', 'before', 'after'];

export default function ModelWorkshop({ item, roomId, onSaved, onClose }: Props) {
  const locale = useLocale();
  const dialog = useRef<HTMLDialogElement>(null), mount = useRef<HTMLDivElement>(null), panelContent = useRef<HTMLDivElement>(null), runtime = useRef<WorkshopSceneRuntime | null>(null);
  const [ready, setReady] = useState(false), [error, setError] = useState(''), [saving, setSaving] = useState(false), [revision, setRevision] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const initialName = useRef(item?.name ?? t('Mi modelo'));
  const colorPreview = useRef<Map<THREE.MeshStandardMaterial, THREE.Color> | null>(null);
  const dirtyState = useRef(false);
  const savingModel = useRef(false);
  useEffect(() => registerBeforeAppUpdate(async () => { if (dirtyState.current || savingModel.current || runtime.current?.transform.dragging) throw new Error('Guarda o cierra el modelo antes de actualizar la aplicación.'); }), []);
  useEffect(() => registerAppActivity(() => dirtyState.current || savingModel.current || runtime.current?.transform.dragging ? 'Guarda o cierra el modelo antes de actualizar la aplicación.' : false), []);
  const [selected, setSelected] = useState<string | null>(null), [panel, setPanel] = useState<WorkshopPanel>(item ? 'model' : 'add'), [tool, setTool] = useState<WorkshopTool>('translate'), [geometryTool, setGeometryTool] = useState<WorkshopGeometryTool>('vertices');
  const [selectedIds, setSelectedIds] = useState<string[]>([]), [multiSelect, setMultiSelect] = useState(false);
  const [palette, setPalette] = useState<'primitives' | 'prefabs' | 'furniture'>('prefabs'), [second, setSecond] = useState(''), [operation, setOperation] = useState<WorkshopBooleanOperation>('union');
  const [computing, setComputing] = useState(false), [previewing, setPreviewing] = useState(false);
  const history = useRef(new WorkshopHistory()), dragSnapshot = useRef<WorkshopSnapshot | null>(null);
  const booleanJob = useRef<ReturnType<typeof startWorkshopBoolean> | null>(null);
  const booleanSequence = useRef(0);
  const preview = useRef<{ result: THREE.Mesh; base: THREE.Mesh; cutter: THREE.Mesh; visibility: [boolean, boolean] } | null>(null);
  const [vertexId, setVertexId] = useState(0), [faceId, setFaceId] = useState(0), [faceVertices, setFaceVertices] = useState<[number, number, number]>([0, 1, 2]);
  const [name, setName] = useState(item?.name ?? t('Mi modelo'));
  dirtyState.current = history.current.canUndo || name !== initialName.current || computing || previewing;
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirtyState.current || savingModel.current || runtime.current?.transform.dragging) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, []);
  const [panelOpen, setPanelOpen] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true), [snapGrid, setSnapGrid] = useState(true), [snapPieces, setSnapPieces] = useState(true), [gridStep, setGridStep] = useState(.05), [angleStep, setAngleStep] = useState(15);
  const [alignmentReference, setAlignmentReference] = useState(''), [alignmentAxis, setAlignmentAxis] = useState<WorkshopAxis>('x');
  const latest = useRef({ selected, selectedIds, multiSelect, panel, tool, geometryTool, vertexId, faceId, saving, computing, previewing, name, snapEnabled, snapGrid, snapPieces, gridStep });
  latest.current = { selected, selectedIds, multiSelect, panel, tool, geometryTool, vertexId, faceId, saving, computing, previewing, name, snapEnabled, snapGrid, snapPieces, gridStep };
  const change = () => { runtime.current?.invalidate(true); setRevision(value => value + 1); setError(''); };
  const pieces = (runtime.current?.content.children ?? []).filter((object): object is THREE.Mesh => object instanceof THREE.Mesh);
  const mesh = pieces.find(piece => piece.uuid === selected);
  const selection = pieces.filter(piece => selectedIds.includes(piece.uuid));
  const isMultiple = selection.length > 1;
  const commonGroup = isMultiple && mesh && workshopGroup(mesh) && selection.every(piece => workshopGroup(piece)?.id === workshopGroup(mesh)?.id) ? workshopGroup(mesh) : null;
  const vertices = useMemo(() => mesh && panel === 'geometry' ? getEditableVertices(mesh.geometry) : [], [mesh, panel, revision]);
  const faces = useMemo(() => mesh && panel === 'geometry' && geometryTool === 'faces' ? getModelFaces(mesh.geometry) : [], [mesh, panel, geometryTool, revision]);
  const vertex = vertices[Math.min(vertexId, Math.max(0, vertices.length - 1))];
  const reference = pieces.find(piece => piece.uuid === alignmentReference && !selectedIds.includes(piece.uuid));

  function closeWorkshop() {
    if (savingModel.current) return;
    if (dirtyState.current || runtime.current?.transform.dragging) setConfirmDiscard(true);
    else onClose();
  }
  function previewColor(color: string | null) {
    runtime.current?.invalidate();
    if (color === null) {
      colorPreview.current?.forEach((previous, material) => { material.color.copy(previous); }); colorPreview.current = null;
      return;
    }
    if (!colorPreview.current) colorPreview.current = new Map(selection.flatMap(piece => (Array.isArray(piece.material) ? piece.material : [piece.material]).map(material => [material as THREE.MeshStandardMaterial, (material as THREE.MeshStandardMaterial).color.clone()] as const)));
    colorPreview.current.forEach((_previous, material) => { material.color.set(color); });
  }

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
    setPreviewing(false); setComputing(false); runtime.current?.invalidate(true);
  }
  function restore(snapshot: WorkshopSnapshot) {
    const active = runtime.current;
    if (!active) { disposeWorkshopSnapshot(snapshot); return; }
    active.transform.detach();
    clearSelectionHelpers(active);
    for (const key of ['points', 'face', 'outline', 'toolOutline', 'snapGuide'] as const) removeHelper(active, key);
    if (!applyWorkshopPatch(snapshot, active.content)) {
      disposeWorkshopModel(active.content);
      while (snapshot.content.children.length) active.content.add(snapshot.content.children[0]);
    }
    setName(snapshot.name); setSelected(snapshot.selected); setSelectedIds(snapshot.selectedIds); setSecond(''); setVertexId(0); setFaceId(0); change();
  }
  function run(action: () => void | boolean, key?: string, patch?: WorkshopPatchSpec) {
    const active = runtime.current;
    if (!active || active.transform.dragging || latest.current.saving || latest.current.computing || latest.current.previewing) return;
    const before = patch ? captureWorkshopPatch(active.content, latest.current.selected, latest.current.name, latest.current.selectedIds, patch) : captureWorkshopSnapshot(active.content, latest.current.selected, latest.current.name, latest.current.selectedIds);
    try { if (action() === false) { disposeWorkshopSnapshot(before); return; } if (active.content.children.reduce((sum, piece) => sum + faceCount(piece as THREE.Mesh), 0) > 200000) throw new Error('El modelo admite hasta 200 000 caras.'); compactWorkshopVertexPatch(before, active.content); history.current.record(before, key); change(); }
    catch (cause) { restore(before); setError(cause instanceof Error ? cause.message : "No se pudo hacer el cambio."); }
  }
  function travelHistory(direction: 'undo' | 'redo') {
    const active = runtime.current;
    if (!active || active.transform.dragging || latest.current.saving || latest.current.computing) return;
    discardPreview();
    const current = history.current.captureCurrent(direction, active.content, selected, name, selectedIds);
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
      setPreviewing(true); setComputing(false); active.invalidate(true);
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
    active.controls.target.copy(center); active.controls.update(); active.invalidate();
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
    let active: WorkshopSceneRuntime | null = null, observer: ResizeObserver | null = null;
    let removeEvents = () => {};
    void (async () => {
      try {
        active = createWorkshopScene(host, t('Editor de modelo 3D. Selecciona una pieza y arrastra los controles para editarla.'));
        const { scene, camera, renderer, controls, transform, content, proxy } = active;
        const canvas = renderer.domElement;
        runtime.current = active;
        const value = active;
        const resize = () => {
          const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight); renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix(); value.invalidate();
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
          value.outline?.update(); value.invalidate(true);
        };
        const dragging = (event: { value: unknown }) => {
          controls.enabled = !event.value;
          if (event.value) {
            value.dragged = false; dragSnapshot.current = captureWorkshopPatch(content, latest.current.selected, latest.current.name, latest.current.selectedIds, value.vertexMesh ? { kind: 'vertices', id: value.vertexMesh.uuid, indices: value.vertexIndices } : { kind: 'transforms', ids: latest.current.selectedIds });
            if (value.selectionProxy) value.selectionTransform = captureSelectionTransform(content.children.filter((piece): piece is THREE.Mesh => piece instanceof THREE.Mesh && latest.current.selectedIds.includes(piece.uuid)));
          }
          if (!event.value) {
            removeHelper(value, 'snapGuide');
            if (value.pendingNormals && value.vertexMesh) { value.vertexMesh.geometry.deleteAttribute('tangent'); value.vertexMesh.geometry.computeVertexNormals(); value.vertexMesh.geometry.computeBoundingBox(); value.vertexMesh.geometry.computeBoundingSphere(); const raw = value.vertexIndices[0]; const welded = getEditableVertices(value.vertexMesh.geometry).find(vertex => vertex.indices.includes(raw)); if (welded) setVertexId(welded.id); value.pendingNormals = false; }
            if (dragSnapshot.current) {
              if (value.dragged) { compactWorkshopVertexPatch(dragSnapshot.current, content); history.current.record(dragSnapshot.current); } else disposeWorkshopSnapshot(dragSnapshot.current);
              dragSnapshot.current = null;
            }
            change();
          }
        };
        canvas.addEventListener('pointerdown', pointerDown, true); canvas.addEventListener('pointerup', pointerUp);
        transform.addEventListener('objectChange', changed); transform.addEventListener('dragging-changed', dragging);
        const frames = createDemandFrames(() => {
          if (cancelled) return false;
          const moving = controls.update(); value.outline?.update(); value.toolOutline?.update(); value.selectionOutlines.forEach(outline => outline.update()); renderer.render(scene, camera); return moving;
        }, { fps: () => getGraphicsProfile().fps });
        value.invalidate = (shadows = false) => { if (shadows) value.sun.shadow.needsUpdate = true; frames.invalidate(); };
        const presentation = () => value.invalidate();
        controls.addEventListener('change', presentation); transform.addEventListener('change', presentation);
        const quality = () => {
          const profile = getGraphicsProfile(), shadowSize = profile.shadows || 512;
          renderer.setPixelRatio(Math.min(2, window.devicePixelRatio) * profile.renderScale); renderer.shadowMap.enabled = !!profile.shadows;
          if (value.sun.shadow.mapSize.x !== shadowSize) { value.sun.shadow.map?.dispose(); value.sun.shadow.map = null; value.sun.shadow.mapSize.set(shadowSize, shadowSize); }
          value.sun.castShadow = !!profile.shadows; value.invalidate(true); resize();
        };
        const unsubscribe = subscribeGraphicsSettings(quality); quality();
        removeEvents = () => { frames.dispose(); unsubscribe(); controls.removeEventListener('change', presentation); transform.removeEventListener('change', presentation); canvas.removeEventListener('pointerdown', pointerDown, true); canvas.removeEventListener('pointerup', pointerUp); transform.removeEventListener('objectChange', changed); transform.removeEventListener('dragging-changed', dragging); };
        if (item) source = item.type === 'custom' ? await loadEditableModel(item, roomId) : createFurnitureModel(item);
        else source = new THREE.Group();
        if (cancelled) { releaseWorkshopSource(source); source = null; return; }
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
      history.current.clear(); if (dragSnapshot.current) disposeWorkshopSnapshot(dragSnapshot.current); dragSnapshot.current = null;
      if (active) disposeWorkshopScene(active);
      if (source) releaseWorkshopSource(source);
      runtime.current = null;
    };
  }, [item?.id, roomId]);

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
    grid.position.y = -.004; active.scene.add(grid); active.invalidate();
    return () => { grid.removeFromParent(); active.invalidate(); grid.geometry.dispose(); (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach(material => material.dispose()); };
  }, [ready, snapEnabled, snapGrid, gridStep]);

  useEffect(() => {
    const active = runtime.current;
    if (!active || !ready) return;
    updateWorkshopSelection(active, { panel, tool, geometryTool, selected, selectedIds, second, reference, vertexId, faceId, saving, computing, previewing }); active.invalidate();
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
      const model = cloneWorkshopModel(original); releaseWorkshopSource(original);
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
    }, undefined, { kind: 'transforms', ids: selectedIds });
  }
  function ungroupSelection() {
    const groups = new Set(selection.map(piece => workshopGroup(piece)?.id).filter(Boolean)), targets = pieces.filter(piece => groups.has(workshopGroup(piece)?.id));
    run(() => { ungroupWorkshopPieces(targets); }, undefined, { kind: 'transforms', ids: targets.map(piece => piece.uuid) });
  }
  function moveSelection(axis: WorkshopAxis, value: number) {
    run(() => { const snapshot = captureSelectionTransform(selection), position = snapshot.center.clone(); position[axis] = value; return applySelectionTransform(snapshot, position); }, `selection-position-${selectedIds.join('-')}-${axis}`, { kind: 'transforms', ids: selectedIds });
  }
  function alignSelection(alignment: WorkshopAlignment) {
    if (!reference || !selection.length) return;
    run(() => {
      if (selection.length === 1) return alignWorkshopPiece(selection[0], reference, alignmentAxis, alignment);
      const proxy = createSelectionProxy(selection), snapshot = captureSelectionTransform(selection); runtime.current!.content.add(proxy);
      try { if (!alignWorkshopPiece(proxy, reference, alignmentAxis, alignment)) return false; return applySelectionTransform(snapshot, proxy.position); }
      finally { proxy.removeFromParent(); proxy.geometry.dispose(); (proxy.material as THREE.Material).dispose(); }
    }, undefined, { kind: 'transforms', ids: selectedIds });
  }
  async function save() {
    const active = runtime.current, modelName = parseName(name);
    if (!active || active.transform.dragging || savingModel.current || computing || previewing) return;
    if (!modelName) { setError('Escribe el nombre del modelo.'); return; }
    const release = beginAppActivity('Guarda o cierra el modelo antes de actualizar la aplicación.');
    savingModel.current = true;
    setSaving(true); setError('');
    try { const bytes = await exportWorkshopGLB(active.content), file = new File([bytes], `${modelName}.glb`, { type: 'model/gltf-binary' }); const asset = await uploadModel(file, roomId); if (onSaved(asset) === false) setError('El modelo está guardado en Modelos propios. No se pudo añadir al diseño.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar el modelo."); }
    finally { savingModel.current = false; release(); setSaving(false); }
  }
  function setVertexCoordinate(axis: number, value: number) {
    if (!mesh || !vertex) return;
    run(() => { const point: [number, number, number] = [...vertex.position]; point[axis] = value; const raw = vertex.indices[0]; moveModelVertex(mesh.geometry, vertex.id, point); setVertexId(getEditableVertices(mesh.geometry).find(next => next.indices.includes(raw))!.id); }, `vertex-${mesh.uuid}-${vertex.indices[0]}-${axis}`, { kind: 'vertices', id: mesh.uuid, indices: vertex.indices });
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
  const openPanel = (next: WorkshopPanel) => { if (locked) return; if (next === 'geometry' && mesh) { selectPiece(mesh, { individual: true }); setMultiSelect(false); } setPanel(next); setPanelOpen(true); };
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

  return <dialog ref={dialog} className={'model-workshop' + (!pieces.length ? ' is-empty' : '') + (panel === 'alignment' || panel === 'pieces' ? ' is-aligning' : '')} aria-labelledby="workshop-title" onCancel={event => { event.preventDefault(); closeWorkshop(); }} onKeyDown={event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !(event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"]')) { event.preventDefault(); travelHistory(event.shiftKey ? 'redo' : 'undo'); }
  }}>
    <header className="workshop-header"><h2 id="workshop-title">{item ? t('Editar modelo') : t('Crear modelo')}</h2><button type="button" className="workshop-save primary-button" onClick={() => void save()} disabled={!ready || locked || !pieces.length}>{saving && <LoaderCircle size={17} className="saving-spinner" />}{saving ? t('Guardando') : item ? t('Guardar copia') : t('Guardar modelo')}</button><button type="button" className="icon-button" aria-label={t('Cerrar editor de modelo')} onClick={closeWorkshop} disabled={saving}><X size={22} /></button></header>
    {confirmDiscard && <div className="workshop-discard" role="alert"><span>{t('¿Descartar los cambios del modelo?')}</span><button type="button" onClick={() => setConfirmDiscard(false)}>{t('Seguir editando')}</button><button type="button" onClick={onClose}>{t('Descartar cambios')}</button></div>}
    {(computing || previewing) && <div className="workshop-operation-status" role="status"><span>{computing ? <><LoaderCircle size={17} className="saving-spinner" />{t('Calculando…')}</> : t('Vista previa')}</span>{previewing && <button type="button" className="primary-button" onClick={applyBoolean}>{t('Aplicar')}</button>}<button type="button" className="outline-button" onClick={discardPreview}>{t('Cancelar')}</button></div>}
    <div className={`workshop-workspace${panelOpen ? '' : ' is-panel-hidden'}`}>
      <section className="workshop-viewport"><div ref={mount} className="workshop-canvas" />{!ready && !error && <div className="workshop-loading"><LoaderCircle size={24} className="saving-spinner" /></div>}
        <WorkshopToolbar ready={ready} locked={locked} saving={saving} computing={computing} canUndo={history.current.canUndo} canRedo={history.current.canRedo} tool={tool} panel={panel} isMultiple={isMultiple} hasSelection={!!mesh} snapEnabled={snapEnabled} hasPieces={!!pieces.length} panelOpen={panelOpen} onAdd={() => openPanel('add')} onUndo={() => travelHistory('undo')} onRedo={() => travelHistory('redo')} onToolChange={setTool} onSnapToggle={() => setSnapEnabled(value => !value)} onCenter={frameModel} onPanelToggle={() => setPanelOpen(value => !value)} />
      </section>
      <aside id="workshop-panel" className="workshop-panel" hidden={!panelOpen}>
        <nav className="workshop-tabs" aria-label={t('Panel del modelo')}>{([['add', "Agregar"], ['model', "Editar"], ['pieces', "Piezas"], ['alignment', "Alinear"], ['geometry', "Geometría"]] as const).map(([tab, label]) => <button key={tab} type="button" disabled={locked} aria-pressed={panel === tab} onClick={() => openPanel(tab)}>{t(label)}</button>)}</nav>
        <div ref={panelContent} className="workshop-panel-content"><fieldset disabled={!ready || locked}>
          {panel !== 'add' && panel !== 'geometry' && <div className="workshop-selection-bar"><label className="workshop-toggle"><input type="checkbox" checked={multiSelect} onChange={event => setMultiSelect(event.target.checked)} />{t('Seleccionar varias')}</label><span aria-live="polite">{t('{{count}} seleccionadas', { count: selection.length })}</span></div>}
          {panel === 'add' ? <>
            <nav className="workshop-palette-tabs" aria-label={t('Tipo de pieza')}>{([['primitives', "Formas"], ['prefabs', "Piezas"], ['furniture', "Muebles"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={palette === value} onClick={() => setPalette(value)}>{t(label)}</button>)}</nav>
            {palette === 'furniture' ? <FurnitureCatalog onSelect={addFurniture} /> : <div className="workshop-piece-grid">{WORKSHOP_PIECES.filter(preset => preset.category === palette).map(preset => <button type="button" key={preset.id} aria-label={t('Agregar {{name}}', { name: t(preset.label) })} onClick={() => addPiece(preset.id)}><PieceThumbnail preset={preset} /><span>{t(preset.label)}</span></button>)}</div>}
          </> : panel === 'model' ? <>
            <NameControl label={t('Nombre del modelo')} value={name} onChange={value => run(() => setName(value), 'model-name', { kind: 'transforms', ids: [] })} />
            {mesh ? <>
              {commonGroup ? <NameControl label={t('Grupo')} value={commonGroup.name} onChange={value => run(() => { for (const piece of selection) piece.userData.workshopGroup = { ...commonGroup, name: value }; }, `group-name-${commonGroup.id}`, { kind: 'transforms', ids: selectedIds })} /> : !isMultiple && <NameControl label={t('Pieza')} value={mesh.name} onChange={value => run(() => { mesh.name = value; }, `piece-name-${mesh.uuid}`, { kind: 'transforms', ids: selectedIds })} />}
              <label className="workshop-field"><span>{isMultiple ? t('Material de la selección') : t('Material')}</span><select value={workshopSurface(firstMaterial(mesh))} onChange={event => run(() => { for (const piece of selection) setWorkshopMaterial(piece, event.target.value as FurnitureMaterial, '#' + firstMaterial(piece).color.getHexString()); }, undefined, { kind: 'materials', ids: selectedIds })}><option value="wood">{t('Madera')}</option><option value="plastic">{t('Plástico')}</option><option value="metal">{t('Metal')}</option></select></label>
              <ColorPicker key={selectedIds.join('-')} value={'#' + firstMaterial(mesh).color.getHexString()} revision={revision} colors={[...new Set(pieces.flatMap(piece => (Array.isArray(piece.material) ? piece.material : [piece.material]).map(material => '#' + (material as THREE.MeshStandardMaterial).color.getHexString())))]} onPreview={previewColor} onChange={value => { previewColor(null); run(() => { for (const piece of selection) setWorkshopColor(piece, value); }, undefined, { kind: 'materials', ids: selectedIds }); }} />
              {isMultiple ? <div className="workshop-group"><span>{t('Posición (m)')}</span><div className="workshop-coordinates">{AXES.map(axis => <NumberControl key={axis} label={axis.toUpperCase()} value={selectionCenter![axis]} onChange={value => moveSelection(axis, value)} />)}</div></div> : <>
                <div className="workshop-group"><span>{t('Tamaño (m)')}</span><div className="workshop-coordinates">{([['x', "Ancho"], ['y', "Alto"], ['z', "Fondo"]] as const).filter(([axis]) => dimensions[axis] > .000001).map(([axis, label]) => <NumberControl key={axis} label={t(label)} value={dimensions[axis] * Math.abs(mesh.scale[axis])} min={.001} max={Math.min(10000, dimensions[axis] * 1000)} onChange={value => run(() => { mesh.scale[axis] = (Math.sign(mesh.scale[axis]) || 1) * value / dimensions[axis]; }, `size-${mesh.uuid}-${axis}`, { kind: 'transforms', ids: selectedIds })} />)}</div></div>
                <details className="workshop-transforms"><summary>{t('Posición y giro')}</summary>{([['position', "Posición (m)"], ['rotation', "Giro (°)"]] as const).map(([attribute, label]) => <div className="workshop-group" key={attribute}><span>{t(label)}</span><div className="workshop-coordinates">{AXES.map(axis => <NumberControl key={axis} label={axis.toUpperCase()} value={attribute === 'rotation' ? THREE.MathUtils.radToDeg(mesh.rotation[axis]) : mesh.position[axis]} onChange={value => run(() => { if (attribute === 'rotation') mesh.rotation[axis] = THREE.MathUtils.degToRad(value); else mesh.position[axis] = value; }, `${attribute}-${mesh.uuid}-${axis}`, { kind: 'transforms', ids: selectedIds })} />)}</div></div>)}</details>
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
