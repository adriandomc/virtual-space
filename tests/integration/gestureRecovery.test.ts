import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultProject, projectToRoom, updateProjectRoom } from '../../src/domain/project/projectDocument';
import { clearOffline, readOffline, writeOffline } from '../../src/client/offline/offlineStorage';
import { ProjectRecovery } from '../../src/client/projects/projectRecovery';
import { GestureCheckpoints } from '../../src/features/viewer/sceneItemDragging';

const owner = { id: '031f3902-316e-4233-931b-6e3776ba8ae6', username: 'owner', verifiedAt: Date.now() };
const project = createDefaultProject(undefined, undefined, 'design');
const key = 'recovery:' + owner.id + ':' + project.id;
async function reset() { await clearOffline(); await writeOffline('meta', 'identity', owner); }

test('a stopped gesture cannot clear the next gesture after its delayed durability check finishes', async () => {
  await reset();
  const recovery = new ProjectRecovery(project.id), room = projectToRoom(project, project.activeLevelId);
  let generation = 0, durabilityCalls = 0, releaseFirst!: () => void;
  let markStarted!: () => void, markSecondStored!: () => void, markCleared!: () => void;
  const started = new Promise<void>(resolve => { markStarted = resolve; });
  const secondStored = new Promise<void>(resolve => { markSecondStored = resolve; });
  const cleared = new Promise<void>(resolve => { markCleared = resolve; });
  const local = { hasUndurableWork: false, async assertDurable() {
    if (++durabilityCalls === 1) {
      markStarted();
      await new Promise<void>(resolve => { releaseFirst = resolve; });
    }
  } };
  // Match useProject.checkpointRoom: each invocation reserves its generation before
  // waiting for local durability, so stale previews and cleanup cannot win later.
  const write = async (next: typeof room | null) => {
    const currentGeneration = ++generation;
    await recovery.updateCheckpoint(next ? updateProjectRoom(project, project.activeLevelId, next) : null, owner.id, local, () => generation === currentGeneration);
    if (next?.name === 'Second gesture') markSecondStored();
    if (!next) markCleared();
  };
  const errors: unknown[] = [];
  const first = new GestureCheckpoints(write, cause => errors.push(cause));
  const second = new GestureCheckpoints(write, cause => errors.push(cause));
  first.queue({ ...room, name: 'First gesture' }); first.tick(500);
  await started;
  try {
    first.stop(true);
    second.queue({ ...room, name: 'Second gesture' }); second.tick(500);
    await secondStored;
    assert.equal((await readOffline<{ project: typeof project }>('meta', key))?.project.name, 'Second gesture');
  } finally { releaseFirst(); second.stop(); }
  await cleared;
  const reopened = new ProjectRecovery(project.id); await reopened.restore(() => true);
  assert.equal(reopened.project()?.name, 'Second gesture');
  assert.deepEqual(errors, []);
});
