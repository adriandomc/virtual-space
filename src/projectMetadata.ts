import type { ProjectDocument } from './projectDocument.js';
export function projectMetadata(project: ProjectDocument) {
  const { levels: _levels, ...metadata } = project;
  return metadata;
}
