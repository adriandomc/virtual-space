import { Focus, Magnet, Move, PanelRight, Plus, Redo2, RotateCw, Scaling, Undo2 } from 'lucide-react';
import { t } from '../../shared/i18n/i18n';
import type { WorkshopPanel, WorkshopTool } from './workshopScene';

type Props = {
  ready: boolean;
  locked: boolean;
  saving: boolean;
  computing: boolean;
  canUndo: boolean;
  canRedo: boolean;
  tool: WorkshopTool;
  panel: WorkshopPanel;
  isMultiple: boolean;
  hasSelection: boolean;
  snapEnabled: boolean;
  hasPieces: boolean;
  panelOpen: boolean;
  onAdd: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onToolChange: (tool: WorkshopTool) => void;
  onSnapToggle: () => void;
  onCenter: () => void;
  onPanelToggle: () => void;
};

export default function WorkshopToolbar({ ready, locked, saving, computing, canUndo, canRedo, tool, panel, isMultiple, hasSelection, snapEnabled, hasPieces, panelOpen, onAdd, onUndo, onRedo, onToolChange, onSnapToggle, onCenter, onPanelToggle }: Props) {
  return <div className="workshop-tools" aria-label={t('Herramientas de modelo')}>
          <button type="button" className="workshop-add" onClick={onAdd} disabled={!ready || locked} aria-label={t('Agregar pieza')}><Plus size={18} /><span>{t('Agregar')}</span></button>
          <button type="button" aria-label={t('Deshacer')} title={t('Deshacer (Ctrl+Z)')} disabled={!ready || saving || computing || !canUndo} onClick={onUndo}><Undo2 size={20} /></button>
          <button type="button" aria-label={t('Rehacer')} title={t('Rehacer (Ctrl+Mayús+Z)')} disabled={!ready || locked || !canRedo} onClick={onRedo}><Redo2 size={20} /></button>
          {([['translate', Move, "Mover"], ['rotate', RotateCw, "Girar"], ['scale', Scaling, "Tamaño"]] as const).map(([mode, Icon, label]) => <button type="button" key={mode} aria-label={t(label)} title={t(label)} aria-pressed={tool === mode && panel !== 'geometry' && (!isMultiple || mode !== 'scale')} disabled={locked || panel === 'geometry' || !hasSelection || isMultiple && mode === 'scale'} onClick={() => onToolChange(mode)}><Icon size={20} /></button>)}
          <button type="button" className="workshop-snap" aria-label={t('Snap')} title={snapEnabled ? t('Desactivar snap') : t('Activar snap')} aria-pressed={snapEnabled} disabled={!ready || locked} onClick={onSnapToggle}><Magnet size={19} /><span>{t('Snap')}</span></button>
          <button type="button" className="workshop-center" aria-label={t('Centrar')} title={t('Centrar')} onClick={onCenter} disabled={!ready || !hasPieces}><Focus size={20} /><span>{t('Centrar')}</span></button><button type="button" aria-label={panelOpen ? t('Ocultar panel') : t('Mostrar panel')} title={panelOpen ? t('Ocultar panel') : t('Mostrar panel')} aria-expanded={panelOpen} aria-controls="workshop-panel" onClick={onPanelToggle}><PanelRight size={20} /></button>
        </div>;
}
