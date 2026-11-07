'use client';
import { useEffect, useState, type ReactNode } from 'react';

/** ADDON-44-D — rotates announcement lines every 7 s; pauses on hover/focus; no rotation with reduced motion. */
export function AnnouncementRotator({ lines }: { lines: ReactNode[] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (lines.length < 2 || paused) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % lines.length), 7000);
    return () => window.clearInterval(t);
  }, [lines.length, paused]);
  return (
    <div onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)} aria-live="off">
      {lines.map((l, n) => <div key={n} hidden={n !== i}>{l}</div>)}
    </div>
  );
}

