import { SlidersHorizontal } from 'lucide-react';
import { t, useLocale } from './i18n';
import { getGraphicsProfile, resetGraphicsSettings, setGraphicsMode, setGraphicsPreferences, useGraphicsSettings, type GraphicsKey, type GraphicsProfile } from './graphicsSettings';
import './scene.css';

export default function GraphicsSettings() {
  useLocale();
  const preferences = useGraphicsSettings(), profile = getGraphicsProfile();
  const field = <K extends GraphicsKey>(key: K, label: string, options: { value: GraphicsProfile[K]; label: string }[]) => <label className="graphics-field"><span>{t(label)}</span><select aria-label={t(label)} value={String(preferences[key])} onChange={event => {
    const option = options.find(option => String(option.value) === event.target.value);
    setGraphicsPreferences({ ...preferences, [key]: option ? option.value : 'auto' });
  }}><option value="auto">{t('Automático')} · {options.find(option => option.value === profile[key])?.label}</option>{options.map(option => <option key={String(option.value)} value={String(option.value)}>{option.label}</option>)}</select></label>;
  return <section className="graphics-settings" aria-labelledby="graphics-heading"><h3 id="graphics-heading"><SlidersHorizontal size={19} />{t('Gráficos')}</h3>
    <p>{t('Estos ajustes se guardan solo en este dispositivo.')}</p>
    <div className="graphics-mode" role="group" aria-label={t('Ajuste de gráficos')}><button type="button" aria-pressed={preferences.mode === 'auto'} onClick={() => setGraphicsMode('auto')}>{t('Automático')}</button><button type="button" aria-pressed={preferences.mode === 'manual'} onClick={() => setGraphicsMode('manual')}>{t('Manual')}</button></div>
    <p className="graphics-note">{t('En automático puedes fijar opciones concretas. Las demás se adaptan al dispositivo.')}</p>
    {field('shadows', 'Sombras', [{ value: 0, label: t('Desactivadas') }, { value: 512, label: t('Bajas') }, { value: 1024, label: t('Medias') }, { value: 2048, label: t('Altas') }])}
    {field('textures', 'Resolución de texturas', [{ value: 512, label: t('Baja ({{size}})', { size: 512 }) }, { value: 1024, label: t('Media ({{size}})', { size: 1024 }) }, { value: 2048, label: t('Alta ({{size}})', { size: 2048 }) }])}
    {field('renderScale', 'Escala de renderizado', ([0.5, 0.75, 1] as const).map(value => ({ value, label: Math.round(value * 100) + '%' })))}
    {field('geometry', 'Detalle de geometría', [{ value: 'low', label: t('Bajo') }, { value: 'medium', label: t('Medio') }, { value: 'high', label: t('Detalle alto') }])}
    {field('distance', 'Distancia de detalle', [{ value: 40, label: t('Cerca') }, { value: 80, label: t('Media') }, { value: 160, label: t('Lejos') }])}
    {field('ao', 'Sombras de contacto', [{ value: 'off', label: t('Desactivadas') }, { value: 'low', label: t('Bajas') }, { value: 'medium', label: t('Medias') }, { value: 'high', label: t('Altas') }])}
    {field('fps', 'Límite de fotogramas', [{ value: 30, label: '30' }, { value: 60, label: '60' }, { value: 0, label: t('Sin límite') }])}
    <button type="button" className="outline-button full-width" onClick={resetGraphicsSettings}>{t('Restablecer gráficos')}</button>
  </section>;
}
