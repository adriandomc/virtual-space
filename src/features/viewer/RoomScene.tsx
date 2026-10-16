import { t, useLocale } from '../../shared/i18n/i18n';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { DoorClosed, DoorOpen, Lightbulb, LoaderCircle } from 'lucide-react';
import { furnitureWalkable, itemWorldPosition, moveSceneItem, toggleSceneInteraction } from '../../domain/project/model';
import { createArchitecturalPostProcessing } from './postProcessing';
import { joystickVector, renderPixelRatio } from './navigation';
import { sampleCameraTransition } from './cameraTransition';
import type { Room, Selection } from '../../domain/project/types';
import { ceilingFinishTargets, projectToRoom, updateProjectRoom, type ProjectDocument } from '../../domain/project/projectDocument';
import { residentLevelIds, sceneResourceUsage } from './sceneProjection';
import { getGraphicsPreferences, getGraphicsProfile, useGraphicsSettings, GraphicsPerformanceController, setAdaptiveGraphicsTier } from '../../client/graphics/graphicsSettings';
import './scene.css';
import { registerAppActivity, registerBeforeAppUpdate } from '../../client/pwa/appOffline';
import type { RoomSceneProps, SceneRuntime } from './sceneRuntime';
import { disposeArchitecture, disposeContent } from './sceneResources';
import { updateRoom, buildProjectScene, buildRoom } from './sceneArchitecture';
import { sameSelection, canMove, canInteract, updateSelection } from './sceneSelection';
import { fitOrbitCamera, resetCamera, finishViewTransition, startViewTransition } from './sceneCamera';
import { updatePresentation } from './scenePresentation';

const KEY_DIRECTIONS: Record<string, string> = { KeyW: 'forward', ArrowUp: 'forward', KeyS: 'back', ArrowDown: 'back', KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right', KeyQ: 'lookLeft', KeyE: 'lookRight', KeyR: 'lookUp', KeyF: 'lookDown' };

export default function RoomScene(props: RoomSceneProps) {
  const graphicsPreferences = useGraphicsSettings();
  const locale = useLocale();
  const container = useRef<HTMLDivElement>(null);
  const runtime = useRef<SceneRuntime | null>(null);
  const overlayPaused = useRef(false);
  const [preview, setPreview] = useState<Room | null>(null);
  const [previewProject, setPreviewProject] = useState<ProjectDocument | null>(null);
  const effectiveRoom = props.readOnly ? preview ?? props.room : props.room;
  const effectiveProject = props.readOnly ? previewProject ?? props.project : props.project;
  const effectiveActiveLevelId = props.readOnly ? previewProject?.activeLevelId ?? props.activeLevelId : props.activeLevelId;
  const current = useRef(props);
  current.current = { ...props, room: effectiveRoom, project: effectiveProject, activeLevelId: effectiveActiveLevelId };
  const directions = useRef(new Set<string>());
  const joystick = useRef({ x: 0, z: 0 });
  const [stick, setStick] = useState({ x: 0, z: 0 });
  const joystickPointer = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [walkBlocked, setWalkBlocked] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const lastResetKey = useRef(props.resetKey);
  const [notice, setNotice] = useState('');
  const [walkTarget, setWalkTarget] = useState<Selection | null>(null);
  const walkTargetRef = useRef<Selection | null>(null);
  useEffect(() => {
    const invalidate = () => { if (runtime.current) runtime.current.needsRender = true; };
    window.addEventListener('space-material-ready', invalidate); document.addEventListener('visibilitychange', invalidate);
    return () => { window.removeEventListener('space-material-ready', invalidate); document.removeEventListener('visibilitychange', invalidate); };
  }, []);
  useEffect(() => {
    const modal = (event: Event) => { overlayPaused.current = (event as CustomEvent<boolean>).detail === true; if (runtime.current) { runtime.current.overlayPaused = overlayPaused.current; runtime.current.needsRender = true; } directions.current.clear(); joystick.current = { x: 0, z: 0 }; setStick({ x: 0, z: 0 }); };
    window.addEventListener('space-mesh-editor-active', modal);
    return () => window.removeEventListener('space-mesh-editor-active', modal);
  }, []);
  useEffect(() => {
    const active = runtime.current;
    if (!active || !ready) return;
    active.graphics = getGraphicsProfile(); active.postProcessing?.dispose(); active.postProcessing = null; active.postFailed = false;
    buildRoom(active, current.current.room); updateSelection(active, current.current);
  }, [graphicsPreferences, ready]);
  useEffect(() => {
    if (runtime.current) runtime.current.needsRender = true;
    if (props.paused) { directions.current.clear(); joystick.current = { x: 0, z: 0 }; setStick({ x: 0, z: 0 }); }
  }, [props.paused]);
  useEffect(() => {
    runtime.current?.renderer.domElement.setAttribute('aria-label', t('Visor 3D del cuarto. Arrastra para mirar. En recorrido: WASD o flechas para moverte, Q y E para girar, R y F para mirar arriba y abajo. Toca puertas y focos, o mira hacia ellos y pulsa Enter o espacio.'));
  }, [locale, ready]);

  const changeWalkTarget = (target: Selection | null) => {
    if (target === null && walkTargetRef.current === null || sameSelection(target, walkTargetRef.current)) return;
    walkTargetRef.current = target;
    setWalkTarget(target);
  };
  const interact = (target: Selection | null) => {
    const state = current.current, active = runtime.current;
    if (!active || active.viewTransition || state.mode !== 'walk' || !canInteract(state.room, target) || !target) return;
    const next = toggleSceneInteraction(state.room, target);
    if (!state.readOnly && state.onChange(next) === false) return;
    current.current = { ...state, room: next };
    if (state.project) { const project = updateProjectRoom(state.project, active.activeLevelId ?? state.project.activeLevelId, next); active.project = project; current.current.project = project; if (state.readOnly) setPreviewProject(project); }
    updateRoom(active, next);
    updateSelection(active, current.current);
    changeWalkTarget(target);
    if (state.readOnly) setPreview(next);
    setNotice('');
  };

  useEffect(() => { setPreview(null); setPreviewProject(null); }, [props.room, props.project, props.readOnly]);

  useEffect(() => {
    let cancelled = false;
    let renderer: THREE.WebGPURenderer | null = null;
    let observer: ResizeObserver | null = null;
    let removeEvents = () => {};
    let removeOrbitEvents = () => {};
    let unregisterFlush = () => {}, unregisterActivity = () => {};
    const mount = container.current;
    if (!mount) return;
    const initialize = async () => {
      try {
        renderer = new THREE.WebGPURenderer({ antialias: true });
        try { await renderer.init(); }
        catch {
          try { renderer.dispose(); } catch { /* initialization may not have allocated a backend */ }
          if (cancelled) return;
          renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: true });
          await renderer.init();
        }
        if (cancelled) { renderer.dispose(); return; }
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color('#e9ece4');
        const camera = new THREE.PerspectiveCamera(43, 1, 0.025, 250);
        const canvas = renderer.domElement;
        canvas.tabIndex = 0;
        canvas.setAttribute('aria-label', t('Visor 3D del cuarto. Arrastra para mirar. En recorrido: WASD o flechas para moverte, Q y E para girar, R y F para mirar arriba y abajo. Toca puertas y focos, o mira hacia ellos y pulsa Enter o espacio.'));
        mount.append(canvas);
        const transform = new TransformControls(camera, canvas);
        transform.enabled = false;
        transform.setSize(window.matchMedia('(pointer: coarse)').matches ? 1.35 : 1.05);
        transform.setColors('#ce756a', '#819968', '#6d97b4', '#d7ab5b');
        const proxy = new THREE.Object3D();
        scene.add(proxy, transform.getHelper());
        const controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.enablePan = true;
        const content = new THREE.Group();
        scene.add(content);
        const active: SceneRuntime = { graphics: getGraphicsProfile(), needsRender: true, renderer, scene, camera, controls, content, walls: [], ceiling: null, yaw: 0, pitch: 0, fittedDistance: 0, objects: new Map(), invalidFurniture: new Set(), selectionBox: null, walkBlocked: false, viewTransition: null, orbitPose: null, animateView: !!current.current.animateView, ceilingOpacity: current.current.mode === 'walk' ? 1 : 0, transform, proxy, manipulating: null, directDragging: false, pendingEdit: false, lastOpeningBuild: 0, environment: null, architecturalEnvironment: null, sky: null, loadingSky: false, disposed: false, areaTextures: null, postProcessing: null, postFailed: false, viewMode: current.current.mode, builtRoom: null, structure: '', outlinedKey: null };
        // Wheel input may finish controls.update() before the next animation frame; its change event must invalidate that frame.
        const invalidateOrbit = () => { active.needsRender = true; };
        controls.addEventListener('change', invalidateOrbit);
        removeOrbitEvents = () => controls.removeEventListener('change', invalidateOrbit);
        runtime.current = active;
        active.overlayPaused = overlayPaused.current;
        active.roomId = current.current.roomId;
        active.project = current.current.project; active.activeLevelId = current.current.activeLevelId ?? active.project?.activeLevelId; active.presentation = current.current.presentation;
        active.publicView = current.current.publicView;
        active.onModelError = message => current.current.onModelError?.(message);
        buildRoom(active, current.current.room);
        resetCamera(active, current.current.room, current.current.mode);
        updateSelection(active, current.current);
        setWalkBlocked(active.walkBlocked);
        const resize = () => {
          const width = Math.max(1, mount.clientWidth);
          const height = Math.max(1, mount.clientHeight);
          const detailed = current.current.room.renderQuality !== 'standard';
          const highResolution = detailed && !window.matchMedia('(pointer: coarse)').matches && width > 700;
          const ratio = renderPixelRatio(window.devicePixelRatio, current.current.room.renderQuality, highResolution) * active.graphics.renderScale;
          const size = active.renderer.getSize(new THREE.Vector2());
          if (size.x !== width || size.y !== height || active.renderer.getPixelRatio() !== ratio) {
            active.postProcessing?.dispose(); active.postProcessing = null;
            active.renderer.setPixelRatio(ratio); active.renderer.setSize(width, height);
          }
          let shadowProfileChanged = false;
          content.traverse(object => {
            if (!(object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight)) return;
            const size = object instanceof THREE.DirectionalLight ? active.graphics.shadows || 512 : Math.min(active.graphics.shadows || 512, 1024);
            if (object.shadow.mapSize.x !== size) { object.shadow.mapSize.set(size, size); object.shadow.needsUpdate = true; shadowProfileChanged = true; }
          });
          // Recreate shadow nodes when switching profiles so GPU bindings do not retain the old maps.
          if (shadowProfileChanged) { buildRoom(active, current.current.room); updateSelection(active, current.current); }
          const aspect = width / height;
          if (Math.abs(camera.aspect - aspect) > 0.001) {
            camera.aspect = aspect;
            if (current.current.mode === 'orbit' && !active.viewTransition) fitOrbitCamera(active, current.current.room, true);
          }
          camera.updateProjectionMatrix();
        };
        observer = new ResizeObserver(resize);
        observer.observe(mount);
        resize();
        let pointer: { id: number; x: number; y: number; startX: number; startY: number; handled: boolean; multi: boolean } | null = null;
        const pointers = new Set<number>();
        let directPlane: THREE.Plane | null = null;
        const dragOffset = new THREE.Vector3();
        const ray = new THREE.Raycaster();
        const point = new THREE.Vector3();
        const normalized = (event: PointerEvent) => {
          const rect = canvas.getBoundingClientRect();
          return { x: (event.clientX - rect.left) / rect.width * 2 - 1, y: -(event.clientY - rect.top) / rect.height * 2 + 1, button: event.button };
        };
        const setRay = (event: PointerEvent) => { const position = normalized(event); ray.setFromCamera(new THREE.Vector2(position.x, position.y), camera); };
        const pickRay = (changeLevel = false): Selection | null => {
          const targets = [...new Set(active.objects.values())].filter(object => object.visible && object.layers.test(camera.layers));
          for (const hit of ray.intersectObjects(targets, true)) {
            if (hit.object.userData.slabSurfaceId) {
              const id = hit.object.userData.slabSurfaceId as string;
              if (hit.face?.materialIndex === 1 && active.project) {
                const lower = active.project.levels.find(level => ceilingFinishTargets(active.project!, level.id).some(target => target.id === id && target.side === 'undersideFinish'));
                if (lower) { if (changeLevel && lower.id !== active.activeLevelId) current.current.onActiveLevelChange?.(lower.id); return { kind: 'ceiling', id }; }
              }
              if (hit.object.userData.levelId !== active.activeLevelId) continue;
            }
            let item: THREE.Object3D | null = hit.object;
            while (item && !item.userData.selection) item = item.parent;
            if (item?.userData.selection) return item.userData.selection;
          }
          return null;
        };
        const pick = (event: PointerEvent): Selection | null => { setRay(event); return pickRay(true); };
        const findWalkTarget = () => {
          const state = current.current;
          camera.updateMatrixWorld();
          ray.setFromCamera(new THREE.Vector2(), camera);
          const lookedAt = pickRay();
          const candidates = [lookedAt, walkTargetRef.current, state.selection];
          for (const candidate of candidates) {
            if (!candidate || !canInteract(state.room, candidate)) continue;
            const position = itemWorldPosition(state.room, candidate);
            if (!position) continue;
            const target = new THREE.Vector3(position.x, position.y + (state.room.elevation ?? 0), position.z);
            if (target.distanceTo(camera.position) > 5) continue;
            const screen = target.project(camera);
            if (screen.z < -1 || screen.z > 1 || Math.abs(screen.x) > 0.95 || Math.abs(screen.y) > 0.95) continue;
            ray.setFromCamera(new THREE.Vector2(screen.x, screen.y), camera);
            if (sameSelection(pickRay(), candidate)) return candidate;
          }
          return null;
        };
        let lastCommitError: Error | null = null;
        const commitProxy = (force = false) => {
          if (!active.pendingEdit) return;
          const state = current.current;
          const selected = active.manipulating;
          if (state.readOnly || state.mode !== 'orbit' || !selected) { active.pendingEdit = false; return; }
          if (selected.kind === 'opening' && !force && performance.now() - active.lastOpeningBuild < 80) return;
          active.pendingEdit = false;
          active.lastOpeningBuild = performance.now();
          try {
            const next = moveSceneItem(state.room, selected, { x: proxy.position.x, y: proxy.position.y - (state.room.elevation ?? 0), z: proxy.position.z, rotation: THREE.MathUtils.radToDeg(proxy.rotation.y) });
            if (next !== state.room && state.onChange(next) === false) throw new Error('No se pudo aplicar el cambio.');
            current.current = { ...state, room: next };
            if (state.project) { active.project = updateProjectRoom(state.project, active.activeLevelId ?? state.project.activeLevelId, next); current.current.project = active.project; }
            const accepted = itemWorldPosition(next, selected);
            if (accepted) proxy.position.set(accepted.x, accepted.y + (state.room.elevation ?? 0), accepted.z);
            if (selected.kind === 'furniture') { const item = next.furniture.find(item => item.id === selected.id); if (item) proxy.rotation.y = THREE.MathUtils.degToRad(item.rotation); }
            updateRoom(active, next);
            updateSelection(active, current.current);
            setNotice('');
            lastCommitError = null;
            return true;
          } catch (cause) { lastCommitError = cause instanceof Error ? cause : new Error('No se puede colocar aquí.'); setNotice(lastCommitError.message); return false; }
        };
        unregisterFlush = registerBeforeAppUpdate(async () => { if (active.pendingEdit && commitProxy(true) === false) throw lastCommitError ?? new Error('No se puede colocar aquí.'); });
        unregisterActivity = registerAppActivity(() => !current.current.publicView && (active.directDragging || transform.dragging) ? 'El movimiento pendiente se conserva. Revísalo antes de continuar.' : false);
        const finishDrag = () => {
          commitProxy(true);
          active.directDragging = false;
          active.manipulating = null;
          active.pendingEdit = false;
          directPlane = null;
          controls.enabled = current.current.mode === 'orbit' && !active.viewTransition;
          updateSelection(active, current.current);
        };
        const changed = () => { if (active.transform.dragging) active.pendingEdit = true; };
        const dragging = (event: { value: unknown }) => {
          if (event.value) { active.manipulating = current.current.selection; controls.enabled = false; }
          else finishDrag();
        };
        transform.addEventListener('objectChange', changed);
        transform.addEventListener('dragging-changed', dragging);
        const down = (event: PointerEvent) => {
          if (active.viewTransition) { event.preventDefault(); event.stopImmediatePropagation(); return; }
          if ((transform.dragging || active.directDragging) && pointer && event.pointerId !== pointer.id) { event.preventDefault(); event.stopImmediatePropagation(); return; }
          canvas.focus({ preventScroll: true });
          pointers.add(event.pointerId);
          if (pointer && pointers.size > 1) pointer.multi = true;
          if (pointers.size > 1) return;
          pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, handled: false, multi: false };
          if (current.current.mode === 'walk') canvas.setPointerCapture(event.pointerId);
          if (!transform.enabled || current.current.readOnly || current.current.mode !== 'orbit' || event.button !== 0) return;
          transform.pointerHover(normalized(event) as unknown as PointerEvent);
          if (transform.axis) { pointer.handled = true; controls.enabled = false; return; }
          const selected = pick(event);
          if (current.current.transformMode !== 'translate' || !canMove(selected) || !sameSelection(selected, current.current.selection)) return;
          directPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -proxy.position.y);
          if (!ray.ray.intersectPlane(directPlane, point)) { directPlane = null; return; }
          dragOffset.copy(proxy.position).sub(point);
          active.manipulating = selected;
          active.directDragging = true;
          controls.enabled = false;
          pointer.handled = true;
          event.preventDefault(); event.stopImmediatePropagation();
          canvas.setPointerCapture(event.pointerId);
        };
        const move = (event: PointerEvent) => {
          if (active.viewTransition) { event.preventDefault(); event.stopImmediatePropagation(); return; }
          if (!pointer || pointer.id !== event.pointerId) return;
          if (active.directDragging && directPlane) {
            event.preventDefault(); event.stopImmediatePropagation();
            if (current.current.readOnly || current.current.mode !== 'orbit') { finishDrag(); return; }
            setRay(event);
            if (ray.ray.intersectPlane(directPlane, point)) { proxy.position.copy(point).add(dragOffset); active.pendingEdit = true; }
            return;
          }
          if (current.current.mode !== 'walk') return;
          if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) >= 5) pointer.handled = true;
          active.yaw -= (event.clientX - pointer.x) * 0.004;
          active.pitch = THREE.MathUtils.clamp(active.pitch - (event.clientY - pointer.y) * 0.004, -1.25, 1.25);
          camera.rotation.set(active.pitch, active.yaw, 0, 'YXZ');
          pointer.x = event.clientX;
          pointer.y = event.clientY;
        };
        const up = (event: PointerEvent) => {
          pointers.delete(event.pointerId);
          if (active.viewTransition) { pointer = null; event.preventDefault(); event.stopImmediatePropagation(); return; }
          if (!pointer || pointer.id !== event.pointerId) return;
          if (active.directDragging) { event.preventDefault(); event.stopImmediatePropagation(); finishDrag(); if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); }
          else if (!pointer.handled && !pointer.multi && Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 5) {
            const selected = pick(event);
            if (current.current.mode === 'walk') interact(selected);
            else current.current.onSelect(selected);
          }
          pointer = null;
        };
        const cancel = () => { pointers.clear(); if (transform.dragging) transform.pointerUp(null); if (active.directDragging) finishDrag(); pointer = null; controls.enabled = current.current.mode === 'orbit' && !active.viewTransition; };
        const keyDown = (event: KeyboardEvent) => {
          if (event.target !== canvas) return;
          if (active.viewTransition) { if (KEY_DIRECTIONS[event.code] || event.code === 'Enter' || event.code === 'Space') event.preventDefault(); return; }
          if (event.code === 'Escape') { cancel(); current.current.onSelect(null); return; }
          if (current.current.mode === 'orbit' && !current.current.readOnly && canMove(current.current.selection)) {
            const selected = current.current.selection;
            const position = selected ? itemWorldPosition(current.current.room, selected) : null;
            const step = current.current.room.editing.snap ? current.current.room.editing.step : 0.05;
            const shift = ({ ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, 0, -step], ArrowDown: [0, 0, step], KeyR: [0, step, 0], KeyF: [0, -step, 0] } as Record<string, number[]>)[event.code];
            const rotation = selected?.kind === 'furniture' && (event.code === 'KeyQ' || event.code === 'KeyE');
            if (position && selected && (shift || rotation)) {
              event.preventDefault();
              active.manipulating = selected;
              proxy.position.set(position.x + (shift?.[0] ?? 0), (current.current.room.elevation ?? 0) + position.y + (shift?.[1] ?? 0), position.z + (shift?.[2] ?? 0));
              if (rotation) proxy.rotation.y += THREE.MathUtils.degToRad(event.code === 'KeyQ' ? 15 : -15);
              active.pendingEdit = true; commitProxy(true); active.manipulating = null; updateSelection(active, current.current);
            }
            return;
          }
          if (current.current.mode !== 'walk') return;
          if (event.code === 'Enter' || event.code === 'Space') {
            event.preventDefault();
            if (!event.repeat) interact(findWalkTarget());
            return;
          }
          const direction = KEY_DIRECTIONS[event.code];
          if (direction) { directions.current.add(direction); event.preventDefault(); }
        };
        const keyUp = (event: KeyboardEvent) => {
          const direction = KEY_DIRECTIONS[event.code];
          if (direction) directions.current.delete(direction);
        };
        const blur = () => { cancel(); directions.current.clear(); joystickPointer.current = null; joystick.current = { x: 0, z: 0 }; setStick({ x: 0, z: 0 }); };
        canvas.addEventListener('pointerdown', down, true);
        canvas.addEventListener('pointermove', move, true);
        canvas.addEventListener('pointerup', up, true);
        canvas.addEventListener('pointercancel', cancel);
        canvas.addEventListener('lostpointercapture', cancel);
        window.addEventListener('keydown', keyDown);
        window.addEventListener('keyup', keyUp);
        window.addEventListener('blur', blur);
        removeEvents = () => {
          canvas.removeEventListener('pointerdown', down, true);
          canvas.removeEventListener('pointermove', move, true);
          canvas.removeEventListener('pointerup', up, true);
          canvas.removeEventListener('pointercancel', cancel);
          canvas.removeEventListener('lostpointercapture', cancel);
          transform.removeEventListener('objectChange', changed);
          transform.removeEventListener('dragging-changed', dragging);
          window.removeEventListener('keydown', keyDown);
          window.removeEventListener('keyup', keyUp);
          window.removeEventListener('blur', blur);
        };
        let previous = 0, lastWalkTargetUpdate = 0, lastMetricsUpdate = -Infinity, lastResidencyUpdate = -Infinity;
        const performanceController = new GraphicsPerformanceController();
        let sampledPreferences = getGraphicsPreferences();
        await renderer.setAnimationLoop(time => {
          if (cancelled) return;
          if (current.current.paused || active.overlayPaused || document.visibilityState === 'hidden') { previous = 0; return; }
          if (active.graphics.fps && previous && time - previous < 1000 / active.graphics.fps - 1) return;
          const elapsedMs = previous ? time - previous : 0;
          const delta = Math.min(0.04, elapsedMs / 1000);
          previous = time;
          const state = current.current;
          if (active.project && time - lastResidencyUpdate > 500) { const desired = residentLevelIds(active.project, active.activeLevelId ?? active.project.activeLevelId, state.mode === 'walk', camera.position, active.graphics.distance); const changed = [...active.levelViews ?? []].some(([id, view]) => view.resident !== desired.has(id)); if (changed) buildProjectScene(active, active.project); lastResidencyUpdate = time; }
          commitProxy();
          if (active.viewTransition) {
            if (sampleCameraTransition(active.viewTransition, performance.now(), camera)) {
              finishViewTransition(active);
              updateSelection(active, current.current);
              setTransitioning(false);
              setWalkBlocked(active.walkBlocked);
            }
          } else if (state.mode === 'walk') {
            active.yaw += (Number(directions.current.has('lookLeft')) - Number(directions.current.has('lookRight'))) * delta * 1.4;
            active.pitch = THREE.MathUtils.clamp(active.pitch + (Number(directions.current.has('lookUp')) - Number(directions.current.has('lookDown'))) * delta, -1.25, 1.25);
            camera.rotation.set(active.pitch, active.yaw, 0, 'YXZ');
            const forward = Number(directions.current.has('forward')) - Number(directions.current.has('back')) - joystick.current.z;
            const right = Number(directions.current.has('right')) - Number(directions.current.has('left')) + joystick.current.x;
            const length = Math.max(1, Math.hypot(forward, right));
            const distance = delta * 1.8 / length;
            const dx = (-Math.sin(active.yaw) * forward + Math.cos(active.yaw) * right) * distance;
            const dz = (-Math.cos(active.yaw) * forward - Math.sin(active.yaw) * right) * distance;
            if (active.navigator) {
              active.walkState ??= active.navigator.start(active.activeLevelId ?? active.project!.activeLevelId, camera.position) ?? undefined;
              if (active.walkState) {
                active.walkState = active.navigator.move(active.walkState, { x: dx, z: dz });
                camera.position.set(active.walkState.x, active.walkState.eyeY, active.walkState.z);
                if (active.walkState.levelId !== active.activeLevelId) {
                  active.activeLevelId = active.walkState.levelId;
                  if (active.project) { buildProjectScene(active, active.project); const next = projectToRoom(active.project, active.activeLevelId); current.current = { ...current.current, room: next, activeLevelId: active.activeLevelId }; if (state.readOnly) { setPreview(next); setPreviewProject({ ...active.project, activeLevelId: active.activeLevelId }); } }
                  state.onActiveLevelChange?.(active.activeLevelId);
                }
              }
            } else {
              if (furnitureWalkable({ x: camera.position.x + dx, z: camera.position.z }, state.room)) camera.position.x += dx;
              if (furnitureWalkable({ x: camera.position.x, z: camera.position.z + dz }, state.room)) camera.position.z += dz;
            }
            if (time - lastWalkTargetUpdate >= 80) { changeWalkTarget(findWalkTarget()); lastWalkTargetUpdate = time; }
          } else if (!transform.dragging && !active.directDragging && controls.update()) active.needsRender = true;
          if (state.mode === 'walk') {
            const pose = JSON.stringify({ x: camera.position.x, z: camera.position.z, yaw: active.yaw, feetY: active.walkState?.y ?? camera.position.y - 1.6, eyeY: camera.position.y, levelId: active.walkState?.levelId ?? active.activeLevelId, surfaceId: active.walkState?.surfaceId, blocked: active.walkState?.blocked ?? active.walkBlocked });
            if (canvas.dataset.walkPose !== pose) canvas.dataset.walkPose = pose;
          }
          updatePresentation(active, current.current, delta);
          if (state.mode === 'orbit' && !active.needsRender && !active.viewTransition && !transform.dragging && !active.directDragging) return;
          try {
            const renderStarted = performance.now();
            if (state.room.renderQuality === 'hyperrealistic' && active.graphics.ao !== 'off' && !active.postProcessing && !active.postFailed) {
              try { active.postProcessing = createArchitecturalPostProcessing(active.renderer, scene, camera, active.graphics.ao); }
              catch (cause) { active.postFailed = true; console.warn('Architectural effects:', cause); }
            }
            if (active.postProcessing) {
              try { active.postProcessing.render(); }
              catch (cause) {
                console.warn('Architectural effects:', cause);
                active.postProcessing.dispose(); active.postProcessing = null; active.postFailed = true;
                active.renderer.render(scene, camera);
              }
            } else active.renderer.render(scene, camera);
            active.needsRender = false;
            if (time - lastMetricsUpdate >= 1000) {
              const resources = sceneResourceUsage(scene), info = active.renderer.info;
              canvas.dataset.sceneMetrics = JSON.stringify({ sampledAt: Date.now(), activeLevelId: active.activeLevelId ?? active.builtRoom?.levelId ?? null, levels: active.project?.levels.length ?? 1, residentLevels: active.levelViews ? [...active.levelViews.values()].filter(view => view.resident).length : 1, architectureBuilds: active.levelViews ? [...active.levelViews.values()].reduce((sum, view) => sum + (view.runtime.architectureBuilds ?? 0), 0) : active.architectureBuilds ?? 0, gpuGeometries: info.memory.geometries, gpuTextures: info.memory.textures, drawCalls: info.render.drawCalls, renderedTriangles: info.render.triangles, frameMs: Math.round((performance.now() - renderStarted) * 100) / 100, walk: active.walkState ? { levelId: active.walkState.levelId, feetY: active.walkState.y, eyeY: active.walkState.eyeY, x: active.walkState.x, z: active.walkState.z, yaw: active.yaw, surfaceId: active.walkState.surfaceId, blocked: active.walkState.blocked } : null, ...resources }); lastMetricsUpdate = time;
            }
            const settings = getGraphicsPreferences();
            if (settings !== sampledPreferences && JSON.stringify(settings) !== JSON.stringify(sampledPreferences)) { performanceController.reset(); sampledPreferences = settings; }
            const adaptive = performanceController.sample(Math.max(performance.now() - renderStarted, elapsedMs), elapsedMs, active.graphics.fps || 60, settings.mode === 'auto');
            if (adaptive !== null) { setAdaptiveGraphicsTier(adaptive); sampledPreferences = getGraphicsPreferences(); }
          }
          catch (cause) {
            console.error('Room renderer:', cause);
            void active.renderer.setAnimationLoop(null);
            setError(t("No se pudo mostrar el cuarto. Actualiza el navegador o activa la aceleración gráfica."));
          }
        });
        if (cancelled) return;
        setReady(true);
        canvas.dataset.backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
        current.current.onReady?.(canvas.dataset.backend === 'webgpu' ? 'WebGPU · TSL' : 'WebGL2 · TSL');
      } catch (cause) {
        console.error('Room renderer initialization:', cause);
        observer?.disconnect();
        unregisterActivity(); unregisterFlush();
        removeEvents();
        removeOrbitEvents();
        const active = runtime.current;
        if (active?.renderer === renderer) {
          active.controls.dispose();
          active.transform.dispose();
          active.environment?.dispose();
          if (active.selectionBox) { active.selectionBox.geometry.dispose(); (active.selectionBox.material as THREE.Material).dispose(); }
          disposeContent(active.content);
          disposeArchitecture(active);
          runtime.current = null;
        }
        try { renderer?.dispose(); } catch { /* a rejected backend might not be initialized */ }
        renderer?.domElement.remove();
        if (!cancelled) setError(t("Este navegador no pudo iniciar el visor 3D. Actualiza el navegador o activa la aceleración gráfica."));
      }
    };
    void initialize();
    return () => {
      cancelled = true;
      observer?.disconnect();
      unregisterActivity(); unregisterFlush();
      removeEvents();
      removeOrbitEvents();
      directions.current.clear();
      joystick.current = { x: 0, z: 0 };
      const active = runtime.current;
      if (active) {
        void active.renderer.setAnimationLoop(null);
        active.controls.dispose();
        active.transform.dispose();
        active.environment?.dispose();
        if (active.selectionBox) { active.selectionBox.geometry.dispose(); (active.selectionBox.material as THREE.Material).dispose(); }
        disposeContent(active.content);
        disposeArchitecture(active);
        active.renderer.dispose();
        active.renderer.domElement.remove();
        runtime.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const active = runtime.current;
    if (!active || !ready) return;
    const previousLevelId = active.activeLevelId;
    const previousLevelsMode = active.presentation?.levels;
    active.project = effectiveProject; active.activeLevelId = effectiveActiveLevelId ?? effectiveProject?.activeLevelId; active.presentation = props.presentation;
    if (active.roomId !== props.roomId || active.publicView !== props.publicView) {
      active.roomId = props.roomId;
      active.publicView = props.publicView;
      buildRoom(active, effectiveRoom);
    } else updateRoom(active, effectiveRoom);
    updateSelection(active, current.current);
    if (props.mode === 'walk' && active.viewMode === props.mode && !active.viewTransition) {
      if (active.navigator) { if (previousLevelId !== active.activeLevelId && active.walkState?.levelId !== active.activeLevelId) resetCamera(active, effectiveRoom, props.mode); else if (active.walkState) active.camera.position.y = active.walkState.eyeY; }
      else { active.camera.position.y = (effectiveRoom.elevation ?? 0) + Math.min(1.65, effectiveRoom.height - 0.2); if (!furnitureWalkable(active.camera.position, effectiveRoom)) resetCamera(active, effectiveRoom, props.mode); }
      setWalkBlocked(active.walkBlocked);
    }
    if ((previousLevelId !== active.activeLevelId || previousLevelsMode !== active.presentation?.levels) && props.mode === 'orbit') resetCamera(active, effectiveRoom, props.mode);
  }, [effectiveRoom, effectiveProject, effectiveActiveLevelId, props.presentation, props.roomId, props.publicView, ready]);

  useEffect(() => {
    if (runtime.current && ready) {
      const active = runtime.current;
      directions.current.clear();
      joystickPointer.current = null;
      joystick.current = { x: 0, z: 0 };
      setStick({ x: 0, z: 0 });
      changeWalkTarget(null);
      const resetRequested = lastResetKey.current !== props.resetKey;
      lastResetKey.current = props.resetKey;
      if (props.animateView && !resetRequested && props.mode !== 'plan' && active.viewMode !== 'plan') {
        if (active.viewMode !== props.mode) {
          active.transform.pointerUp(null);
          active.directDragging = false;
          active.pendingEdit = false;
          active.manipulating = null;
          startViewTransition(active, current.current.room, props.mode);
          setTransitioning(!!active.viewTransition);
        }
      } else {
        resetCamera(active, current.current.room, props.mode);
        setTransitioning(false);
      }
      updateSelection(active, current.current);
      setWalkBlocked(active.walkBlocked);
    }
  }, [props.mode, props.resetKey, props.animateView, ready]);

  useEffect(() => {
    const active = runtime.current;
    if (!active || !ready) return;
    if (props.readOnly || props.mode !== 'orbit' || active.manipulating && !sameSelection(active.manipulating, props.selection)) {
      active.transform.pointerUp(null);
      active.directDragging = false;
      active.pendingEdit = false;
      active.manipulating = null;
      active.controls.enabled = props.mode === 'orbit' && !active.viewTransition;
    }
    updateSelection(active, current.current);
    setNotice('');
  }, [props.selection, props.readOnly, props.transformMode, props.mode, ready]);

  const moveJoystick = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (runtime.current?.viewTransition) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const vector = joystickVector((event.clientX - rect.left - rect.width / 2) / 34, (event.clientY - rect.top - rect.height / 2) / 34);
    joystick.current = vector;
    setStick(vector);
  };
  const releaseJoystick = () => {
    joystickPointer.current = null;
    joystick.current = { x: 0, z: 0 };
    setStick({ x: 0, z: 0 });
  };
  const targetDoor = walkTarget?.kind === 'opening' ? effectiveRoom.openings.find(opening => opening.id === walkTarget.id && opening.type === 'door' && opening.doorStyle !== 'frame') : null;
  const targetLight = walkTarget?.kind === 'light' ? effectiveRoom.lights.find(light => light.id === walkTarget.id) : null;
  const interactionLabel = targetDoor ? targetDoor.open === false ? t("Abrir puerta") : t("Cerrar puerta") : targetLight ? t(targetLight.enabled ? 'Apagar {{name}}' : 'Encender {{name}}', { name: targetLight.name }) : null;

  return <div className="room-scene" ref={container}>
    {!ready && !error && <div className="scene-loading"><LoaderCircle size={24} /><span>{t("Cargando…")}</span></div>}
    {error && <div className="scene-error" role="alert"><strong>{t("No pudimos iniciar el visor")}</strong><p>{t(error)}</p></div>}
    {notice && !error && <div className="scene-notice" role="status">{t(notice)}</div>}
    {ready && !error && !transitioning && props.mode === 'walk' && <><div className="walk-hint">{walkBlocked ? t("No queda espacio libre para caminar. Mueve algún mueble.") : t("Arrastra para mirar · Toca puertas y focos")}</div>{interactionLabel && <button type="button" className="walk-interaction" aria-pressed={targetDoor ? targetDoor.open !== false : targetLight?.enabled} onClick={() => interact(walkTargetRef.current)}>{targetDoor ? targetDoor.open === false ? <DoorOpen size={20} /> : <DoorClosed size={20} /> : <Lightbulb size={20} />}<span>{interactionLabel}</span></button>}<div className="walk-joystick"><button type="button" tabIndex={-1} className="joystick-base" aria-label={t("Joystick de movimiento: arrastra para caminar. Con teclado usa WASD en el visor.")} onPointerDown={event => { event.preventDefault(); event.stopPropagation(); joystickPointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); moveJoystick(event); }} onPointerMove={event => { if (joystickPointer.current === event.pointerId) { event.stopPropagation(); moveJoystick(event); } }} onPointerUp={releaseJoystick} onPointerCancel={releaseJoystick} onLostPointerCapture={releaseJoystick}><span className="joystick-knob" style={{ transform: `translate(${stick.x * 34}px, ${stick.z * 34}px)` }} /></button></div></>}
  </div>;
}
