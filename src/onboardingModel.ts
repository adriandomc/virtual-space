import { createDefaultRoom, fitRoom, interiorPoint, validateRoom } from './model';
import type { Room } from './types';

export type OnboardingStep = 'plan' | 'colors' | 'decoration';

export function createBlankRoom(): Room {
  const room = createDefaultRoom();
  return resetOnboardingStep({ ...room, furniture: [], openings: [], lights: room.lights.map(light => ({ ...light, enabled: true })), showFurniture: false, setupStep: 0 }, 'colors');
}

export function resetOnboardingStep(room: Room, step: OnboardingStep): Room {
  if (step === 'decoration') {
    const primary = room.lights.find(light => light.id === 'light-1') ?? { ...createDefaultRoom().lights[0], ...interiorPoint(room.vertices), y: room.height - 0.3, enabled: true };
    return validateRoom({ ...room, furniture: [], openings: [], lights: [primary], showFurniture: false });
  }
  if (step === 'colors') return validateRoom({ ...room, wallColors: room.vertices.map(() => '#f5f5f2'), ceilingColor: '#ffffff', floorColor: '#edede8', floorFinish: 'concrete' });
  const initial = createDefaultRoom();
  return fitRoom({ ...room, vertices: initial.vertices, height: initial.height, openings: room.openings.map(opening => ({ ...opening, wall: opening.wall % initial.vertices.length })), wallColors: initial.vertices.map((_, i) => room.wallColors[i] ?? '#f5f5f2') });
}
