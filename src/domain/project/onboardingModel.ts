import { createDefaultProject, type ProjectDocument } from './projectDocument';

export type OnboardingStep = 'plan' | 'roof' | 'colors' | 'decoration';

export function createBlankProject(name?: string, lightName?: string, levelName?: string): ProjectDocument {
  return { ...createDefaultProject(name, lightName, undefined, levelName), setupStep: 0 };
}

export function skipOnboardingStep<T>(document: T): T { return document; }
