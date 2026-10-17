import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { ChevronDown, Grid2X2, Layers3 } from 'lucide-react';
import { ceilingFinishTargets, type ProjectDocument, type ProjectLevel } from '../../domain/project/projectDocument';
import type { Selection } from '../../domain/project/types';
import { t, useLocale } from '../../shared/i18n/i18n';
import { wallName } from './editorLabels';
import { closestSurfaceWall, surfaceMap } from './surfaceNavigation';
import './surfaceNavigator.css';

type Props = { project: ProjectDocument; activeLevelId: string; selection: Selection | null; wallSide: 'left' | 'right'; onSelect: (levelId: string, selection: Selection) => void };

export default function SurfaceNavigator({ project, activeLevelId, selection, wallSide, onSelect }: Props) {
  useLocale();
  const [expanded, setExpanded] = useState(() => new Set([activeLevelId]));
  useEffect(() => { setExpanded(previous => new Set([...previous, activeLevelId])); }, [activeLevelId]);
  return <nav className="surface-navigator" aria-label={t('Superficies por nivel')}>
    {project.levels.map(level => <details key={level.id} open={expanded.has(level.id)} className={'surface-level ' + (activeLevelId === level.id ? 'active' : '')} onToggle={event => {
      const open = event.currentTarget.open;
      setExpanded(previous => { if (previous.has(level.id) === open) return previous; const next = new Set(previous); if (open) next.add(level.id); else next.delete(level.id); return next; });
    }}>
      <summary><ChevronDown size={16} /><Layers3 size={17} /><span>{level.name}</span>{activeLevelId === level.id && <span className="surface-level-current">{t('Nivel activo')}</span>}</summary>
      {expanded.has(level.id) && <LevelSurfaces project={project} level={level} selection={activeLevelId === level.id ? selection : null} wallSide={wallSide} onSelect={selection => onSelect(level.id, selection)} />}
    </details>)}
  </nav>;
}

function LevelSurfaces({ project, level, selection, wallSide, onSelect }: { project: ProjectDocument; level: ProjectLevel; selection: Selection | null; wallSide: 'left' | 'right'; onSelect: (selection: Selection) => void }) {
  const map = surfaceMap(level), svgRef = useRef<SVGSVGElement>(null);
  const selectedWall = selection?.kind === 'wall' ? selection.id ?? level.walls[selection.index]?.id : undefined;
  const selectedIndex = map.walls.findIndex(wall => wall.id === selectedWall);
  const wallSelection = (index: number): Selection => ({ kind: 'wall', index, id: map.walls[index].id });
  function pick(event: MouseEvent<SVGElement>, floorId?: string) {
    event.stopPropagation();
    const svg = svgRef.current, matrix = svg?.getScreenCTM(); if (!svg || !matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const wall = closestSurfaceWall(map, { x: point.x, z: point.y }, 22 / Math.hypot(matrix.a, matrix.b));
    if (wall) onSelect(wallSelection(wall.index));
    else if (floorId) onSelect({ kind: 'floor', id: floorId });
  }
  function keyboard(event: KeyboardEvent<SVGGElement>, index: number) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); onSelect(wallSelection(index)); return; }
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? map.walls.length - 1 : ['ArrowRight', 'ArrowDown'].includes(event.key) ? (index + 1) % map.walls.length : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? (index + map.walls.length - 1) % map.walls.length : -1;
    if (next < 0) return;
    event.preventDefault(); event.stopPropagation();
    svgRef.current?.querySelectorAll<SVGGElement>('[data-surface-wall]')[next]?.focus();
  }
  return <div className="surface-level-body">
    {!!map.walls.length && <span className="surface-map-instruction">{t('Toca una pared en la planta')}</span>}
    <svg ref={svgRef} className="surface-map" viewBox={`0 0 ${map.width} ${map.height}`} aria-label={t('Superficies de {{level}}', { level: level.name })} onClick={pick}>
      {map.floors.map(floor => <path key={floor.id} d={floor.path} fill={floor.color} fillRule="evenodd" className={'surface-map-floor ' + (selection?.kind === 'floor' && (!selection.id || selection.id === floor.id) ? 'selected' : '')} onClick={event => pick(event, floor.id)} />)}
      {map.walls.map((wall, index) => <g key={wall.id} role="button" tabIndex={selectedIndex === index || selectedIndex < 0 && index === 0 ? 0 : -1} aria-label={t('{{wall}} · {{level}} · {{side}}', { wall: wallName(index), level: level.name, side: t(wallSide === 'left' ? 'Lado izquierdo' : 'Lado derecho') })} aria-pressed={wall.id === selectedWall} data-surface-wall={wall.id} className={wall.id === selectedWall ? 'selected' : ''} onKeyDown={event => keyboard(event, index)} onClick={event => { if (!event.detail) { event.stopPropagation(); onSelect(wallSelection(index)); } }}>
        <line className="surface-map-wall-hit" x1={wall.start.x} y1={wall.start.z} x2={wall.end.x} y2={wall.end.z} />
        <line className="surface-map-wall-outline" x1={wall.start.x} y1={wall.start.z} x2={wall.end.x} y2={wall.end.z} />
        <line className="surface-map-wall-color" style={{ stroke: level.walls[index][wallSide].color }} x1={wall.start.x} y1={wall.start.z} x2={wall.end.x} y2={wall.end.z} />
      </g>)}
    </svg>
    <div className="surface-level-tabs">
      <button type="button" aria-pressed={selection?.kind === 'floor'} onClick={() => onSelect({ kind: 'floor', id: map.floors[0]?.id })}><Grid2X2 size={17} />{t('Piso')}</button>
      <button type="button" disabled={!ceilingFinishTargets(project, level.id).length} aria-pressed={selection?.kind === 'ceiling'} onClick={() => onSelect({ kind: 'ceiling', id: ceilingFinishTargets(project, level.id)[0]?.id })}><Layers3 size={17} />{t('Techo')}</button>
    </div>
    {selectedIndex >= 0 && <div className="surface-current-wall" role="status"><span style={{ background: level.walls[selectedIndex][wallSide].color }} /><strong>{wallName(selectedIndex)}</strong><span>{Number(map.walls[selectedIndex].length.toFixed(2))} m</span></div>}
    {!!map.walls.length && <details className="surface-wall-list"><summary>{t('Lista de paredes')}</summary><div>{map.walls.map((wall, index) => <button key={wall.id} type="button" aria-pressed={wall.id === selectedWall} onClick={() => onSelect(wallSelection(index))}><span style={{ background: level.walls[index][wallSide].color }} />{wallName(index)}</button>)}</div></details>}
  </div>;
}
