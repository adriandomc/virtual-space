export type Bounds2 = { minX: number; maxX: number; minZ: number; maxZ: number };

/** Broad phase only; callers retain their exact geometry checks. */
export class SpatialIndex {
  private cells = new Map<string, Set<string>>();
  private entries = new Map<string, { bounds: Bounds2; cells: string[] }>();
  constructor(private cellSize = 2) { if (!Number.isFinite(cellSize) || cellSize <= 0) throw new Error('Invalid spatial cell size.'); }
  private keys(box: Bounds2) {
    if (![box.minX, box.maxX, box.minZ, box.maxZ].every(Number.isFinite) || box.minX > box.maxX || box.minZ > box.maxZ) throw new Error('Invalid spatial bounds.');
    const keys: string[] = [];
    const a = Math.floor(box.minX / this.cellSize), b = Math.floor(box.maxX / this.cellSize), c = Math.floor(box.minZ / this.cellSize), d = Math.floor(box.maxZ / this.cellSize);
    if ((b - a + 1) * (d - c + 1) > 10000) throw new Error('Spatial bounds exceed the project area.');
    for (let x = a; x <= b; x++) for (let z = c; z <= d; z++) keys.push(x + ':' + z);
    return keys;
  }
  remove(id: string) { const previous = this.entries.get(id); if (!previous) return; for (const key of previous.cells) { const cell = this.cells.get(key)!; cell.delete(id); if (!cell.size) this.cells.delete(key); } this.entries.delete(id); }
  set(id: string, bounds: Bounds2) { const keys = this.keys(bounds); this.remove(id); this.entries.set(id, { bounds, cells: keys }); for (const key of keys) { const cell = this.cells.get(key) ?? new Set<string>(); cell.add(id); this.cells.set(key, cell); } }
  query(box: Bounds2) { const result = new Set<string>(); for (const key of this.keys(box)) for (const id of this.cells.get(key) ?? []) { const candidate = this.entries.get(id)!.bounds; if (box.minX <= candidate.maxX && box.maxX >= candidate.minX && box.minZ <= candidate.maxZ && box.maxZ >= candidate.minZ) result.add(id); } return result; }
  get size() { return this.entries.size; }
}
