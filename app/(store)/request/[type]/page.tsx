import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { block } from '@/lib/content';
import { getStoreContent } from '@/components/store/currency';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { COUNTRY_NAMES } from '@/lib/format';
import { Notice } from '@/components/ui';
import { getServices, getProductById } from '@/components/store/data';
import { REQUEST_TYPES, isRequestType, SERVICE_CODE, type RequestType } from '@/components/store/request-schema';
import { RequestForm } from '@/components/store/request-form';
import { AdSlot } from '@/components/store/ad-slot';
import { parts } from '@/components/store/seo';
import { submitRequest } from './actions';

type Params = Promise<{ type: string }>;
type SP = Promise<{ product?: string; qty?: string }>;

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
  const productQs = product ? `?product=${product.id}` : '';
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

  const [talkT, talkB] = parts(blocks, 'request.talk', 'Prefer to talk it through?|Message our sourcing team and share photos directly.');
  const [loginT, loginB] = parts(blocks, 'request.login', 'Sign in to submit|An account is needed to submit requests.');
  const wa = company?.whatsapp ? `https://wa.me/${company.whatsapp.replace(/\D/g, '')}` : null;
  const next = [1, 2, 3, 4, 5, 6].map((n) => parts(blocks, `request.next.${n}`)).filter((x) => x[0]);

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-10 sm:py-12">
      <div className="eyebrow">{block(blocks, 'request.eyebrow', 'Request Center')}</div>
      <h1 className="text-[34px] sm:text-[44px] font-extrabold leading-[1.1] mt-3 max-w-[780px]">{block(blocks, 'request.title')}</h1>
      <p className="text-[17px] text-[#3B4556] mt-4 max-w-[760px] leading-relaxed">{block(blocks, 'request.subtitle')}</p>

      <nav aria-label="Request type" className="mt-8">
        <ul className="grid gap-2 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {REQUEST_TYPES.map((t) => {
            const [title, sub] = parts(blocks, `request.type.${t}`, FALLBACK[t]);
            const on = t === type;
            return (
              <li key={t}>
                <Link href={`/request/${t}${productQs}`} aria-current={on ? 'page' : undefined}
                  className={`block h-full rounded-[14px] border px-5 py-4 ${on ? 'bg-navy border-navy text-white' : 'bg-white border-line hover:border-navy'}`}>
                  <span className="block font-semibold">{title}</span>
                  <span className={`block text-[13px] mt-1 ${on ? 'text-[#C9CFDB]' : 'text-muted'}`}>{sub}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px] items-start">
        <section className="card p-6 sm:p-8 space-y-6 min-w-0" aria-label="Request form">
          {mode === 'guest' && (
            <div id="req-locked"><Notice tone="blue"><strong>{loginT}.</strong> {loginB} <Link href={loginHref} className="underline font-semibold">Sign in or create an account</Link>.</Notice></div>
          )}
          {mode === 'no-org' && (
            <div id="req-locked"><Notice tone="amber">Please <Link href="/onboarding" className="underline font-semibold">complete your company profile</Link> before submitting requests.</Notice></div>
          )}
          {product && (
            <div className="rounded-[10px] border border-line bg-surface px-4 py-3 text-sm flex flex-wrap justify-between gap-2">
              <span>Request for <Link href={`/p/${product.slug}`} className="font-semibold text-blue">{product.title}</Link></span>
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
            feeLabel={fee > 0 ? `Charged once ${svc?.unit ?? 'per request'} when you submit it.` : 'No fee to submit — you will receive a quote.'}
            balanceCents={balance} creditCents={credit} walletEnabled={walletEnabled} currency={svcCurrency} mode={mode} loginHref={loginHref}
          />
        </section>

        <aside className="space-y-4 min-w-0" aria-label="About your request">
          {next.length > 0 && (
            <section className="rounded-[14px] bg-navy text-white p-7" aria-labelledby="next-h">
              <h2 id="next-h" className="!text-white text-xl font-semibold">What happens next</h2>
              <ol className="mt-5 relative">
                {next.map(([t, b], i) => (
                  <li key={i} className="relative pl-10 pb-5 last:pb-0">
                    {i < next.length - 1 && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-blue/60" aria-hidden />}
                    <span className="absolute left-0 top-0 w-7 h-7 rounded-full border-2 border-[#5B9BF0] flex items-center justify-center text-[11px] font-semibold" aria-hidden>{i + 1}</span>
                    <div className="font-semibold">{t}</div>
                    <div className="text-[13px] text-[#C9CFDB] mt-0.5">{b}</div>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <AdSlot placement="product_side" layout="card" />
          {wa && (
            <section className="card p-6" aria-labelledby="talk-h">
              <h2 id="talk-h" className="text-base font-semibold">{talkT}</h2>
              <p className="text-[13px] text-muted mt-2">{talkB}</p>
              <a href={wa} target="_blank" rel="noopener noreferrer" className="btn btn-ghost w-full mt-4 !border-ok text-[#156B3A]">Chat on WhatsApp</a>
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
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_300px]"><div className="card h-[640px]" /><div className="rounded-[14px] bg-navy h-[520px]" /></div>
    </div>
  );
}
