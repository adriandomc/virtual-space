import { MousePointer2, PaintBucket, Pipette } from 'lucide-react';
import { t } from '../../shared/i18n/i18n';
import ColorPicker from '../../shared/ui/ColorPicker';
import type { PaintToolMode } from './usePaintTool';
import './paintToolbar.css';

type Props = { mode: PaintToolMode; color: string; colors: string[]; disabled?: boolean; onModeChange: (mode: PaintToolMode) => void; onColorChange: (color: string) => void };

export default function PaintToolbar({ mode, color, colors, disabled, onModeChange, onColorChange }: Props) {
  return <div className="paint-toolbar" role="group" aria-label={t('Herramientas de pintura')}>
    <button type="button" className={mode === 'select' ? 'active' : ''} aria-label={t('Seleccionar')} title={t('Seleccionar')} aria-pressed={mode === 'select'} onClick={() => onModeChange('select')}><MousePointer2 size={20} /></button>
    <button type="button" className={mode === 'paint' ? 'active' : ''} disabled={disabled} aria-label={t('Cubeta de pintura')} title={t('Cubeta de pintura')} aria-pressed={mode === 'paint'} onClick={() => onModeChange('paint')}><PaintBucket size={20} /></button>
    <button type="button" className={mode === 'sample' ? 'active' : ''} disabled={disabled} aria-label={t('Cuentagotas')} title={t('Cuentagotas')} aria-pressed={mode === 'sample'} onClick={() => onModeChange('sample')}><Pipette size={20} /></button>
    <ColorPicker compact label={t('Color principal')} value={color} colors={colors} disabled={disabled} onChange={onColorChange} />
  </div>;
}
