import assert from 'node:assert/strict';
import test from 'node:test';
import { validateModelBudget } from './modelBudget';
import type { FurnitureItem } from '../project/types';
import type { ModelAsset } from './glbValidation';

test('custom-model budgets apply across all levels and count unique asset bytes/textures once', () => {
  const assets = new Map<string, ModelAsset>(Array.from({ length: 31 }, (_, index) => {
    const id = 'asset-' + index;
    return [id, { id, name: id, size: 16, width: 1, height: 1, depth: 1, triangles: 1, meshInstances: 1, materials: 1, texturePixels: 0, nodes: [], createdAt: new Date().toISOString() }];
  }));
  const items: FurnitureItem[] = [...assets.keys()].map((assetId, index) => ({ id: 'item-' + index, type: 'custom', assetId, name: assetId, width: 1, height: 1, depth: 1, material: null, color: null, x: 0, z: 0, rotation: 0 }));
  assert.doesNotThrow(() => validateModelBudget(items.slice(0, 30), assets));
  const perLevel = [items.slice(0, 16), items.slice(16)]; assert.throws(() => validateModelBudget(perLevel.flat(), assets), /30 modelos/);
  const model = assets.get('asset-0')!; model.texturePixels = 16 * 1024 * 1024; model.size = 100 * 1024 * 1024;
  assert.doesNotThrow(() => validateModelBudget([items[0], { ...items[0], id: 'another-instance' }], assets));
  model.meshInstances = 512; model.materials = 5; assert.throws(() => validateModelBudget([items[0]], assets), /demasiados modelos/);
  model.meshInstances = 1; model.materials = 1; model.nodes = Array.from({ length: 512 }, (_, index) => ({ key: String(index), name: 'group', mesh: false }));
  assert.throws(() => validateModelBudget(Array.from({ length: 8 }, (_, index) => ({ ...items[0], id: 'group-instance-' + index })), assets), /demasiados modelos/);
});
