import assert from 'node:assert/strict';
import test from 'node:test';
import { SpatialIndex } from './spatialIndex';
import { createDefaultRoom, furniturePlacementIssues, invalidFurnitureIds } from '../domain/project/model';
import type { FurnitureItem } from '../domain/project/types';

test('spatial index updates and removes every occupied cell without distant false candidates', () => {
  const index = new SpatialIndex(2);
  index.set('a', { minX: -3, maxX: 1, minZ: -3, maxZ: 1 });
  index.set('b', { minX: 10, maxX: 12, minZ: 10, maxZ: 12 });
  assert.deepEqual([...index.query({ minX: -1, maxX: 0, minZ: -1, maxZ: 0 })], ['a']);
  index.set('a', { minX: 11, maxX: 13, minZ: 11, maxZ: 13 });
  assert.equal(index.query({ minX: -1, maxX: 0, minZ: -1, maxZ: 0 }).size, 0);
  assert.deepEqual([...index.query({ minX: 11, maxX: 12, minZ: 11, maxZ: 12 })].sort(), ['a', 'b']);
  index.remove('a'); assert.equal(index.size, 1);
  assert.throws(() => index.set('bad', { minX: 1, maxX: 0, minZ: 0, maxZ: 1 }));
});

test('incremental furniture warnings match exact collision checks after movement, removal and room changes', () => {
  const items: FurnitureItem[] = Array.from({ length: 40 }, (_, i) => ({ id: 'f-' + i, type: 'nightstand', variant: 'nightstand-classic', color: '#ffffff', material: 'wood', width: .4 + i % 3 * .1, depth: .5, height: .5, rotation: i * 7, x: -2 + i % 8 * .6, z: -1.6 + Math.floor(i / 8) * .6 }));
  let room = { ...createDefaultRoom(), levelId: 'spatial-test', furniture: items };
  for (let n = 0; n < 20; n++) {
    const expected = new Set(room.furniture.filter(item => { const issue = furniturePlacementIssues(room, item); return issue.outside || issue.overlap; }).map(item => item.id));
    assert.deepEqual(invalidFurnitureIds(room), expected);
    room = { ...room, furniture: room.furniture.filter(item => item.id !== 'f-' + n).map((item, i) => i === 0 ? { ...item, x: n / 10, z: -.2, rotation: n * 11 } : item), thickness: .1 + n * .005 };
  }
});
