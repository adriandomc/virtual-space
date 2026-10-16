import { t } from '../../shared/i18n/i18n';
import { BED_SIZES, FURNITURE_LABELS } from '../../domain/project/model';
import { getFurniturePreset } from '../../domain/models/furnitureCatalog';
import type { FurnitureItem } from '../../domain/project/types';

export const wallName = (index: number) => t('Pared {{number}}', { number: String(index + 1).padStart(2, '0') });
export const furnitureName = (item: FurnitureItem) => item.type === 'custom' ? item.name ?? t("Modelo") : item.type === 'bed' ? t('Cama {{size}}', { size: t(BED_SIZES[item.bedSize!].label).toLowerCase() }) : t(FURNITURE_LABELS[item.type]) + (item.variant ? ' · ' + t(getFurniturePreset(item.type, item.variant)?.label ?? '') : '');
