import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultProject } from './projectDocument';
import { colorRevision, projectColors } from './colorPreview';

test('la paleta reúne superficies, ambas caras, cubiertas, muebles, partes y escaleras sin duplicados', () => {
  const project = createDefaultProject(), level = project.levels[0];
  level.walls[0].right.color = '#112233';
  level.furniture.push({ id: 'bed', levelId: level.id, type: 'bed', bedSize: 'double', x: 0, z: 0, rotation: 0, width: 1.4, height: .6, depth: 2, material: 'wood', color: '#ABCDEF', parts: { '0': { color: '#123456' } } });
  project.stairs.push({ id: 'stair', type: 'straight', fromLevelId: level.id, toLevelId: level.id, x: 0, z: 0, rotation: 0, width: 1, run: 3, stepCount: 12, landingDepth: 1, innerRadius: .2, turns: 1, clockwise: true, thickness: .1, rails: 'none', hole: null, finish: { color: '#ff6633', material: 'wood' } });
  assert.deepEqual(projectColors(project), ['#ffffff', '#112233', '#abcdef', '#123456', '#ff6633']);
});

test('server acknowledgements with the same canonical document keep previews, while real remote edits invalidate them', () => {
  const project = createDefaultProject(), acknowledgement = structuredClone(project);
  acknowledgement.sun = { intensity: project.sun.intensity, azimuth: project.sun.azimuth, hour: project.sun.hour, enabled: project.sun.enabled };
  assert.equal(colorRevision(project), colorRevision(acknowledgement));
  const edited = structuredClone(project); edited.levels[0].walls[0].left.color = '#123456';
  assert.notEqual(colorRevision(project), colorRevision(edited));
  assert.equal(colorRevision(4), 4); assert.equal(colorRevision(undefined), undefined);
});
