import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import { validateGlb } from './modelAssets';
import { addModelFace, addModelVertex, clampWorkshopScale, cloneWorkshopModel, deleteModelFace, deleteModelVertex, disposeWorkshopModel, exportWorkshopGLB, fitWorkshopCamera, getEditableVertices, getModelFaces, moveModelVertex, setWorkshopMaterial } from './modelWorkshopGeometry';

test('framing retains the full model and a visible margin on portrait, square and landscape screens', () => {
  const camera = new THREE.PerspectiveCamera(43), bounds = new THREE.Box3(new THREE.Vector3(-.6, 0, -.3), new THREE.Vector3(.6, 2, .3));
  for (const aspect of [.45, 1, 2.5]) {
    fitWorkshopCamera(camera, bounds, aspect);
    for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
      const point = new THREE.Vector3(x, y, z).project(camera);
      assert.ok(Math.abs(point.x) < .95 && Math.abs(point.y) < .95 && point.z > -1 && point.z < 1);
    }
  }
});

test('workshop transforms retain reflected imported pieces while bounding scale magnitudes', () => {
  const scale = new THREE.Vector3(-1, -0.00001, 3000);
  clampWorkshopScale(scale);
  assert.deepEqual(scale.toArray(), [-1, -.001, 1000]);
  const original = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 3), new THREE.MeshStandardMaterial());
  original.scale.copy(scale); const before = new THREE.Box3().setFromObject(original).getSize(new THREE.Vector3());
  original.position.set(2, 3, 4); clampWorkshopScale(original.scale);
  assert.ok(new THREE.Box3().setFromObject(original).getSize(new THREE.Vector3()).distanceTo(before) < 1e-9);
  disposeWorkshopModel(new THREE.Group().add(original));
});

test('moving a welded vertex moves all texture seams and recomputes finite normals', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1), vertices = getEditableVertices(geometry);
  assert.equal(vertices.length, 8);
  assert.equal(vertices[0].indices.length, 3);
  moveModelVertex(geometry, 0, [0.75, 0.8, 0.9]);
  for (const index of vertices[0].indices) assert.deepEqual([geometry.getAttribute('position').getX(index), geometry.getAttribute('position').getY(index), geometry.getAttribute('position').getZ(index)].map(value => Number(value.toFixed(3))), [0.75, .8, .9]);
  for (const value of geometry.getAttribute('normal').array) assert.ok(Number.isFinite(value));
  assert.equal(Number(geometry.boundingBox!.max.x.toFixed(3)), .75);
  assert.throws(() => moveModelVertex(geometry, 0, [NaN, 0, 0]));
  assert.throws(() => moveModelVertex(geometry, 900, [0, 0, 0]));
  geometry.dispose();
});

test('faces can be deleted and rebuilt; new vertices retain valid UVs and material groups', () => {
  const geometry = new THREE.BoxGeometry(1, 1, 1), faces = getModelFaces(geometry), face = faces[0];
  deleteModelFace(geometry, 0);
  assert.equal(getModelFaces(geometry).length, 11);
  addModelFace(geometry, face);
  assert.equal(getModelFaces(geometry).length, 12);
  const id = addModelVertex(geometry, [0, 1, 0]);
  assert.equal(getEditableVertices(geometry).length, 9);
  addModelFace(geometry, [face[0], face[1], id]);
  assert.equal(getModelFaces(geometry).length, 13);
  assert.equal(geometry.getAttribute('uv').count, geometry.getAttribute('position').count);
  assert.equal(geometry.groups.reduce((sum, group) => sum + group.count, 0), geometry.index!.count);
  assert.throws(() => addModelFace(geometry, [0, 0, 1]));
  assert.throws(() => addModelFace(geometry, [0, 1, 999]));
  assert.throws(() => addModelVertex(geometry, [0, 1, 0]));
  deleteModelVertex(geometry, id);
  assert.equal(getEditableVertices(geometry).length, 8);
  assert.equal(getModelFaces(geometry).length, 12);
  assert.ok(Array.from(geometry.index!.array).every(index => index < geometry.getAttribute('position').count));
  geometry.dispose();
});

test('workshop clones source geometry and materials without retaining private metadata or hidden pieces', () => {
  const original = new THREE.Group(), hidden = new THREE.Group(); hidden.visible = false;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new MeshStandardNodeMaterial({ color: '#abcdef' })); mesh.name = 'Puerta'; mesh.userData = { privateId: 'secret' };
  const parent = new THREE.Group(); parent.position.set(2, 3, 4); parent.scale.set(2, 1, .5); parent.add(mesh); original.add(parent, hidden);
  hidden.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
  const copy = cloneWorkshopModel(original), target = copy.children[0] as THREE.Mesh;
  assert.equal(copy.children.length, 1);
  assert.notEqual(target.geometry, mesh.geometry); assert.notEqual(target.material, mesh.material);
  assert.equal((target.material as THREE.MeshStandardMaterial).type, 'MeshStandardMaterial');
  assert.equal(target.name, 'Puerta'); assert.deepEqual(target.userData, {});
  assert.deepEqual(target.position.toArray(), [2, 3, 4]); assert.deepEqual(target.scale.toArray(), [2, 1, .5]);
  moveModelVertex(target.geometry, 0, [1, 1, 1]);
  assert.notEqual(target.geometry.getAttribute('position').getX(0), mesh.geometry.getAttribute('position').getX(0));
  setWorkshopMaterial(target, 'metal', '#123456');
  assert.equal((target.material as THREE.MeshStandardMaterial).metalness, 1);
  assert.equal((target.material as THREE.MeshStandardMaterial).color.getHexString(), '123456');
  assert.equal((mesh.material as MeshStandardNodeMaterial).color.getHexString(), 'abcdef');
  disposeWorkshopModel(copy); disposeWorkshopModel(original);
});

test('exported GLB passes server validation and restores edited vertices, new faces and piece transforms', async () => {
  const previous = globalThis.FileReader;
  class Reader {
    result: ArrayBuffer | null = null;
    onloadend?: () => void;
    readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then(bytes => { this.result = bytes; this.onloadend?.(); }); }
  }
  globalThis.FileReader = Reader as unknown as typeof FileReader;
  const group = new THREE.Group(), mesh = new THREE.Mesh(new THREE.BoxGeometry(.5, .5, .5), new THREE.MeshStandardMaterial({ color: '#445566' }));
  mesh.position.set(.3, .4, -.2); mesh.name = 'Modelo editado'; group.add(mesh);
  const facesBefore = getModelFaces(mesh.geometry).length;
  moveModelVertex(mesh.geometry, 0, [.4, .45, .35]);
  const point = addModelVertex(mesh.geometry, [0, .6, 0]);
  addModelFace(mesh.geometry, [0, 1, point]);
  deleteModelFace(mesh.geometry, 3);
  mesh.userData.secret = 'not exported'; group.userData.private = 'not exported';
  try {
    const output = await exportWorkshopGLB(group), metadata = validateGlb(Buffer.from(output));
    assert.equal(metadata.triangles, facesBefore);
    const restored = await new GLTFLoader().parseAsync(output, '');
    const restoredMesh = restored.scene.getObjectByProperty('isMesh', true) as THREE.Mesh;
    assert.ok(restoredMesh);
    assert.deepEqual(restoredMesh.position.toArray(), mesh.position.toArray());
    assert.equal(getModelFaces(restoredMesh.geometry).length, facesBefore);
    const originalBox = new THREE.Box3().setFromObject(group), restoredBox = new THREE.Box3().setFromObject(restored.scene);
    assert.ok(originalBox.min.distanceTo(restoredBox.min) < .00001 && originalBox.max.distanceTo(restoredBox.max) < .00001);
    assert.equal(restoredMesh.userData.secret, undefined);
    assert.equal((restoredMesh.material as THREE.MeshStandardMaterial).color.getHexString(), '445566');
    disposeWorkshopModel(restored.scene);
  } finally { globalThis.FileReader = previous; disposeWorkshopModel(group); }
});

test('flattening an imported hierarchy preserves geometry under parent shear', () => {
  const source = new THREE.Group(), parent = new THREE.Group(); parent.scale.set(2, 1, .5);
  const piece = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()); piece.rotation.y = .7; parent.add(piece); source.add(parent);
  const expected = new THREE.Box3().setFromObject(source), copy = cloneWorkshopModel(source), actual = new THREE.Box3().setFromObject(copy);
  assert.ok(actual.min.distanceTo(expected.min) < .000001 && actual.max.distanceTo(expected.max) < .000001);
  disposeWorkshopModel(source); disposeWorkshopModel(copy);
});

test('saving loose vertices keeps them editable locally without distorting saved model dimensions', async () => {
  const previous = globalThis.FileReader;
  class Reader {
    result: ArrayBuffer | null = null; onloadend?: () => void;
    readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then(bytes => { this.result = bytes; this.onloadend?.(); }); }
  }
  globalThis.FileReader = Reader as unknown as typeof FileReader;
  const geometry = new THREE.BoxGeometry(.5, .5, .5), mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()), group = new THREE.Group().add(mesh);
  addModelVertex(geometry, [9, 0, 0]);
  try {
    const output = await exportWorkshopGLB(group), metadata = validateGlb(Buffer.from(output));
    assert.equal(metadata.width, .5); assert.equal(metadata.height, .5); assert.equal(metadata.depth, .5); assert.equal(metadata.triangles, 12);
    const loaded = await new GLTFLoader().parseAsync(output, ''), restored = loaded.scene.getObjectByProperty('isMesh', true) as THREE.Mesh;
    assert.equal(getEditableVertices(restored.geometry).length, 8);
    assert.equal(getEditableVertices(geometry).length, 9);
    assert.equal(geometry.getAttribute('uv').count, geometry.getAttribute('position').count);
    disposeWorkshopModel(loaded.scene);
  } finally { globalThis.FileReader = previous; disposeWorkshopModel(group); }
});
