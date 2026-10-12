import assert from 'node:assert/strict';
import test from 'node:test';
import { createDuvetGeometry, createPillowGeometry } from './beddingGeometry';

test('bedding has finite positions/normals, folds and stays within the declared bed', () => {
  for (const width of [1, 1.35, 1.5, 2]) {
    const duvet = createDuvetGeometry(width, 1.9, 1.1);
    duvet.computeBoundingBox();
    const box = duvet.boundingBox!;
    assert.ok(box.min.x >= -width / 2 && box.max.x <= width / 2);
    assert.ok(box.min.z >= -0.95 && box.max.z <= 0.95);
    assert.ok(box.min.y > 0 && box.max.y < 1.1);
    assert.ok(box.max.y - box.min.y > 0.2, 'cloth drapes at the edges');
    const positions = duvet.getAttribute('position');
    const middle = positions.getY(24 * 49 + 24);
    assert.notEqual(positions.getY(24 * 49 + 18), middle, 'cloth is not a flat slab');
    for (const value of [...positions.array, ...duvet.getAttribute('normal').array]) assert.ok(Number.isFinite(value));
    const pillow = createPillowGeometry(width * 0.4, 0.16, 0.45);
    pillow.computeBoundingBox();
    assert.ok(pillow.boundingBox!.min.x >= -width * 0.2 - 0.000001 && pillow.boundingBox!.max.x <= width * 0.2 + 0.000001);
    for (const value of [...pillow.getAttribute('position').array, ...pillow.getAttribute('normal').array]) assert.ok(Number.isFinite(value));
    duvet.dispose(); pillow.dispose();
  }
});
