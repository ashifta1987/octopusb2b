'use client';

import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { cx } from '../cx';

const SIDE: Record<'top' | 'bottom' | 'end' | 'start', string> = {
  top: 'bottom-full mb-2 start-1/2 -translate-x-1/2 rtl:translate-x-1/2',
  bottom: 'top-full mt-2 start-1/2 -translate-x-1/2 rtl:translate-x-1/2',
  end: 'start-full ms-2 top-1/2 -translate-y-1/2',
  start: 'end-full me-2 top-1/2 -translate-y-1/2',
};

/**
 * Tooltip (2.5): on hover AND keyboard focus, after 300 ms; Esc hides it. The trigger gets aria-describedby (skipped
 * when the tooltip only repeats the trigger's aria-label, so screen readers don't hear it twice).
 * WCAG 1.4.13: the tooltip itself is hoverable (moving the pointer onto it keeps it open, with a short grace period
 * across the gap) and dismissible with Esc.
 * Never put essential information only in a tooltip. Phones: hover doesn't exist, so content must also be on screen
 * (icon buttons already carry aria-label; collapsed sidebars expand on phones instead).
 */
export function Tooltip({ content, side = 'top', delay = 300, children, disabled }: { content: ReactNode; side?: keyof typeof SIDE; delay?: number; children: ReactElement; disabled?: boolean }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = () => {
    if (disabled) return;
    clear();
    timer.current = setTimeout(() => setOpen(true), open ? 0 : delay);
  };
  const hide = (grace = 0) => {
    clear();
    if (grace) timer.current = setTimeout(() => setOpen(false), grace);
    else setOpen(false);
  };
  useEffect(() => () => clear(), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  if (!isValidElement(children)) return children;
  const child = children as ReactElement<{ 'aria-describedby'?: string; 'aria-label'?: string }>;
  const duplicate = typeof content === 'string' && child.props['aria-label'] === content;
  const trigger = cloneElement(child, { 'aria-describedby': cx(child.props['aria-describedby'], !disabled && !duplicate && id) || undefined });
  return (
    <span className="relative inline-flex" onPointerEnter={show} onPointerLeave={() => hide(120)} onFocus={show} onBlur={() => hide()}>
      {trigger}
      <span
        role="tooltip"
        id={id}
        hidden={!open || disabled}
        className={cx('absolute z-(--z-dropdown) w-max max-w-64 rounded-[6px] bg-ods-navy px-2 py-1 text-[12px] leading-snug font-medium text-white shadow-ods-pop', SIDE[side])}
      >
        {content}
      </span>
    </span>
  );
}
