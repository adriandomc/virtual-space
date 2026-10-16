import type { ModelAsset } from './modelAssets.js';
import type { FurnitureItem } from './types.js';

/** One budget for all levels, also applied to packages before decoding their models. */
export function validateModelBudget(items: FurnitureItem[], models: ReadonlyMap<string, ModelAsset>): void {
  let triangles = 0, bytes = 0, pixels = 0, renderCost = 0, graphCost = 0;
  const seen = new Set<string>();
  for (const item of items) {
    if (item.type !== 'custom') continue;
    const info = models.get(item.assetId!);
    if (!info) throw new Error('El modelo no está disponible en este diseño.');
    if (![info.size, info.triangles, info.texturePixels, info.meshInstances, info.materials].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('El modelo GLB no es válido.');
    if (Object.keys(item.parts ?? {}).some(key => !info.nodes.some(node => node.key === key))) throw new Error('El modelo contiene una parte no válida.');
    triangles += info.triangles;
    renderCost += info.meshInstances * Math.max(1, info.materials);
    graphCost += info.nodes.length + info.meshInstances;
    if (!seen.has(info.id)) { seen.add(info.id); bytes += info.size; pixels += info.texturePixels; }
  }
  if (seen.size > 30) throw new Error('El diseño admite hasta 30 modelos personalizados distintos.');
  if (triangles > 1000000 || bytes > 100 * 1024 * 1024 || renderCost > 2048 || graphCost > 4096) throw new Error('El diseño tiene demasiados modelos personalizados.');
  if (pixels > 16 * 1024 * 1024) throw new Error('El diseño tiene demasiadas texturas en sus modelos personalizados.');
}
