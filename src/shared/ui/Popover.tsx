import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import './popover.css';

type Props = { label: string; trigger: ReactNode; children: (close: () => void) => ReactNode; className?: string; triggerClassName?: string; rootClassName?: string; role?: 'dialog' | 'menu' | 'navigation'; disabled?: boolean; onOpenChange?: (open: boolean) => void };

export default function Popover({ label, trigger: icon, children, className = '', triggerClassName = '', rootClassName = '', role = 'dialog', disabled = false, onOpenChange }: Props) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null), [open, setOpen] = useState(false);
  const changeRef = useRef(onOpenChange), isOpen = useRef(false); changeRef.current = onOpenChange;
  const show = () => { isOpen.current = true; setOpen(true); changeRef.current?.(true); };
  const close = useCallback((focus = true) => { if (!isOpen.current) return; isOpen.current = false; setOpen(false); changeRef.current?.(false); if (panel.current && typeof panel.current.hidePopover === 'function' && panel.current.matches(':popover-open')) panel.current.hidePopover(); if (focus) requestAnimationFrame(() => { if (!isOpen.current) trigger.current?.focus(); }); }, []);
  useEffect(() => { if (disabled && open) close(); }, [disabled, open, close]);
  useLayoutEffect(() => {
    if (!open) return;
    const element = panel.current; if (!element) return;
    if (typeof element.showPopover === 'function') element.showPopover();
    if (role === 'menu') element.querySelector<HTMLElement>('a[href],button:not(:disabled),[role=menuitem]')?.focus();
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect(); if (!anchor) return;
      const viewport = window.visualViewport, left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0, width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
      element.style.setProperty('--popover-viewport-height', height + 'px'); element.style.setProperty('--popover-viewport-bottom', top + height + 'px');
      const rect = element.getBoundingClientRect();
      element.style.left = Math.max(left + 8, Math.min(anchor.left, left + width - rect.width - 8)) + 'px';
      element.style.top = Math.max(top + 8, Math.min(anchor.bottom + 6, top + height - rect.height - 8)) + 'px';
      element.style.maxHeight = Math.max(44, height - 16) + 'px';
    };
    place(); window.addEventListener('resize', place); window.addEventListener('scroll', place, true); window.visualViewport?.addEventListener('resize', place); window.visualViewport?.addEventListener('scroll', place);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); window.visualViewport?.removeEventListener('resize', place); window.visualViewport?.removeEventListener('scroll', place); };
  }, [open, role]);
  useEffect(() => {
    if (!open) return;
    let swallowClick = false;
    const outside = (event: PointerEvent) => {
      const target = event.target; if (!(target instanceof Element)) return;
      if (panel.current?.contains(target) || trigger.current?.contains(target)) return;
      // Dismissing over the canvas must not also select, draw, or start moving the scene.
      if (target.closest('.plan-canvas, .room-scene')) { swallowClick = true; event.preventDefault(); event.stopImmediatePropagation(); }
      close(false);
    };
    const click = (event: MouseEvent) => { if (swallowClick) { event.preventDefault(); event.stopImmediatePropagation(); swallowClick = false; } };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('click', click, true); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape, true); if (swallowClick) document.addEventListener('click', () => document.removeEventListener('click', click, true), { once: true, capture: true }); else document.removeEventListener('click', click, true); };
  }, [open, close]);
  const menuFocus = (key: string) => {
    const choices = [...(panel.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),[role=menuitem]') ?? [])]; if (!choices.length) return;
    const index = choices.indexOf(document.activeElement as HTMLElement), next = key === 'Home' ? 0 : key === 'End' ? choices.length - 1 : (index + (key === 'ArrowUp' ? -1 : 1) + choices.length) % choices.length;
    choices[next].focus();
  };
  // Safari can blur to no target on pointerdown; keep the item mounted until its click runs.
  return <span className={'transient-popover-root ' + rootClassName}><button ref={trigger} type="button" className={triggerClassName} aria-label={label} title={label} aria-controls={id} aria-expanded={open} aria-haspopup={role === 'navigation' ? undefined : role} disabled={disabled} onClick={() => open ? close() : show()} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (!open) show(); requestAnimationFrame(() => menuFocus(event.key === 'ArrowUp' ? 'End' : 'Home')); } }}>{icon}</button>{open && <div id={id} ref={panel} popover={typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.showPopover === 'function' ? 'auto' : undefined} className={'transient-popover ' + className} role={role} aria-label={label} onToggle={event => { if ((event as unknown as { newState: string }).newState === 'closed') close(false); }} onBlur={event => { if (role !== 'dialog' && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node | null) && !trigger.current?.contains(event.relatedTarget as Node | null)) close(false); }} onKeyDown={event => { if (role === 'menu' && ['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) { event.preventDefault(); menuFocus(event.key); } }}>{children(() => close())}</div>}</span>;
}
