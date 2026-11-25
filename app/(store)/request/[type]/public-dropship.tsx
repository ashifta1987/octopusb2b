import Link from 'next/link';
import { COUNTRY_NAMES, money } from '@/lib/format';
import { createClient } from '@/lib/supabase/server';
import { getDropshipLaunchCountries } from '@/lib/dropship-features';

/**
 * Release 1 · EA-2 — screens/EA_PublicDropship.html + mobile/M_EA_PublicDropship.html.
 * Signed-out visitors to /request/dropship while dropship_v2_ui is ON. Numbers come from settings and the active fee
 * version; an answer whose number isn't set is left out (no placeholders). No per-product prices here.
 */
export async function PublicDropshipPage() {
  const sb = await createClient();
  const [feeRes, countries] = await Promise.all([sb.rpc('public_dropship_processing_fee'), getDropshipLaunchCountries()]);
  const fee = (feeRes.data ?? null) as { first_item_cents?: number; extra_item_cents?: number } | null;
  const feeText = fee?.first_item_cents != null
    ? `${money(Number(fee.first_item_cents), 'USD')} first item${fee.extra_item_cents != null ? `, ${money(Number(fee.extra_item_cents), 'USD')} each extra item` : ''}`
    : null;
  const countryText = countries.length ? countries.map((c) => COUNTRY_NAMES[c] ?? c).join(', ') : null;
  const signup = '/signup?next=%2Faccount%2Fdropship';
  const login = '/login?next=%2Faccount%2Fdropship';
  const faqs: [string, string][] = [
    ...(feeText ? [['What does it cost?', `Plan fees: free while they’re off. Each order: product + processing (${feeText}) + shipping + duties.`] as [string, string]] : []),
    ...(countryText ? [['Which countries?', `${countryText} at launch.`] as [string, string]] : []),
    ['When can I connect Shopify?', 'In the next release. You can browse and request products now.'],
    ['Who can join?', 'Companies that pass our verification (KYC).'],
  ];

  return (
    <div className="max-w-[1100px] mx-auto px-4 sm:px-6 py-10 flex flex-col gap-10" data-testid="public-dropship">
      <section className="flex flex-col gap-4 max-w-[760px]">
        <span className="pill bg-tint text-ink self-start">Early access</span>
        <h1 className="font-display text-[34px] sm:text-[42px] font-bold leading-tight text-ink m-0">
          Sell Octopus products in your store. We pack and ship every order under your brand.
        </h1>
        <p className="text-[17px] text-black m-0">
          See the full landed cost to each country before you list a product: product, processing, shipping and duties. Pay from one wallet. Your buyers only ever see your brand.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href={signup} className="btn btn-primary min-h-11" data-testid="public-dropship-signup">Create an account</Link>
          <Link href={login} className="btn btn-ghost min-h-11" data-testid="public-dropship-login">Log in to request access</Link>
        </div>
        <p className="text-[14px] text-black/75 m-0">Open to verified companies. Our team approves each request.</p>
      </section>

      <section aria-labelledby="how-h" className="flex flex-col gap-4">
        <h2 id="how-h" className="text-[22px] font-semibold text-ink m-0">How it works</h2>
        <ol className="list-none m-0 p-0 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {['Verify your company', 'Request access', 'Browse with landed costs', 'Connect your store (next release)'].map((t, i) => (
            <li key={t} className="card p-4 flex items-start gap-3">
              <span className="inline-flex w-8 h-8 rounded-full bg-ink text-white items-center justify-center font-bold shrink-0" aria-hidden="true">{i + 1}</span>
              <span className="text-[15px] font-medium text-ink">{t}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-label="What you get" className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          ['Landed cost per country', 'Product, processing, shipping and duties in one number, before you list.'],
          ['Your brand on every parcel', 'Your brand and return address on labels and the tracking page. No supplier names, ever.'],
          ['One wallet', 'Add funds by bank transfer and pay for products from one balance.'],
          ['Request any product', 'Ask our sourcing team for products we don’t stock yet. Free.'],
        ].map(([t, d]) => (
          <div key={t} className="card p-5">
            <h3 className="text-[17px] font-semibold text-ink m-0">{t}</h3>
            <p className="text-[15px] text-black mt-1 mb-0">{d}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="faq-h" className="flex flex-col gap-3 max-w-[760px]">
        <h2 id="faq-h" className="text-[22px] font-semibold text-ink m-0">Questions</h2>
        <dl className="m-0 flex flex-col gap-3" data-testid="public-dropship-faq">
          {faqs.map(([q, a]) => (
            <div key={q} className="card p-4">
              <dt className="font-semibold text-ink">{q}</dt>
              <dd className="m-0 mt-1 text-[15px] text-black">{a}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
