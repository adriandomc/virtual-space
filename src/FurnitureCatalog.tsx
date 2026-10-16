import { t, useLocale } from './i18n';
import { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { FURNITURE_CATALOG, FURNITURE_CATEGORIES } from './furnitureCatalog';
import type { FurnitureCategory, FurniturePreset } from './furnitureCatalog';
import { getCatalogParts } from './catalogGeometry';
import type { CatalogPart } from './catalogGeometry';
import './furnitureCatalog.css';

type Props = { onSelect: (preset: FurniturePreset) => void; category?: FurnitureCategory; onBack?: () => void };
const colors = { body: '#b89670', face: '#cfb494', handles: '#60665d', mirror: '#b5cecf', light: '#fff4d4' };
const shade = (hex: string, multiplier: number) => '#' + [1, 3, 5].map(offset => Math.round(parseInt(hex.slice(offset, offset + 2), 16) * multiplier).toString(16).padStart(2, '0')).join('');

export function FurnitureThumbnail({ preset }: { preset: FurniturePreset }) {
  const parts = getCatalogParts(preset.type, preset.id);
  const project = (point: number[]) => [(point[0] * preset.width - point[2] * preset.depth) * 0.84, -point[1] * preset.height * 0.95 + (point[0] * preset.width + point[2] * preset.depth) * 0.32];
  const corners = (part: CatalogPart) => {
    const [x, y, z] = part.at, [w, h, d] = part.size;
    return [[x - w / 2, y - h / 2, z - d / 2], [x + w / 2, y - h / 2, z - d / 2], [x + w / 2, y - h / 2, z + d / 2], [x - w / 2, y - h / 2, z + d / 2], [x - w / 2, y + h / 2, z - d / 2], [x + w / 2, y + h / 2, z - d / 2], [x + w / 2, y + h / 2, z + d / 2], [x - w / 2, y + h / 2, z + d / 2]];
  };
  const projected = parts.flatMap(part => corners(part).map(project));
  const left = Math.min(...projected.map(point => point[0])), right = Math.max(...projected.map(point => point[0]));
  const top = Math.min(...projected.map(point => point[1])), bottom = Math.max(...projected.map(point => point[1]));
  const scale = Math.min(128 / (right - left), 100 / (bottom - top));
  const map = (point: number[]) => { const [x, y] = project(point); return [80 + (x - (left + right) / 2) * scale, 57 + (y - (top + bottom) / 2) * scale]; };
  const polygon = (vertices: number[][]) => vertices.map(point => map(point).join(',')).join(' ');
  const ordered = [...parts].sort((a, b) => (a.at[0] * preset.width + a.at[2] * preset.depth + a.at[1] * 0.1) - (b.at[0] * preset.width + b.at[2] * preset.depth + b.at[1] * 0.1));
  return <svg viewBox="0 0 160 118" aria-hidden="true" focusable="false" className="furniture-thumbnail"><ellipse cx="80" cy="110" rx="52" ry="5" fill="#64715a" opacity=".1" />{ordered.map((part, index) => {
    const vertices = corners(part), color = colors[part.material];
    if (part.kind === 'ellipse') {
      const at = map(part.at), radiusX = part.size[0] * preset.width * scale * 0.42, radiusY = part.size[1] * preset.height * scale * 0.475;
      return <ellipse key={index} cx={at[0]} cy={at[1]} rx={radiusX} ry={radiusY} fill={color} stroke={shade(color, 0.78)} strokeWidth=".65" />;
    }
    if (part.kind === 'wedge') {
      const triangle = [vertices[0], vertices[1], vertices[3]], above = triangle.map(point => [point[0], point[1] + part.size[1], point[2]]);
      return <g key={index} stroke={shade(color, 0.78)} strokeWidth=".55" strokeLinejoin="round"><polygon points={polygon([triangle[1], triangle[2], above[2], above[1]])} fill={color} /><polygon points={polygon(above)} fill={shade(color, 1.05)} /></g>;
    }
    if (part.kind === 'cylinder' && part.axis === 'y') {
      const upper = map([part.at[0], part.at[1] + part.size[1] / 2, part.at[2]]), lower = map([part.at[0], part.at[1] - part.size[1] / 2, part.at[2]]);
      const radius = Math.hypot(part.size[0] * preset.width, part.size[2] * preset.depth) * scale * 0.42;
      const depth = Math.max(1, radius * 0.27);
      return <g key={index} stroke={shade(color, 0.78)} strokeWidth=".55"><path d={`M ${upper[0] - radius} ${upper[1]} L ${lower[0] - radius} ${lower[1]} A ${radius} ${depth} 0 0 0 ${lower[0] + radius} ${lower[1]} L ${upper[0] + radius} ${upper[1]} Z`} fill={color} /><ellipse cx={upper[0]} cy={upper[1]} rx={radius} ry={depth} fill={shade(color, 1.05)} /></g>;
    }
    return <g key={index} stroke={shade(color, 0.79)} strokeWidth=".55" strokeLinejoin="round"><polygon points={polygon([vertices[1], vertices[2], vertices[6], vertices[5]])} fill={shade(color, 0.87)} /><polygon points={polygon([vertices[2], vertices[3], vertices[7], vertices[6]])} fill={color} /><polygon points={polygon([vertices[4], vertices[5], vertices[6], vertices[7]])} fill={shade(color, 1.05)} /></g>;
  })}</svg>;
}

export default function FurnitureCatalog({ onSelect, category = 'wardrobe', onBack }: Props) {
  useLocale();
  const [active, setActive] = useState<FurnitureCategory>(category);
  useEffect(() => setActive(category), [category]);
  return <section className="furniture-catalog" aria-label={t('Catálogo de muebles')}><div className="catalog-navigation">{onBack && <button type="button" className="catalog-back" onClick={onBack}><ChevronLeft size={18} />{t('Elementos')}</button>}<nav className="catalog-categories" aria-label={t('Categoría de muebles')}>{(Object.keys(FURNITURE_CATEGORIES) as FurnitureCategory[]).map(type => <button type="button" key={type} aria-pressed={active === type} onClick={() => setActive(type)}>{t(FURNITURE_CATEGORIES[type])}</button>)}</nav></div><div className="catalog-models">{FURNITURE_CATALOG.filter(preset => preset.type === active).map(preset => <button type="button" key={preset.id} className="catalog-model" onClick={() => onSelect(preset)} aria-label={t('Agregar {{name}}', { name: t(preset.label) })}><FurnitureThumbnail preset={preset} /><span className="catalog-model-name">{t(preset.label)}</span><span className="catalog-model-size">{Math.round(preset.width * 100)} × {Math.round(preset.depth * 100)} × {Math.round(preset.height * 100)} cm</span></button>)}</div></section>;
}
