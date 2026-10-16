import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProject, validateProjectDocument, validateRoofMesh, type ParametricRoof } from './projectDocument.js';
import { buildRoofGeometry, buildStairGeometry, roofHeightAt, roofToMesh, surfaceGeometry, wallRoofProfile } from './projectGeometry.js';
import { addHole, addLevel, addStair, convertRoofToMesh, editRoofMesh, replaceRoofWithTemplate } from './projectOperations.js';

test('all roof templates produce closed solids and actual sloped undersides', () => {
  const project = createDefaultProject();
  for (const type of ['flat', 'shed', 'gable', 'hip'] as const) {
    const roof = { ...project.roofs[0], type, pitch: type === 'flat' ? 0 : 25 } as ParametricRoof;
    const geometry = buildRoofGeometry(project, roof), mesh = roofToMesh(project, roof); validateRoofMesh(mesh);
    assert(geometry.underside.length >= 2); assert(geometry.vertices.every(v => [v.x, v.y, v.z].every(Number.isFinite)));
    if (type === 'flat') assert.equal(roofHeightAt(geometry.underside, 0, 0), 2.8);
    else assert(Math.max(...geometry.underside.flat().map(v => v.y)) > 2.8);
  }
});

test('roof overhangs and pitches cannot generate out-of-budget geometry or uneditable template heights', () => {
  const project = createDefaultProject(), roof = project.roofs[0] as ParametricRoof;
  roof.footprint = [{ x: 0, z: 0 }, { x: 50, z: .001 }, { x: 0, z: 1 }]; roof.overhang = 2; assert.throws(() => validateProjectDocument(project), /medidas/);
  roof.footprint = [{ x: -25, z: -2 }, { x: 25, z: -2 }, { x: 25, z: 2 }, { x: -25, z: 2 }]; roof.overhang = 0; roof.type = 'shed'; roof.pitch = 75; assert.throws(() => validateProjectDocument(project), /medidas/);
});

test('gable boundary wall profile follows the ridge while interior and low walls retain their height', () => {
  const project = createDefaultProject(); project.roofs[0] = { ...project.roofs[0], type: 'gable', pitch: 30 } as ParametricRoof;
  const level = project.levels[0], wall = level.walls[0], profile = wallRoofProfile(project, level.id, wall.id);
  assert(profile.some(p => p.height > level.height + 1));
  wall.height = 1; assert.deepEqual(wallRoofProfile(project, level.id, wall.id), [{ t: 0, height: 1 }, { t: 1, height: 1 }]);
});

test('roof free edits preserve stable IDs and reject open, duplicate and self-intersecting solids atomically', () => {
  const original = createDefaultProject(), meshProject = convertRoofToMesh(original, original.roofs[0].id), roof = meshProject.roofs[0]; assert.equal(roof.type, 'mesh'); if (roof.type !== 'mesh') return;
  const moved = structuredClone(roof.vertices); moved[0].y += .01;
  const changed = editRoofMesh(meshProject, roof.id, moved, roof.faces); assert.deepEqual(changed.roofs[0].type === 'mesh' && changed.roofs[0].vertices.map(v => v.id), roof.vertices.map(v => v.id));
  assert.throws(() => editRoofMesh(meshProject, roof.id, roof.vertices, roof.faces.slice(1)), /sólido cerrado/);
  assert.throws(() => editRoofMesh(meshProject, roof.id, roof.vertices, [...roof.faces, { ...roof.faces[0], id: crypto.randomUUID() }]), /duplicadas/);
  assert.equal(original.roofs[0].type, 'flat');
  assert.equal(replaceRoofWithTemplate(meshProject, roof.id, 'shed').roofs[0].type, 'shed');
  const crossing = structuredClone(roof); crossing.vertices.forEach(vertex => { vertex.id = 'other-' + vertex.id; vertex.x += .3; vertex.y += .075; }); crossing.faces.forEach(face => { face.id = 'other-' + face.id; face.vertexIds = face.vertexIds.map(id => 'other-' + id); });
  assert.throws(() => editRoofMesh(meshProject, roof.id, [...roof.vertices, ...crossing.vertices], [...roof.faces, ...crossing.faces]), /atravesarse/);
});

test('floor triangulation removes holes from actual geometry', () => {
  let project = createDefaultProject(); const level = project.levels[0], floor = level.surfaces[0];
  project = addHole(project, level.id, floor.id, [{ x: -.5, z: -.5 }, { x: .5, z: -.5 }, { x: .5, z: .5 }, { x: -.5, z: .5 }]);
  const geometry = surfaceGeometry(project.levels[0], project.levels[0].surfaces[0]);
  const area = geometry.triangles.reduce((sum, t) => { const [a, b, c] = t.map(i => geometry.vertices[i]); return sum + Math.abs((b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x)) / 2; }, 0);
  assert(Math.abs(area - 19) < 1e-6);
});

test('all five stair forms generate real treads, connected surfaces and persistent aperture proposals', () => {
  for (const type of ['straight', 'landing', 'l', 'u', 'spiral'] as const) {
    let project = addLevel(createDefaultProject(), { copy: true });
    const level = project.levels[1];
    // A wide, explicit footprint accommodates every tested flight and landing.
    for (const floor of project.levels) { floor.points.forEach(p => { p.x *= 4; p.z *= 4; }); }
    project = addStair(project, { fromLevelId: project.levels[0].id, toLevelId: level.id, type, x: -2, z: -2, rotation: 0 });
    const stair = project.stairs[0], geometry = buildStairGeometry(project, stair);
    assert(geometry.triangles.length > 0); assert(geometry.rails.length > 0); assert(geometry.surfaces.length >= stair.stepCount); assert(geometry.hole.length >= 3);
    assert.equal(geometry.path[0].y, project.levels[0].elevation); assert(Math.abs(geometry.path.at(-1)!.y - level.elevation) < 1e-6);
    assert(project.levels[1].surfaces[0].holes.some(h => h.stairId === stair.id));
    for (let i = 0; i < geometry.surfaces.length - 1; i++) assert(geometry.surfaces[i].neighbors.includes(geometry.surfaces[i + 1].id));
  }
});
