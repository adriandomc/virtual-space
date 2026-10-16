import * as THREE from 'three';
import { booleanTransfers, packBooleanMesh, unpackBooleanGeometry } from './workshopBooleanTransfer';
import type { BooleanReply, WorkshopBooleanOperation } from './workshopBooleanTransfer';

export type { WorkshopBooleanOperation } from './workshopBooleanTransfer';

export function startWorkshopBoolean(base: THREE.Mesh, tool: THREE.Mesh, operation: WorkshopBooleanOperation): { promise: Promise<THREE.Mesh>; cancel: () => void } {
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let rejectOperation: (cause: Error) => void = () => {};
  const finish = () => { settled = true; if (timer) clearTimeout(timer); worker?.terminate(); };
  const promise = new Promise<THREE.Mesh>((accept, reject) => {
    rejectOperation = reject;
    try {
      if (base === tool || !['union', 'subtract', 'intersect'].includes(operation)) throw new Error('Selecciona dos piezas distintas.');
      const faces = [base, tool].reduce((total, mesh) => total + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position')?.count ?? 0) / 3, 0);
      if (!Number.isInteger(faces) || faces > 20000 || [base, tool].some(mesh => (mesh.geometry.getAttribute('position')?.count ?? 0) > 60000)) throw new Error('Las piezas son demasiado complejas para combinarlas.');
      const originals = new Map<string, THREE.Material>();
      for (const [prefix, mesh] of [['base', base], ['tool', tool]] as const) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material, index) => originals.set(`csg-input-${prefix}-${index}`, material));
      const first = packBooleanMesh(base, 'base', base.parent), second = packBooleanMesh(tool, 'tool', base.parent);
      worker = new Worker(new URL('./workshopBoolean.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }: MessageEvent<BooleanReply>) => {
        if (settled) return;
        let geometry: THREE.BufferGeometry | undefined;
        const materials: THREE.Material[] = [];
        try {
          if ('error' in data) throw new Error(data.error);
          geometry = unpackBooleanGeometry(data.geometry);
          for (const name of data.materials) {
            const source = originals.get(name);
            if (!source) throw new Error('No se pudo recuperar el material de la pieza.');
            materials.push(source.clone());
          }
          const result = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
          result.position.fromArray(data.position); result.name = data.name || base.name;
          result.castShadow = result.receiveShadow = true;
          finish(); accept(result);
        } catch (cause) {
          geometry?.dispose(); materials.forEach(material => material.dispose()); finish(); reject(cause);
        }
      };
      worker.onerror = event => { event.preventDefault(); if (!settled) { finish(); reject(new Error('No se pudo iniciar la combinación de piezas.')); } };
      worker.onmessageerror = () => { if (!settled) { finish(); reject(new Error('No se pudo recibir la combinación de piezas.')); } };
      timer = setTimeout(() => { if (!settled) { finish(); reject(new Error('La combinación tardó demasiado. Prueba con piezas más sencillas.')); } }, 20000);
      worker.postMessage({ base: first, tool: second, operation }, [...booleanTransfers(first.geometry), ...booleanTransfers(second.geometry)]);
    } catch (cause) { finish(); reject(cause); }
  });
  return { promise, cancel() { if (!settled) { finish(); rejectOperation(new Error('La combinación se canceló.')); } } };
}
