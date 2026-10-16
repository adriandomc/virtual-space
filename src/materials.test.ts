import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { architecturalTexturePath, createCeilingMaterial, createCeilingFinishMaterial, createSlabMaterials, createWallFinishMaterial, createFabricMaterial, createFloorMaterial, createRoofInteriorMaterial, createFurnitureMaterial, createWallMaterial, createWoodMaterial, disposeArchitecturalTextures, setMaterialTextureResolution } from './materials';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createDefaultRoom } from './model';
import type { FloorFinish } from './types';

test('all floor finishes construct light-reactive materials in both quality modes without browser textures', () => {
  const room = createDefaultRoom();
  const finishes: FloorFinish[] = ['wood', 'tile-grid', 'tile-brick', 'tile-checker', 'marble', 'concrete'];
  for (const floorFinish of finishes) for (const renderQuality of ['standard', 'realistic'] as const) {
    const material = createFloorMaterial({ ...room, floorFinish, renderQuality, floorColor: '#35a4c8' });
    assert.equal(material.color.getHexString(), '35a4c8');
    assert.ok(material.colorNode); assert.equal(material.lights, true);
    assert.equal(material.map, null); assert.equal(material.normalMap, null);
    if (renderQuality === 'realistic') {
      assert.ok(material instanceof THREE.MeshPhysicalNodeMaterial);
      assert.ok(material.normalNode instanceof THREE.NormalMapNode);
      assert.ok(material.roughnessNode);
    } else {
      assert.equal(material.normalNode, null);
      assert.equal(material.roughnessNode, null);
    }
    material.dispose();
  }
});

test('room rebuilds use independent materials, preserve chosen paint and support interior ceiling faces', () => {
  const wall = createWallMaterial('#123456', 'realistic');
  const ceiling = createCeilingMaterial('#abcdef', 'realistic');
  const wood = createWoodMaterial('#876543', 'realistic');
  const standard = createWallMaterial('#123456', 'standard');
  assert.equal(wall.color.getHexString(), '123456'); assert.equal(ceiling.color.getHexString(), 'abcdef');
  assert.equal(wall.side, THREE.DoubleSide); assert.equal(ceiling.side, THREE.DoubleSide);
  assert.ok(wall.normalNode); assert.ok(ceiling.normalNode); assert.ok(wood.normalNode);
  assert.equal(standard.normalNode, null);
  assert.notEqual(wall.normalNode, ceiling.normalNode);
  wall.dispose();
  assert.ok(ceiling.normalNode); assert.equal(ceiling.color.getHexString(), 'abcdef');
  ceiling.dispose(); wood.dispose(); standard.dispose();
});

test('architectural materials use photographed PBR maps with custom tint and share textures across rebuilds', () => {
  const room = createDefaultRoom();
  const finishes: FloorFinish[] = ['wood', 'tile-grid', 'tile-brick', 'tile-checker', 'marble', 'concrete'];
  const floors = finishes.map(floorFinish => createFloorMaterial({ ...room, floorFinish, renderQuality: 'hyperrealistic', floorColor: '#35a4c8' }));
  const wood = createWoodMaterial('#876543', 'hyperrealistic');
  const fabric = createFabricMaterial('#abcdef', 'hyperrealistic');
  const wall = createWallMaterial('#123456', 'hyperrealistic');
  const ceiling = createCeilingMaterial('#654321', 'hyperrealistic');
  const materials = [...floors, wood, fabric, wall, ceiling];
  for (const material of materials) {
    assert.ok(material instanceof THREE.MeshPhysicalNodeMaterial);
    assert.equal(material.lights, true);
    assert.ok(material.colorNode); assert.ok(material.normalNode); assert.ok(material.roughnessNode); assert.ok(material.aoNode);
    assert.ok(material.map); assert.ok(material.normalMap); assert.ok(material.roughnessMap);
    assert.equal(material.map.colorSpace, THREE.SRGBColorSpace);
    assert.equal(material.normalMap.colorSpace, THREE.NoColorSpace);
    assert.equal(material.roughnessMap.colorSpace, THREE.NoColorSpace);
    assert.equal(material.roughnessMap, material.aoMap);
    assert.equal(material.map.wrapS, THREE.RepeatWrapping); assert.equal(material.map.wrapT, THREE.RepeatWrapping);
    assert.match(material.map.name, /^\/materials\/(wood|plaster|stone|marble|fabric)\/color\.jpg$/);
    // Constructing materials on the server must not attempt image downloads or require a DOM.
    assert.equal(material.map.image, null);
  }
  floors.forEach(material => assert.equal(material.color.getHexString(), '35a4c8'));
  assert.equal(wall.color.getHexString(), '123456'); assert.equal(ceiling.color.getHexString(), '654321');
  assert.equal(wood.map, floors[0].map); assert.equal(wall.map, ceiling.map);
  assert.equal(wall.side, THREE.DoubleSide); assert.equal(ceiling.side, THREE.DoubleSide);
  const paintRelief = ((wall.normalNode as THREE.NormalMapNode).scaleNode as THREE.ConstNode<THREE.Vector2>).value;
  const woodRelief = ((wood.normalNode as THREE.NormalMapNode).scaleNode as THREE.ConstNode<THREE.Vector2>).value;
  assert.ok(paintRelief.x > 0 && paintRelief.x < woodRelief.x / 4, 'paint retains a finer surface than exposed wood');
  assert.equal((fabric as THREE.MeshPhysicalNodeMaterial).sheen, 0.5);
  assert.equal(floors[1].map, floors[2].map); assert.equal(floors[1].map, floors[3].map);

  const cached = new Set(materials.flatMap(material => [material.map!, material.normalMap!, material.roughnessMap!]));
  let disposed = 0;
  cached.forEach(map => map.addEventListener('dispose', () => disposed++));
  materials.forEach(material => material.dispose());
  assert.equal(disposed, 0);
  disposeArchitecturalTextures();
  assert.equal(disposed, cached.size);
  disposeArchitecturalTextures();
  assert.equal(disposed, cached.size);
  const rebuilt = createWoodMaterial('#876543', 'hyperrealistic');
  assert.notEqual(rebuilt.map, wood.map);
  rebuilt.dispose(); disposeArchitecturalTextures();
});

test('furniture wood, plastic and metal preserve HEX and physical response in every quality mode', () => {
  let disposed = 0;
  for (const quality of ['standard', 'realistic', 'hyperrealistic'] as const) {
    for (const surface of ['wood', 'plastic', 'metal'] as const) {
      const material = createFurnitureMaterial('#e14c35', surface, quality);
      assert.equal(material.color.getHexString(), 'e14c35');
      assert.equal(material.lights, true);
      assert.equal(material.metalness, surface === 'metal' ? 1 : 0);
      assert.ok(material.roughness > 0 && material.roughness <= 1);
      if (surface === 'wood') {
        assert.equal(Boolean(material.map), quality === 'hyperrealistic');
        if (quality === 'hyperrealistic') assert.equal(material.map!.name, '/materials/wood/color.jpg');
      } else {
        assert.ok(material instanceof THREE.MeshPhysicalNodeMaterial);
        assert.equal(material.map, null); assert.equal(material.normalMap, null);
        assert.equal(Boolean(material.normalNode), quality !== 'standard');
        assert.equal(Boolean(material.roughnessNode), quality !== 'standard');
        if (surface === 'plastic') assert.ok(material.clearcoat > 0);
        else assert.equal(material.clearcoat, 0);
      }
      material.addEventListener('dispose', () => disposed++);
      material.dispose();
    }
  }
  assert.equal(disposed, 9);
  disposeArchitecturalTextures();
});

test('lower texture quality downloads real 512 variants and keeps high quality within authored resolution', async () => {
  const manifest: { path: string; variants: Record<string, { path: string; bytes: number; sha256: string; width: number; height: number }> }[] = JSON.parse(await readFile(new URL('../public/materials/manifest.json', import.meta.url), 'utf8'));
  let lowBytes = 0, originalBytes = 0;
  for (const entry of manifest) for (const [resolution, variant] of Object.entries(entry.variants)) {
    const bytes = await readFile(new URL('../public' + variant.path, import.meta.url));
    assert.equal(bytes.length, variant.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), variant.sha256);
    assert.ok(Math.max(variant.width, variant.height) <= Number(resolution) + 1);
    if (resolution === '512') lowBytes += variant.bytes; else originalBytes += variant.bytes;
  }
  assert.ok(lowBytes < originalBytes / 4, 'mobile variants reduce actual downloads');
  assert.equal(architecturalTexturePath('wood', 'color', 512), '/materials/512/wood/color.jpg');
  assert.equal(architecturalTexturePath('wood', 'color', 2048), '/materials/wood/color.jpg');
  setMaterialTextureResolution(512);
  const low = createWoodMaterial('#abcdef', 'hyperrealistic'); assert.match(low.map!.name, /^\/materials\/512\//);
  low.dispose(); setMaterialTextureResolution(2048); disposeArchitecturalTextures();
});

test('roof interior finishes retain selected physical material in every visual mode', () => {
  for (const quality of ['standard', 'realistic', 'hyperrealistic'] as const) for (const material of ['wood', 'marble', 'concrete'] as const) {
    const interior = createRoofInteriorMaterial({ color: '#abcdef', material }, quality);
    assert.equal(interior.color.getHexString(), 'abcdef'); assert.equal(interior.side, THREE.DoubleSide);
    // Plaster keeps a uniform paint tint; its realistic relief and hyperrealistic maps add detail independently.
    assert.equal(Boolean(interior.colorNode), material !== 'concrete' || quality === 'hyperrealistic');
    if (quality !== 'standard') { assert.ok(interior.normalNode); assert.ok(interior.roughnessNode); }
    if (quality === 'hyperrealistic') assert.equal(interior.map!.name, '/materials/' + (material === 'concrete' ? 'plaster' : material) + '/color.jpg');
    interior.dispose();
  }
  disposeArchitecturalTextures();
});

test('both wall sides and ceilings use their explicit finish without changing shader quality', () => {
  for (const quality of ['standard', 'realistic', 'hyperrealistic'] as const) for (const factory of [createWallFinishMaterial, createCeilingFinishMaterial]) for (const material of ['wood', 'tile-grid', 'tile-brick', 'tile-checker', 'marble', 'concrete'] as const) {
    const surface = factory({ color: '#3478ab', material }, quality); assert.equal(surface.color.getHexString(), '3478ab'); assert.equal(surface.side, THREE.DoubleSide); assert.equal(surface.lights, true);
    if (quality === 'hyperrealistic') assert.equal(surface.map!.name, '/materials/' + (material === 'concrete' ? 'plaster' : material.startsWith('tile-') ? 'stone' : material) + '/color.jpg');
    else assert.equal(surface.map, null);
    if (quality !== 'standard') assert.ok(surface.normalNode);
    surface.dispose();
  }
  disposeArchitecturalTextures();
});

test('one slab keeps independent top and underside finishes in every visual mode', () => {
  for (const quality of ['standard', 'realistic', 'hyperrealistic'] as const) {
    const [top, underside, edge] = createSlabMaterials({ color: '#674320', material: 'wood' }, { color: '#d7e8f9', material: 'marble' }, quality);
    assert.equal(top.color.getHexString(), '674320'); assert.equal(underside.color.getHexString(), 'd7e8f9'); assert.equal(edge, top); assert.notEqual(top, underside);
    assert.equal(Boolean(top.map), quality === 'hyperrealistic'); assert.equal(Boolean(underside.map), quality === 'hyperrealistic');
    if (quality === 'hyperrealistic') { assert.match(top.map!.name, /wood\/color.jpg$/); assert.match(underside.map!.name, /marble\/color.jpg$/); }
    new Set([top, underside, edge]).forEach(material => material.dispose());
  }
  disposeArchitecturalTextures();
});
