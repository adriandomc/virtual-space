import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { applyWorkshopPatch, captureWorkshopPatch, captureWorkshopSnapshot, compactWorkshopVertexPatch, disposeWorkshopSnapshot, WorkshopHistory } from './workshopHistory';
import { getEditableVertices, moveModelVertex } from './modelWorkshopGeometry';

const snapshot = (name: string, bytes?: number) => {
  const content = new THREE.Group(), piece = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, .5), new THREE.MeshStandardMaterial()); content.add(piece);
  const copy = captureWorkshopSnapshot(content, piece.uuid, name); piece.geometry.dispose(); piece.material.dispose();
  if (bytes !== undefined) copy.bytes = bytes;
  return copy;
};

test('snapshots preserve selection, UUIDs, hidden pieces and exact local transforms without touching originals or textures', () => {
  const content = new THREE.Group(), texture = new THREE.Texture(), material = new THREE.MeshStandardMaterial({ color: '#123456', roughness: .4, map: texture }), geometry = new THREE.BoxGeometry(.5, .5, .5);
  const hidden = new THREE.Mesh(geometry, material), visible = new THREE.Mesh(geometry, material); hidden.visible = false;
  hidden.position.set(1, 2, 3); hidden.rotation.set(.1, .2, .3); hidden.scale.set(2, 3, 4); hidden.name = 'Pieza oculta'; content.add(hidden, visible);
  const value = captureWorkshopSnapshot(content, hidden.uuid, 'Mi modelo'), copy = value.content.children[0] as THREE.Mesh, sibling = value.content.children[1] as THREE.Mesh;
  assert.equal(value.selected, hidden.uuid); assert.equal(value.content.uuid, content.uuid); assert.equal(copy.uuid, hidden.uuid); assert.equal(copy.visible, false); assert.equal(copy.name, hidden.name);
  assert.deepEqual(copy.position.toArray(), hidden.position.toArray()); assert.deepEqual(copy.quaternion.toArray(), hidden.quaternion.toArray()); assert.deepEqual(copy.scale.toArray(), hidden.scale.toArray());
  assert.notEqual(copy.geometry, geometry); assert.notEqual(copy.material, material); assert.equal(copy.geometry, sibling.geometry); assert.equal(copy.material, sibling.material);
  assert.equal((copy.material as THREE.MeshStandardMaterial).map, texture);
  copy.geometry.getAttribute('position').setX(0, 5); (copy.material as THREE.MeshStandardMaterial).color.set('#ffffff');
  assert.notEqual(geometry.getAttribute('position').getX(0), 5); assert.equal(material.color.getHexString(), '123456');
  let textureDisposed = false; texture.addEventListener('dispose', () => { textureDisposed = true; }); disposeWorkshopSnapshot(value);
  assert.equal(textureDisposed, false); assert.equal(content.children.length, 2);
  geometry.dispose(); material.dispose(); texture.dispose();
});

test('byte budgets count shared geometries and interleaved backing buffers once', () => {
  const content = new THREE.Group(), geometry = new THREE.BufferGeometry(), interleaved = new THREE.InterleavedBuffer(new Float32Array(18), 6), uv = new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2);
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(interleaved, 3, 0)); geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(interleaved, 3, 3)); geometry.setAttribute('uv', uv); geometry.setIndex([0, 1, 2]);
  const material = new THREE.MeshStandardMaterial(); content.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material));
  const copy = captureWorkshopSnapshot(content, null, 'Interleaved');
  assert.equal(copy.bytes, interleaved.array.byteLength + uv.array.byteLength + geometry.index!.array.byteLength);
  disposeWorkshopSnapshot(copy); geometry.dispose(); material.dispose();
});

test('undo and redo transfer exact snapshots and a new branch discards only its obsolete future', () => {
  const history = new WorkshopHistory(), a = snapshot('A'), b = snapshot('B'), c = snapshot('C');
  history.record(a); history.record(b);
  assert.equal(history.canUndo, true); assert.equal(history.canRedo, false);
  const previous = history.undo(c); assert.equal(previous, b); assert.equal(history.canRedo, true); assert.equal(c.content.children.length, 1);
  const back = history.redo(snapshot('B current')); assert.equal(back, c); assert.equal(c.content.children.length, 1);
  disposeWorkshopSnapshot(previous!); disposeWorkshopSnapshot(back!);
  const current = snapshot('C current'), beforeBranch = history.undo(current); assert.ok(beforeBranch);
  history.record(snapshot('Nueva rama'));
  assert.equal(history.canRedo, false); assert.equal(current.content.children.length, 0);
  disposeWorkshopSnapshot(beforeBranch!); history.clear();
  assert.equal(history.canUndo, false); assert.equal(history.canRedo, false);
});

test('typing coalesces within 500 milliseconds while keeping its earliest before-image', () => {
  let time = 0; const history = new WorkshopHistory(() => time), earliest = snapshot('Antes'), later = snapshot('Durante');
  history.record(earliest, 'name'); time = 300; history.record(later, 'name');
  assert.equal(history.past.length, 1); assert.equal(history.past[0], earliest); assert.equal(later.content.children.length, 0);
  time = 800; history.record(snapshot('Nueva pausa'), 'name'); assert.equal(history.past.length, 2);
  time = 801; history.record(snapshot('Otro campo'), 'color'); assert.equal(history.past.length, 3);
  const restored = history.undo(snapshot('Actual')); assert.ok(restored); time = 802;
  history.record(snapshot('Rama'), 'color'); assert.equal(history.past.length, 3); assert.equal(history.future.length, 0);
  disposeWorkshopSnapshot(restored!); history.clear();
});

test('history bounds combined steps and bytes, pruning distant states before the nearest state', () => {
  const history = new WorkshopHistory(), first = snapshot('0'); history.record(first);
  for (let i = 1; i < 25; i++) history.record(snapshot(String(i)));
  assert.equal(history.past.length, 20); assert.equal(first.content.children.length, 0); assert.equal(history.past[0].name, '5'); history.clear();
  const older = snapshot('Viejo', 30 * 1024 * 1024), recent = snapshot('Reciente', 30 * 1024 * 1024), nearest = snapshot('Cercano', 30 * 1024 * 1024);
  history.record(older); history.record(recent); history.record(nearest);
  assert.equal(older.content.children.length, 0); assert.deepEqual(history.past.map(state => state.name), ['Reciente', 'Cercano']);
  const undo = history.undo(snapshot('Presente', 40 * 1024 * 1024)); assert.equal(undo, nearest);
  assert.equal(history.past.length, 0); assert.equal(history.future[0].name, 'Presente'); assert.equal(recent.content.children.length, 0);
  disposeWorkshopSnapshot(undo!); history.clear();
  const oversized = snapshot('Único', 80 * 1024 * 1024); history.record(oversized); assert.equal(history.past[0], oversized);
  history.record(snapshot('Siguiente', 1)); assert.equal(oversized.content.children.length, 0); assert.equal(history.past.length, 1); history.clear();
});

test('empty history consumes unused captures and clearing disposes owned geometry and materials once', () => {
  const history = new WorkshopHistory(), unused = snapshot('Unused'); assert.equal(history.undo(unused), null); assert.equal(unused.content.children.length, 0);
  const value = snapshot('Owned'), mesh = value.content.children[0] as THREE.Mesh; let geometryDisposed = 0, materialDisposed = 0;
  mesh.geometry.addEventListener('dispose', () => geometryDisposed++); (mesh.material as THREE.Material).addEventListener('dispose', () => materialDisposed++);
  history.record(value); history.clear(); history.clear(); assert.equal(geometryDisposed, 1); assert.equal(materialDisposed, 1);
});

test('transform and material undo use sparse before-images without cloning unaffected model buffers', () => {
  const content = new THREE.Group(), mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 120, 120), new THREE.MeshStandardMaterial({ color: '#123456' }));
  const sibling = new THREE.Mesh(new THREE.SphereGeometry(1, 120, 120), new THREE.MeshStandardMaterial()); content.add(mesh, sibling);
  const geometry = mesh.geometry, buffer = geometry.getAttribute('position'), siblingMaterial = sibling.material;
  const history = new WorkshopHistory(), before = captureWorkshopPatch(content, mesh.uuid, 'Model', [mesh.uuid], { kind: 'transforms', ids: [mesh.uuid] });
  assert(before.bytes < 1024); assert.equal(before.content.children.length, 0);
  mesh.position.set(1, 2, 3); mesh.rotation.y = 1; mesh.userData.workshopGroup = { id: 'g', name: 'Group' }; history.record(before);
  const undo = history.undo(history.captureCurrent('undo', content, mesh.uuid, 'Model', [mesh.uuid]))!; assert(applyWorkshopPatch(undo, content));
  assert.deepEqual(mesh.position.toArray(), [0, 0, 0]); assert.equal(mesh.userData.workshopGroup, undefined); assert.equal(mesh.geometry, geometry); assert.equal(geometry.getAttribute('position'), buffer);
  const redo = history.redo(history.captureCurrent('redo', content, mesh.uuid, 'Model', [mesh.uuid]))!; applyWorkshopPatch(redo, content); assert.deepEqual(mesh.position.toArray(), [1, 2, 3]);
  const materialBefore = captureWorkshopPatch(content, mesh.uuid, 'Model', [mesh.uuid], { kind: 'materials', ids: [mesh.uuid] }); mesh.material.color.set('#abcdef'); applyWorkshopPatch(materialBefore, content);
  assert.equal(mesh.material.color.getHexString(), '123456'); assert.equal(sibling.material, siblingMaterial); assert.equal(mesh.geometry, geometry);
  history.clear(); mesh.geometry.dispose(); mesh.material.dispose(); sibling.geometry.dispose(); sibling.material.dispose();
});

test('vertex history restores exact normals, tangents and positions with sparse retained memory and unchanged buffers', () => {
  const content = new THREE.Group(), mesh = new THREE.Mesh(new THREE.PlaneGeometry(4, 4, 60, 60), new THREE.MeshStandardMaterial()); content.add(mesh);
  const geometry = mesh.geometry, position = geometry.getAttribute('position'), originalPositions = position.array.slice(), originalNormals = geometry.getAttribute('normal').array.slice();
  const tangent = new THREE.Float32BufferAttribute(new Float32Array(position.count * 4).fill(.5), 4); geometry.setAttribute('tangent', tangent);
  const vertex = getEditableVertices(geometry)[1400], history = new WorkshopHistory();
  const before = captureWorkshopPatch(content, mesh.uuid, 'Model', [mesh.uuid], { kind: 'vertices', id: mesh.uuid, indices: vertex.indices });
  moveModelVertex(geometry, vertex.id, [vertex.position[0], vertex.position[1], 1]); compactWorkshopVertexPatch(before, content); history.record(before);
  assert(before.bytes < tangent.array.byteLength + 1024, 'only changed normals and positions are retained alongside authored tangents');
  const changedPositions = position.array.slice(), changedNormals = geometry.getAttribute('normal').array.slice();
  const previous = history.undo(history.captureCurrent('undo', content, mesh.uuid, 'Model', [mesh.uuid]))!; applyWorkshopPatch(previous, content);
  assert.equal(mesh.geometry, geometry); assert.equal(geometry.getAttribute('position'), position); assert.deepEqual(position.array, originalPositions); assert.deepEqual(geometry.getAttribute('normal').array, originalNormals); assert.deepEqual(geometry.getAttribute('tangent').array, tangent.array);
  const next = history.redo(history.captureCurrent('redo', content, mesh.uuid, 'Model', [mesh.uuid]))!; applyWorkshopPatch(next, content);
  assert.deepEqual(position.array, changedPositions); assert.deepEqual(geometry.getAttribute('normal').array, changedNormals); assert.equal(geometry.getAttribute('tangent'), undefined);
  history.clear(); geometry.dispose(); mesh.material.dispose();
});

test('coalesced vertex edits retain the first value of every newly affected normal and vertex', () => {
  const content = new THREE.Group(), mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2, 2, 2), new THREE.MeshStandardMaterial()); content.add(mesh);
  const geometry = mesh.geometry, positions = geometry.getAttribute('position').array.slice(), normals = geometry.getAttribute('normal').array.slice(); let time = 0;
  const history = new WorkshopHistory(() => time);
  for (const id of [0, 8]) {
    const vertex = getEditableVertices(geometry)[id], before = captureWorkshopPatch(content, mesh.uuid, 'Model', [mesh.uuid], { kind: 'vertices', id: mesh.uuid, indices: vertex.indices });
    moveModelVertex(geometry, id, [vertex.position[0], vertex.position[1], .5]); compactWorkshopVertexPatch(before, content); history.record(before, 'coordinate'); time += 100;
  }
  assert.equal(history.past.length, 1);
  const previous = history.undo(history.captureCurrent('undo', content, mesh.uuid, 'Model', [mesh.uuid]))!; applyWorkshopPatch(previous, content);
  assert.deepEqual(geometry.getAttribute('position').array, positions); assert.deepEqual(geometry.getAttribute('normal').array, normals);
  history.clear(); geometry.dispose(); mesh.material.dispose();
});
