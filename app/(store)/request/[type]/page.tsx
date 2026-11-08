import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { block } from '@/lib/content';
import { getStoreContent } from '@/components/store/currency';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { COUNTRY_NAMES, money } from '@/lib/format';
import { Notice } from '@/components/ui';
import { getServices, getProductById } from '@/components/store/data';
import { REQUEST_TYPES, isRequestType, SERVICE_CODE, type RequestType } from '@/components/store/request-schema';
import { RequestForm } from '@/components/store/request-form';
import { AdSlot } from '@/components/store/ad-slot';
import { parts } from '@/components/store/seo';
import { submitRequest } from './actions';
import { RequestTabs } from '@/components/store/request-tabs';
import { ExamplePill, Icon, TBC } from '@/components/ds';
import type { Warehouse } from '@/components/store/request-form';

type Params = Promise<{ type: string }>;
type SP = Promise<{ product?: string; qty?: string; title?: string; country?: string; city?: string; category?: string }>;

/** ADDON-36 (M1): every request type has its own heading + one-line intro (CMS override: request.h1.<type> = "Title|Intro"). */
const HEAD: Record<RequestType, string> = {
  sourcing: "Tell us the product. We'll find the factory.|Matched, verified factories quote within 24 hours. You compare and choose; we inspect and ship.",
  dropship: 'Start dropshipping with Octopus B2B|Sell our verified products in your store. We pack each order under your brand and ship it to your customer.',
  '3pl': 'Store your stock near your buyers|Ship your bulk order once. We receive it, store it by SKU and send out each order as it comes in.',
  sample: 'Order a sample before you buy in bulk|Check quality, packaging and finish in your hands before you commit to a bulk order.',
  qc: 'Book a quality inspection|Our inspectors check the goods at the factory, with photos and video, before anything ships.',
  certification: 'Get your product certified for your market|CE, FCC, RoHS, SASO and more, arranged with accredited labs.',
};
/** ADDON-36 (H2): dropshipping is an onboarding, not a quote request. */
/** ADDON-44-C (audit 11): 3PL has its own steps — Octopus quotes warehousing, not suppliers. */
const THREEPL_STEPS = ['Submitted|You get a reference number right away.', 'Rates sent|Octopus sends storage, pick-and-pack and shipping rates for your goods.', 'Accepted|You accept the rates in My account › 3PL warehouse.', 'Send your first inbound notice|Tell us what is coming: cartons, SKUs and arrival date.', 'Goods received and counted|We check and count every carton and put it on your stock list.', 'Live|Orders ship from your stock and you follow everything in your account.'];
const DROPSHIP_STEPS = 'Create your account|Free, takes two minutes.;Choose products|Pick from the dropship catalogue of verified factories.;Connect your store|Shopify or WooCommerce — store connection coming soon; upload orders as a sheet meanwhile.;Top up your wallet|Product, shipping and fulfilment are paid from it per order. Top up by bank transfer.;We pack and ship|Packed under your brand, tracked to your customer.';

const FALLBACK: Record<RequestType, string> = {
  sourcing: 'Product sourcing|Find a product we don’t list yet', '3pl': '3PL service|Warehousing and fulfillment', dropship: 'Dropshipping|Ship straight to your customers',
  sample: 'Sample request|Check quality before bulk', qc: 'QC inspection|Inspect before it ships', certification: 'Certification|CE, FCC, RoHS and more',
};

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { type } = await params;
  if (!isRequestType(type)) return { title: 'Request Center', robots: { index: false } };
  const { blocks } = await getStoreContent();
  const [title, sub] = parts(blocks, `request.type.${type}`, FALLBACK[type]);
  return { title: `${title} · Request Center`, description: `${sub}. ${block(blocks, 'request.subtitle')}`.slice(0, 160), alternates: { canonical: `/request/${type}` } };
}

/** Request.png — Request Center (public; submitting requires sign-in + company profile). */
export default function RequestPage({ params, searchParams }: { params: Params; searchParams: SP }) {
  return (
    <Suspense fallback={<RequestSkeleton />}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: { params: Params; searchParams: SP }) {
  const [{ type }, sp] = await Promise.all([params, searchParams]);
  if (!isRequestType(type)) notFound();
  const [{ blocks, settings, company, ctx }, services, session, product] = await Promise.all([
    getStoreContent(), getServices(), getSession(), sp.product ? getProductById(sp.product) : Promise.resolve(null),
  ]);
  const walletEnabled = settings.wallet_enabled !== false;
  const svc = services[SERVICE_CODE[type]];
  const fee = svc?.priceCents ?? 0;
  const svcCurrency = svc?.currency ?? ctx.currency;
  let balance: number | null = null;
  let credit = 0;
  if (session?.org) {
    const sb = await createClient();
    // Charges use the wallet in the platform currency (SPEC §15.1); the wallet may use its credit limit (migration 143).
    const { data } = await sb.rpc('my_wallet_credit', { p_currency: svcCurrency }).maybeSingle<{ balance_minor: number; credit_limit_minor: number }>();
    balance = data == null ? 0 : Number(data.balance_minor);
    credit = data == null ? 0 : Number(data.credit_limit_minor);
  }
  const prefill = new URLSearchParams(Object.entries({ title: product ? undefined : sp.title, qty: sp.qty, country: sp.country, city: sp.city, category: sp.category }).filter(([, v]) => typeof v === 'string' && v) as [string, string][]).toString();
  const productQs = product ? `?product=${product.id}${prefill ? `&${prefill}` : ''}` : prefill ? `?${prefill}` : '';
  const loginHref = `/login?next=${encodeURIComponent(`/request/${type}${productQs}`)}`;
  const mode = !session ? 'guest' : !session.org ? 'no-org' : 'ready';
  const orgCountry = session?.org?.country && session.org.country in COUNTRY_NAMES ? session.org.country : '';

  const defaults: Record<string, string> = {};
  if (product) {
    defaults.title = product.title;
    defaults.product = product.title;
    if (type === 'sourcing') defaults.quantity = String(sp.qty && /^\d+$/.test(sp.qty) ? sp.qty : product.moq);
  }
  if (orgCountry) { defaults.destination_country = orgCountry; defaults.warehouse_country = orgCountry; defaults.target_market = orgCountry; }
  // home "Get quotes in 24 h" form: ?title=&qty=&country= prefill the sourcing request (validated, never trusted)
  // ADDON-36 (C2, C3): every request type reads title / qty / country / city from the query string (validated, unknown keys ignored)
  {
    const t = typeof sp.title === 'string' ? sp.title.trim().slice(0, 200) : '';
    if (t && !product) { defaults.title = t; defaults.product = t; }
    if (typeof sp.qty === 'string' && /^\d{1,9}$/.test(sp.qty)) defaults.quantity = sp.qty;
    const c = typeof sp.country === 'string' ? sp.country.toUpperCase() : '';
    if (c in COUNTRY_NAMES) { defaults.destination_country = c; defaults.warehouse_country = c; defaults.target_market = c; }
    const city = typeof sp.city === 'string' ? sp.city.trim().slice(0, 120) : '';
    if (city) defaults.destination_city = city;
    const cat = typeof sp.category === 'string' && /^[a-z0-9-]{2,80}$/.test(sp.category) ? sp.category : '';
    if (cat && type === 'sourcing' && !defaults.details) defaults.details = `Category: ${cat.replace(/-/g, ' ')}\n`;
  }

  const [talkT, talkB] = parts(blocks, 'request.talk', 'Prefer to talk it through?|Message our sourcing team and share photos directly.');
  const [loginT, loginB] = parts(blocks, 'request.login', 'Sign in to submit|An account is needed to submit requests.');
  const wa = company?.whatsapp ? `https://wa.me/${company.whatsapp.replace(/\D/g, '')}` : null;
  const next = type === 'dropship'
    ? block(blocks, 'request.dropship.steps', DROPSHIP_STEPS).split(';').map((x) => x.split('|') as [string, string])
    : type === '3pl'
      ? THREEPL_STEPS.map((f, i) => parts(blocks, `request.next.3pl.${i + 1}`, f)).filter((x) => x[0])
      : [1, 2, 3, 4, 5, 6].map((n) => parts(blocks, `request.next.${n}`)).filter((x) => x[0]);
  const [h1, intro] = parts(blocks, `request.h1.${type}`, HEAD[type]);
  // ADDON-44-F board 25: warehouses, rates and cut-off come from settings only (nothing invented)
  const warehouses: Warehouse[] = Array.isArray(settings.warehouses)
    ? (settings.warehouses as Warehouse[]).filter((w) => w && typeof w.code === 'string' && typeof w.city === 'string' && typeof w.country === 'string')
    : [];
  const rates = typeof settings['3pl.rates_text'] === 'string' && (settings['3pl.rates_text'] as string).trim() ? (settings['3pl.rates_text'] as string) : null;
  const cutoff = typeof settings['3pl.cutoff'] === 'string' && (settings['3pl.cutoff'] as string).trim() ? (settings['3pl.cutoff'] as string) : null;
  const demo = settings['demo.addon44'] === true;

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-10 sm:py-12">
      <div className="eyebrow">{block(blocks, 'request.eyebrow', 'Request Center')}</div>
      <h1 className="text-[34px] sm:text-[44px] font-extrabold leading-[1.1] mt-3 max-w-[780px]">{h1}</h1>
      <p className="text-[17px] text-black mt-4 max-w-[760px] leading-relaxed">{intro}</p>

      <RequestTabs blocks={blocks} active={type} qs={productQs} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px] items-start">
        <section className="card p-6 sm:p-8 space-y-6 min-w-0" aria-label="Request form">
          {mode === 'guest' && (
            <div id="req-locked"><Notice tone="blue"><strong>{loginT}.</strong> {loginB} <Link href={loginHref} className="underline font-semibold">Sign in or create an account</Link>.</Notice></div>
          )}
          {mode === 'no-org' && (
            <div id="req-locked"><Notice tone="amber">Please <Link href="/onboarding" className="underline font-semibold">complete your company profile</Link> before submitting requests.</Notice></div>
          )}
          {product && (
            <div className="rounded-[10px] border border-line bg-pearl px-4 py-3 text-sm flex flex-wrap justify-between gap-2">
              <span>Request for <Link href={`/p/${product.slug}`} className="font-semibold text-coral-text">{product.title}</Link></span>
              <Link href={`/request/${type}`} className="text-muted underline">Remove product</Link>
            </div>
          )}
          {session?.org && (
            <div>
              <h2 className="text-xl font-semibold mb-3">Your company</h2>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-[14px]">
                <div><dt className="text-muted text-[12px]">Company</dt><dd className="font-semibold">{session.org.name}</dd></div>
                <div><dt className="text-muted text-[12px]">Country</dt><dd className="font-semibold">{(session.org.country && COUNTRY_NAMES[session.org.country]) ?? session.org.country ?? '—'}</dd></div>
                <div><dt className="text-muted text-[12px]">Email</dt><dd className="font-semibold break-all">{session.email ?? '—'}</dd></div>
                <div><dt className="text-muted text-[12px]">WhatsApp / phone</dt><dd className="font-semibold">{session.profile?.phone ?? '—'}</dd></div>
              </dl>
              <p className="text-[12px] text-muted mt-2">Wrong details? Update them in <Link href="/account" className="underline">your account</Link>.</p>
            </div>
          )}
          <RequestForm
            key={type}
            type={type} action={submitRequest} defaults={defaults} productId={product?.id ?? null}
            feeCents={fee} serviceName={svc?.name ?? 'Service fee'}
            feeLabel={fee > 0 ? `${type === 'sourcing' ? 'RFQ fee' : svc?.name ?? 'Fee'} ${money(fee, svcCurrency)}, charged ${walletEnabled ? 'from your wallet' : 'on your next invoice'} when you submit.` : type === 'dropship' ? 'Dropship setup is free. You pay per order from your wallet once orders flow.' : 'Free to submit.'}
            balanceCents={balance} creditCents={credit} walletEnabled={walletEnabled} currency={svcCurrency} mode={mode} loginHref={loginHref}
            warehouses={warehouses} demo={demo}
          />
          {type === '3pl' && (
            <div className="rounded-[12px] border border-line bg-pearl p-4 text-[14px]" data-testid="3pl-rates">
              <div className="flex items-center gap-2 font-semibold text-ink">3PL rates{demo && rates && <ExamplePill />}</div>
              <p className="mt-1 text-black">{rates ?? `${TBC}. Octopus sends storage, pick-and-pack and shipping rates for your goods after you submit.`}</p>
            </div>
          )}
        </section>

        <aside className="space-y-4 min-w-0" aria-label="About your request">
          {next.length > 0 && (
            <section className="rounded-[14px] bg-ink text-white p-7" aria-labelledby="next-h">
              <h2 id="next-h" className="!text-white text-xl font-semibold">{type === 'dropship' ? 'How dropship setup works' : 'What happens next'}</h2>
              <ol className="mt-5 relative">
                {next.map(([t, b], i) => (
                  <li key={i} className="relative pl-10 pb-5 last:pb-0">
                    {i < next.length - 1 && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-coral/60" aria-hidden />}
                    <span className="absolute left-0 top-0 w-7 h-7 rounded-full border-2 border-coral flex items-center justify-center text-[11px] font-semibold" aria-hidden>{i + 1}</span>
                    <div className="font-semibold">{t}</div>
                    <div className="text-[13px] text-on-ink mt-0.5">{(b ?? '').replace('{currency}', svcCurrency)}</div>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {type === '3pl' && (
            <section className="card p-6" aria-labelledby="before-h" data-testid="before-you-ship">
              <h2 id="before-h" className="text-base font-semibold">Before you ship to us</h2>
              <ul className="mt-3 space-y-2 text-[13.5px] text-black">
                {['Label every carton with the SKU and your reference', 'Create an inbound notice in My account › 3PL warehouse before the goods leave',
                  'Check accepted and refused goods with your account manager (batteries, liquids, hazardous goods)',
                  cutoff ? `Same-day dispatch for orders received before ${cutoff}` : `Same-day cut-off time: ${TBC.toLowerCase()}`].map((t) => (
                  <li key={t} className="flex gap-2"><Icon name="check" size={16} className="text-ok mt-0.5" />{t}</li>
                ))}
              </ul>
            </section>
          )}
          <AdSlot placement="product_side" layout="card" />
          {wa && (
            <section className="card p-6" aria-labelledby="talk-h">
              <h2 id="talk-h" className="text-base font-semibold">{talkT}</h2>
              <p className="text-[13px] text-muted mt-2">{talkB}</p>
              <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-ghost w-full mt-4 !border-ok text-ok">Chat on WhatsApp</a>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function RequestSkeleton() {
  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-12" aria-busy="true" aria-label="Loading">
      <div className="h-4 w-32 bg-line rounded" /><div className="h-12 w-2/3 bg-line rounded mt-4" />
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 mt-8">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="card h-[84px]" />)}</div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]"><div className="card h-[640px]" /><div className="rounded-[14px] bg-ink h-[520px]" /></div>
    </div>
  );
}
