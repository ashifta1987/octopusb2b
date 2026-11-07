import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getSiteContent, block } from '@/lib/content';
import { Breadcrumbs, JsonLd, breadcrumbLd, parts } from '@/components/store/seo';
import {
  SectionEyebrow, StepCards, StudioPreviewLabel, STUDIO_CAPTION, ExamplePill, Pill, Icon, FAQ, Notice, NewBadge, PAYMENT_LINE, TBC,
} from '@/components/ds';
import {
  BRAND_START_HREF, MMB_STEPS, EXAMPLES, EXAMPLE_BRAND, EXAMPLE_QUOTE, SHIPPING_SERVICES, brandMethods, replyHours, exampleQty, isDemo, usd, fmtInt,
} from '@/components/store/make-my-brand/content';

const TITLE = 'Make My Brand: your logo on verified products';
const DESC = 'Put your brand on products made by verified factories. We produce and check them, keep them as your stock in our warehouse, and ship worldwide. Price confirmed before you pay.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: '/make-my-brand' },
  openGraph: { title: TITLE, description: DESC, url: '/make-my-brand', type: 'website', images: [{ url: '/mmb/F8.jpg', alt: 'Studio preview of a branded handheld fan' }] },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESC, images: ['/mmb/F8.jpg'] },
};

const W = 'wrap';
const CRUMBS = [{ name: 'Home', href: '/' }, { name: 'Make My Brand' }];
const Arrow = () => <span aria-hidden>→</span>;

/** Product photo + Studio preview label + example brand tag (mandatory caption is rendered by the caller). */
function Preview({ src, alt, className = '' }: { src: string; alt: string; className?: string }) {
  return (
    <div className={`relative bg-[#EDE6DC] overflow-hidden ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />
      <StudioPreviewLabel className="absolute top-3 left-3" />
      <span className="absolute bottom-3 left-1/2 -translate-x-1/2 mono text-[11px] font-bold tracking-[.18em] uppercase px-3 py-1 bg-white/95 text-navy border border-dashed border-navy/50 rounded-[4px] whitespace-nowrap">{EXAMPLE_BRAND}</span>
    </div>
  );
}

async function MakeMyBrandView() {
  const { blocks, settings } = await getSiteContent();
  const methods = brandMethods(settings);
  const reply = replyHours(settings);
  const demo = isDemo(settings);
  const [h1a, h1b] = parts(blocks, 'mmb.hero.title', 'Put your brand on products made by|verified factories.');
  const faq: [string, string][] = [
    ['What is the minimum order?', block(blocks, 'mmb.faq.moq', 'It depends on the product and the branding method. Your account manager confirms the minimum quantity in your quote before you pay anything.')],
    ['How long does a brand project take?', block(blocks, 'mmb.faq.time', 'The product\u2019s normal production time plus the extra time for your branding method and sample approval. Your quote shows the delivery date.')],
    ['Who owns the artwork files?', block(blocks, 'mmb.faq.artwork', 'You do. Your logo and artwork files are kept private and are shared only with the factory making your order.')],
    ['Can I see a sample first?', block(blocks, 'mmb.faq.sample', 'Yes. Nothing is produced until you approve the artwork proof and a physical branded sample.')],
    ['How do I pay?', block(blocks, 'mmb.faq.pay', `${PAYMENT_LINE} You pay a deposit to start production and the balance before your goods ship.`)],
  ];

  return (
    <div className="pb-4" data-testid="mmb-page">
      <JsonLd data={breadcrumbLd(CRUMBS)} />

      {/* Hero */}
      <section className="bg-gradient-to-b from-white to-[#F2F7FE] border-b border-line">
        <div className={`${W} pt-5 pb-12 sm:pb-16`}>
          <Breadcrumbs items={CRUMBS} />
          <div className="mt-6 grid gap-10 lg:grid-cols-[1.05fr_1fr] items-center">
            <div>
              <SectionEyebrow n={2} isNew>Make My Brand</SectionEyebrow>
              <h1 className="mt-4 text-[32px] sm:text-[50px] leading-[1.05] font-extrabold tracking-[-0.03em]">{h1a} <span className="text-blue">{h1b}</span></h1>
              <p className="mt-4 text-[16.5px] text-body-2 leading-[1.6] max-w-[560px]">{block(blocks, 'mmb.hero.lead', 'Choose a product Octopus lists directly, add your logo and packaging, and approve a proof and a sample. We produce it, check it, keep it as your stock in our warehouse and ship it wherever you sell.')}</p>
              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <Link href={BRAND_START_HREF} className="btn btn-primary btn-hero" data-testid="mmb-start">Start a brand project <Arrow /></Link>
                <Link href="/contact" className="btn btn-ghost btn-hero">Talk to an account manager</Link>
              </div>
              <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-1.5 text-[13.5px] text-body-2">
                {['Verified suppliers only', 'Price confirmed before you pay', 'One account manager'].map((t) => <li key={t} className="flex items-center gap-1.5"><Icon name="check" size={15} className="text-ok" />{t}</li>)}
              </ul>
            </div>
            <figure className="rounded-[18px] bg-navy p-4 sm:p-5">
              <div className="grid grid-cols-2 gap-3">
                <Preview src="/mmb/F8.jpg" alt="Handheld fan with the example brand Nova Breeze" className="aspect-[4/5] rounded-[12px]" />
                <Preview src="/mmb/G1000.jpg" alt="Neck fan with the example brand Nova Breeze" className="aspect-[4/5] rounded-[12px]" />
              </div>
              <figcaption className="mt-3 text-[12.5px] text-[#C9D0E8]">{STUDIO_CAPTION}</figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="mmb-how-h" className="bg-white border-b border-line">
        <div className={`${W} py-12 sm:py-16`}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-[640px]">
              <div className="k !text-blue">How it works</div>
              <h2 id="mmb-how-h" className="mt-2 text-[25px] sm:text-[34px] font-extrabold leading-[1.12]">{block(blocks, 'mmb.how.title', 'Six steps from product to your customer')}</h2>
              <p className="mt-2 text-[15.5px] text-body-2">Each step shows who does the work. Your account manager guides you through every approval.</p>
            </div>
            <Link href={BRAND_START_HREF} className="inline-flex items-center min-h-11 font-semibold text-blue">Start a brand project <Arrow /></Link>
          </div>
          <div className="mt-7"><StepCards steps={MMB_STEPS} cols={3} /></div>
          <div className="mt-5"><Notice>Before any payment, your quote confirms the final price, delivery date, duties and shipping. You pay from your US dollar wallet, topped up by bank transfer.</Notice></div>
        </div>
      </section>

      {/* Branding methods */}
      <section aria-labelledby="mmb-methods-h" className="border-b border-line">
        <div className={`${W} py-12 sm:py-16`}>
          <div className="flex items-center gap-2"><div className="k !text-blue">What you can brand</div>{demo && <ExamplePill />}</div>
          <h2 id="mmb-methods-h" className="mt-2 text-[25px] sm:text-[34px] font-extrabold leading-[1.12]">Branding methods</h2>
          <p className="mt-2 text-[15.5px] text-body-2 max-w-[640px]">What is possible depends on the product. Your account manager confirms the method, minimum quantity and time in your quote.</p>
          <ul className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="mmb-methods">
            {methods.map((m) => (
              <li key={m.key} className="card p-[18px] flex flex-col">
                <span className="inline-flex items-center justify-center w-10 h-10 rounded-[10px] bg-blue-soft text-blue"><Icon name={m.icon} /></span>
                <h3 className="mt-3 text-[16px] font-bold">{m.name}</h3>
                <p className="mt-1 text-[13.5px] text-muted leading-relaxed flex-1">{m.body}</p>
                <dl className="mt-4 pt-3 border-t border-line space-y-1.5 text-[13px]">
                  <div className="flex justify-between gap-2"><dt className="text-muted">Minimum quantity</dt><dd className="font-semibold text-navy tabular-nums text-right">{m.moq ? `${fmtInt(m.moq)} units` : TBC}</dd></div>
                  <div className="flex justify-between gap-2"><dt className="text-muted">Typical extra time</dt><dd className="font-semibold text-navy text-right">{m.days ?? TBC}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Example projects */}
      <section aria-labelledby="mmb-examples-h" className="bg-white border-b border-line">
        <div className={`${W} py-12 sm:py-16`}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-[640px]">
              <div className="k !text-blue">Example projects</div>
              <h2 id="mmb-examples-h" className="mt-2 text-[25px] sm:text-[34px] font-extrabold leading-[1.12]">What a brand project can look like</h2>
              <p className="mt-2 text-[15.5px] text-body-2">These are examples using the invented brand {EXAMPLE_BRAND}, not real customer orders.</p>
            </div>
            <Link href="/products" className="inline-flex items-center min-h-11 font-semibold text-blue">Browse verified products <Arrow /></Link>
          </div>
          <ul className="mt-7 grid gap-4 md:grid-cols-3">
            {EXAMPLES.map((e) => {
              const q = exampleQty(settings, e.key);
              return (
                <li key={e.key} className="card overflow-hidden" data-testid="mmb-example">
                  <Preview src={e.src} alt={e.alt} className="aspect-[4/3]" />
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-2"><h3 className="text-[16px] font-bold">{e.product}</h3><ExamplePill /></div>
                    <dl className="mt-3 space-y-1.5 text-[13px]">
                      <div className="flex justify-between gap-2"><dt className="text-muted">Branding</dt><dd className="font-semibold text-navy text-right">{e.method}</dd></div>
                      {q && <div className="flex justify-between gap-2"><dt className="text-muted">Quantity</dt><dd className="font-semibold text-navy tabular-nums">{fmtInt(q)} units</dd></div>}
                    </dl>
                    <p className="mt-2 text-[12.5px] text-muted">{STUDIO_CAPTION}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      {/* Account manager */}
      <section aria-labelledby="mmb-am-h" className="border-b border-line">
        <div className={`${W} py-12 sm:py-16`}>
          <div className="card p-6 sm:p-8 grid gap-8 lg:grid-cols-2">
            <div>
              <div className="k !text-blue">Your account manager</div>
              <h2 id="mmb-am-h" className="mt-2 text-[25px] sm:text-[30px] font-extrabold leading-[1.15]">One person for your whole project</h2>
              <p className="mt-2 text-[15.5px] text-body-2">Every customer has one Octopus account manager. You never chase a factory yourself.</p>
              <div className="mt-6 flex items-center gap-3">
                <span className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-navy text-white"><Icon name="user" /></span>
                <div><div className="font-bold text-navy">Your own account manager</div>{reply && <div className="text-[13px] text-muted">Replies within {reply} working hours{demo && <ExamplePill className="ml-2" />}</div>}</div>
              </div>
            </div>
            <ul className="space-y-2.5 text-[14.5px] text-body-2">
              {['Checks that your product can carry the branding you want', 'Prepares your artwork proof and sends it for your approval', 'Arranges your sample and confirms it with you', 'Sends your quote with price, delivery date, duties and shipping', 'Follows production and the QC inspection for you', 'Plans how your stock ships, in bulk or order by order'].map((t) => (
                <li key={t} className="flex gap-2.5"><span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-ok-bg text-ok shrink-0"><Icon name="check" size={12} /></span>{t}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* What it costs */}
      <section aria-labelledby="mmb-cost-h" className="bg-white border-b border-line">
        <div className={`${W} py-12 sm:py-16 grid gap-10 lg:grid-cols-[0.8fr_1.2fr] items-start`}>
          <div>
            <div className="k !text-blue">What it costs</div>
            <h2 id="mmb-cost-h" className="mt-2 text-[25px] sm:text-[34px] font-extrabold leading-[1.12]">Every cost on one line before you pay</h2>
            <p className="mt-3 text-[15.5px] text-body-2">Your quote lists the product, branding, packaging, sample and inspection separately, so you see exactly what you pay for.</p>
            <ul className="mt-5 space-y-2 text-[14.5px] text-body-2">
              {['Final price, delivery date, duties and shipping confirmed in your quote', 'Paid from your US dollar wallet, topped up by bank transfer', 'No card payments'].map((t) => <li key={t} className="flex gap-2"><Icon name="check" size={16} className="text-ok mt-0.5" />{t}</li>)}
            </ul>
          </div>
          <div className="card overflow-hidden" data-testid="mmb-example-quote">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 border-b border-line">
              <div className="flex items-center gap-2"><ExamplePill /><span className="font-bold text-navy">Example quote</span></div>
              <span className="text-[12.5px] text-muted">Handheld fan F8 · {EXAMPLE_BRAND}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[14px] min-w-[480px]">
                <thead><tr><th className="th !py-2.5">Item</th><th className="th !py-2.5">What it covers</th><th className="th !py-2.5 !text-right">Amount</th></tr></thead>
                <tbody>
                  {EXAMPLE_QUOTE.rows.map(([item, what, c]) => (
                    <tr key={item}><td className="td !py-3 font-semibold">{item}</td><td className="td !py-3 text-body-2">{what}</td><td className="td !py-3 text-right tabular-nums whitespace-nowrap">{usd(c)}</td></tr>
                  ))}
                  <tr className="bg-surface"><td className="td !py-3 font-bold" colSpan={2}>Total</td><td className="td !py-3 text-right font-bold tabular-nums whitespace-nowrap">{usd(EXAMPLE_QUOTE.total)}</td></tr>
                </tbody>
              </table>
            </div>
            <div className="p-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded-[10px] bg-surface border border-line p-3.5"><div className="k">Deposit to start</div><div className="mt-1 text-[20px] font-bold tabular-nums">{usd(EXAMPLE_QUOTE.deposit)}</div></div>
              <div className="rounded-[10px] bg-surface border border-line p-3.5"><div className="k">Balance before shipping</div><div className="mt-1 text-[20px] font-bold tabular-nums">{usd(EXAMPLE_QUOTE.balance)}</div></div>
            </div>
            <p className="px-5 pb-5 text-[13px] text-muted"><b className="text-navy">Example quote</b> — your price is confirmed in your own quote before you pay. Shipping and duties depend on your destination.</p>
          </div>
        </div>
      </section>

      {/* Where your stock goes */}
      <section aria-labelledby="mmb-stock-h" className="border-b border-line">
        <div className={`${W} py-12 sm:py-16`}>
          <div className="k !text-blue">Where your stock goes</div>
          <h2 id="mmb-stock-h" className="mt-2 text-[25px] sm:text-[34px] font-extrabold leading-[1.12]">Stocked with us, shipped worldwide</h2>
          <p className="mt-2 text-[15.5px] text-body-2 max-w-[640px]">Your finished goods wait in the Octopus warehouse as your stock. You decide how they leave.</p>
          <ul className="mt-7 grid gap-3 md:grid-cols-3">
            {[
              ['Your stock', 'Kept in our warehouse', 'Checked goods are stored as your stock. You see units on hand in My account.'],
              ['Bulk', 'In bulk to one country', 'Send cartons to your own warehouse or distributor, with duties confirmed in your quote.'],
              ['Order by order', 'From your online store', 'Shopify and WooCommerce store connection is coming soon — upload orders as a sheet meanwhile. We ship each order from your stock.'],
            ].map(([tag, t, b]) => (
              <li key={t} className="card p-5"><Pill tone="info">{tag}</Pill><h3 className="mt-3 text-[16.5px] font-bold">{t}</h3><p className="mt-1 text-[14px] text-muted leading-relaxed">{b}</p></li>
            ))}
          </ul>
          <div className="mt-4 card px-5 py-3.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[13.5px] font-bold text-navy">Shipping services</span>
            {SHIPPING_SERVICES.map((s) => <Pill key={s}>{s}</Pill>)}
            <span className="sm:ml-auto text-[13px] text-muted">Price and delivery estimate shown before you confirm.</span>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section aria-labelledby="mmb-faq-h">
        <div className={`${W} py-12 sm:py-16 max-w-[860px]`}>
          <h2 id="mmb-faq-h" className="text-[25px] sm:text-[30px] font-extrabold">Questions</h2>
          <div className="mt-5"><FAQ items={faq} id="faq" /></div>
        </div>
      </section>

      {/* CTA */}
      <section className={`${W} pb-6`}>
        <div className="rounded-[18px] bg-navy text-white p-6 sm:p-8 flex flex-col md:flex-row md:items-center gap-5 justify-between">
          <div className="max-w-[560px]">
            <h2 className="!text-white text-[22px] sm:text-[26px] font-extrabold flex items-center gap-2">Start a brand project <NewBadge /></h2>
            <p className="mt-1.5 text-[14.5px] text-[#C9D0E8]">Tell us the product and your brand. Your account manager sends a proof and a quote before you pay anything.</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href={BRAND_START_HREF} className="btn btn-light btn-pub">Start a brand project <Arrow /></Link>
            <Link href="/contact" className="btn btn-pub border-white/40 text-white hover:bg-white/10 hover:text-white">Talk to an account manager</Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function MmbSkeleton() {
  return <div aria-busy="true" aria-label="Loading" className="wrap py-10 space-y-6"><div className="h-[360px] card" /><div className="grid gap-3 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="card h-[140px]" />)}</div></div>;
}

/** ADDON-44-D board 21 — public Make My Brand page. Numbers only from settings ("To be confirmed" when empty); examples labelled. */
export default function MakeMyBrandPage() {
  return <Suspense fallback={<MmbSkeleton />}><MakeMyBrandView /></Suspense>;
}
