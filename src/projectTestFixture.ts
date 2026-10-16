import { createDefaultProject, projectToRoom, updateProjectRoom, type ProjectDocument } from './projectDocument';
import type { ProjectSnapshot } from './liveProject';
import type { Room } from './types';

/** Test builders use the current internal level view; never a production import adapter. */
export function projectFixture(room?: Room, id = 'room', base = createDefaultProject(undefined, undefined, id)): ProjectDocument {
  return room ? updateProjectRoom(base, base.activeLevelId, room) : base;
}
export function patchProject(project: ProjectDocument, patch: Partial<Room>): ProjectDocument {
  return updateProjectRoom(project, project.activeLevelId, { ...projectToRoom(project), ...patch });
}
export function snapshotFixture(id = 'room', accountId = 'owner', project = createDefaultProject(undefined, undefined, id)): ProjectSnapshot {
  return { id, accountId, project, revision: 1, structureRevision: 1, structureRevisions: Object.fromEntries(project.levels.map(level => [level.id, 1])), sketches: Object.fromEntries(project.levels.map(level => [level.id, { hasSketch: false, version: 0, mutationId: null }])), role: 'owner', canEdit: true, canManage: true, shared: false, offlineAllowed: true };
}
