'use client';

import { useRef, useState, type KeyboardEvent, type UIEvent } from 'react';
import Image from 'next/image';
import { ImageIcon } from 'lucide-react';
import { Icon, cx, type ProductCardImage } from '@octopus/ui';

/**
 * Product gallery (Part 5.4 item 2). Desktop / tablet: main image + up to 4 thumbnails (buttons, aria-pressed; arrow
 * keys / Home / End move between them). Phones (< 768): one swipeable strip (scroll-snap) with dots and a "2 of 5"
 * live text. No photos → a neutral placeholder (no stock photos). Images from outside site-media render unoptimized.
 */
export function ProductGallery({ images, title }: { images: ProductCardImage[]; title: string }) {
  const [idx, setIdx] = useState(0);
  const [phoneIdx, setPhoneIdx] = useState(0);
  const thumbs = useRef<(HTMLButtonElement | null)[]>([]);
  const list = images.slice(0, 8);
  const shown = list.slice(0, 4);
  const main = list[Math.min(idx, list.length - 1)];

  if (!list.length) {
    return (
      <div role="img" aria-label={`${title}: no photo yet`} className="grid aspect-[4/3] w-full place-items-center rounded-ods-card border border-ods-line bg-ods-canvas text-ods-slate">
        <span className="flex flex-col items-center gap-2 text-ods-small">
          <Icon icon={ImageIcon} size="xl" />
          No photo yet
        </span>
      </div>
    );
  }

  const onKey = (e: KeyboardEvent) => {
    const n = shown.length;
    const map: Record<string, number> = { ArrowRight: idx + 1, ArrowDown: idx + 1, ArrowLeft: idx - 1, ArrowUp: idx - 1, Home: 0, End: n - 1 };
    if (!(e.key in map)) return;
    e.preventDefault();
    const next = (map[e.key] + n) % n;
    setIdx(next);
    thumbs.current[next]?.focus();
  };
  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
    if (i !== phoneIdx) setPhoneIdx(Math.abs(i));
  };

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="product-gallery">
      {/* tablet + desktop */}
      <div className="hidden flex-col gap-3 ods-tablet:flex">
        <Image
          src={main.src}
          alt={main.alt}
          width={main.width ?? 960}
          height={main.height ?? 720}
          unoptimized={main.unoptimized}
          priority
          sizes="(min-width: 1200px) 600px, 100vw"
          className="aspect-[4/3] w-full rounded-ods-card border border-ods-line bg-ods-canvas object-contain"
        />
        {shown.length > 1 ? (
          <div role="group" aria-label="Product photos" className="grid grid-cols-4 gap-3" onKeyDown={onKey}>
            {shown.map((im, i) => (
              <button
                key={im.src + i}
                ref={(el) => {
                  thumbs.current[i] = el;
                }}
                type="button"
                aria-pressed={i === idx}
                aria-label={`Show photo ${i + 1} of ${list.length}`}
                tabIndex={i === idx ? 0 : -1}
                onClick={() => setIdx(i)}
                className={cx('overflow-hidden rounded-ods-control border-2 bg-ods-canvas p-0', i === idx ? 'border-ods-blue' : 'border-ods-line hover:border-ods-navy')}
              >
                <Image src={im.src} alt="" width={200} height={150} unoptimized={im.unoptimized} className="aspect-[4/3] w-full object-cover" />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {/* phones: swipe with dots */}
      <div className="ods-tablet:hidden">
        <div
          className="flex snap-x snap-mandatory overflow-x-auto rounded-ods-card border border-ods-line bg-ods-canvas"
          onScroll={onScroll}
          tabIndex={0}
          role="region"
          aria-label={`Product photos, swipe to see more (${list.length})`}
        >
          {list.map((im, i) => (
            <Image key={im.src + i} src={im.src} alt={im.alt} width={800} height={600} unoptimized={im.unoptimized} priority={i === 0} className="aspect-[4/3] w-full shrink-0 snap-center object-contain" />
          ))}
        </div>
        {list.length > 1 ? (
          <div className="mt-2 flex items-center justify-center gap-1.5">
            {list.map((_, i) => (
              <span key={i} aria-hidden="true" className={cx('size-2 rounded-full', i === phoneIdx ? 'bg-ods-blue' : 'bg-ods-line-strong')} />
            ))}
            <span className="sr-only" aria-live="polite">
              Photo {phoneIdx + 1} of {list.length}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
