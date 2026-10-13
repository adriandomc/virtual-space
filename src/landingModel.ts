import { createDefaultRoom, validateRoom } from './model';
import type { FurnitureItem, Room } from './types';

export const LANDING_WARDROBE_ID = 'demo-wardrobe';

export function createLandingRoom(): Room {
  return validateRoom({
    ...createDefaultRoom(),
    name: 'Cuarto de ejemplo',
    wallColors: ['#b7c4b0', '#f4f1e9', '#f4f1e9', '#f4f1e9'],
    floorColor: '#c8b293', ceilingColor: '#f8f6f0',
    renderQuality: 'realistic', showFurniture: false,
    editing: { snap: true, step: 0.1, bounds: true },
    furniture: [
      { id: 'demo-bed', type: 'bed', bedSize: 'double', x: -1.1, z: -0.95, width: 1.4, depth: 1.9, height: 0.9, rotation: 0, material: 'wood', color: '#b19a7a' },
      { id: LANDING_WARDROBE_ID, type: 'wardrobe', x: 1.65, z: -1.5, width: 1.1, depth: 0.62, height: 2.05, rotation: 0, material: 'wood', color: '#ba9773' },
      { id: 'demo-nightstand', type: 'nightstand', x: -2.1, z: -1.45, width: 0.45, depth: 0.45, height: 0.48, rotation: 0, material: 'wood', color: '#b19a7a' },
      { id: 'demo-vanity', type: 'vanity', x: 1.82, z: 0.95, width: 1.1, depth: 0.58, height: 1.5, rotation: 270, material: 'wood', color: '#b19a7a' },
    ],
    openings: [
      { id: 'demo-door', type: 'door', wall: 0, offset: 2.16, width: 0.92, height: 2.1, sill: 0, doorStyle: 'right', open: false },
      { id: 'demo-window', type: 'window', wall: 1, offset: 1.1, width: 1.8, height: 1.35, sill: 0.8 },
    ],
    lights: [{ id: 'demo-light', name: 'Luz principal', x: 0, y: 2.5, z: 0, lumens: 1200, temperature: 3000, enabled: true }],
    sun: { enabled: true, hour: 14, azimuth: 60, intensity: 3 },
  });
}

export function updateLandingWardrobe(room: Room, patch: Partial<Pick<FurnitureItem, 'x' | 'z' | 'width' | 'depth' | 'height' | 'rotation' | 'color' | 'material'>>): Room {
  return validateRoom({ ...room, furniture: room.furniture.map(item => item.id === LANDING_WARDROBE_ID ? { ...item, ...patch } : item) });
}
