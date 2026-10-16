import { t, useLocale } from './i18n';
import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { FurnitureItem, ModelPart } from './types';
import { modelMetadata, type ModelAsset } from './customModel';
import NumberInput from './NumberInput';
import ColorPicker from './ColorPicker';
import './customModel.css';

type Props = { item: FurnitureItem; roomId?: string; onChange: (item: FurnitureItem) => void; onPreview?: (item: FurnitureItem | null) => void; revision?: unknown; colors?: string[]; readOnly?: boolean; notify?: (message: string) => void };
export default function CustomModelEditor({ item, roomId, onChange, onPreview, revision, colors, readOnly = false, notify }: Props) {
  useLocale();
  const [metadata, setMetadata] = useState<ModelAsset | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    setMetadata(null); setSelected(''); setError('');
    if (item.assetId) void modelMetadata(item.assetId, roomId).then(model => {
      if (current) { setMetadata(model); setSelected(model.nodes.find(node => node.mesh)?.key ?? model.nodes[0]?.key ?? ''); }
    }).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : "No se pudo cargar el modelo."); });
    return () => { current = false; };
  }, [item.assetId, roomId]);
  const part = item.parts?.[selected] ?? {};
  const report = (message: string) => { setError(message); notify?.(t(message)); };
  const change = (patch: Partial<ModelPart>) => {
    if (readOnly || !selected) return;
    setError('');
    onChange({ ...item, parts: { ...item.parts, [selected]: { ...part, ...patch } } });
  };
  const reset = () => {
    if (readOnly) return;
    const next = { ...item.parts }; delete next[selected];
    onChange({ ...item, parts: Object.keys(next).length ? next : undefined });
  };
  const controls = (kind: 'position' | 'rotation' | 'scale', label: string, fallback: number, min: number, max: number, step: number) => <fieldset className="model-part-vector"><legend>{label}</legend>{(['x', 'y', 'z'] as const).map(axis => <label key={axis}><span>{axis.toUpperCase()}</span><NumberInput label={`${label} ${axis.toUpperCase()}`} value={part[kind]?.[axis] ?? fallback} min={min} max={max} step={step} onChange={value => change({ [kind]: { x: fallback, y: fallback, z: fallback, ...part[kind], [axis]: value } })} onEdit={() => setError('')} onInvalid={() => report('Escribe un valor válido. Se conservó el anterior.')} /></label>)}</fieldset>;
  return <details className="custom-model-editor">
    <summary>{t('Partes del modelo')}</summary>
    {error && <p role="status" className="model-part-error">{t(error)}</p>}
    {!metadata && !error && <p role="status">{t('Cargando…')}</p>}
    {metadata && <fieldset disabled={readOnly} className="model-part-fields">
      <label>{t('Parte')}<select value={selected} onChange={event => { setSelected(event.target.value); setError(''); }}>{metadata.nodes.map(node => <option key={node.key} value={node.key}>{node.generatedName === true ? t('Parte {{number}}', { number: Number(node.key) + 1 }) : node.name}</option>)}</select></label>
      <label className="model-part-visible"><input type="checkbox" checked={part.visible !== false} onChange={event => change({ visible: event.target.checked })} />{t('Visible')}</label>
      <label>{t('Material')}<select value={part.material ?? ''} onChange={event => change({ material: event.target.value ? event.target.value as ModelPart['material'] : undefined })}><option value="">{t('Original')}</option><option value="wood">{t('Madera')}</option><option value="plastic">{t('Plástico')}</option><option value="metal">{t('Metal')}</option></select></label>
      <div className="model-part-color-section" role="group" aria-label={t('Color de la parte')}><label className="model-part-visible"><input type="checkbox" checked={part.color === undefined} onChange={event => change({ color: event.target.checked ? undefined : item.color ?? '#ffffff' })} />{t('Color original')}</label>{part.color !== undefined && <ColorPicker key={item.id + selected} label={t('Color de la parte')} value={part.color} revision={revision ?? item} disabled={readOnly} colors={colors} onChange={color => change({ color })} onPreview={color => onPreview?.(color ? { ...item, parts: { ...item.parts, [selected]: { ...part, color } } } : null)} />}</div>
      <details className="model-part-transforms"><summary>{t('Posición y tamaño')}</summary>{controls('position', t('Desplazamiento'), 0, -20, 20, 0.1)}{controls('rotation', t('Rotación'), 0, -360, 360, 15)}{controls('scale', t('Escala'), 1, 0.1, 10, 0.1)}</details>
      <button type="button" onClick={reset} className="model-part-reset"><RotateCcw size={16} />{t('Restablecer parte')}</button>
    </fieldset>}
  </details>;
}
