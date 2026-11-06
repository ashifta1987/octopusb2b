'use client';
import { Children, useEffect, useRef, useState } from 'react';
import { logBannerEvent } from './banner-actions';

/** Rotates up to 3 lead banners every 7 s; pauses on hover / focus; no auto-rotation with prefers-reduced-motion. */
export function BannerRotator({ ids, children }: { ids: string[]; children: React.ReactNode }) {
  const slides = Children.toArray(children);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const seen = useRef(new Set<string>());
  useEffect(() => {
    const id = ids[i];
    if (id && !seen.current.has(id)) { seen.current.add(id); void logBannerEvent(id, 'lead', 'impression'); }
  }, [i, ids]);
  useEffect(() => {
    if (slides.length < 2 || paused) return;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((x) => (x + 1) % slides.length), 7000);
    return () => clearInterval(t);
  }, [slides.length, paused]);
  return (
    <div className="relative h-full" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}
      onClickCapture={(e) => { if ((e.target as HTMLElement).closest('a')) void logBannerEvent(ids[i] ?? null, 'lead', 'click'); }}
      aria-roledescription={slides.length > 1 ? 'carousel' : undefined}>
      {slides.map((s, k) => (
        <div key={k} className={k === i ? 'h-full' : 'hidden'} aria-hidden={k !== i} role={slides.length > 1 ? 'group' : undefined} aria-roledescription={slides.length > 1 ? 'slide' : undefined} aria-label={slides.length > 1 ? `${k + 1} of ${slides.length}` : undefined}>{s}</div>
      ))}
      {slides.length > 1 && (
        <div className="absolute left-6 bottom-4 flex gap-1.5">
          {slides.map((_, k) => (
            <button key={k} type="button" onClick={() => setI(k)} aria-label={`Show banner ${k + 1}`} aria-current={k === i}
              className={`h-2 rounded-full ${k === i ? 'w-6 bg-white' : 'w-2 bg-white/40'} min-h-2`} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Logs one impression for a side banner / announcement and its clicks. */
export function TrackSlot({ slot, children, className }: { slot: string; children: React.ReactNode; className?: string }) {
  useEffect(() => { void logBannerEvent(null, slot, 'impression'); }, [slot]);
  return <div className={className} onClickCapture={(e) => { if ((e.target as HTMLElement).closest('a')) void logBannerEvent(null, slot, 'click'); }}>{children}</div>;
}
