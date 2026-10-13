import { useState, type FormEvent } from 'react';
import { parseNumber } from './fieldDraft';
import { wallLength } from './model';
import type { Opening, Room } from './types';

export type OpeningValues = { wall: number; width: number; height: number; sill: number; doorStyle?: 'right' | 'left' | 'frame' };

export default function OpeningForm({ room, type, initialWall = 0, onCreate, onCancel }: { room: Room; type: Opening['type']; initialWall?: number; onCreate: (values: OpeningValues) => boolean; onCancel: () => void }) {
  const [wall, setWall] = useState(initialWall);
  const [width, setWidth] = useState(type === 'door' ? '0.9' : '1.5');
  const [height, setHeight] = useState('');
  const [sill, setSill] = useState('0.85');
  const [doorStyle, setDoorStyle] = useState<NonNullable<OpeningValues['doorStyle']>>('right');
  const [error, setError] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsedWidth = parseNumber(width, 0.3, wallLength(room, wall));
    const parsedHeight = parseNumber(height, 0.3, room.height);
    const parsedSill = type === 'door' ? 0 : parseNumber(sill, 0, room.height);
    if (parsedWidth === null) { setError('El ancho debe estar entre 0.3 y ' + Number(wallLength(room, wall).toFixed(2)) + ' m.'); return; }
    if (parsedHeight === null) { setError('Escribe una altura entre 0.3 y ' + room.height + ' m.'); return; }
    if (parsedSill === null || parsedSill + parsedHeight > room.height) { setError('La altura y la distancia desde el piso deben caber en el cuarto.'); return; }
    setError('');
    try {
      if (!onCreate({ wall, width: parsedWidth, height: parsedHeight, sill: parsedSill, ...(type === 'door' ? { doorStyle } : {}) })) setError('No se pudo agregar el elemento.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo agregar el elemento.'); }
  }

  return <form className="opening-create-form" onSubmit={submit}>
    <label className="select-field">Pared<select aria-label="Pared del nuevo elemento" value={wall} onChange={event => { setWall(Number(event.target.value)); setError(''); }}>{room.vertices.map((_, index) => <option key={index} value={index}>Pared {index + 1}</option>)}</select></label>
    <div className="dimensions-grid">
      <label className="number-field"><span>Ancho</span><div className="number-input"><input aria-label="Ancho del nuevo elemento" type="text" inputMode="decimal" required value={width} onChange={event => { setWidth(event.target.value); setError(''); }} /><span>m</span></div></label>
      <label className="number-field"><span>Altura</span><div className="number-input"><input aria-label="Altura del nuevo elemento" type="text" inputMode="decimal" required value={height} onChange={event => { setHeight(event.target.value); setError(''); }} /><span>m</span></div></label>
      {type === 'window' && <label className="number-field"><span>Altura desde piso</span><div className="number-input"><input aria-label="Altura desde piso del nuevo elemento" type="text" inputMode="decimal" required value={sill} onChange={event => { setSill(event.target.value); setError(''); }} /><span>m</span></div></label>}
    </div>
    {type === 'door' && <label className="select-field">Apertura<select aria-label="Apertura de la nueva puerta" value={doorStyle} onChange={event => setDoorStyle(event.target.value as NonNullable<OpeningValues['doorStyle']>)}><option value="right">Derecha</option><option value="left">Izquierda</option><option value="frame">Sólo marco</option></select></label>}
    {error && <p className="field-feedback" role="alert">{error}</p>}
    <div className="opening-form-actions"><button type="button" className="outline-button" onClick={onCancel}>Volver</button><button type="submit" className="primary-button">Agregar {type === 'door' ? 'puerta' : 'ventana'}</button></div>
  </form>;
}
