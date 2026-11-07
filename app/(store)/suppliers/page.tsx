import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getSiteContent, block } from '@/lib/content';
import { parts, Breadcrumbs } from '@/components/store/seo';
import { ApplyForm } from './apply-form';

export const metadata: Metadata = {
  title: 'Sell on Octopus B2B — become a verified supplier',
  description: 'List your factory on Octopus B2B and reach wholesale buyers in the Gulf, Africa and worldwide. Free to apply; we handle buyers, payment and export paperwork.',
  alternates: { canonical: '/suppliers' },
};

const OFFER = 'Buyers you would not reach alone|Wholesale importers, retailers and dropshippers in the Gulf, Africa, Europe and Asia send RFQs every day.;'
  + 'Paid through escrow|Buyers pay a deposit into escrow before you produce; the balance is released after QC and shipping.;'
  + 'We handle the export work|Our China offices do QC, consolidation, export documents and shipping for every order.;'
  + 'No listing fee|Applying and listing are free. We earn a margin on orders we bring you.';
const REQUIRE = 'A registered Chinese company with a valid business licence (USCC);Your own factory or a long-term factory partner;MOQ, price tiers and lead times you can keep;Product photos, specifications and, where needed, certificates (CE, RoHS, FCC…);Willingness to accept a factory audit and pre-shipment QC';
const STEPS = 'Apply|Send the form below with your licence number and a product sheet.;'
  + 'Review|We check your licence and product range, usually within 3 working days.;'
  + 'Audit|A sourcing lead visits or video-audits the factory.;'
  + 'Go live|We list your products under your supplier code and start sending RFQs.';

/** ADDON-36 C5 — public supplier recruitment page ("Sell on Octopus B2B"). All copy overridable from the CMS. */
export default function SuppliersPage() {
  return (
    <Suspense fallback={<div className="max-w-[1180px] mx-auto px-4 sm:px-8 py-10 min-h-[80vh]" aria-busy="true" />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const { blocks, categories } = await getSiteContent();
  const [h1, intro] = parts(blocks, 'suppliers.hero', 'Sell on Octopus B2B|Reach wholesale buyers worldwide. We bring the orders, collect payment through escrow and handle QC, export and shipping from our offices in China.');
  const offer = block(blocks, 'suppliers.offer', OFFER).split(';').map((x) => x.split('|'));
  const req = block(blocks, 'suppliers.requirements', REQUIRE).split(';');
  const steps = block(blocks, 'suppliers.steps', STEPS).split(';').map((x) => x.split('|'));
  const cats = categories.filter((c) => c.level === 1).sort((a, b) => a.sort - b.sort).map((c) => c.name);

  return (
    <div className="max-w-[1180px] mx-auto px-4 sm:px-8 py-8 sm:py-12">
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Sell on Octopus B2B' }]} />
      <section className="mt-4 rounded-[18px] bg-navy text-white px-6 sm:px-10 py-10">
        <h1 className="!text-white text-[30px] sm:text-[40px] font-extrabold leading-tight max-w-[720px]">{h1}</h1>
        <p className="mt-3 text-[#C9CFDB] text-[16px] max-w-[680px]">{intro}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a href="#apply" className="btn btn-primary min-h-11">Apply to sell</a>
          <Link href="/staff/login" className="btn btn-ghost min-h-11 !bg-white/10 !text-white !border-white/30">Supplier and staff sign-in</Link>
        </div>
      </section>

      <section aria-labelledby="offer-h" className="mt-12">
        <h2 id="offer-h" className="text-2xl font-extrabold">What you get</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {offer.map(([t, b]) => (
            <div key={t} className="card p-5"><h3 className="text-[16px] font-bold">{t}</h3><p className="text-[14px] text-muted mt-1.5">{b}</p></div>
          ))}
        </div>
      </section>

      <div className="mt-12 grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="req-h">
          <h2 id="req-h" className="text-2xl font-extrabold">Requirements</h2>
          <ul className="mt-4 space-y-2.5">
            {req.map((r) => <li key={r} className="flex gap-2.5 text-[15px]"><span aria-hidden className="text-ok font-bold">✓</span>{r}</li>)}
          </ul>
        </section>
        <section aria-labelledby="steps-h">
          <h2 id="steps-h" className="text-2xl font-extrabold">How it works</h2>
          <ol className="mt-4 space-y-3">
            {steps.map(([t, b], i) => (
              <li key={t} className="flex gap-3">
                <span className="mono shrink-0 w-8 h-8 rounded-full bg-surface border border-line flex items-center justify-center text-[13px] font-bold">{i + 1}</span>
                <div><div className="font-bold">{t}</div><p className="text-[14px] text-muted">{b}</p></div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section id="apply" aria-labelledby="apply-h" className="mt-12 card p-6 sm:p-8 scroll-mt-24">
        <h2 id="apply-h" className="text-2xl font-extrabold">Apply to sell</h2>
        <p className="text-[14px] text-muted mt-1 mb-6">Takes about 3 minutes. Fields marked * are required.</p>
        <ApplyForm categories={cats} />
      </section>
    </div>
  );
}
