import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { prepareCustomModelTemplate } from './customModel';
import { applySelectionTransform, captureSelectionTransform, createSelectionProxy, duplicateWorkshopPieces, groupWorkshopPieces, readWorkshopGroup, ungroupWorkshopPieces, workshopGroup, workshopSelectionUnit } from './workshopGrouping';
import { cloneWorkshopModel, disposeWorkshopModel, exportWorkshopGLB } from './modelWorkshopGeometry';
import { alignWorkshopPiece, snapWorkshopPiece } from './workshopAlignment';
import { captureWorkshopSnapshot, WorkshopHistory } from './workshopHistory';

const box = (x = 0): THREE.Mesh => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()); mesh.position.x = x; return mesh; };
const near = (actual: THREE.Vector3, expected: THREE.Vector3) => assert.ok(actual.distanceTo(expected) < 1e-8, `${actual.toArray()} != ${expected.toArray()}`);

test('group metadata is small, validated, and only expands selection to its members', () => {
  for (const value of [null, [], true, { id: '../x', name: 'bad' }, { id: 'a', name: '' }, { id: 'a', name: 'x'.repeat(81) }, { id: 'a', name: 'a\nb' }]) assert.equal(readWorkshopGroup(value), null);
  assert.deepEqual(readWorkshopGroup({ id: 'group_1', name: '  Mesa  ', geometry: true }), { id: 'group_1', name: 'Mesa' });
  const a = box(), b = box(2), c = box(4), pieces = [a, b, c];
  assert.equal(groupWorkshopPieces([a], 'x'), false);
  assert.equal(groupWorkshopPieces([a, b], 'Mesa', 'mesa'), true);
  assert.deepEqual(workshopSelectionUnit(a, pieces), [a, b]);
  assert.deepEqual(workshopSelectionUnit(c, pieces), [c]);
  ungroupWorkshopPieces([a, b]); assert.deepEqual(workshopSelectionUnit(a, pieces), [a]);
  disposeWorkshopModel(new THREE.Group().add(...pieces));
});

test('a repeated group drag uses a stable start, preserves mirrors and distances, and introduces no shear', () => {
  const a = box(-2), b = box(2), parent = new THREE.Group().add(a, b);
  a.scale.set(-2, .3, 1.5); a.rotation.set(.3, .7, .1); b.rotation.z = .6; b.scale.set(.2, 3, 1);
  const snapshot = captureSelectionTransform([a, b]), distance = a.position.distanceTo(b.position), rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  const destination = new THREE.Vector3(3, 4, 5);
  for (let i = 0; i < 10; i++) assert.equal(applySelectionTransform(snapshot, destination, rotation), true);
  assert.ok(Math.abs(a.position.distanceTo(b.position) - distance) < 1e-8);
  near(a.scale, new THREE.Vector3(-2, .3, 1.5)); near(b.scale, new THREE.Vector3(.2, 3, 1));
  const expected = rotation.clone().multiply(snapshot.pieces[0].quaternion); assert.ok(a.quaternion.angleTo(expected) < 1e-7);
  near(a.position, snapshot.pieces[0].position.clone().sub(snapshot.center).applyQuaternion(rotation).add(destination));
  const before = a.position.clone(); assert.equal(applySelectionTransform(snapshot, new THREE.Vector3(Infinity, 0, 0)), false); near(a.position, before);
  assert.equal(applySelectionTransform(snapshot, new THREE.Vector3(20000, 0, 0)), false); near(a.position, before);
  disposeWorkshopModel(parent);
});

test('duplicating a selection keeps its groups separate from the original and copies geometry and materials', () => {
  const a = box(), b = box(2), c = box(4); a.name = 'Pata'; groupWorkshopPieces([a, b], 'Mesa', 'mesa');
  const copies = duplicateWorkshopPieces([a, b, c]);
  assert.equal(workshopGroup(copies[0])?.id, workshopGroup(copies[1])?.id);
  assert.notEqual(workshopGroup(copies[0])?.id, 'mesa'); assert.equal(workshopGroup(copies[2]), null);
  copies[0].geometry.translate(1, 0, 0); (copies[0].material as THREE.MeshStandardMaterial).color.set('red');
  assert.notDeepEqual(copies[0].geometry.getAttribute('position').array, a.geometry.getAttribute('position').array);
  assert.notEqual((copies[0].material as THREE.MeshStandardMaterial).color.getHex(), (a.material as THREE.MeshStandardMaterial).color.getHex());
  near(copies[1].position.clone().sub(copies[0].position), b.position.clone().sub(a.position));
  assert.equal(a.name, 'Pata'); assert.equal(workshopGroup(a)?.id, 'mesa');
  const lone = duplicateWorkshopPieces([a]); assert.equal(workshopGroup(lone[0]), null);
  disposeWorkshopModel(new THREE.Group().add(a, b, c, ...copies, ...lone));
});

test('moving and rotating imported small-scale pieces preserves their physical size and reflected scales', () => {
  const source = new THREE.Group(), imported = new THREE.Mesh(new THREE.BoxGeometry(10000, 10000, 10000), new THREE.MeshStandardMaterial()), other = box(2);
  imported.scale.set(-.0001, .0001, .0001); imported.rotation.z = .2; source.add(imported, other);
  const editable = cloneWorkshopModel(source), pieces = editable.children as THREE.Mesh[], start = captureSelectionTransform(pieces);
  const size = new THREE.Box3().setFromObject(pieces[0]).getSize(new THREE.Vector3()), distance = pieces[0].position.distanceTo(pieces[1].position);
  const moved = start.center.clone().add(new THREE.Vector3(1, 2, 3));
  assert.equal(applySelectionTransform(start, moved), true);
  near(new THREE.Box3().setFromObject(pieces[0]).getSize(new THREE.Vector3()), size);
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  assert.equal(applySelectionTransform(start, moved, rotation), true);
  near(pieces[0].scale, new THREE.Vector3(-.0001, .0001, .0001));
  assert.ok(Math.abs(pieces[0].position.distanceTo(pieces[1].position) - distance) < 1e-8);
  near(pieces[0].position, start.pieces[0].position.clone().sub(start.center).applyQuaternion(rotation).add(moved));
  disposeWorkshopModel(source); disposeWorkshopModel(editable);
});

test('group bounds snap and align as one object while preserving member spacing', () => {
  const a = box(), b = box(2), reference = box(6), parent = new THREE.Group().add(a, b, reference);
  const start = captureSelectionTransform([a, b]), proxy = createSelectionProxy([a, b]); parent.add(proxy);
  assert.equal(alignWorkshopPiece(proxy, reference, 'x', 'before'), true);
  assert.equal(applySelectionTransform(start, proxy.position), true);
  near(a.position, new THREE.Vector3(3, 0, 0)); near(b.position, new THREE.Vector3(5, 0, 0));
  proxy.position.x += .02;
  const matches = snapWorkshopPiece(proxy, [reference], ['x'], { grid: .1, pieces: true, tolerance: .03 });
  assert.equal(matches[0].reference, reference); assert.ok(Math.abs(proxy.position.x - 4) < 1e-8);
  assert.equal(applySelectionTransform(start, proxy.position), true); assert.equal(b.position.x - a.position.x, 2);
  disposeWorkshopModel(parent);
});

test('undo and redo restore group membership and all selected pieces', () => {
  const a = box(), b = box(2), parent = new THREE.Group().add(a, b), ids = [a.uuid, b.uuid], history = new WorkshopHistory();
  history.record(captureWorkshopSnapshot(parent, a.uuid, 'Mesa', ids)); groupWorkshopPieces([a, b], 'Mesa', 'mesa');
  const previous = history.undo(captureWorkshopSnapshot(parent, a.uuid, 'Mesa', ids))!;
  assert.deepEqual(previous.selectedIds, ids); assert.equal(workshopGroup(previous.content.children[0]), null);
  const restored = history.redo(previous)!;
  assert.deepEqual(restored.selectedIds, ids); assert.equal(workshopGroup(restored.content.children[0])?.id, 'mesa');
  history.clear(); disposeWorkshopModel(restored.content); disposeWorkshopModel(parent);
});

test('grouped multi-material pieces retain membership through real GLB export and reload', async () => {
  const previous = globalThis.FileReader;
  class Reader { result: ArrayBuffer | null = null; onloadend?: () => void; readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then(bytes => { this.result = bytes; this.onloadend?.(); }); } }
  globalThis.FileReader = Reader as unknown as typeof FileReader;
  const a = box(), b = box(2), parent = new THREE.Group().add(a, b); a.name = 'Tabla'; b.name = 'Pata';
  a.material = Array.from({ length: 6 }, () => new THREE.MeshStandardMaterial()); groupWorkshopPieces([a, b], 'Mesa', 'mesa');
  let loaded: THREE.Group | null = null, editable: THREE.Group | null = null;
  try {
    const bytes = await exportWorkshopGLB(parent), gltf = await new GLTFLoader().parseAsync(bytes, ''); loaded = gltf.scene;
    prepareCustomModelTemplate(gltf); editable = cloneWorkshopModel(loaded);
    assert.equal(editable.children.length, 2);
    for (const piece of editable.children) assert.deepEqual(workshopGroup(piece), { id: 'mesa', name: 'Mesa' });
    assert.deepEqual(workshopSelectionUnit(editable.children[0] as THREE.Mesh, editable.children as THREE.Mesh[]), editable.children);
    assert.equal((editable.children[0] as THREE.Mesh).geometry.index!.count, 36);
  } finally { globalThis.FileReader = previous; disposeWorkshopModel(parent); if (loaded) disposeWorkshopModel(loaded); if (editable) disposeWorkshopModel(editable); }
});
