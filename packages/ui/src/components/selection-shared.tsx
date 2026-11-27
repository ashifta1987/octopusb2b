'use client';

import { useEffect, type RefObject } from 'react';
import { rowScrollDelta } from '../selection-logic';

/**
 * Internal helpers for the selection group (not exported from the barrel).
 *
 * INSET_RING: rows that scroll sideways (`overflow-x-auto`) would clip the global 3 px amber ring drawn 2 px OUTSIDE
 * the element, so items in those rows draw the same 3 px amber ring INSIDE their box. `!` is needed because the
 * global ring rule in tokens.css is unlayered (an important layered declaration beats a normal unlayered one).
 */
export const INSET_RING = 'focus-visible:outline-offset-[-3px]!';

/** Hidden scrollbar track on touch rows still scrolls; we keep the native scrollbar thin. */
export const SCROLL_ROW = 'flex min-w-0 flex-nowrap overflow-x-auto overscroll-x-contain [scrollbar-width:thin]';

/** Keeps the item matching `selector` scrolled into view inside the horizontal `row` whenever `key` changes. */
export function useRowScroll(row: RefObject<HTMLElement | null>, selector: string, key: unknown) {
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const item = el.querySelector<HTMLElement>(selector);
    if (!item) return;
    const delta = rowScrollDelta(el.getBoundingClientRect(), item.getBoundingClientRect());
    if (delta) el.scrollBy({ left: delta });
  }, [row, selector, key]);
}
