import { ArrowDownToLine, ArrowUpFromLine, Magnet, Shield } from 'lucide-react';
import { t, useLocale } from '../../shared/i18n/i18n';
import type { Room } from '../../domain/project/types';
import type { RoomSceneProps } from '../viewer/sceneRuntime';
import { NumberField, Section } from './propertyControls';

type Props = {
  room: Room;
  readOnly: boolean;
  presentation: NonNullable<RoomSceneProps['presentation']>;
  setPresentation: (presentation: NonNullable<RoomSceneProps['presentation']>) => void;
  change: (room: Room) => boolean;
  setBounds: (enabled: boolean) => void;
  onImport: () => void;
  onExport: () => void;
};

export default function EditorViewOptions({ room, readOnly, presentation, setPresentation, change, setBounds, onImport, onExport }: Props) {
  useLocale();
  return <div className="view-options-content">
        <fieldset disabled={readOnly} className="property-fields"><Section title={t("Calidad visual")}><div className="quality-switch" role="group" aria-label={t("Calidad visual")}>{(['standard', 'realistic', 'hyperrealistic'] as const).map(quality => <button key={quality} aria-pressed={room.renderQuality === quality} className={room.renderQuality === quality ? 'active' : ''} onClick={() => change({ ...room, renderQuality: quality })}>{quality === 'standard' ? t("Estándar") : quality === 'realistic' ? t("Realista") : t("Hiperrealista")}</button>)}</div></Section><Section title={t("Movimiento")} defaultOpen={false}><label className="check-field"><input type="checkbox" checked={room.editing.snap} onChange={event => change({ ...room, editing: { ...room.editing, snap: event.target.checked } })} /><Magnet size={17} />{t("Ajustar a cuadrícula")}</label><NumberField label={t("Paso de ajuste")} value={room.editing.step} min={0.01} max={1} step={0.01} onChange={step => change({ ...room, editing: { ...room.editing, step } })} /><label className="check-field"><input type="checkbox" checked={room.editing.bounds} onChange={event => setBounds(event.target.checked)} /><Shield size={17} />{t("Ajustar luces al cuarto")}</label></Section></fieldset>
        <Section title={t('Visibilidad')}><div className="presentation-controls"><label>{t('Paredes')}<select aria-label={t('Vista de paredes')} value={presentation.walls} onChange={event => setPresentation({ ...presentation, walls: event.target.value as typeof presentation.walls })}><option value="full">{t('Completas')}</option><option value="cut">{t('Recortadas')}</option><option value="hidden">{t('Ocultas')}</option></select></label><label><input type="checkbox" checked={presentation.roofs} onChange={event => setPresentation({ ...presentation, roofs: event.target.checked })} />{t('Mostrar cubiertas')}</label><label>{t('Niveles visibles')}<select aria-label={t('Niveles visibles')} value={presentation.levels} onChange={event => setPresentation({ ...presentation, levels: event.target.value as typeof presentation.levels })}><option value="active">{t('Nivel activo')}</option><option value="below">{t('Niveles inferiores')}</option><option value="all">{t('Edificio completo')}</option></select></label></div></Section>
        <div className="mobile-file-actions mobile-only"><button className="view-options-help" disabled={readOnly} onClick={() => { onImport(); }}><ArrowUpFromLine size={18} />{t("Abrir proyecto")}</button><button className="view-options-help" onClick={() => { onExport(); }}><ArrowDownToLine size={18} />{t("Descargar copia")}</button></div>
      </div>;
}
