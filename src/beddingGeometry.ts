import { BufferAttribute, BufferGeometry, SphereGeometry } from 'three/webgpu';

const smoothEdge = (value: number, start: number) => {
  const t = Math.max(0, Math.min(1, (value - start) / (1 - start)));
  return t * t * (3 - 2 * t);
};

export function createDuvetGeometry(width: number, depth: number, height: number, detail: 'low' | 'medium' | 'high' = 'high') {
  const segments = detail === 'low' ? 12 : detail === 'medium' ? 24 : 48;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let row = 0; row <= segments; row++) for (let col = 0; col <= segments; col++) {
    const u = col / segments, v = row / segments, x = (u - 0.5) * width * 0.96;
    const side = smoothEdge(Math.abs(u - 0.5) * 2, 0.84);
    const foot = smoothEdge(v, 0.85);
    const folds = (Math.sin(u * 25 + v * 7) * 0.012 + Math.sin(v * 32 - u * 8) * 0.008) * (1 - side * 0.6);
    const foldOver = Math.exp(-(((v - 0.12) / 0.055) ** 2)) * 0.028;
    positions.push(x, height * (0.59 - side * 0.24 - foot * 0.22 + folds + foldOver), depth * (v * 0.66 - 0.175));
    uvs.push(u * width * 0.96, v * depth * 0.66);
    if (row < segments && col < segments) {
      const a = row * (segments + 1) + col, b = a + segments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createPillowGeometry(width: number, height: number, depth: number, detail: 'low' | 'medium' | 'high' = 'high') {
  const geometry = new SphereGeometry(1, detail === 'low' ? 12 : detail === 'medium' ? 24 : 40, detail === 'low' ? 8 : detail === 'medium' ? 16 : 24);
  const position = geometry.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const p = 0.7;
    const pillow = (value: number) => Math.sign(value) * Math.abs(value) ** p;
    // A superellipsoid gives filled corners; restrained folds preserve the declared footprint.
    const wrinkle = 1 - 0.022 * Math.abs(Math.sin(x * 19 + z * 13)) * (1 - Math.abs(y));
    position.setXYZ(i, pillow(x) * width / 2 * wrinkle, pillow(y) * height / 2 * wrinkle, pillow(z) * depth / 2 * wrinkle);
  }
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width * 2, uv.getY(i) * depth * 2);
  geometry.computeVertexNormals();
  return geometry;
}
