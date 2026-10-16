import type { OfflineProjectRecord, SoloProject } from '../offline/offlineProject';
import { offlineFetch } from '../offline/offlineMode';
import type { ProjectSnapshot } from './liveProject';

export const sketchAddress = (id: string, levelId: string, hasSketch: boolean, version: number) => hasSketch ? '/api/rooms/' + encodeURIComponent(id) + '/levels/' + encodeURIComponent(levelId) + '/sketch?v=' + version : null;

type SketchOwner = Pick<SoloProject, 'cacheSketch'>;
type Selection = {
  snapshot: Omit<ProjectSnapshot, 'project'> | null;
  record: OfflineProjectRecord | null;
  owner: SketchOwner | null;
  levelId: string;
  offline: boolean;
};

/** Owns image URLs and only caches responses still belonging to this session/version. */
export class ProjectSketch {
  private selection: Selection | null = null;
  private displayed: { levelId: string; version: number; blob: Blob | null | undefined; address: string | null } | null = null;
  private localUrl: string | null = null;
  private loading = new Map<string, SketchOwner>();

  constructor(private id: string, private display: (url: string | null) => void, private fetch: typeof offlineFetch = offlineFetch) {}

  update(selection: Selection) {
    this.selection = selection;
    const { snapshot, record, owner, levelId, offline } = selection;
    const sketch = snapshot?.sketches[levelId];
    const draft = record?.sketchDrafts?.[levelId], cached = record?.sketchBlobs?.[levelId];
    const blob = draft ? draft.blob : cached && cached.version === sketch?.version ? cached.blob : undefined;
    const address = offline ? null : sketchAddress(this.id, levelId, sketch?.hasSketch ?? false, sketch?.version ?? 0);
    const previous = this.displayed;
    if (!previous || previous.levelId !== levelId || previous.version !== sketch?.version || previous.blob !== blob || previous.address !== address) {
      this.releaseUrl();
      if (blob) this.localUrl = URL.createObjectURL(blob);
      this.display(blob !== undefined ? this.localUrl : address);
      this.displayed = { levelId, version: sketch?.version ?? 0, blob, address };
    }
    if (blob !== undefined || !sketch?.hasSketch || offline || !owner) return;
    const version = sketch.version, key = levelId + ':' + version;
    if (this.loading.get(key) === owner) return;
    this.loading.set(key, owner);
    const current = () => this.selection?.owner === owner && !this.selection.offline && this.selection.snapshot?.sketches[levelId]?.version === version;
    void this.fetch(sketchAddress(this.id, levelId, true, version)!, { credentials: 'same-origin' }).then(async response => {
      if (!response.ok || response.headers.get('ETag') !== '"' + this.id + '-' + levelId + '-' + version + '"' || !current()) return;
      const image = await response.blob();
      if (current()) await owner.cacheSketch(image, version, levelId);
    }).catch(() => {}).finally(() => { if (this.loading.get(key) === owner) this.loading.delete(key); });
  }

  private releaseUrl() { if (this.localUrl) URL.revokeObjectURL(this.localUrl); this.localUrl = null; }
  dispose() { this.selection = null; this.releaseUrl(); this.displayed = null; this.loading.clear(); }
}
