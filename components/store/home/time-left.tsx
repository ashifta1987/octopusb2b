'use client';
import { useEffect, useState } from 'react';

/** "2d 14h left" — computed in the browser (the home page is prerendered, so no clock on the server). */
export function TimeLeft({ deadline }: { deadline: string }) {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => {
      const ms = Math.max(0, new Date(deadline).getTime() - Date.now());
      setLabel(`${Math.floor(ms / 86_400_000)}d ${String(Math.floor((ms % 86_400_000) / 3_600_000)).padStart(2, '0')}h left`);
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [deadline]);
  return <span suppressHydrationWarning>{label ?? 'Closing soon'}</span>;
}
