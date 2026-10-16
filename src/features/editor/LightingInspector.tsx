import { Lightbulb, Plus, Sun } from 'lucide-react';
import { t, useLocale } from '../../shared/i18n/i18n';
import type { Room, Selection } from '../../domain/project/types';
import { Section, Slider, Switch } from './propertyControls';

const timeLabel = (hour: number) => String(Math.floor(hour)).padStart(2, '0') + ':' + String(Math.round((hour % 1) * 60)).padStart(2, '0');

type Props = {
  room: Room;
  readOnly: boolean;
  change: (next: Room) => boolean;
  select: (selection: Selection, properties: boolean) => void;
  addLight: () => void;
};

export default function LightingInspector({ room, readOnly, change, select, addLight }: Props) {
  useLocale();
  return <>
    <fieldset disabled={readOnly} className="property-fields"><Section title={t("Sol")}><div className="setting-row"><span>{t("Luz del sol")}</span><Switch label={t("Activar luz del sol")} checked={room.sun.enabled} onChange={enabled => change({ ...room, sun: { ...room.sun, enabled } })} /></div>
      <div className="time-card"><Sun size={23} /><strong>{timeLabel(room.sun.hour)}</strong></div><Slider label={t("Hora del día")} value={room.sun.hour} min={0} max={24} step={0.25} unit="h" onChange={hour => change({ ...room, sun: { ...room.sun, hour } })} />
    </Section><Section title={t("Ajustes del sol")} defaultOpen={false}><Slider label={t("Orientación")} value={room.sun.azimuth} min={0} max={360} unit="°" onChange={azimuth => change({ ...room, sun: { ...room.sun, azimuth } })} /><Slider label={t("Intensidad solar")} value={room.sun.intensity} min={0} max={10} step={0.1} unit="×" onChange={intensity => change({ ...room, sun: { ...room.sun, intensity } })} /></Section></fieldset>
    <Section title={t("Focos")}>{room.lights.map(item => <div className="light-list-row" key={item.id}><button onClick={() => select({ kind: 'light', id: item.id }, true)}><Lightbulb size={16} />{item.name}</button><Switch label={t('Encender {{name}}', { name: item.name })} disabled={readOnly} checked={item.enabled} onChange={enabled => change({ ...room, lights: room.lights.map(value => value.id === item.id ? { ...value, enabled } : value) })} /></div>)}<button disabled={readOnly} className="outline-button full-width" onClick={() => addLight()}><Plus size={14} />{t("Agregar foco")}</button></Section>
  </>;
}
