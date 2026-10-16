const fail = (): never => { throw new Error('El modelo GLB no es válido.'); };
type Json = Record<string, any>;
const object = (value: unknown): Json => value && typeof value === 'object' && !Array.isArray(value) ? value as Json : fail();
const integer = (value: unknown, maximum: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum ? value : fail();
const entries = (value: unknown, maximum: number): Json[] => value === undefined ? [] : Array.isArray(value) && value.length <= maximum ? value.map(object) : fail();

/** Bound graph expansion and primitive instances before GLTFLoader allocates any scene. */
export function preflightGlb(bytes: Uint8Array) {
  if (bytes.byteLength < 28 || bytes.byteLength > 20 * 1024 * 1024) fail();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.byteLength) fail();
  const length = view.getUint32(12, true);
  if (!length || length > 1024 * 1024 || length % 4 || length + 28 > bytes.byteLength || view.getUint32(16, true) !== 0x4e4f534a) fail();
  let document: Json;
  try { document = object(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(20, 20 + length)))); } catch { return fail(); }
  const accessors = entries(document.accessors, 1024), meshes = entries(document.meshes, 256), nodes = entries(document.nodes, 512), scenes = entries(document.scenes, 32), materials = entries(document.materials, 256);
  const textures = entries(document.textures, 64);
  for (const material of materials) {
    const pbr = material.pbrMetallicRoughness === undefined ? {} : object(material.pbrMetallicRoughness);
    for (const texture of [material.normalTexture, material.occlusionTexture, material.emissiveTexture, pbr.baseColorTexture, pbr.metallicRoughnessTexture]) if (texture !== undefined) integer(object(texture).index, textures.length - 1);
  }
  if (!nodes.length || !scenes.length) fail();
  integer(document.scene ?? 0, scenes.length - 1);
  const triangles = meshes.map(mesh => {
    const primitives = entries(mesh.primitives, 128);
    if (!primitives.length) fail();
    const count = primitives.reduce((total, primitive) => {
      if (primitive.mode !== undefined && primitive.mode !== 4) fail();
      if (primitive.material !== undefined) integer(primitive.material, materials.length - 1);
      const attributes = object(primitive.attributes);
      const position = accessors[integer(attributes.POSITION, accessors.length - 1)];
      if (!position || position.type !== 'VEC3' || position.componentType !== 5126) fail();
      const accessor = primitive.indices === undefined ? position : accessors[integer(primitive.indices, accessors.length - 1)];
      const vertices = integer(accessor.count, 600000);
      if (!vertices || vertices % 3) fail();
      return total + vertices / 3;
    }, 0);
    return { triangles: count, primitives: primitives.length };
  });
  const parents = new Set<number>();
  for (const node of nodes) {
    if (node.mesh !== undefined) integer(node.mesh, meshes.length - 1);
    if (node.children !== undefined && (!Array.isArray(node.children) || node.children.length > 512)) fail();
    for (const child of node.children ?? []) { integer(child, nodes.length - 1); if (parents.has(child)) throw new Error('El modelo tiene una jerarquía no válida.'); parents.add(child); }
  }
  const checked = new Set<number>(), visiting = new Set<number>();
  const graph = (index: number, depth: number) => {
    if (depth > 32 || visiting.has(index)) throw new Error('El modelo tiene una jerarquía no válida.');
    if (checked.has(index)) return;
    visiting.add(index); for (const child of nodes[index].children ?? []) graph(child, depth + 1);
    visiting.delete(index); checked.add(index);
  };
  nodes.forEach((_, index) => graph(index, 0));
  let instances = 0, primitiveInstances = 0, triangleInstances = 0;
  const visit = (index: number) => {
    if (++instances > 1024) fail();
    const node = nodes[index];
    if (node.mesh !== undefined) {
      primitiveInstances += triangles[node.mesh].primitives;
      triangleInstances += triangles[node.mesh].triangles;
      if (primitiveInstances > 512) throw new Error('El modelo es demasiado complejo.');
      if (triangleInstances > 200000) throw new Error('El modelo debe tener como máximo 200 000 triángulos.');
    }
    for (const child of node.children ?? []) visit(child);
  };
  // GLTFLoader parses every declared scene, including scenes not initially displayed.
  for (const scene of scenes) {
    if (!Array.isArray(scene.nodes) || scene.nodes.length > 512 || new Set(scene.nodes).size !== scene.nodes.length) fail();
    for (const index of scene.nodes) { integer(index, nodes.length - 1); if (parents.has(index)) fail(); visit(index); }
  }
  return { document, instances, primitiveInstances, triangles: triangleInstances, materials: materials.length };
}
