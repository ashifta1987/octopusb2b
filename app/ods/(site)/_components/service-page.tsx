import Link from 'next/link';
import { Check } from 'lucide-react';
import { Breadcrumbs, Icon, cx } from '@octopus/ui';
import type { SiteSettings } from '@/lib/ods-site';
import { Container, ExampleTag, Facts, Faq, FinalCta, Section, Steps } from './blocks';
import { GoogleCta } from './google-cta';
import { SITE_SERVICES, type SiteService } from './services';

/**
 * One service page (Part 4.2): hero in the service colour (name, one line, Continue with Google) → How it works →
 * What you pay (settings text only) → Example cards (labelled Example, no prices) → FAQ → final CTA.
 * Used by /services/[name] and /turnkey (owner decision D4).
 */
export function ServicePage({ service: s, settings }: { service: SiteService; settings: SiteSettings }) {
  const f = settings.facts[s.slug];
  const others = SITE_SERVICES.filter((o) => o.slug !== s.slug);
  return (
    <div data-testid="service-page" data-service={s.slug}>
      <section aria-labelledby="service-title" className={cx('text-white', s.cls.bg)}>
        <Container className="py-12 ods-tablet:py-18">
          <Breadcrumbs
            items={[{ label: 'Home', href: '/' }, { label: 'Services', href: '/#services' }, { label: s.name }]}
            className="[&_a]:text-white/85 [&_a:hover]:text-white [&_span]:text-white [&_svg]:text-white/80"
          />
          <div className="mt-6 flex items-center gap-4">
            <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-ods-card bg-white/15 text-white">
              <Icon icon={s.icon} size="xl" />
            </span>
            <h1 id="service-title" className="text-[length:var(--ods-display)] leading-[var(--ods-leading-display)] font-bold tracking-tight text-white">
              {s.name}
            </h1>
          </div>
          <p className="mt-4 max-w-[640px] text-ods-body text-white/90">{s.line}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <GoogleCta variant="secondary" testId="service-cta" />
            <a href="#what-you-pay" className={cx('inline-flex h-ods-control items-center rounded-ods-control border border-white/50 px-4 font-semibold text-white hover:bg-white/10')}>
              What you pay
            </a>
          </div>
          <p className="mt-4 text-ods-small text-white/85">Free to join with your Google account · Opens the shop in a new tab</p>
        </Container>
      </section>

      <Section id="how" title="How it works" intro={`${s.name} in ${s.steps.length} steps.`}>
        <Steps steps={s.steps} />
      </Section>

      <Section id="what-you-pay" tone="surface" title="What you pay" intro="No hidden costs: the full price, shipping and duties are shown before you pay.">
        <div className="grid gap-6 ods-desktop:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className={cx('rounded-ods-card border border-ods-line border-t-4 bg-ods-surface p-ods-pad-card shadow-ods-card', s.cls.border)}>
            <Facts
              rows={[
                ['You pay', f.you_pay],
                [s.minimumLabel, f.minimum],
                ['Typical time', f.typical_time],
                ['Who holds stock', f.holds_stock],
                ['Best for', f.best_for],
              ]}
            />
          </div>
          <ul className="grid content-start gap-3">
            {[
              'Prices by quantity are shown in the shop after you sign in.',
              'Shipping and duties to your country are shown before you order.',
              settings.feeText,
              'Pay from your wallet. Every charge shows in My account › Wallet.',
            ].map((t) => (
              <li key={t} className="flex items-start gap-2 text-ods-body text-ods-text">
                <Icon icon={Check} size="sm" className="mt-1 shrink-0 text-ods-success" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <Section id="examples" title="Examples" intro="What this looks like in the shop. These cards are examples, not live offers.">
        <ul className="grid gap-4 ods-tablet:grid-cols-3">
          {s.examples.map((e) => (
            <li key={e.title} className="flex flex-col overflow-hidden rounded-ods-card border border-ods-line bg-ods-surface shadow-ods-card">
              <div aria-hidden className={cx('grid h-24 place-items-center', s.cls.tint, s.cls.text)}>
                <Icon icon={s.icon} size="xl" />
              </div>
              <div className="flex flex-1 flex-col p-ods-pad-card">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-ods-body font-bold text-ods-navy">{e.title}</h3>
                  <ExampleTag />
                </div>
                <ul className="mt-2 grid gap-1">
                  {e.lines.map((l) => (
                    <li key={l} className="text-ods-table text-ods-slate">
                      {l}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-ods-small text-ods-slate">Price: shown in the shop after you sign in</p>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="faq" tone="surface" title="Questions">
        <Faq items={s.faq} />
      </Section>

      <section aria-labelledby="other-services-title" className="bg-ods-canvas py-12">
        <Container>
          <h2 id="other-services-title" className="text-ods-h2 font-bold text-ods-navy">
            Other ways to work with us
          </h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {others.map((o) => (
              <li key={o.slug}>
                <Link href={o.href} className={cx('inline-flex min-h-ods-control items-center gap-2 rounded-ods-pill border border-ods-line bg-ods-surface px-4 font-semibold hover:border-ods-navy', o.cls.text)}>
                  <Icon icon={o.icon} size="sm" />
                  {o.name}
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <FinalCta />
    </div>
  );
}
