import { buildPickingTree, pickingTreeTransfers, type PickingGeometryData, type PickingTreeReply } from './pickingBvhProtocol';

const worker = self as unknown as { onmessage: (event: MessageEvent<PickingGeometryData>) => void; postMessage: (value: PickingTreeReply, transfer?: Transferable[]) => void };
worker.onmessage = ({ data }) => {
  try { const tree = buildPickingTree(data); worker.postMessage({ tree }, pickingTreeTransfers(tree)); }
  catch { worker.postMessage({ failed: true }); }
};
