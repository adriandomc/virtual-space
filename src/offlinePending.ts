import { listOfflineMetadata } from './offlineStorage';

export async function hasStoredOfflineChanges(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  const [projects, assets, metadata] = await Promise.all([
    listOfflineMetadata<{ localOnly?: boolean; deleted?: boolean; draft?: unknown; inflight?: unknown; sketchDrafts?: object; inflightSketches?: object }>('projects'),
    listOfflineMetadata<{ pending?: boolean; deleted?: boolean; uploading?: boolean }>('assets'),
    listOfflineMetadata<{ project?: unknown; roomId?: string }>('meta'),
  ]);
  return projects.some(p => p.localOnly || p.deleted || p.draft || p.inflight || Object.keys(p.sketchDrafts ?? {}).length || Object.keys(p.inflightSketches ?? {}).length)
    || assets.some(a => a.pending || a.deleted || a.uploading)
    || metadata.some(m => m.project && typeof m.roomId === 'string');
}
