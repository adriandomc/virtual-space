export type Point = { x: number; z: number };
export type Opening = {
  id: string;
  type: 'door' | 'window';
  wall: number;
  offset: number;
  width: number;
  height: number;
  sill: number;
};
export type RoomLight = {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  lumens: number;
  temperature: number;
  enabled: boolean;
};
export type BedSize = 'single' | 'double' | 'queen' | 'king';
export type FurnitureItem = {
  id: string;
  type: 'bed' | 'wardrobe' | 'vanity' | 'nightstand';
  bedSize?: BedSize;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  rotation: number;
};
export type Room = {
  version: 1;
  name: string;
  vertices: Point[];
  wallColors: string[];
  height: number;
  thickness: number;
  floorColor: string;
  showFurniture: boolean;
  furniture: FurnitureItem[];
  openings: Opening[];
  lights: RoomLight[];
  sun: { enabled: boolean; hour: number; azimuth: number; intensity: number };
};
export type ViewMode = 'orbit' | 'walk' | 'plan';
