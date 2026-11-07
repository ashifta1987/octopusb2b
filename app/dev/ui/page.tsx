import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isStaging } from '@/lib/core/account';
import {
  AnnouncementBar, ServiceRail, SectionEyebrow, StepCards, ServiceChoiceCard, VerifiedBadge, ShippingTypePill,
  ExamplePill, NewBadge, Pill, StudioPreviewCard, StudioPreviewLabel, ProofPoint, FAQ, Notice, Icon,
  PAYMENT_LINE, STORE_SOON, TBC, STUDIO_CAPTION, type RailItem,
} from '@/components/ds';

export const metadata: Metadata = { title: 'UI components (staging)', robots: { index: false, follow: false } };

const RAIL: RailItem[] = [
  { key: 'sourcing', label: 'Product sourcing', href: '/request/sourcing' },
  { key: 'brand', label: 'Make My Brand', href: '/make-my-brand', isNew: true },
  { key: 'dropship', label: 'Dropshipping', href: '/#dropshipping' },
  { key: 'pools', label: 'MOQ pools', href: '/pools' },
  { key: '3pl', label: '3PL warehousing', href: '/#warehousing' },
  { key: 'turnkey', label: 'Turnkey Projects', href: '/turnkey' },
];

function Block({ name, note, children }: { name: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="py-8 border-t border-line" aria-labelledby={`ds-${name}`} data-testid={`ds-${name}`}>
      <h2 id={`ds-${name}`} className="text-[20px] font-bold">{name}</h2>
      {note && <p className="text-[14px] text-muted mt-1 max-w-[760px]">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
const K = ({ children }: { children: React.ReactNode }) => <div className="k mb-2">{children}</div>;

/** ADDON-44-B — every shared component in every state. Staging and local only (404 on live). */
export default function DevUiPage() {
  if (process.env.NODE_ENV === 'production' && !isStaging()) notFound();
  return (
    <main className="pb-24">
      <AnnouncementBar text="Make My Brand: your logo on verified products, stocked in our warehouse, shipped worldwide." linkText="See how it works →" href="/make-my-brand" />
      <ServiceRail items={RAIL} active="sourcing" extra={{ key: 'all', label: 'All categories', href: '/products' }} />
      <div className="wrap pt-10">
        <div className="flex items-center gap-3 flex-wrap"><h1 className="text-[30px] font-extrabold leading-[1.15]">UI components</h1><Pill tone="warn">Staging only</Pill></div>
        <p className="text-[15px] text-body-2 mt-2 max-w-[760px]">ADDON-44 design system. Tokens are in <code className="mono text-[13px]">app/globals.css</code>, components in <code className="mono text-[13px]">components/ds</code>. This page returns 404 on the live site.</p>

        <Block name="Colours" note="Blue text and links always use blue-text #1E58B0 (6.3:1 on white). #2A6FD6 is only for filled buttons with white text.">
          <ul className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {([['navy', '#11133C', 'bg-navy text-white'], ['blue (fill)', '#2A6FD6', 'bg-blue-fill text-white'], ['blue-text', '#1E58B0', 'bg-white text-blue border border-line'], ['bg', '#F5F6F8', 'bg-surface text-navy border border-line'], ['border', '#E2E5EA', 'bg-line text-navy'], ['muted', '#5A6475', 'bg-white text-muted border border-line'], ['body-2', '#3B4556', 'bg-white text-body-2 border border-line'], ['soft-blue', '#E6EFFC', 'bg-blue-soft text-navy'], ['green', '#15803D / #DCFCE7', 'bg-ok-bg text-ok'], ['amber', '#92400E / #FEF3C7', 'bg-warn-bg text-warn'], ['orange', '#9A3412 / #FFEDD5', 'bg-needs-bg text-needs'], ['red', '#991B1B / #FEE2E2', 'bg-bad-bg text-bad'], ['new badge', '#11133C / #F59E0B', 'bg-new-bg text-navy']] as const).map(([n, hex, cls]) => (
              <li key={n} className={`rounded-[10px] p-3 min-h-[76px] ${cls}`}><div className="text-[13px] font-semibold">{n}</div><div className="mono text-[11px] mt-1">{hex}</div></li>
            ))}
          </ul>
        </Block>

        <Block name="Type">
          <div className="space-y-3">
            <div><K>H1 public hero · Lexend 50/1.05 800 (phone 32)</K><div className="font-display text-[32px] sm:text-[50px] leading-[1.05] font-extrabold tracking-[-0.03em]">Your brand on proven products.</div></div>
            <div><K>H1 account · 30/1.15 800</K><div className="font-display text-[30px] leading-[1.15] font-extrabold">Dropship catalogue</div></div>
            <div><K>H2 section · 34/1.12 800 (phone 25)</K><div className="font-display text-[25px] sm:text-[34px] leading-[1.12] font-extrabold">How it works</div></div>
            <div><K>H3 card · 17 700</K><div className="font-display text-[17px] font-bold">Pick a verified product</div></div>
            <div><K>Body · Inter 16/1.6</K><p className="text-[16px] leading-[1.6] text-body-2 max-w-[640px]">Pick a product from our verified suppliers and we put your logo on it, on the product and on the box.</p></div>
            <div><K>Label (k) · IBM Plex Mono 11 600 uppercase</K><div className="k">Customers in</div></div>
            <div><K>Money and ids · tabular</K><div className="tabular-nums text-[18px] font-semibold">US$ 1,234.56 <span className="mono text-[14px] text-muted ml-2">MB-0042</span></div></div>
          </div>
        </Block>

        <Block name="Buttons" note="Radius 10. Public 48 px, hero 52 px, account 44 px, small 38 px. Tab through to see the 3 px focus ring.">
          <div className="flex flex-wrap gap-3 items-center">
            <button className="btn btn-primary btn-hero">Hero 52</button>
            <button className="btn btn-primary btn-pub">Primary 48</button>
            <button className="btn btn-dark btn-pub">Dark 48</button>
            <button className="btn btn-ghost btn-pub">Ghost 48</button>
            <button className="btn btn-primary">Account 44</button>
            <button className="btn btn-ghost btn-sm">Small 38</button>
            <button className="btn btn-primary" disabled>Disabled</button>
            <span className="bg-navy p-3 rounded-[10px]"><button className="btn btn-light">Light on navy</button></span>
          </div>
        </Block>

        <Block name="Pills and badges">
          <div className="flex flex-wrap gap-2 items-center">
            <NewBadge /><ExamplePill /><VerifiedBadge /><VerifiedBadge verified={false} />
            <ShippingTypePill type="express" /><ShippingTypePill type="standard" /><ShippingTypePill type="economy" />
            <ShippingTypePill type="express" days="4–7 days" /><Pill tone="ok">Live</Pill><Pill tone="needs">Needs you</Pill><Pill tone="bad">Not available</Pill><Pill tone="info">You</Pill><Pill tone="navy">Octopus</Pill><Pill>Draft</Pill>
          </div>
          <div className="mt-3"><VerifiedBadge explain="Octopus lists this product directly from a factory we have checked." /></div>
        </Block>

        <Block name="AnnouncementBar · ServiceRail" note="Shown at the top of this page. Rail: active item = navy pill; scrolls sideways on phone. PublicHeader stays the existing store header (logo, search, My account).">
          <div className="card overflow-hidden"><ServiceRail items={RAIL} active="brand" /></div>
        </Block>

        <Block name="SectionEyebrow">
          <div className="space-y-3"><SectionEyebrow n={1}>Product sourcing</SectionEyebrow><SectionEyebrow n={2} isNew>Make My Brand</SectionEyebrow><SectionEyebrow pill={<ExamplePill />}>Example quote</SectionEyebrow></div>
        </Block>

        <Block name="StepCard" note="6 per row desktop, 2 tablet, 1 phone. Optional You / Octopus tag.">
          <StepCards steps={[
            { title: 'Pick a verified product', body: 'Only products Octopus lists directly.', tag: 'You' },
            { title: 'Add your brand', body: 'Logo print, engraving or a branded box.', tag: 'You' },
            { title: 'Approve proof and sample', body: 'Nothing is made until you approve both.', tag: 'You' },
            { title: 'We produce and check', body: 'The factory makes it and we run QC.', tag: 'Octopus' },
            { title: 'Stocked in our warehouse', body: 'Kept as your stock, ready to ship.', tag: 'Octopus' },
            { title: 'Shipped worldwide', body: 'In bulk, or order by order from your store.', tag: 'Octopus' },
          ]} />
        </Block>

        <Block name="ServiceChoiceCard" note="Product page: 4 in a row, 2×2 tablet, stacked phone. The brand card is disabled on unverified products.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ServiceChoiceCard icon="search" title="Buy in bulk" body="Get factory quotes for your quantity." cta="Request a quote" href="#" primary />
            <ServiceChoiceCard icon="tag" title="Put your brand on it" body="Your logo on the product and box." cta="Start a brand project" href="#" isNew />
            <ServiceChoiceCard icon="truck" title="Dropship it" body="We ship each order to your customer." cta="Dropship this" href="#" />
            <ServiceChoiceCard icon="tag" title="Put your brand on it" body="Only verified products can be branded." cta="Not available yet" href="#" disabled note={<VerifiedBadge verified={false} />} />
          </div>
        </Block>

        <Block name="StudioPreviewLabel" note={`Mandatory on every branded mock-up, with the caption "${STUDIO_CAPTION}" Images below are demo images (public/demo).`}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 items-start">
            <StudioPreviewCard src="/demo/F8.jpg" alt="Handheld fan with a sample logo" brand="Nova Breeze" title="Handheld fan F8 · pad print logo" />
            <StudioPreviewCard src="/demo/S7.jpg" alt="Aroma diffuser with a sample logo" brand="Nova Breeze" title="Aroma diffuser S7 · laser engraving" />
            <div className="card p-4"><StudioPreviewLabel /><p className="text-[13px] text-muted mt-2">Label alone</p></div>
          </div>
        </Block>

        <Block name="Proof points">
          <ul className="grid gap-4 sm:grid-cols-3">
            <ProofPoint icon="shield" title="Verified suppliers only" body="You choose from products Octopus lists directly." />
            <ProofPoint icon="user" title="One account manager" body="One person handles artwork, proof, sample and approval." />
            <ProofPoint icon="doc" title="Price confirmed before you pay" body="Price, delivery date, duties and shipping are in your quote." />
          </ul>
        </Block>

        <Block name="Notices and fixed wording">
          <div className="grid gap-2 max-w-[760px]">
            <Notice>{PAYMENT_LINE}</Notice>
            <Notice tone="warn">{STORE_SOON}</Notice>
            <Notice tone="bad">Cannot ship to Saudi Arabia: contains a battery not allowed on this route.</Notice>
            <Notice tone="ok">Added to your import list.</Notice>
            <p className="text-[14px] text-muted">Unknown value: <b className="text-navy">{TBC}</b></p>
          </div>
        </Block>

        <Block name="FAQ" note="Native details/summary, 54 px rows.">
          <div className="max-w-[760px]">
            <FAQ items={[['Do I pay before I approve the sample?', 'No. Nothing is produced until you approve the proof and the sample.'], ['How do I pay?', PAYMENT_LINE], ['Can I use my own packaging?', 'Yes. Your account manager confirms what the factory can print.']]} />
          </div>
        </Block>

        <Block name="Icons" note="2 px stroke, 18–20 px. Never emoji.">
          <div className="flex flex-wrap gap-4 text-navy">
            {(['check', 'shield', 'user', 'doc', 'box', 'tag', 'truck', 'warehouse', 'search', 'arrow', 'info', 'alert', 'chevron'] as const).map((n) => <span key={n} className="inline-flex flex-col items-center gap-1 text-[11px] text-muted"><Icon name={n} />{n}</span>)}
          </div>
        </Block>

        <Block name="AccountShell" note="Header, service tabs (active = 3 px blue underline), 236 px side menu, STAGING badge on preview only. Sign in as the staging customer and open /account to see it.">
          <a href="/account" className="btn btn-ghost">Open My account</a>
        </Block>
      </div>
    </main>
  );
}

