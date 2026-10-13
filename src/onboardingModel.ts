import { createDefaultRoom, fitRoom, validateRoom } from './model';
import type { Room } from './types';

export type OnboardingStep = 'plan' | 'colors' | 'decoration';

export function createBlankRoom(): Room {
  const room = createDefaultRoom();
  return resetOnboardingStep({ ...room, furniture: [], showFurniture: false, setupStep: 0 }, 'colors');
}

export function resetOnboardingStep(room: Room, step: OnboardingStep): Room {
  if (step === 'decoration') return validateRoom({ ...room, furniture: [], showFurniture: false });
  if (step === 'colors') return validateRoom({ ...room, wallColors: room.vertices.map(() => '#f5f5f2'), ceilingColor: '#ffffff', floorColor: '#edede8', floorFinish: 'concrete' });
  const initial = createDefaultRoom();
  return fitRoom({ ...room, vertices: initial.vertices, height: initial.height, openings: initial.openings, wallColors: initial.vertices.map((_, i) => room.wallColors[i] ?? '#f5f5f2') });
}
