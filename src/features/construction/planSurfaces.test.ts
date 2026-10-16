import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultProject } from '../../domain/project/projectDocument';
import { addHole, addRoom } from '../../domain/project/projectOperations';
import { planFloorRegions, planVisibleHoles } from './planSurfaces';

test('additive floor regions retain their own IDs, colors and partition cut-outs', () => {
  let project = createDefaultProject(); const levelId = project.activeLevelId;
  project = addRoom(project, levelId, [{ x: -.8, z: -.8 }, { x: .8, z: -.8 }, { x: .8, z: .8 }, { x: -.8, z: .8 }]);
  const level = project.levels[0], floors = level.surfaces.filter(surface => surface.kind === 'floor');
  floors[0].finish.color = '#ffaa11'; floors[1].finish.color = '#2288ff';
  const regions = planFloorRegions(level);
  assert.equal(regions.length, 2); assert.equal(regions[0].surface.id, floors[0].id); assert.equal(regions[1].surface.finish.color, '#2288ff');
  assert.equal(regions[0].holes.length, 1); assert.equal(planVisibleHoles(level).length, 0, 'the inner floor fills its partition ring');
  project = addHole(project, levelId, floors[1].id, [{ x: -.3, z: -.3 }, { x: .3, z: -.3 }, { x: .3, z: .3 }, { x: -.3, z: .3 }]);
  const holes = planVisibleHoles(project.levels[0]); assert.equal(holes.length, 1); assert.equal(holes[0].surfaceId, floors[1].id); assert.equal(holes[0].polygons.length, 1);
});

test('a real aperture is kept when another floor region does not cover it', () => {
  let project = createDefaultProject(); const levelId = project.activeLevelId, floorId = project.levels[0].surfaces[0].id;
  project = addHole(project, levelId, floorId, [{ x: -1, z: -.4 }, { x: -.4, z: -.4 }, { x: -.4, z: .4 }, { x: -1, z: .4 }]);
  const holes = planVisibleHoles(project.levels[0]); assert.equal(holes.length, 1); assert.equal(holes[0].hole.id, project.levels[0].surfaces[0].holes[0].id); assert.equal(holes[0].polygons[0][0].length, 4);
});
