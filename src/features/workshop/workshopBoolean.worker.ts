import type { BooleanReply, BooleanRequest } from './workshopBooleanTransfer';
import { booleanTransfers, packBooleanGeometry, unpackBooleanMesh } from './workshopBooleanTransfer';
import { combineWorkshopMeshes } from './workshopBoolean';
import { disposeWorkshopModel } from './modelWorkshopGeometry';
import * as THREE from 'three';

const worker = self as unknown as { onmessage: ((event: MessageEvent<BooleanRequest>) => void) | null; postMessage: (message: BooleanReply, transfer?: Transferable[]) => void };
worker.onmessage = ({ data }) => {
  const inputs = new THREE.Group();
  let result: THREE.Mesh | undefined;
  try {
    const base = unpackBooleanMesh(data.base), tool = unpackBooleanMesh(data.tool);
    inputs.add(base, tool); inputs.updateWorldMatrix(true, true);
    result = combineWorkshopMeshes(base, tool, data.operation);
    const geometry = packBooleanGeometry(result.geometry);
    const materials = (Array.isArray(result.material) ? result.material : [result.material]).map(material => material.name);
    worker.postMessage({ geometry, materials, position: result.position.toArray(), name: result.name }, booleanTransfers(geometry));
  } catch (cause) {
    worker.postMessage({ error: cause instanceof Error ? cause.message : 'No se pudo combinar las piezas.' });
  } finally {
    disposeWorkshopModel(inputs);
    if (result) disposeWorkshopModel(new THREE.Group().add(result));
  }
};
