export type FurnitureCategory = 'wardrobe' | 'vanity' | 'nightstand';
export type FurniturePreset = { id: string; type: FurnitureCategory; label: string; width: number; depth: number; height: number };

export const FURNITURE_CATEGORIES: Record<FurnitureCategory, string> = { wardrobe: 'Roperos', vanity: 'Tocadores', nightstand: 'Burós' };

export const FURNITURE_CATALOG: readonly FurniturePreset[] = [
  { id: 'wardrobe-classic', type: 'wardrobe', label: 'Dos puertas', width: 1.4, depth: 0.6, height: 2 },
  { id: 'wardrobe-sliding', type: 'wardrobe', label: 'Puertas corredizas', width: 1.8, depth: 0.65, height: 2.1 },
  { id: 'wardrobe-l', type: 'wardrobe', label: 'En L', width: 1.8, depth: 1.8, height: 2.1 },
  { id: 'wardrobe-corner', type: 'wardrobe', label: 'Esquinero', width: 1.2, depth: 1.2, height: 2.1 },
  { id: 'wardrobe-rack', type: 'wardrobe', label: 'Perchero abierto', width: 1.2, depth: 0.5, height: 1.8 },
  { id: 'wardrobe-shelves', type: 'wardrobe', label: 'Con repisas', width: 1.3, depth: 0.55, height: 2 },
  { id: 'wardrobe-double-rail', type: 'wardrobe', label: 'Doble barra', width: 1.4, depth: 0.6, height: 2.1 },
  { id: 'wardrobe-drawers', type: 'wardrobe', label: 'Con cajonera', width: 1.5, depth: 0.6, height: 2.1 },
  { id: 'wardrobe-mirror', type: 'wardrobe', label: 'Con espejo', width: 1.6, depth: 0.6, height: 2.1 },
  { id: 'wardrobe-modular', type: 'wardrobe', label: 'Modular abierto', width: 2.1, depth: 0.6, height: 2.1 },
  { id: 'vanity-classic', type: 'vanity', label: 'Espejo rectangular', width: 1.1, depth: 0.48, height: 1.5 },
  { id: 'vanity-round', type: 'vanity', label: 'Espejo redondo', width: 1.1, depth: 0.48, height: 1.5 },
  { id: 'vanity-oval', type: 'vanity', label: 'Espejo ovalado', width: 0.9, depth: 0.45, height: 1.5 },
  { id: 'vanity-trifold', type: 'vanity', label: 'Espejo triple', width: 1.4, depth: 0.5, height: 1.55 },
  { id: 'vanity-double-drawers', type: 'vanity', label: 'Doble cajonera', width: 1.5, depth: 0.5, height: 1.5 },
  { id: 'vanity-floating', type: 'vanity', label: 'Suspendido', width: 1.1, depth: 0.45, height: 1.45 },
  { id: 'vanity-corner', type: 'vanity', label: 'Esquinero', width: 1, depth: 1, height: 1.5 },
  { id: 'vanity-lighted', type: 'vanity', label: 'Espejo con focos', width: 1.2, depth: 0.48, height: 1.55 },
  { id: 'vanity-minimal', type: 'vanity', label: 'Mesa y espejo', width: 1.2, depth: 0.45, height: 1.45 },
  { id: 'vanity-side-shelves', type: 'vanity', label: 'Con estantería', width: 1.3, depth: 0.5, height: 1.6 },
  { id: 'nightstand-classic', type: 'nightstand', label: 'Dos cajones', width: 0.5, depth: 0.42, height: 0.55 },
  { id: 'nightstand-single', type: 'nightstand', label: 'Un cajón', width: 0.5, depth: 0.42, height: 0.55 },
  { id: 'nightstand-three', type: 'nightstand', label: 'Tres cajones', width: 0.48, depth: 0.42, height: 0.65 },
  { id: 'nightstand-open', type: 'nightstand', label: 'Repisas abiertas', width: 0.5, depth: 0.4, height: 0.55 },
  { id: 'nightstand-round', type: 'nightstand', label: 'Redondo', width: 0.46, depth: 0.46, height: 0.55 },
  { id: 'nightstand-floating', type: 'nightstand', label: 'Suspendido', width: 0.5, depth: 0.38, height: 0.55 },
  { id: 'nightstand-cube', type: 'nightstand', label: 'Cubo abierto', width: 0.45, depth: 0.4, height: 0.45 },
  { id: 'nightstand-cabinet', type: 'nightstand', label: 'Con puerta', width: 0.5, depth: 0.42, height: 0.6 },
  { id: 'nightstand-tripod', type: 'nightstand', label: 'Tres patas', width: 0.48, depth: 0.48, height: 0.58 },
  { id: 'nightstand-nested', type: 'nightstand', label: 'Mesas anidadas', width: 0.65, depth: 0.45, height: 0.55 },
];

export function getFurniturePreset(type: string, variant?: string): FurniturePreset | undefined {
  return FURNITURE_CATALOG.find(preset => preset.type === type && preset.id === variant);
}

export function isFurnitureVariant(type: string, variant: unknown): variant is string {
  return typeof variant === 'string' && getFurniturePreset(type, variant) !== undefined;
}
