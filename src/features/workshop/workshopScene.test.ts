import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { getEditableVertices, disposeWorkshopModel } from './modelWorkshopGeometry';
import { clearSelectionHelpers, disposeWorkshopScene, releaseWorkshopSource, showSnapGuide, updateWorkshopSelection, type WorkshopSceneRuntime } from './workshopScene';

function fixture() {
  const scene = new THREE.Scene(), content = new THREE.Group(), proxy = new THREE.Object3D(), transformHelper = new THREE.Group();
  scene.add(content, proxy, transformHelper);
  let disposed = 0;
  const transform = {
    object: undefined as THREE.Object3D | undefined,
    mode: 'translate', space: 'world', enabled: false,
    detach() { this.object = undefined; }, attach(object: THREE.Object3D) { this.object = object; },
    setMode(mode: string) { this.mode = mode; }, setSpace(space: string) { this.space = space; },
    getHelper() { return transformHelper; }, dispose() { disposed++; },
  };
  const runtime = {
    scene, content, proxy, transform, selectionProxy: null, selectionTransform: null, selectionOutlines: [],
    outline: null, toolOutline: null, snapGuide: null, points: null, face: null, vertexMesh: null, vertexIndices: [],
    renderer: { setAnimationLoop(value: unknown) { assert.equal(value, null); }, dispose() { disposed++; }, domElement: { remove() { disposed++; } } },
    controls: { dispose() { disposed++; } },
  } as unknown as WorkshopSceneRuntime;
  const a = new THREE.Mesh(new THREE.BoxGeometry(.5, 1, .3), new THREE.MeshStandardMaterial());
  const b = new THREE.Mesh(new THREE.BoxGeometry(.3, .2, .4), new THREE.MeshStandardMaterial());
  b.position.set(1, .2, -.5); content.add(a, b);
  const state = { panel: 'model' as const, tool: 'translate' as const, geometryTool: 'vertices' as const, selected: a.uuid, selectedIds: [a.uuid], second: '', reference: undefined, vertexId: 0, faceId: 0, saving: false, computing: false, previewing: false };
  return { runtime, transform, a, b, state, disposed: () => disposed };
}

test('group visualization uses one world proxy and disposes it when switching to vertex editing', () => {
  const { runtime, transform, a, b, state } = fixture();
  const before = [a.position.clone(), b.position.clone()];
  updateWorkshopSelection(runtime, { ...state, selectedIds: [a.uuid, b.uuid], tool: 'scale' });
  const selectionProxy = runtime.selectionProxy!;
  let disposed = 0;
  selectionProxy.geometry.addEventListener('dispose', () => disposed++);
  assert.equal(transform.object, selectionProxy);
  assert.equal(transform.mode, 'translate');
  assert.equal(transform.space, 'world');
  assert.equal(runtime.selectionOutlines.length, 2);
  updateWorkshopSelection(runtime, { ...state, panel: 'geometry' });
  assert.equal(disposed, 1);
  assert.equal(selectionProxy.parent, null);
  assert.equal(runtime.selectionProxy, null);
  assert.equal(runtime.selectionOutlines.length, 0);
  assert.equal(transform.object, runtime.proxy);
  assert.equal(runtime.vertexMesh, a);
  assert.equal(runtime.points!.geometry.getAttribute('position').count, getEditableVertices(a.geometry).length);
  assert.deepEqual([a.position, b.position], before);
  disposeWorkshopScene(runtime);
});

test('face and preview transitions release vertex helpers without changing authored geometry', () => {
  const { runtime, transform, a, state } = fixture();
  const positions = Array.from(a.geometry.getAttribute('position').array);
  updateWorkshopSelection(runtime, { ...state, panel: 'geometry' });
  const points = runtime.points!;
  let disposed = 0;
  points.geometry.addEventListener('dispose', () => disposed++);
  updateWorkshopSelection(runtime, { ...state, panel: 'geometry', geometryTool: 'faces', faceId: 0 });
  assert.equal(disposed, 1);
  assert.equal(points.parent, null);
  assert.equal(runtime.points, null);
  assert.equal(runtime.face!.geometry.getAttribute('position').count, 3);
  assert.equal(transform.object, undefined);
  updateWorkshopSelection(runtime, { ...state, previewing: true });
  assert.equal(runtime.face, null);
  assert.equal(runtime.outline, null);
  assert.deepEqual(Array.from(a.geometry.getAttribute('position').array), positions);
  disposeWorkshopScene(runtime);
});

test('snap guides show matched planes and replace their old buffers, while grid-only matches stay unobtrusive', () => {
  const { runtime, a, b } = fixture();
  showSnapGuide(runtime, a, [{ axis: 'y', value: .2, reference: b }]);
  const guide = runtime.snapGuide!, position = guide.geometry.getAttribute('position');
  assert.equal(position.count, 4);
  for (let index = 0; index < position.count; index++) assert.ok(Math.abs(position.getY(index) - .2) < 1e-7);
  let disposed = 0;
  guide.geometry.addEventListener('dispose', () => disposed++);
  showSnapGuide(runtime, a, [{ axis: 'x', value: 0, reference: null }]);
  assert.equal(disposed, 1);
  assert.equal(runtime.snapGuide, null);
  disposeWorkshopScene(runtime);
});

test('scene disposal stops animation and releases owned helpers; imported sources retain their own disposal callback', () => {
  const { runtime, a, b, state, disposed } = fixture();
  updateWorkshopSelection(runtime, { ...state, selectedIds: [a.uuid, b.uuid] });
  clearSelectionHelpers(runtime);
  assert.equal(runtime.selectionProxy, null);
  assert.deepEqual(runtime.selectionOutlines, []);
  disposeWorkshopScene(runtime);
  assert.equal(disposed(), 4);
  const source = new THREE.Group();
  let released = 0;
  source.userData.disposeEditorModel = () => released++;
  releaseWorkshopSource(source);
  assert.equal(released, 1);
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  source.add(new THREE.Mesh(geometry, material));
  delete source.userData.disposeEditorModel;
  geometry.addEventListener('dispose', () => released++);
  releaseWorkshopSource(source);
  assert.equal(released, 2);
  disposeWorkshopModel(source);
});
