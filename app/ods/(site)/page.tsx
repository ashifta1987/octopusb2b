import type { Metadata } from 'next';
import Link from 'next/link';
import { ClipboardCheck, CreditCard, Lock, ShieldCheck, Truck, Wallet } from 'lucide-react';
import { Icon, buttonClass } from '@octopus/ui';
import { brandName, formatUnits, getSiteData, type SiteData } from '@/lib/ods-site';
import { Container, Countries, ExampleTag, Faq, FinalCta, Section, ServiceCards, Steps, TwoTabs } from './_components/blocks';
import { ComparisonTable } from './_components/comparison-table';
import { GoogleCta } from './_components/google-cta';
import { ShopPicture } from './_components/shop-picture';
import { HOW_IT_WORKS_STEPS, homeFaq } from './_components/copy';

const TITLE = 'Octopus B2B — Source, store and sell from China';
const DESCRIPTION =
  'One account for sourcing from verified factories, MOQ pools, dropshipping, warehouse storage, turnkey projects and your own brand. Free to join with Google.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  openGraph: { type: 'website', title: TITLE, description: DESCRIPTION, url: '/', images: [{ url: '/images/ods/octopus-b2b-logo.png', width: 640, height: 166, alt: 'Octopus B2B' }] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: ['/images/ods/octopus-b2b-logo.png'] },
};

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

function organizationLd({ company }: SiteData) {
  const ld: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: brandName(company),
    url: SITE_URL,
    logo: `${SITE_URL}/images/ods/octopus-b2b-logo.png`,
  };
  if (company?.legal_name) ld.legalName = company.legal_name;
  if (company?.email) ld.email = company.email;
  if (company?.phone) ld.telephone = company.phone;
  if (company?.address) ld.address = company.address;
  if (company?.tagline) ld.slogan = company.tagline;
  return ld;
}

/** `/` — introduction (Part 4.1, Match: Public_Home / M_Public_Home). Static: settings come from the cached site content. */
export default async function HomePage() {
  const data = await getSiteData();
  const { settings } = data;
  const trust = [
    { icon: ShieldCheck, title: 'Verified suppliers only', body: 'Every factory is checked before it can sell to you.' },
    { icon: ClipboardCheck, title: 'Quality check before you pay in full', body: 'A QC report with photos comes before the balance is due.' },
    { icon: Lock, title: 'Payment protection', body: 'Pay now, or pay into protection until your order is right.' },
    { icon: Wallet, title: 'One wallet, one account', body: 'Invoices, payments and documents in one place.' },
  ];
  const poolRules = [
    <>
      <strong>Pick a pool</strong> and choose your units{settings.poolMinUnits ? `, from ${formatUnits(settings.poolMinUnits)}` : ''}.
    </>,
    <>
      <strong>Pay a deposit</strong>
      {settings.poolDepositPct ? ` of ${settings.poolDepositPct}%` : ''} that is held, not spent.
    </>,
    <>
      <strong>Pool fills:</strong> the factory produces, you pay the balance after the quality check.
    </>,
    <>
      <strong>Pool doesn’t fill:</strong> your deposit goes back to your wallet automatically.
    </>,
  ];

  return (
    <div data-testid="ods-home">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationLd(data)).replace(/</g, '\\u003c') }} />

      {/* 2 · Hero (navy gradient allowed here, Part 2.2) */}
      <section aria-labelledby="hero-title" className="bg-[linear-gradient(135deg,var(--ods-navy-dark)_0%,var(--ods-navy)_55%,var(--ods-navy-hover)_100%)] text-white">
        <Container className="grid items-center gap-12 py-12 ods-tablet:py-18 ods-desktop:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div>
            <p className="inline-flex rounded-ods-pill bg-white/10 px-3 py-1 text-ods-label font-semibold text-white">For companies buying from China</p>
            <h1 id="hero-title" className="mt-4 text-ods-display leading-[var(--ods-leading-display)] font-bold tracking-tight text-white">
              Source, store and sell from China. <span className="text-ods-teal">One account for all of it.</span>
            </h1>
            <p className="mt-4 max-w-[600px] text-ods-body text-white/85">
              Buy from verified factories, share a minimum order with other buyers, dropship to your Shopify customers, keep stock in our warehouse,
              launch a full product line and put your brand on it.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <GoogleCta variant="accent" testId="hero-cta" />
              <a href="#how-it-works" className={buttonClass('on-navy')}>
                See how it works
              </a>
            </div>
            <p className="mt-4 text-ods-small text-white/80">Free to join with your Google account · Opens the shop in a new tab</p>
          </div>
          <div className="hidden ods-desktop:block">
            <ShopPicture />
          </div>
        </Container>
      </section>

      {/* 3 · Trust strip */}
      <section aria-label="Why buyers trust us" className="border-b border-ods-line bg-ods-surface">
        <Container>
          <ul className="grid gap-4 py-6 ods-tablet:grid-cols-2 ods-desktop:grid-cols-4">
            {trust.map((t) => (
              <li key={t.title} className="flex items-start gap-3">
                <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-ods-control bg-ods-blue-tint text-ods-blue">
                  <Icon icon={t.icon} />
                </span>
                <span>
                  <span className="block text-ods-table font-bold text-ods-navy">{t.title}</span>
                  <span className="block text-ods-small text-ods-slate">{t.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      {/* 4 · Six ways */}
      <Section id="services" eyebrow="What we do" title="Six ways to work with us" intro="Use one, or combine them. Most customers start with sourcing or a pool, then add branding and warehouse storage.">
        <ServiceCards settings={settings} />
      </Section>

      {/* 5 · Comparison */}
      <Section id="compare" tone="surface" eyebrow="Compare" title="Which one is right for you?" intro="A quick comparison. You can change your mind later: everything sits in the same account.">
        <ComparisonTable settings={settings} />
      </Section>

      {/* 6 · How it works */}
      <Section id="how-it-works" eyebrow="How it works" title="How it works" intro="From sign-up to delivery in four steps.">
        <Steps steps={HOW_IT_WORKS_STEPS} />
      </Section>

      {/* 7 · Two tabs */}
      <Section id="two-tabs" tone="surface" eyebrow="Your account" title="After you sign in: two tabs, one login" intro="Shop in one tab and manage everything in the other. Switch with one click; you stay signed in to both.">
        <TwoTabs />
      </Section>

      {/* 8 · MOQ pools explained */}
      <Section id="pools" eyebrow="MOQ pools" title="MOQ pools: the bulk price without the bulk order" intro="Factories have minimums. Pools let several buyers share one order, and everyone pays the bulk price.">
        <div className="grid items-start gap-6 ods-desktop:grid-cols-2">
          <article aria-labelledby="pool-example-title" className="rounded-ods-card border border-ods-line bg-ods-surface p-ods-pad-card shadow-ods-card">
            <div className="flex items-start justify-between gap-3">
              <h3 id="pool-example-title" className="text-ods-body font-bold text-ods-navy">
                Foldable pet crate
              </h3>
              <ExampleTag />
            </div>
            <p className="mt-2 text-ods-table text-ods-text">
              <strong className="text-ods-svc-pools">Pool price</strong> below the price for buying alone. Real prices are shown on each pool in the shop.
            </p>
            <div aria-hidden className="mt-3 h-2 overflow-hidden rounded-ods-pill bg-ods-line">
              <div className="h-full w-[64%] rounded-ods-pill bg-ods-svc-pools" />
            </div>
            <p className="mt-2 text-ods-small text-ods-slate">
              Example: the pool is about two-thirds full and closes on the date shown.{' '}
              {settings.poolMinUnits ? `Join from ${formatUnits(settings.poolMinUnits)} units.` : 'The smallest quantity is set per pool.'}
            </p>
          </article>
          <ol className="grid gap-3">
            {poolRules.map((r, i) => (
              <li key={i} className="flex items-start gap-3 text-ods-body text-ods-text">
                <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-full bg-ods-svc-pools-tint text-ods-label font-bold text-ods-svc-pools">
                  {i + 1}
                </span>
                <span>{r}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-6">
          <Link href="/services/pools" className="font-semibold text-ods-blue underline underline-offset-4 hover:decoration-2">
            More about MOQ pools
          </Link>
        </p>
      </Section>

      {/* 9 · Quality and payments (navy band) */}
      <section id="quality" aria-labelledby="quality-title" className="bg-ods-navy py-12 text-white ods-tablet:py-18">
        <Container>
          <p className="text-ods-small font-bold tracking-wide text-ods-teal uppercase">Quality and payments</p>
          <h2 id="quality-title" className="mt-1 max-w-[720px] text-ods-h1 font-bold text-white">
            You see the product and the full cost before you pay in full
          </h2>
          <ul className="mt-8 grid gap-4 ods-desktop:grid-cols-3">
            {[
              { icon: ShieldCheck, title: 'Quality checked', body: 'We inspect every order before you pay the balance. You get a report with photos and can ask for fixes.' },
              {
                icon: CreditCard,
                title: 'Safe payments',
                body: `Pay now, or use Payment protection: your money is held until the order is right. ${
                  settings.depositPct ? `${settings.depositPct}% deposit, balance before shipping.` : 'A deposit first, the balance before shipping.'
                }`,
              },
              { icon: Truck, title: 'Shipping and duties up front', body: 'See the cost delivered to your country before you order: product, shipping and duties.' },
            ].map((c) => (
              <li key={c.title} className="rounded-ods-card border border-white/15 bg-white/5 p-ods-pad-card">
                <Icon icon={c.icon} size="lg" className="text-ods-teal" />
                <h3 className="mt-3 text-ods-body font-bold text-white">{c.title}</h3>
                <p className="mt-1 text-ods-table text-white/85">{c.body}</p>
              </li>
            ))}
          </ul>
          <div className="mt-8">
            <Countries countries={settings.deliveryCountries} onNavy />
          </div>
        </Container>
      </section>

      {/* 10 · FAQ */}
      <Section
        id="faq"
        tone="surface"
        eyebrow="FAQ"
        title="Questions"
        intro={
          <>
            Can’t find your answer? Our team replies{settings.replyTime ? ` ${settings.replyTime}` : ' to every message'}.{' '}
            <Link href="/help" className="font-semibold text-ods-blue underline underline-offset-4">
              See all help
            </Link>
          </>
        }
      >
        <Faq items={homeFaq(settings)} />
      </Section>

      {/* 11 · Final call to action */}
      <FinalCta />
    </div>
  );
}
