'use client';
import { useRef, useState, type KeyboardEvent, type TouchEvent } from 'react';

export type GalleryImage = { url: string; alt: string | null };

/**
 * Product gallery (6 Nov 2026): one main image + a strip of real thumbnails, only for images that exist.
 * 0 images → renders nothing (no placeholder box). 1 image → main image only, no strip. N ≥ 2 → N thumbnails
 * (56 px desktop / 48 px mobile, 8 px gap, left-aligned, selected one outlined). A packaging photo is just another image.
 * Keyboard: ←/→ (and Home/End) move between images; swipe the main image on touch screens.
 * Used by the storefront product page and the moderation preview.
 */
export function ProductGallery({ images, title, mainClassName = 'aspect-square', framed = true }: {
  images: GalleryImage[]; title: string; mainClassName?: string; framed?: boolean;
}) {
  const list = images.filter((i) => !!i.url);
  const [idx, setIdx] = useState(0);
  const touch = useRef<number | null>(null);
  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);
  if (!list.length) return null;
  const n = list.length;
  const cur = Math.min(idx, n - 1);
  const go = (i: number, focus = false) => {
    const next = (i + n) % n;
    setIdx(next);
    if (focus) thumbs.current[next]?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    if (n < 2) return;
    const map: Record<string, number> = { ArrowRight: cur + 1, ArrowDown: cur + 1, ArrowLeft: cur - 1, ArrowUp: cur - 1, Home: 0, End: n - 1 };
    if (e.key in map) { e.preventDefault(); go(map[e.key], true); }
  };
  const onTouchStart = (e: TouchEvent) => { touch.current = e.touches[0]?.clientX ?? null; };
  const onTouchEnd = (e: TouchEvent) => {
    if (touch.current == null || n < 2) return;
    const dx = (e.changedTouches[0]?.clientX ?? touch.current) - touch.current;
    touch.current = null;
    if (Math.abs(dx) > 40) go(cur + (dx < 0 ? 1 : -1));
  };
  const img = list[cur];
  return (
    <div className="space-y-2" data-testid="product-gallery" onKeyDown={onKey}>
      <div className={framed ? 'card overflow-hidden' : 'overflow-hidden rounded-[10px] border border-line'}
        onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} tabIndex={n > 1 ? 0 : undefined}
        aria-roledescription={n > 1 ? 'carousel' : undefined} aria-label={n > 1 ? `${title}, image ${cur + 1} of ${n}. Use the arrow keys or swipe for more.` : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img.url} alt={img.alt || (n > 1 ? `${title} — image ${cur + 1} of ${n}` : title)} width={800} height={800}
          decoding="async" className={`${mainClassName} w-full object-cover bg-surface select-none`} draggable={false} data-testid="gallery-main" />
      </div>
      {n > 1 && (
        <ul className="flex flex-wrap justify-start gap-2" aria-label="Product images" data-testid="gallery-thumbs">
          {list.map((m, i) => (
            <li key={`${m.url}-${i}`}>
              <button type="button" ref={(el) => { thumbs.current[i] = el; }} onClick={() => go(i)} aria-current={i === cur ? 'true' : undefined}
                tabIndex={i === cur ? 0 : -1}
                className={`block w-12 h-12 sm:w-14 sm:h-14 rounded-md overflow-hidden border bg-surface ${i === cur ? 'border-navy ring-2 ring-navy ring-offset-1' : 'border-line hover:border-navy'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt={`Image ${i + 1} of ${n}`} width={56} height={56} loading="lazy" decoding="async" className="w-full h-full object-cover" draggable={false} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

