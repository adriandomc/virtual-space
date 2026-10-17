import { MousePointer2, PaintBucket } from 'lucide-react';
import { t } from '../../shared/i18n/i18n';
import ColorPicker from '../../shared/ui/ColorPicker';
import './paintToolbar.css';

type Props = { active: boolean; color: string; colors: string[]; disabled?: boolean; onModeChange: (active: boolean) => void; onColorChange: (color: string) => void };

export default function PaintToolbar({ active, color, colors, disabled, onModeChange, onColorChange }: Props) {
  return <div className="paint-toolbar" role="group" aria-label={t('Herramientas de pintura')}>
    <button type="button" className={!active ? 'active' : ''} aria-label={t('Seleccionar')} title={t('Seleccionar')} aria-pressed={!active} onClick={() => onModeChange(false)}><MousePointer2 size={20} /></button>
    <button type="button" className={active ? 'active' : ''} disabled={disabled} aria-label={t('Cubeta de pintura')} title={t('Cubeta de pintura')} aria-pressed={active} onClick={() => onModeChange(true)}><PaintBucket size={20} /></button>
    <ColorPicker compact label={t('Color principal')} value={color} colors={colors} disabled={disabled} onChange={onColorChange} />
  </div>;
}
