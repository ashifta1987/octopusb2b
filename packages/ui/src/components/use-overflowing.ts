'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Internal (navigation group, not exported from the barrel): `true` while the element's content is taller than the
 * element. Collapsed sidebars only turn on `overflow-y: auto` when they must, because a scroll box would clip the
 * tooltips that pop out to the side.
 */
export function useOverflowing<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [over, setOver] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setOver(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    Array.from(el.children).forEach((c) => ro.observe(c));
    return () => ro.disconnect();
  }, []);
  return [ref, over] as const;
}
