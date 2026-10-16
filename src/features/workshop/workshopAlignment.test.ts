import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { alignWorkshopPiece, snapWorkshopPiece, type WorkshopAlignment, type WorkshopAxis } from './workshopAlignment';

const box = (x = 1, y = 1, z = 1): THREE.Mesh => new THREE.Mesh(new THREE.BoxGeometry(x, y, z), new THREE.MeshStandardMaterial());
const near = (actual: number, expected: number, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);
function localBounds(mesh: THREE.Mesh, parent: THREE.Object3D | null = mesh.parent) {
  mesh.updateWorldMatrix(true, false); parent?.updateWorldMatrix(true, false);
  const matrix = (parent ? parent.matrixWorld.clone().invert() : new THREE.Matrix4()).multiply(mesh.matrixWorld), result = new THREE.Box3(), point = new THREE.Vector3(), position = mesh.geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) result.expandByPoint(point.fromBufferAttribute(position, i).applyMatrix4(matrix));
  return result;
}
function dispose(...meshes: THREE.Mesh[]) { for (const mesh of meshes) { mesh.geometry.dispose(); (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(material => material.dispose()); } }

test('aligning a table leg before a thin board places its top exactly against the underside', () => {
  const leg = box(.08, 1.4, .08), board = box(2, .06, 1), group = new THREE.Group(); group.add(leg, board);
  leg.position.set(.45, .6, -.3); board.position.y = 1.5;
  try {
    assert.equal(alignWorkshopPiece(leg, board, 'y', 'before'), true);
    near(localBounds(leg).max.y, localBounds(board).min.y);
    const aligned = leg.position.clone(); assert.equal(alignWorkshopPiece(leg, board, 'y', 'before'), false); assert.deepEqual(leg.position.toArray(), aligned.toArray());
    assert.equal(leg.position.x, .45); assert.equal(leg.position.z, -.3);
  } finally { dispose(leg, board); }
});

test('all five alignments use real extents with rotations and reflected scales', () => {
  const piece = box(.5, 1, 1.7), reference = box(1.2, .4, 1.3), parent = new THREE.Group(); parent.add(piece, reference);
  piece.rotation.set(.2, .5, -.3); piece.scale.set(-1.4, .8, 1.2); reference.rotation.set(.3, -.6, .4); reference.position.set(2.3, 1.2, -1.4);
  try {
    for (const axis of ['x', 'y', 'z'] as WorkshopAxis[]) for (const alignment of ['min', 'center', 'max', 'before', 'after'] as WorkshopAlignment[]) {
      piece.position.set(-.7, .5, 2);
      const original = piece.position.clone(); assert.equal(alignWorkshopPiece(piece, reference, axis, alignment), true);
      const source = localBounds(piece), target = localBounds(reference);
      if (alignment === 'center') near(source.getCenter(new THREE.Vector3())[axis], target.getCenter(new THREE.Vector3())[axis]);
      else near(source[alignment === 'before' ? 'max' : alignment === 'after' ? 'min' : alignment][axis], target[alignment === 'before' ? 'min' : alignment === 'after' ? 'max' : alignment][axis]);
      for (const other of ['x', 'y', 'z'] as const) if (other !== axis) assert.equal(piece.position[other], original[other]);
    }
  } finally { dispose(piece, reference); }
});

test('translated, rotated and scaled parents retain local-axis alignment without geometry mutations', () => {
  const piece = box(.4, .7, 1.2), reference = box(.9, .6, .5), parent = new THREE.Group(); parent.position.set(4, 5, -7); parent.rotation.set(.2, .8, -.1); parent.scale.set(-2, .6, 1.4); parent.add(piece, reference);
  piece.rotation.y = .5; piece.scale.x = -1; reference.position.set(2, 1, .7);
  const geometry = Array.from(piece.geometry.getAttribute('position').array), rotation = piece.quaternion.toArray(), scale = piece.scale.toArray();
  try {
    assert.equal(alignWorkshopPiece(piece, reference, 'z', 'after'), true); near(localBounds(piece).min.z, localBounds(reference).max.z);
    assert.deepEqual(Array.from(piece.geometry.getAttribute('position').array), geometry); assert.deepEqual(piece.quaternion.toArray(), rotation); assert.deepEqual(piece.scale.toArray(), scale);
  } finally { dispose(piece, reference); }
});

test('alignment also accepts references under a different transformed parent', () => {
  const parent = new THREE.Group(), other = new THREE.Group(), root = new THREE.Group(), piece = box(), reference = box(.4, .7, .8);
  root.add(parent, other); parent.position.set(5, -2, 3); parent.rotation.y = .4; other.position.set(-2, 4, 1); other.rotation.z = -.7; parent.add(piece); other.add(reference);
  try { assert.equal(alignWorkshopPiece(piece, reference, 'x', 'min'), true); near(localBounds(piece).min.x, localBounds(reference, parent).min.x); }
  finally { dispose(piece, reference); }
});

test('rotated non-box geometry is aligned using its vertices instead of a loose rotated bounding box', () => {
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 2, 0, 0, 0, 1, 0], 3));
  const piece = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial()), reference = box(); piece.rotation.z = Math.PI / 4; reference.position.x = 4;
  try { assert.equal(alignWorkshopPiece(piece, reference, 'x', 'before'), true); near(localBounds(piece).max.x, localBounds(reference).min.x); }
  finally { dispose(piece, reference); }
});

test('piece snapping supports touching surfaces and takes priority over a nearer grid line', () => {
  const leg = box(.1, 1, .1), board = box(2, .02, 1); board.position.y = 1.047; leg.position.y = .53;
  try {
    const result = snapWorkshopPiece(leg, [board], ['y'], { grid: .01, pieces: true, tolerance: .03 });
    assert.equal(result.length, 1); assert.equal(result[0].reference, board); near(localBounds(leg).max.y, localBounds(board).min.y);
    near(result[0].value, localBounds(board).min.y);
    assert.notEqual(result[0].value, leg.position.y);
  } finally { dispose(leg, board); }
});

test('grid snapping uses the pivot and only requested axes, including negative coordinates', () => {
  const piece = box(); piece.position.set(-.97, .49, 1.04); piece.rotation.y = .6;
  try {
    const snaps = snapWorkshopPiece(piece, [], ['x', 'z', 'x'], { grid: .1, pieces: false, tolerance: .05 });
    assert.deepEqual(snaps.map(snap => snap.axis), ['x', 'z']); near(piece.position.x, -1); near(piece.position.z, 1); assert.equal(piece.position.y, .49); assert.ok(snaps.every(snap => snap.reference === null));
  } finally { dispose(piece); }
});

test('grid snapping has no dead zones when piece tolerance is smaller than half the grid step', () => {
  const piece = box(), reference = box(); piece.position.set(.049, -.049, .051); reference.position.set(10, 10, 10);
  try {
    const snaps = snapWorkshopPiece(piece, [reference], ['x', 'y', 'z'], { grid: .1, pieces: true, tolerance: .001 });
    assert.equal(snaps.length, 3); near(piece.position.x, 0); near(piece.position.y, 0); near(piece.position.z, .1);
    for (const snap of snaps) { assert.equal(snap.reference, null); assert.equal(snap.value, piece.position[snap.axis]); }
  } finally { dispose(piece, reference); }
});

test('piece snap guides return the matched face or center plane rather than the moving pivot', () => {
  const piece = box(.2, .2, .2), reference = box(2, 2, 2); reference.position.x = 5;
  try {
    for (const [position, expected] of [[3.88, 4], [4.12, 4], [4.98, 5], [5.88, 6], [6.12, 6]]) {
      piece.position.x = position;
      const snaps = snapWorkshopPiece(piece, [reference], ['x'], { grid: null, pieces: true, tolerance: .03 });
      assert.equal(snaps.length, 1); assert.equal(snaps[0].reference, reference); near(snaps[0].value, expected);
    }
  } finally { dispose(piece, reference); }
});

test('the nearest piece target wins while distant projections and invisible references are ignored', () => {
  const piece = box(), nearTarget = box(), farther = box(), remote = box(), hidden = box(); piece.position.x = .96; nearTarget.position.x = 2; farther.position.x = 2.02; remote.position.set(1.961, 10, 0); hidden.position.x = 1.962; hidden.visible = false;
  try {
    const snaps = snapWorkshopPiece(piece, [piece, remote, hidden, farther, nearTarget], ['x'], { grid: null, pieces: true, tolerance: .1 });
    assert.equal(snaps[0].reference, nearTarget); near(piece.position.x, 1);
    const invisibleParent = new THREE.Group(); invisibleParent.visible = false; invisibleParent.add(nearTarget);
    piece.position.x = .96; assert.deepEqual(snapWorkshopPiece(piece, [nearTarget, remote, hidden], ['x'], { grid: null, pieces: true, tolerance: .1 }), []);
  } finally { dispose(piece, nearTarget, farther, remote, hidden); }
});

test('snapping has no latch when the next drag position moves outside tolerance', () => {
  const piece = box(), reference = box(); reference.position.x = 2; piece.position.x = .95;
  try {
    assert.equal(snapWorkshopPiece(piece, [reference], ['x'], { grid: null, pieces: true, tolerance: .06 }).length, 1); near(piece.position.x, 1);
    piece.position.x = .85; assert.deepEqual(snapWorkshopPiece(piece, [reference], ['x'], { grid: null, pieces: true, tolerance: .06 }), []); assert.equal(piece.position.x, .85);
  } finally { dispose(piece, reference); }
});

test('hidden, invalid and singular meshes are ignored without changing position', () => {
  const piece = box(), invalid = box(), reference = box(); piece.position.set(.04, .03, .02); invalid.geometry.getAttribute('position').setX(0, NaN);
  try {
    assert.equal(alignWorkshopPiece(piece, invalid, 'x', 'min'), false);
    assert.deepEqual(snapWorkshopPiece(piece, [invalid], ['x'], { grid: null, pieces: true, tolerance: .1 }), []);
    reference.visible = false; assert.equal(alignWorkshopPiece(piece, reference, 'x', 'min'), false);
    const parent = new THREE.Group(); parent.scale.x = 0; parent.add(piece); assert.deepEqual(snapWorkshopPiece(piece, [], ['x'], { grid: .1, pieces: false, tolerance: .1 }), []);
    assert.deepEqual(piece.position.toArray(), [.04, .03, .02]);
  } finally { dispose(piece, invalid, reference); }
});

test('cached extents update after geometry edits and respect indexed draw ranges', () => {
  const piece = box(), reference = box(); reference.position.x = 2;
  try {
    alignWorkshopPiece(piece, reference, 'x', 'before'); near(piece.position.x, 1);
    piece.geometry.scale(2, 1, 1); alignWorkshopPiece(piece, reference, 'x', 'before'); near(piece.position.x, .5);
    const positions = new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 500, 500, 500], 3);
    piece.geometry.dispose(); piece.geometry = new THREE.BufferGeometry(); piece.geometry.setAttribute('position', positions); piece.geometry.setIndex([0, 1, 2, 3, 2, 1]); piece.geometry.setDrawRange(0, 3);
    alignWorkshopPiece(piece, reference, 'x', 'before'); near(piece.position.x, .5);
  } finally { dispose(piece, reference); }
});
