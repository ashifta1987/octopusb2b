import Link from 'next/link';
import Image from 'next/image';
import { JsonLd, breadcrumbLd } from '@/components/store/seo';

/**
 * Public website building blocks (octopus-design-handoff §2–§4, pages 01–09).
 * Tokens only (globals.css): navy = ink, navy-2 = ink-card, blue = coral, link = coral-text, tint, pearl, line,
 * input-border = line-strong, muted, on-ink (text on navy), on-ink-link (links / underline on navy), ok / warn.
 * Note: globals.css styles h1–h4 colour outside a layer, so headings on navy need `!text-white`.
 */

export const SUPPORT_EMAIL = 'support@hostoctopus.com';
export const LEGAL_NAME = 'Shenzhen Octopus Trading Co., Ltd.';
export const OFFICE_HOURS = '09:00–18:00, Monday to Friday, China time (UTC+8)';
export const WHATSAPP_URL = 'https://wa.me/8618826527644';

/** Six services in the design's order (service bar, footer, "Other services"). */
export type ServiceKey = 'sourcing' | 'brand' | 'pools' | 'dropship' | 'turnkey' | '3pl';
export const SERVICES: { key: ServiceKey; href: string; label: string; short: string }[] = [
  { key: 'sourcing', href: '/sourcing', label: 'Product sourcing', short: 'Product sourcing' },
  { key: 'brand', href: '/make-my-brand', label: 'Make My Brand', short: 'Make My Brand' },
  { key: 'pools', href: '/pools', label: 'MOQ pools', short: 'MOQ pools' },
  { key: 'dropship', href: '/request/dropship', label: 'Dropshipping', short: 'Dropshipping' },
  { key: 'turnkey', href: '/turnkey', label: 'Turnkey projects', short: 'Turnkey projects' },
  { key: '3pl', href: '/3pl', label: '3PL and logistics', short: '3PL and logistics' },
];

export const wrap = 'max-w-[1200px] mx-auto px-4 sm:px-6';
export const h1Class = 'm-0 text-[length:clamp(34px,6vw,50px)] !leading-[1.05] font-extrabold';
export const h2Class = 'm-0 text-[length:clamp(26px,4.5vw,34px)] !leading-[1.12] font-extrabold';
export const eyebrowClass = 'font-mono text-[13px] font-semibold uppercase tracking-[.12em]';

const btnBase = 'inline-flex items-center justify-center min-h-12 rounded-[10px] font-semibold text-[16px] no-underline text-center';
export const btn = {
  primary: `${btnBase} px-[26px] bg-coral text-white hover:bg-coral-text hover:text-white`,
  dark: `${btnBase} px-[26px] bg-ink text-white hover:bg-ink-2 hover:text-white`,
  outline: `${btnBase} px-6 border-2 border-ink text-ink hover:bg-ink hover:text-white`,
  light: `${btnBase} px-7 bg-white text-ink hover:bg-tint hover:text-ink`,
};

export function StatusPill({ soon = false, className = '' }: { soon?: boolean; className?: string }) {
  return (
    <span className={`inline-block px-3 py-1.5 rounded-full font-mono text-[12px] font-semibold tracking-[.06em] uppercase leading-none ${soon ? 'bg-warn-bg text-warn' : 'bg-ok-bg text-ok'} ${className}`}>
      {soon ? 'Coming soon' : 'Open now'}
    </span>
  );
}

/** 3:2 picture, object-fit: cover (handoff §4 "Image"). `square` for the 1:1 Visit China thumbnail. */
export function Pic({ src, alt, sizes = '(min-width:1200px) 400px, 100vw', className = '', rounded = 'rounded-[18px]', square = false, preload = false }: {
  src: string; alt: string; sizes?: string; className?: string; rounded?: string; square?: boolean; preload?: boolean;
}) {
  return (
    <div className={`relative w-full ${square ? 'aspect-square' : 'aspect-[3/2]'} overflow-hidden bg-tint ${rounded} ${className}`}>
      <Image src={src} alt={alt} fill sizes={sizes} preload={preload} className="object-cover" />
    </div>
  );
}

export const design = (file: string) => `/images/design/${file}`;

export function Check({ className = 'text-ok' }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" className={`shrink-0 mt-[3px] ${className}`}>
      <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Breadcrumbs (Home › … › current page) with BreadcrumbList JSON-LD. */
export function Crumb({ label, trail = [] }: { label: string; trail?: { name: string; href: string }[] }) {
  const items = [{ name: 'Home', href: '/' }, ...trail, { name: label }];
  return (
    <nav aria-label="Breadcrumb" className={`${wrap} pt-5 text-[14px] text-muted`}>
      <JsonLd data={breadcrumbLd(items)} />
      <ol className="flex flex-wrap items-center gap-x-1.5 list-none m-0 p-0">
        {items.map((it, i) => (
          <li key={it.name} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">›</span>}
            {'href' in it && it.href ? <Link href={it.href} className="inline-flex items-center min-h-11 underline text-ink hover:text-coral-text">{it.name}</Link> : <span aria-current="page">{it.name}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** "What it costs" card: real fees from the existing data; unknown values say "On request". */
export function CostTable({ title = 'What it costs', sub, rows, note, link, testId }: {
  title?: string; sub?: string; rows: [string, React.ReactNode, string?][]; note?: React.ReactNode; link?: { href: string; label: string }; testId?: string;
}) {
  return (
    <section className="px-4 sm:px-6 pb-[72px]" aria-labelledby="cost-h" data-testid={testId}>
      <div className="max-w-[1200px] mx-auto bg-white border border-line rounded-[18px] p-6 sm:p-8">
        <h2 id="cost-h" className="m-0 text-[length:clamp(24px,3.5vw,28px)] !leading-[1.15] font-extrabold">{title}</h2>
        {sub && <p className="mt-2 mb-0 text-[16px] text-muted max-w-[720px]">{sub}</p>}
        <dl className="mt-5 mb-0 grid gap-x-10 sm:grid-cols-2">
          {rows.map(([k, v, href]) => (
            <div key={k} className="flex flex-col min-[480px]:flex-row min-[480px]:justify-between min-[480px]:items-center gap-x-4 gap-y-0.5 py-3 border-b border-divider min-h-11">
              <dt className="text-[16px] text-black">{href ? <Link href={href} className="inline-flex items-center min-h-11 min-[480px]:min-h-0 underline text-ink hover:text-coral-text">{k}</Link> : k}</dt>
              <dd className="m-0 text-[16px] font-bold text-ink min-[480px]:text-right">{v}</dd>
            </div>
          ))}
        </dl>
        {note && <p className="mt-4 mb-0 text-[14px] text-muted">{note}</p>}
        {link && <p className="mt-3 mb-0"><Link href={link.href} className="inline-flex items-center min-h-11 font-semibold underline text-ink hover:text-coral-text">{link.label}</Link></p>}
      </div>
    </section>
  );
}

export const ON_REQUEST = 'On request';

/** Team and Foshan warehouse band (homepage, sourcing, 3PL). */
export function TeamBand({ img, title = 'Our team and warehouse in Foshan', tint = false }: { img: { src: string; alt: string; supplied?: boolean }; title?: string; tint?: boolean }) {
  // Owner 27 Nov: only a REAL team photo is shown (the owner's file in public/images/design/new). Until then, a layout without people.
  const facts = [['Foshan, China', 'Our own warehouse: receiving, storage, packing and dispatch.'], ['One account manager', 'Your single contact for sourcing, branding, stock and shipping.'], ['Escrow wallet', 'Money is held by Octopus and released to the factory only after quality checks and shipping.']];
  return (
    <section className={`px-4 sm:px-6 py-[72px] ${tint ? 'bg-tint' : ''}`} aria-labelledby="team-h" data-testid="team-band">
      <div className="max-w-[1200px] mx-auto flex flex-wrap gap-10 items-center">
        <div className="flex-[1_1_480px] min-w-0">{img.supplied
          ? <Pic src={img.src} alt={img.alt} sizes="(min-width:1200px) 600px, 100vw" />
          : <ul className="m-0 p-0 list-none grid gap-4" data-testid="team-facts">{facts.map(([t, d]) => (
              <li key={t} className="bg-white border border-line rounded-[18px] p-6"><p className="m-0 text-[20px] font-extrabold text-ink">{t}</p><p className="mt-1.5 mb-0 text-[16px] text-muted">{d}</p></li>))}</ul>}</div>
        <div className="flex-[1_1_380px] min-w-0">
          <h2 id="team-h" className={h2Class}>{title}</h2>
          <p className="mt-3 mb-0 text-[18px] leading-[1.6] text-muted">One Octopus team in China handles your sourcing, branding, warehouse and shipping questions, and one account manager is your contact for all of them.</p>
          <ul className="mt-5 mb-0 p-0 list-none flex flex-col gap-3 text-[17px]">
            <li className="flex gap-2.5"><Check />Warehouse: Foshan, China</li>
            <li className="flex gap-2.5"><Check />Office hours: {OFFICE_HOURS}</li>
            <li className="flex gap-2.5"><Check />Support: <a href={`mailto:${SUPPORT_EMAIL}`} className="underline text-ink hover:text-coral-text">{SUPPORT_EMAIL}</a></li>
          </ul>
          <p className="mt-5 mb-0"><Link href="/about" className="inline-flex items-center min-h-11 font-semibold underline text-ink hover:text-coral-text">About Octopus B2B →</Link></p>
        </div>
      </div>
    </section>
  );
}

/** FAQ list (native details/summary, first one open). */
export function Faq({ items, title = 'Questions buyers ask', id, testId }: { items: [string, React.ReactNode][]; title?: string; id?: string; testId?: string }) {
  return (
    <section className="bg-tint py-[72px] px-4 sm:px-6" aria-labelledby={id ?? 'faq-h'} id="faq" data-testid={testId}>
      <div className="max-w-[860px] mx-auto">
        <h2 id={id ?? 'faq-h'} className={`${h2Class} mb-6`}>{title}</h2>
        <div className="flex flex-col gap-3">
          {items.map(([q, a], i) => (
            <details key={q} open={i === 0} className="bg-white rounded-[14px] px-6 py-5 group">
              <summary className="cursor-pointer list-none text-[18px] font-semibold text-ink min-h-11 flex items-center justify-between gap-4 [&::-webkit-details-marker]:hidden">
                {q}<span aria-hidden="true" className="text-coral-text text-[22px] leading-none group-open:rotate-45 transition-transform">+</span>
              </summary>
              <div className="mt-3 text-[16px] leading-[1.6] text-muted">{a}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Navy closing band with two buttons (service pages). */
export function CtaBand({ title, sub = 'Log in to the Octopus B2B app, or create a free account in a minute.', primary = { href: '/login', label: 'Log in to the app' }, secondary = { href: '/signup', label: 'Create free account' } }: {
  title: string; sub?: string; primary?: { href: string; label: string }; secondary?: { href: string; label: string };
}) {
  return (
    <section className="bg-ink py-[72px] px-4 sm:px-6 text-center" aria-labelledby="cta-h">
      <div className="max-w-[720px] mx-auto">
        <h2 id="cta-h" className={`${h2Class} !text-white`}>{title}</h2>
        <p className="mt-3.5 text-[18px] text-on-ink">{sub}</p>
        <div className="mt-[26px] flex flex-wrap gap-3 justify-center">
          <Link href={primary.href} className={btn.primary}>{primary.label}</Link>
          <Link href={secondary.href} className={btn.light}>{secondary.label}</Link>
        </div>
      </div>
    </section>
  );
}

/** "Other services" pills (every service page). */
export function OtherServices({ current, hide = [] }: { current: ServiceKey; hide?: ServiceKey[] }) {
  return (
    <nav aria-labelledby="other-h" className="py-14 px-4 sm:px-6">
      <div className="max-w-[1200px] mx-auto">
        <p id="other-h" className="m-0 mb-4 font-bold text-ink text-[18px]">Other services</p>
        <ul className="flex flex-wrap gap-2.5 list-none m-0 p-0">
          {SERVICES.filter((s) => s.key !== current && !hide.includes(s.key)).map((s) => (
            <li key={s.key}><Link href={s.href} className="inline-flex items-center min-h-11 border-2 border-ink rounded-full px-[18px] font-semibold text-ink hover:bg-ink hover:text-white">{s.short}</Link></li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
