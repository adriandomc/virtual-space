import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { createDefaultProject, projectToRoom } from '../../domain/project/projectDocument';
import { paintProjectTarget } from '../../domain/project/projectPaint';
import { buildLevelRoom } from './sceneLevel';
import { updateRoom } from './sceneArchitecture';
import { disposeContent } from './sceneResources';
import type { SceneRuntime } from './sceneRuntime';

test('all three render modes paint doors, window frames and lamp bodies without replacing geometry or emitted light', () => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { matchMedia: () => ({ matches: true }), devicePixelRatio: 1 } });
  try {
    for (const quality of ['standard', 'realistic', 'hyperrealistic'] as const) {
      let project = createDefaultProject(); project.renderQuality = quality;
      const level = project.levels[0];
      level.openings.push(
        { id: 'right', levelId: level.id, wallId: level.walls[0].id, type: 'door', doorStyle: 'right', open: false, offset: .4, width: .9, height: 2, sill: 0 },
        { id: 'left', levelId: level.id, wallId: level.walls[1].id, type: 'door', doorStyle: 'left', open: true, offset: .4, width: .9, height: 2, sill: 0 },
        { id: 'frame', levelId: level.id, wallId: level.walls[2].id, type: 'door', doorStyle: 'frame', offset: .4, width: .9, height: 2, sill: 0 },
        { id: 'window', levelId: level.id, wallId: level.walls[3].id, type: 'window', offset: .4, width: 1, height: 1, sill: 1 },
      );
      const scene = new THREE.Scene(), content = new THREE.Group(); scene.add(content);
      const runtime = {
        levelOnly: true, levelMeta: level, project, content, scene, objects: new Map(), viewMode: 'orbit',
        renderer: { shadowMap: {}, domElement: { clientWidth: 390 }, setPixelRatio() {} },
        graphics: { shadows: 512, textures: 512, renderScale: 1, geometry: 'low', distance: 40, ao: 'off', fps: 30 },
        walls: [], ceiling: null, ceilings: [], builtRoom: null, structure: '',
      } as unknown as SceneRuntime;
      buildLevelRoom(runtime, projectToRoom(project));
      const meshes = new Map<THREE.Mesh, THREE.BufferGeometry>(), untouched = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
      content.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        meshes.set(object, object.geometry);
        if (!object.userData.openingPaintId && !object.userData.lightBody) untouched.set(object, object.material);
      });
      const lightGroup = runtime.objects.get(`light:${level.lights[0].id}`)!, point = lightGroup.children.find(object => object instanceof THREE.PointLight) as THREE.PointLight;
      const intensity = point.intensity, temperature = point.color.clone(), built = runtime.architectureBuilds;
      for (const opening of level.openings) project = paintProjectTarget(project, { levelId: level.id, selection: { kind: 'opening', id: opening.id } }, '#1188cc');
      project = paintProjectTarget(project, { levelId: level.id, selection: { kind: 'light', id: level.lights[0].id } }, '#cc4488');
      runtime.project = project; runtime.levelMeta = project.levels[0]; updateRoom(runtime, projectToRoom(project));
      assert.equal(runtime.architectureBuilds, built, quality); assert.equal(point.intensity, intensity); assert.deepEqual(point.color, temperature);
      let taggedFrames = 0, taggedLeaves = 0, paintedBodies = 0;
      for (const [mesh, geometry] of meshes) {
        assert.equal(mesh.geometry, geometry, 'color changes retain every resident buffer');
        if (mesh.userData.openingPaintId || mesh.userData.lightBody) {
          const material = mesh.material as THREE.MeshStandardNodeMaterial;
          assert.equal(material.color.getHexString(), mesh.userData.lightBody ? 'cc4488' : '1188cc');
          assert.equal(material.lights, true);
          if (quality !== 'standard') assert.ok(material instanceof THREE.MeshPhysicalNodeMaterial);
          if (mesh.userData.openingPaintRole === 'leaf') taggedLeaves++; else if (mesh.userData.openingPaintRole === 'frame') taggedFrames++; else paintedBodies++;
        } else if (!mesh.userData.bulb) assert.equal(mesh.material, untouched.get(mesh), 'glass, transparent hit targets and hardware keep their material');
      }
      assert.equal(taggedLeaves, 4, 'both swinging leaves and their shadow clones are repainted'); assert.ok(taggedFrames >= 14); assert.equal(paintedBodies, 2);
      assert.equal(runtime.objects.get(`light:${level.lights[0].id}`), lightGroup);
      const bulb = lightGroup.children.find(object => object.userData.bulb) as THREE.Mesh;
      assert.deepEqual((bulb.material as THREE.MeshStandardMaterial).emissive, temperature);
      disposeContent(content);
    }
  } finally {
    if (originalWindow === undefined) Reflect.deleteProperty(globalThis, 'window'); else globalThis.window = originalWindow;
  }
});
