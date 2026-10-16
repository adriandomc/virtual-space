import { t, useLocale } from './i18n';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ArrowLeft, Box, Download, LoaderCircle, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { copyModel, deleteModel, listModels, uploadModel, type ModelAsset } from './customModel';
import { loadLibraryModelBlob } from './offlineAssets';
import './modelLibrary.css';

type Props = { roomId: string; canManage?: boolean; disabled?: boolean; onSelect: (asset: ModelAsset) => void; onCreate: () => void; onBack?: () => void };
export default function ModelLibrary(props: Props) {
  useLocale();
  const { roomId, canManage = false, disabled = false, onSelect, onCreate, onBack } = props;
  const latest = useRef(props); latest.current = props;
  const active = useRef(true), fileInput = useRef<HTMLInputElement>(null), requestId = useRef(0);
  const [models, setModels] = useState<ModelAsset[]>([]);
  const [scope, setScope] = useState<'room' | 'mine'>('room');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const refresh = async () => {
    const sequence = ++requestId.current;
    setLoading(true); setError('');
    try { const items = await listModels(roomId, scope); if (active.current && sequence === requestId.current) setModels(items); }
    catch (cause) { if (active.current && sequence === requestId.current) setError(cause instanceof Error ? cause.message : "No se pudo cargar la biblioteca."); }
    finally { if (active.current && sequence === requestId.current) setLoading(false); }
  };
  useEffect(() => {
    active.current = true; setModels([]); setBusy(false); void refresh();
    return () => { active.current = false; requestId.current++; };
  }, [roomId, scope]);
  const select = async (asset: ModelAsset) => {
    if (disabled || busy) return;
    if (!asset.roomId || asset.roomId === roomId) { onSelect(asset); return; }
    setBusy(true); setError('');
    try {
      const copy = await copyModel(asset, roomId);
      if (active.current && latest.current.roomId === roomId && !latest.current.disabled) latest.current.onSelect(copy);
    } catch (cause) { if (active.current && latest.current.roomId === roomId) setError(cause instanceof Error ? cause.message : "No se pudo copiar el modelo."); }
    finally { if (active.current && latest.current.roomId === roomId) setBusy(false); }
  };
  const upload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || disabled || busy || loading) return;
    setBusy(true); setError('');
    try {
      const asset = await uploadModel(file, roomId);
      if (active.current && latest.current.roomId === roomId) {
        setModels(items => [asset, ...items]);
        if (!latest.current.disabled) latest.current.onSelect(asset);
      }
    } catch (cause) { if (active.current && latest.current.roomId === roomId) setError(cause instanceof Error ? cause.message : "No se pudo subir el modelo."); }
    finally { if (active.current && latest.current.roomId === roomId) setBusy(false); }
  };
  const remove = async (asset: ModelAsset) => {
    if (disabled || busy || !canManage || !window.confirm(t('¿Eliminar «{{name}}»? Esta acción no se puede deshacer.', { name: asset.name }))) return;
    setBusy(true); setError('');
    try { await deleteModel(asset.id); if (active.current) setModels(items => items.filter(item => item.id !== asset.id)); }
    catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "No se pudo eliminar el modelo."); }
    finally { if (active.current) setBusy(false); }
  };
  const download = async (asset: ModelAsset) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const blob = await loadLibraryModelBlob(asset, roomId);
      if (!active.current || latest.current.roomId !== roomId) return;
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = asset.name + '.glb'; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : "No se pudo descargar el modelo."); }
    finally { if (active.current) setBusy(false); }
  };
  return <section className="model-library" aria-label={t('Mis modelos')}>
    <div className="model-library-heading">{onBack && <button type="button" onClick={onBack} aria-label={t('Volver')} className="model-library-icon"><ArrowLeft size={20} /></button>}<h3>{t('Modelos')}</h3><button type="button" onClick={() => void refresh()} disabled={busy || loading} aria-label={t('Actualizar modelos')} className="model-library-icon"><RefreshCw size={18} /></button></div>
    <div className="model-library-tabs" aria-label={t('Biblioteca de modelos')}><button type="button" aria-pressed={scope === 'room'} disabled={busy} onClick={() => setScope('room')}>{t('Este diseño')}</button><button type="button" aria-pressed={scope === 'mine'} disabled={busy} onClick={() => setScope('mine')}>{t('Mis modelos')}</button></div>
    <div className="model-library-actions"><button type="button" onClick={() => fileInput.current?.click()} disabled={disabled || busy || loading}><Upload size={18} />{busy ? t('Guardando…') : t('Subir modelo')}</button><button type="button" onClick={onCreate} disabled={disabled || busy}><Plus size={18} />{t('Crear modelo')}</button></div>
    <span className="model-library-filetype">.glb · 20 MB</span>
    <input ref={fileInput} type="file" accept=".glb,model/gltf-binary" onChange={event => void upload(event)} hidden disabled={disabled || busy || loading} aria-label={t('Subir modelo GLB')} />
    {error && <p className="model-library-error" role="alert">{t(error)}<button type="button" onClick={() => void refresh()} disabled={busy || loading}>{t('Reintentar')}</button></p>}
    {loading && <p className="model-library-loading" role="status"><LoaderCircle size={20} />{t('Cargando…')}</p>}
    {!loading && !error && !models.length && <p className="model-library-empty">{t('Aún no hay modelos.')}</p>}
    <ul className="model-library-list">{models.map(asset => <li key={asset.id} className="model-library-card"><button type="button" className="model-library-select" onClick={() => void select(asset)} disabled={disabled || busy} aria-label={t('Añadir {{name}}', { name: asset.name })}><span className="model-library-preview"><Box size={28} strokeWidth={1.4} /></span><span>{asset.name}</span><Plus size={18} /></button><div className="model-library-card-actions"><button type="button" onClick={() => void download(asset)} disabled={busy} aria-label={t('Descargar {{name}}', { name: asset.name })} className="model-library-icon"><Download size={18} /></button>{canManage && <button type="button" onClick={() => void remove(asset)} disabled={disabled || busy} aria-label={t('Eliminar {{name}}', { name: asset.name })} className="model-library-icon"><Trash2 size={18} /></button>}</div></li>)}</ul>
  </section>;
}
