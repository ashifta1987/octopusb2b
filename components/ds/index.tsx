/**
 * ADDON-44 PART 1 — shared design-system components (build once, reuse).
 * Tokens live in app/globals.css (navy, blue-fill, blue = text blue #1E58B0, ok/warn/needs/bad pairs, new-bg).
 * Every interactive element here is ≥ 44 px tall and gets the global 3 px focus ring.
 * Live gallery of every component and state: /dev/ui (staging and local only).
 */
import Link from 'next/link';
import type { ReactNode } from 'react';

/* ───────── icons (2 px stroke, never emoji) ───────── */
const PATHS = {
  check: 'm5 12 5 5 9-10',
  shield: 'M12 3 4 6v6c0 5 3.4 8.3 8 9 4.6-.7 8-4 8-9V6l-8-3Zm-3.5 9 2.5 2.5 4.5-5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  doc: 'M7 3h7l5 5v13H7V3Zm7 0v5h5M10 13h6M10 17h6',
  box: 'M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8',
  tag: 'M3 12V4h8l10 10-8 8L3 12Zm5-4h.01',
  truck: 'M3 6h11v10H3V6Zm11 4h4l3 3v3h-7v-6ZM7 19a2 2 0 1 0 0-.01M18 19a2 2 0 1 0 0-.01',
  warehouse: 'M3 21V9l9-5 9 5v12M7 21v-8h10v8M7 17h10',
  search: 'm21 21-4.3-4.3M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14Z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  info: 'M12 8h.01M11 12h1v5h1M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18Z',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  chevron: 'm6 9 6 6 6-6',
} as const;
export type IconName = keyof typeof PATHS;
export function Icon({ name, size = 20, className = '' }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={`shrink-0 ${className}`}>
      <path d={PATHS[name]} />
    </svg>
  );
}

/* ───────── pills ───────── */
export type Tone = 'ok' | 'warn' | 'needs' | 'bad' | 'info' | 'neutral' | 'navy';
const TONE: Record<Tone, string> = {
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  needs: 'bg-needs-bg text-needs',
  bad: 'bg-bad-bg text-bad',
  info: 'bg-blue-soft text-blue',
  neutral: 'bg-surface text-muted border border-line',
  navy: 'bg-navy text-white',
};
export function Pill({ tone = 'neutral', children, className = '', testId }: { tone?: Tone; children: ReactNode; className?: string; testId?: string }) {
  return <span className={`pill ${TONE[tone]} ${className}`} data-testid={testId}>{children}</span>;
}
/** NEW badge — navy text on amber. */
export function NewBadge({ className = '' }: { className?: string }) {
  return <span className={`pill !px-1.5 !py-[3px] !text-[9.5px] bg-new-bg text-navy font-bold ${className}`}>New</span>;
}
/** Amber "EXAMPLE" on any block whose numbers are not live. */
export function ExamplePill({ label = 'Example', className = '' }: { label?: string; className?: string }) {
  return <Pill tone="warn" className={className} testId="example-pill">{label}</Pill>;
}

/** Green "✓ VERIFIED BY OCTOPUS" (+ optional one-line explanation). Unverified → amber "Not yet verified". */
export function VerifiedBadge({ verified = true, explain }: { verified?: boolean; explain?: ReactNode }) {
  if (!verified) return <Pill tone="warn" testId="not-verified">Not yet verified</Pill>;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2.5 gap-y-1">
      <Pill tone="ok" testId="verified-badge"><Icon name="check" size={12} className="-ml-0.5" />Verified by Octopus</Pill>
      {explain && <span className="text-[13px] text-muted">{explain}</span>}
    </span>
  );
}

export type ShippingType = 'express' | 'standard' | 'economy';
const SHIP: Record<ShippingType, [string, string]> = {
  express: ['Express', 'bg-blue-soft text-blue'],
  standard: ['Standard', 'bg-ok-bg text-[#166534]'],
  economy: ['Economy', 'bg-warn-bg text-[#8A4B00]'],
};
/** Express / Standard / Economy — always the word, never colour alone. Optional delivery days ("5–10 days"). */
export function ShippingTypePill({ type, days }: { type: ShippingType; days?: string | null }) {
  const [label, cls] = SHIP[type];
  return <span className={`pill ${cls}`} data-testid={`ship-${type}`}>{label}{days ? <span className="normal-case tracking-normal font-medium">· {days}</span> : null}</span>;
}

/* ───────── announcement + service rail ───────── */
/** Navy strip, 13.5 px white text centred: [NEW] text + light-blue link. */
export function AnnouncementBar({ text, linkText, href, isNew = true }: { text: string; linkText?: string; href?: string; isNew?: boolean }) {
  return (
    <div className="bg-navy text-white text-[13.5px]" role="region" aria-label="Announcement" data-testid="announcement-bar">
      <p className="wrap py-2.5 text-center leading-snug">
        {isNew && <NewBadge className="mr-2 align-[1px]" />}
        <span>{text}</span>
        {href && linkText && <> <Link href={href} className="inline-flex items-center min-h-6 font-semibold text-on-ink-link hover:text-white hover:underline">{linkText}</Link></>}
      </p>
    </div>
  );
}

export type RailItem = { key: string; label: string; href: string; isNew?: boolean };
/** Pill links under the header; active = navy pill. Scrolls sideways on phone. */
export function ServiceRail({ items, active, extra }: { items: RailItem[]; active?: string; extra?: RailItem }) {
  return (
    <nav aria-label="Services" className="bg-white border-b border-line" data-testid="service-rail">
      <ul className="wrap py-2 flex gap-1 items-center overflow-x-auto overscroll-x-contain">
        {items.map((it) => {
          const on = it.key === active;
          return (
            <li key={it.key} className="shrink-0">
              <Link href={it.href} aria-current={on ? 'page' : undefined}
                className={`inline-flex items-center gap-1.5 min-h-11 px-3.5 rounded-full text-[14px] font-medium whitespace-nowrap ${on ? 'bg-navy text-white hover:text-white' : 'text-navy hover:bg-surface'}`}>
                {it.label}{it.isNew && <NewBadge />}
              </Link>
            </li>
          );
        })}
        {extra && (
          <li className="shrink-0 flex items-center">
            <span className="w-px h-5 bg-line mx-2" aria-hidden />
            <Link href={extra.href} className="inline-flex items-center min-h-11 px-3.5 rounded-full text-[14px] font-medium text-navy hover:bg-surface whitespace-nowrap">{extra.label}</Link>
          </li>
        )}
      </ul>
    </nav>
  );
}

/* ───────── section pieces ───────── */
/** Numbered 28 px navy square + mono label + optional pill / NEW. */
export function SectionEyebrow({ n, children, isNew, pill }: { n?: number; children: ReactNode; isNew?: boolean; pill?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      {n != null && <span className="inline-flex items-center justify-center w-7 h-7 rounded-[8px] bg-navy text-white text-[13px] font-bold">{n}</span>}
      <span className="mono text-[11px] font-semibold uppercase tracking-[.08em] text-blue">{children}</span>
      {isNew && <NewBadge />}
      {pill}
    </div>
  );
}

export type Step = { title: string; body?: string; tag?: string };
/** Blue numbered square + bold title + 1–2 lines. 6 per row desktop, 2 tablet, 1 phone. */
export function StepCard({ n, step }: { n: number; step: Step }) {
  return (
    <li className="card p-4 sm:p-[18px] h-full" data-testid="step-card">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center justify-center w-7 h-7 rounded-[8px] bg-blue-fill text-white text-[13px] font-bold">{n}</span>
        {step.tag && <Pill tone={step.tag === 'You' ? 'info' : 'navy'} className="!text-[10px]">{step.tag}</Pill>}
      </div>
      <h3 className="text-[15.5px] font-bold mt-3 leading-snug">{step.title}</h3>
      {step.body && <p className="text-[13.5px] text-muted mt-1.5 leading-relaxed">{step.body}</p>}
    </li>
  );
}
export function StepCards({ steps, cols = 6 }: { steps: Step[]; cols?: 3 | 4 | 6 }) {
  const lg = cols === 6 ? 'lg:grid-cols-6' : cols === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3';
  return <ol className={`grid gap-3 sm:grid-cols-2 ${lg}`}>{steps.map((s, i) => <StepCard key={s.title} n={i + 1} step={s} />)}</ol>;
}

/** Icon, title, one line, one button. Product page: 4 in a row, 2×2 tablet, stacked phone. */
export function ServiceChoiceCard({ icon, title, body, cta, href, primary, disabled, note, isNew, testId }: {
  icon: IconName; title: string; body: string; cta: string; href: string; primary?: boolean; disabled?: boolean; note?: ReactNode; isNew?: boolean; testId?: string;
}) {
  return (
    <div className={`card p-5 flex flex-col h-full ${disabled ? 'opacity-70' : ''}`} data-testid={testId ?? 'service-choice'}>
      <span className={`inline-flex items-center justify-center w-10 h-10 rounded-[10px] ${primary ? 'bg-navy text-white' : 'bg-blue-soft text-blue'}`}><Icon name={icon} /></span>
      <h3 className="text-[16.5px] font-bold mt-3 flex items-center gap-2">{title}{isNew && <NewBadge />}</h3>
      <p className="text-[14px] text-muted mt-1 leading-relaxed flex-1">{body}</p>
      {note && <div className="mt-2 text-[12.5px]">{note}</div>}
      {disabled
        ? <span className="btn btn-ghost mt-4 w-full opacity-60 cursor-not-allowed" aria-disabled="true">{cta}</span>
        : <Link href={href} className={`btn ${primary ? 'btn-primary' : 'btn-ghost'} mt-4 w-full`}>{cta} <Icon name="arrow" size={16} /></Link>}
    </div>
  );
}

/** Navy "STUDIO PREVIEW" pill top-left on the image + mandatory caption underneath. */
export function StudioPreviewLabel({ className = '' }: { className?: string }) {
  return <span className={`pill bg-navy text-white !text-[10px] ${className}`} data-testid="studio-preview">Studio preview</span>;
}
export const STUDIO_CAPTION = 'Illustrative preview. Not approved artwork.';
export function StudioPreviewCard({ src, alt, brand, title }: { src: string; alt: string; brand: string; title: string }) {
  return (
    <figure className="card overflow-hidden" data-testid="studio-preview-card">
      <div className="relative aspect-[4/3] bg-surface">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
        <StudioPreviewLabel className="absolute top-3 left-3" />
        <span className="absolute bottom-3 left-1/2 -translate-x-1/2 mono text-[11px] font-bold tracking-[.18em] uppercase px-3 py-1 bg-white/95 text-navy border border-dashed border-navy/50 rounded-[4px]">{brand}</span>
      </div>
      <figcaption className="px-4 py-3">
        <div className="text-[14px] font-semibold text-navy">{title}</div>
        <div className="text-[12.5px] text-muted mt-0.5">{STUDIO_CAPTION}</div>
      </figcaption>
    </figure>
  );
}

/** Proof point: soft-blue icon tile + bold line + muted text. */
export function ProofPoint({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="inline-flex items-center justify-center w-10 h-10 rounded-[10px] bg-blue-soft text-blue shrink-0"><Icon name={icon} /></span>
      <div><div className="text-[15.5px] font-bold text-navy">{title}</div><p className="text-[14px] text-muted mt-0.5 leading-relaxed">{body}</p></div>
    </li>
  );
}

/** Native details/summary rows, 54 px tall, white card. */
export function FAQ({ items, id }: { items: [string, ReactNode][]; id?: string }) {
  return (
    <div className="card divide-y divide-line" id={id} data-testid="faq">
      {items.map(([q, a]) => (
        <details key={q} className="group">
          <summary className="flex items-center justify-between gap-4 min-h-[54px] px-5 cursor-pointer list-none font-semibold text-[15.5px] text-navy [&::-webkit-details-marker]:hidden">
            {q}<Icon name="chevron" size={18} className="text-muted transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-5 pb-4 -mt-1 text-[14.5px] text-body-2 leading-relaxed">{a}</div>
        </details>
      ))}
    </div>
  );
}

/** Small notice row (tone + icon + text) for "coming soon", blocked and empty states. */
export function Notice({ tone = 'info', children, testId }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode; testId?: string }) {
  const cls = { info: 'bg-blue-soft text-navy border-[#C9DBF7]', warn: 'bg-warn-bg text-warn border-[#FCD9A0]', bad: 'bg-bad-bg text-bad border-[#FBC7C7]', ok: 'bg-ok-bg text-ok border-[#B7EBC9]' }[tone];
  return (
    <div className={`flex gap-2.5 items-start rounded-[10px] border px-3.5 py-3 text-[14px] leading-relaxed ${cls}`} data-testid={testId}>
      <Icon name={tone === 'info' ? 'info' : tone === 'ok' ? 'check' : 'alert'} size={18} className="mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

/** One wording everywhere (ADDON-44 content rules). */
export const PAYMENT_LINE = 'Paid from your Octopus wallet. Top up by bank transfer — no card payments.';
export const STORE_SOON = 'Store connection: coming soon — upload orders as a sheet meanwhile.';
export const TBC = 'To be confirmed';

