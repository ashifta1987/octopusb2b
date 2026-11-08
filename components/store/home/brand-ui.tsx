/**
 * Brand kit step 5 — picture building blocks for the home page and /make-my-brand (ADDON-48 Part 1).
 * 3D illustrations sit in an "ill" card (radius 24, ill-bg), real photos are radius 20 with a soft Ink shadow,
 * caption chips sit bottom-left inside the picture, floating cards overlap a corner on desktop and sit inside on phones.
 * All pictures come from the media store through a Site content key (lib/media.ts) and render with next/image.
 */
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { SiteImage } from '@/lib/media';

const SH = 'shadow-[0_18px_40px_rgb(26_23_74/0.10)]';
const FLOAT_SH = 'shadow-[0_16px_36px_rgb(26_23_74/0.16)]';

/** Caption chip: white 94 % pill, Coral dot (green when it is about safety / QC). */
export function CaptionChip({ children, tone = 'coral', className = '' }: { children: ReactNode; tone?: 'coral' | 'ok'; className?: string }) {
  return (
    <span className={`absolute left-3 bottom-3 sm:left-4 sm:bottom-4 inline-flex items-center gap-2 max-w-[calc(100%-24px)] rounded-full bg-white/95 px-3.5 py-2 text-[13.5px] font-semibold text-ink ${className}`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${tone === 'ok' ? 'bg-ok' : 'bg-coral'}`} aria-hidden />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** 3D illustration card (3:2). */
export function IllCard({ img, sizes = '(min-width:1100px) 600px, 100vw', chip, chipTone, priority = false, children, className = '' }: {
  img: SiteImage; sizes?: string; chip?: ReactNode; chipTone?: 'coral' | 'ok'; priority?: boolean; children?: ReactNode; className?: string;
}) {
  return (
    <figure className={`relative rounded-[24px] bg-ill-bg overflow-hidden aspect-[3/2] ${className}`}>
      <Image src={img.src} alt={img.alt} width={img.width} height={img.height} sizes={sizes} priority={priority} className="absolute inset-0 w-full h-full object-cover" />
      {chip && <CaptionChip tone={chipTone}>{chip}</CaptionChip>}
      {children}
    </figure>
  );
}

/** Real photo (radius 20, soft shadow), optional Ink shade caption at the bottom. */
export function Photo({ img, sizes = '(min-width:1100px) 600px, 100vw', aspect = 'aspect-[3/2]', shade, className = '' }: {
  img: SiteImage; sizes?: string; aspect?: string; shade?: { title: string; line?: string }; className?: string;
}) {
  return (
    <figure className={`relative rounded-[20px] overflow-hidden bg-ill-bg ${aspect} ${SH} ${className}`}>
      <Image src={img.src} alt={img.alt} width={img.width} height={img.height} sizes={sizes} className="absolute inset-0 w-full h-full object-cover" />
      {shade && (
        <figcaption className="absolute inset-x-0 bottom-0 px-5 pb-4 pt-16 bg-gradient-to-t from-ink/[.86] via-ink/70 to-transparent">
          <div className="text-white text-[17px] font-bold leading-snug">{shade.title}</div>
          {shade.line && <div className="text-on-ink-muted text-[14px] mt-0.5">{shade.line}</div>}
        </figcaption>
      )}
    </figure>
  );
}

/** Floating white card overlapping a picture corner (desktop) or sitting inside it (phone). */
export function FloatingCard({ children, corner = 'bottom-left', className = '' }: { children: ReactNode; corner?: 'bottom-left' | 'bottom-right'; className?: string }) {
  const pos = corner === 'bottom-left' ? 'left-3 bottom-3 lg:-left-6 lg:-bottom-6' : 'right-3 bottom-3 lg:-right-6 lg:-bottom-6';
  return <div className={`absolute ${pos} z-10 rounded-[16px] bg-white p-3 sm:p-4 ${FLOAT_SH} ${className}`}>{children}</div>;
}

/** Inset photo: 46 % wide, Pearl border, overlapping the bottom-left of a picture; hidden on phones. */
export function InsetPhoto({ img }: { img: SiteImage }) {
  return (
    <figure className={`hidden md:block absolute -left-7 -bottom-7 w-[46%] aspect-[3/2] rounded-[18px] overflow-hidden border-[6px] border-pearl ${SH}`}>
      <Image src={img.src} alt={img.alt} width={img.width} height={img.height} sizes="280px" className="absolute inset-0 w-full h-full object-cover" />
    </figure>
  );
}

/** Hero illustration with feathered edges (no frame). Hidden on phones. */
export function HeroFeather({ img }: { img: SiteImage }) {
  return (
    <div className="hidden lg:block relative w-full max-w-[560px] aspect-[3/2] justify-self-end"
      style={{ maskImage: 'radial-gradient(ellipse 68% 68% at 50% 52%, black 50%, transparent 98%)', WebkitMaskImage: 'radial-gradient(ellipse 68% 68% at 50% 52%, black 50%, transparent 98%)' }}>
      <Image src={img.src} alt={img.alt} width={img.width} height={img.height} sizes="(min-width:1100px) 560px, 0px" priority className="absolute inset-0 w-full h-full object-cover" />
    </div>
  );
}

/** Floating "Ask Octo" button (opens the Octo assistant); face only on phones. */
export function OctoButton({ face }: { face: SiteImage }) {
  return (
    <Link href="/assistant" aria-label="Ask Octo, our assistant" data-testid="octo-button"
      className="fixed z-40 right-4 bottom-4 sm:right-6 sm:bottom-6 inline-flex items-center gap-2.5 rounded-full bg-ink text-white hover:bg-ink-2 hover:text-white p-1.5 sm:pr-5 shadow-[0_12px_30px_rgb(26_23_74/0.28)]">
      <span className="relative inline-flex w-11 h-11 rounded-full bg-pearl overflow-hidden">
        <Image src={face.src} alt="" width={face.width} height={face.height} sizes="44px" className="w-full h-full object-cover" />
        <span className="absolute right-0.5 bottom-0.5 w-2.5 h-2.5 rounded-full bg-ok-bright border-2 border-ink" aria-hidden />
      </span>
      <span className="hidden sm:inline font-semibold text-[15px]">Ask Octo</span>
    </Link>
  );
}

/** Numbered eyebrow: 28 px Ink square + Coral-text label (+ NEW). */
export function NumEyebrow({ n, children, isNew }: { n?: number; children: ReactNode; isNew?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {n != null && <span className="inline-flex items-center justify-center w-7 h-7 rounded-[8px] bg-ink text-white text-[13px] font-bold">{n}</span>}
      <span className="label-caps text-coral-text">{children}</span>
      {isNew && <span className="pill !px-1.5 !py-[3px] !text-[9.5px] bg-new-bg text-ink font-bold">New</span>}
    </div>
  );
}

/** Green-tick list. */
export function Ticks({ items, className = '' }: { items: string[]; className?: string }) {
  return (
    <ul className={`space-y-2 ${className}`}>
      {items.filter(Boolean).map((t) => (
        <li key={t} className="flex gap-2.5 text-[15px] text-black">
          <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-ok-bg text-ok shrink-0" aria-hidden>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><path d="m5 12 5 5 9-10" /></svg>
          </span>{t}
        </li>
      ))}
    </ul>
  );
}

/** Row of step cards; a swipe strip on phones. */
export function StepRow({ steps, cols = 4 }: { steps: [string, string][]; cols?: 4 | 5 }) {
  return (
    <ol className={`flex md:grid gap-3 overflow-x-auto snap-x snap-mandatory md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0 pb-1 ${cols === 5 ? 'md:grid-cols-5' : 'md:grid-cols-4'}`}>
      {steps.map(([t, b], i) => (
        <li key={t} className="card p-4 sm:p-5 shrink-0 w-[260px] md:w-auto snap-start">
          <span className="inline-flex items-center justify-center w-7 h-7 rounded-[8px] bg-coral text-white text-[13px] font-bold">{i + 1}</span>
          <h3 className="mt-3 text-[16.5px] font-bold leading-snug">{t}</h3>
          {b && <p className="mt-1 text-[14px] text-muted leading-relaxed">{b}</p>}
        </li>
      ))}
    </ol>
  );
}

/** Section wrapper: alternating Pearl / white, 64 px (40 px phone) padding, 1 px top line on white. */
export function Band({ id, white = false, children, label, className = '' }: { id?: string; white?: boolean; children: ReactNode; label?: string; className?: string }) {
  return (
    <section id={id} aria-label={label} className={`scroll-mt-28 ${white ? 'bg-white border-t border-line' : 'bg-pearl'} ${className}`}>
      <div className="wrap py-10 md:py-16">{children}</div>
    </section>
  );
}
