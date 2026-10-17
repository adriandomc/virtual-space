import { useState } from 'react';
import type { ProjectDocument } from '../../domain/project/projectDocument';
import { stableStringify } from '../sameData';

const revisions = new WeakMap<object, string>();
export function colorRevision(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  let revision = revisions.get(value);
  if (revision === undefined) { revision = stableStringify(value); revisions.set(value, revision); }
  return revision;
}

export function projectColors(project: ProjectDocument): string[] {
  return [...new Set(project.levels.flatMap(level => [
    ...level.walls.flatMap(wall => [wall.left.color, wall.right.color]),
    ...level.surfaces.flatMap(surface => [surface.finish.color, ...(surface.kind === 'floor' ? [surface.undersideFinish.color] : [])]),
    ...level.furniture.flatMap(item => [item.color, ...Object.values(item.parts ?? {}).map(part => part.color)]),
    ...level.openings.map(opening => opening.color), ...level.lights.map(light => light.color),
  ]).concat(project.roofs.flatMap(roof => [roof.finish.color, roof.undersideFinish.color]), project.stairs.map(stair => stair.finish.color))
    .filter((value): value is string => !!value).map(value => value.toLowerCase()))];
}

export function useColorPreview(project: ProjectDocument) {
  const source = colorRevision(project);
  const [preview, setPreview] = useState<{ source: unknown; project: ProjectDocument } | null>(null);
  return { shownProject: preview && preview.source === source ? preview.project : project, previewProject: (next: ProjectDocument | null) => setPreview(next ? { source, project: next } : null) };
}
