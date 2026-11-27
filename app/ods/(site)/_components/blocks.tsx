import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, Check, ChevronDown } from 'lucide-react';
import { Icon, buttonClass, cx } from '@octopus/ui';
import type { SiteSettings } from '@/lib/ods-site';
import { GoogleCta } from './google-cta';
import { SITE_SERVICES, type SiteService } from './services';

/* Shared building blocks for the introduction site (Part 4.1 patterns, reused by 4.2 and the info pages). Server-safe. */

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-ods-content px-ods-pad-page', className)}>{children}</div>;
}

export function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
  className,
  tone = 'canvas',
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  intro?: ReactNode;
  children?: ReactNode;
  className?: string;
  tone?: 'canvas' | 'surface';
}) {
  const hid = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={hid} className={cx('scroll-mt-20 py-12 ods-tablet:py-18', tone === 'surface' ? 'bg-ods-surface' : 'bg-ods-canvas', className)}>
      <Container>
        {eyebrow ? <p className="text-ods-small font-bold tracking-wide text-ods-blue uppercase">{eyebrow}</p> : null}
        <h2 id={hid} className="mt-1 text-ods-h1 font-bold text-ods-navy">
          {title}
        </h2>
        {intro ? <p className="mt-2 max-w-[680px] text-ods-body text-ods-slate">{intro}</p> : null}
        {children ? <div className="mt-8">{children}</div> : null}
      </Container>
    </section>
  );
}

export function Steps({ steps }: { steps: { title: string; body: string }[] }) {
  return (
    <ol className={cx('grid gap-4 ods-tablet:grid-cols-2', steps.length === 3 ? 'ods-desktop:grid-cols-3' : 'ods-desktop:grid-cols-4')}>
      {steps.map((s, i) => (
        <li key={s.title} className="rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card">
          <span aria-hidden className="grid size-9 place-items-center rounded-full border-2 border-ods-navy text-ods-label font-bold text-ods-navy">
            {i + 1}
          </span>
          <h3 className="mt-3 text-ods-body font-bold text-ods-navy">
            <span className="sr-only">Step {i + 1}: </span>
            {s.title}
          </h3>
          <p className="mt-1 text-ods-table text-ods-slate">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

export function Faq({ items }: { items: { q: string; a: ReactNode }[] }) {
  return (
    <div className="divide-y divide-ods-line rounded-ods-card border border-ods-line bg-ods-surface">
      {items.map((f) => (
        <details key={f.q} className="group">
          <summary className="flex min-h-ods-row cursor-pointer list-none items-center gap-3 rounded-ods-card px-ods-pad-card py-3 font-semibold text-ods-navy hover:bg-ods-canvas [&::-webkit-details-marker]:hidden">
            <Icon icon={ChevronDown} className="shrink-0 text-ods-slate transition-transform duration-(--ods-motion-fast) group-open:rotate-180" />
            {f.q}
          </summary>
          <div className="px-ods-pad-card pb-4 ps-[calc(var(--ods-pad-card)+30px)] text-ods-body text-ods-slate">{f.a}</div>
        </details>
      ))}
    </div>
  );
}

export function FinalCta({ title = 'Start with one product. Grow into all six.', body = 'Free account with Google. No minimum to join.' }: { title?: string; body?: string }) {
  return (
    <section aria-labelledby="final-cta-title" className="bg-ods-navy py-12 text-white ods-tablet:py-18">
      <Container className="flex flex-col gap-6 ods-tablet:flex-row ods-tablet:items-center ods-tablet:justify-between">
        <div>
          <h2 id="final-cta-title" className="text-ods-h1 font-bold text-white">
            {title}
          </h2>
          <p className="mt-2 text-ods-body text-white/85">{body}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <GoogleCta variant="accent" />
          <Link href="/help#contact" className={buttonClass('on-navy')}>
            Talk to our team
          </Link>
        </div>
      </Container>
    </section>
  );
}

/** Minimum order / You pay / Best for (or any facts) as a description list. */
export function Facts({ rows, className }: { rows: [string, string][]; className?: string }) {
  return (
    <dl className={cx('grid gap-3', className)}>
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className="text-ods-small font-bold tracking-wide text-ods-slate uppercase">{k}</dt>
          <dd className="mt-0.5 text-ods-table text-ods-text">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ServiceIconTile({ s, size = 'md' }: { s: SiteService; size?: 'md' | 'lg' }) {
  return (
    <span aria-hidden className={cx('grid shrink-0 place-items-center rounded-ods-control', s.cls.tint, s.cls.text, size === 'lg' ? 'size-12' : 'size-10')}>
      <Icon icon={s.icon} size={size === 'lg' ? 'xl' : 'md'} />
    </span>
  );
}

/** "Six ways to work with us": 3×2 cards (2 on tablets, 1 on phones). */
export function ServiceCards({ settings, headingLevel = 3 }: { settings: SiteSettings; headingLevel?: 3 | 2 }) {
  const H = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <ul className="grid gap-4 ods-tablet:grid-cols-2 ods-desktop:grid-cols-3">
      {SITE_SERVICES.map((s) => {
        const f = settings.facts[s.slug];
        return (
          <li key={s.slug} data-service={s.slug} className="flex flex-col overflow-hidden rounded-ods-card border border-ods-line bg-ods-surface shadow-ods-card">
            <span aria-hidden className={cx('h-1', s.cls.bar)} />
            <div className="flex flex-1 flex-col p-ods-pad-card">
              <div className="flex items-center gap-3">
                <ServiceIconTile s={s} />
                <H className="text-ods-h2 font-bold text-ods-navy">{s.name}</H>
              </div>
              <p className="mt-3 text-ods-body text-ods-text">{s.line}</p>
              <Facts
                className="mt-4"
                rows={[
                  [s.minimumLabel, f.minimum],
                  ['You pay', f.you_pay],
                  ['Best for', f.best_for],
                ]}
              />
              <Link href={s.href} className={cx('mt-auto inline-flex min-h-ods-control items-center gap-1 self-start rounded-ods-control pt-4 font-semibold underline underline-offset-4 hover:decoration-2', s.cls.text)}>
                {s.linkLabel}
                <Icon icon={ArrowRight} size="sm" className="rtl:rotate-180" />
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** "After you sign in: two tabs, one login" — two browser-window cards. */
export function TwoTabs() {
  const cards = [
    {
      tab: 'Tab 1 · Shop',
      title: 'The shop: browse everything',
      items: ['All six sections on one page', 'Prices by quantity and delivery to your country', 'Request quotes, join pools, start projects', 'One cart: buy now, or get a quote for many products at once'],
    },
    {
      tab: 'Tab 2 · My account',
      title: 'Your account panel: run it all',
      items: ['Requests, orders and shipments in one list', 'Wallet, invoices and documents', 'Warehouse stock and dropship orders', 'Your team and your account manager'],
    },
  ];
  return (
    <div className="grid gap-4 ods-tablet:grid-cols-2">
      {cards.map((c) => (
        <article key={c.tab} className="overflow-hidden rounded-ods-card border border-ods-line bg-ods-surface shadow-ods-card">
          <div className="flex items-center gap-3 border-b border-ods-line bg-ods-canvas px-4 py-2">
            <span aria-hidden className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-ods-line-strong" />
              <span className="size-2.5 rounded-full bg-ods-line-strong" />
              <span className="size-2.5 rounded-full bg-ods-line-strong" />
            </span>
            <p className="rounded-t-ods-control border border-b-0 border-ods-line bg-ods-surface px-3 py-1 text-ods-small font-semibold text-ods-navy">{c.tab}</p>
          </div>
          <div className="p-ods-pad-card">
            <h3 className="text-ods-body font-bold text-ods-navy">{c.title}</h3>
            <ul className="mt-3 grid gap-2">
              {c.items.map((it) => (
                <li key={it} className="flex items-start gap-2 text-ods-table text-ods-text">
                  <Icon icon={Check} size="sm" className="mt-0.5 shrink-0 text-ods-success" />
                  {it}
                </li>
              ))}
            </ul>
          </div>
        </article>
      ))}
    </div>
  );
}

/** Delivery countries from settings + "More countries on request" (on navy). */
export function Countries({ countries, onNavy = false }: { countries: string[]; onNavy?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <p className={cx('me-2 font-bold', onNavy ? 'text-white' : 'text-ods-navy')}>We deliver to</p>
      {countries.length ? (
        <ul className="contents">
          {countries.map((c) => (
            <li key={c} className={cx('rounded-ods-pill px-3 py-1.5 text-ods-label font-semibold', onNavy ? 'bg-white/10 text-white' : 'bg-ods-blue-tint text-ods-navy')}>
              {c}
            </li>
          ))}
        </ul>
      ) : (
        <span className={cx('text-ods-label', onNavy ? 'text-white/85' : 'text-ods-slate')}>Delivery countries are being confirmed.</span>
      )}
      <span className={cx('text-ods-label', onNavy ? 'text-white/85' : 'text-ods-slate')}>More countries on request</span>
    </div>
  );
}

/** Small "Example" label (Part 1 rule 9). */
export function ExampleTag() {
  return <span className="rounded-ods-pill border border-ods-warning bg-ods-warning-tint px-2 py-0.5 text-ods-small font-bold text-ods-warning">Example</span>;
}
