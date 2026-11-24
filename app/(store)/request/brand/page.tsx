import { Suspense } from 'react';
import type { Metadata } from 'next';
import { getSession } from '@/lib/auth';
import { createPublicClient } from '@/lib/supabase/server';
import { getStoreContent } from '@/components/store/currency';
import { COUNTRY_NAMES } from '@/lib/format';
import { RequestTabs } from '@/components/store/request-tabs';
import { BrandRequestWizard, type BrandProduct } from '@/components/store/brand-request';
import { MMB_STEPS, brandMethods, replyHours } from '@/components/store/make-my-brand/content';
import { Icon, Notice } from '@/components/ds';

export const metadata: Metadata = {
  title: 'Make My Brand · Request Center',
  description: 'Start a brand project: pick a verified product, add your logo and packaging, and get a quote before you pay anything.',
  alternates: { canonical: '/request/brand' },
};

type SP = Promise<{ product?: string; model?: string; title?: string }>;
const UUID = /^[0-9a-f-]{36}$/i;
const DS_MODEL = /^DS-\d{6}(?:-\d{2})?$/i;

export default function Page({ searchParams }: { searchParams: SP }) {
  return (
    <Suspense fallback={<div aria-busy="true" aria-label="Loading" className="wrap py-12"><div className="h-10 w-2/3 bg-line rounded" /><div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]"><div className="card h-[520px]" /><div className="card h-[420px]" /></div></div>}>
      <BrandRequest searchParams={searchParams} />
    </Suspense>
  );
}

async function BrandRequest({ searchParams }: { searchParams: SP }) {
  const [sp, { blocks, settings }, session] = await Promise.all([searchParams, getStoreContent(), getSession()]);
  const sb = createPublicClient();
  // products from verified factories only (product_factory view: no supplier ids) → live products with a photo
  const wanted = sp.product && UUID.test(sp.product) ? sp.product : null;
  const dsModel = sp.model && DS_MODEL.test(sp.model.trim()) ? sp.model.trim().toUpperCase() : null;
  const dsTitle = dsModel && sp.title ? sp.title.trim().slice(0, 140) : null;
  const [{ data: cand }, { data: one }] = await Promise.all([
    sb.from('products').select('id, title, image_url').eq('status', 'live').is('archived_at', null).not('image_url', 'is', null).order('featured', { ascending: false }).order('created_at', { ascending: false }).limit(60),
    wanted ? sb.from('products').select('id, title, image_url').eq('id', wanted).eq('status', 'live').maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const candIds = [...(cand ?? []).map((p) => p.id as string), ...(wanted ? [wanted] : [])];
  const { data: fac } = candIds.length ? await sb.from('product_factory').select('product_id').in('product_id', candIds).eq('verified', true) : { data: [] as { product_id: string }[] };
  const verifiedIds = new Set((fac ?? []).map((f) => f.product_id as string));
  const list = (cand ?? []).filter((p) => verifiedIds.has(p.id as string)).slice(0, 9);
  const chosenOk = !!one && verifiedIds.has(one.id as string);
  const products: BrandProduct[] = [...(chosenOk ? [{ id: one!.id as string, title: one!.title as string, image_url: one!.image_url as string | null }] : []), ...((list ?? []) as BrandProduct[]).filter((p) => p.id !== wanted)].slice(0, 9);
  const mode = !session ? 'guest' : !session.org ? 'no-org' : 'ready';
  const qs = chosenOk ? `?product=${wanted}` : dsModel ? `?model=${encodeURIComponent(dsModel)}${dsTitle ? `&title=${encodeURIComponent(dsTitle)}` : ''}` : '';
  const loginHref = `/login?next=${encodeURIComponent(`/request/brand${qs}`)}`;
  const reply = replyHours(settings);
  const countries = Object.entries(COUNTRY_NAMES).sort((a, b) => a[1].localeCompare(b[1])) as [string, string][];

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-10 sm:py-12" data-testid="request-brand">
      <div className="eyebrow">Request Center</div>
      <h1 className="text-[34px] sm:text-[44px] font-extrabold leading-[1.1] mt-3 max-w-[780px]">Put your brand on a verified product</h1>
      <p className="text-[17px] text-black mt-4 max-w-[760px] leading-relaxed">Tell us the product, your logo and where the stock goes. Your account manager sends a proof and a quote before you pay anything.</p>
      <RequestTabs blocks={blocks} active="brand" qs={chosenOk ? `?product=${wanted}` : ''} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px] items-start">
        <div className="min-w-0 space-y-4">
          {wanted && !chosenOk && <Notice tone="warn">That product is not from a verified supplier, so it cannot be branded. Choose one of these verified products or paste a link.</Notice>}
          {dsModel && (
            <div data-testid="brand-ds-model-banner">
              <Notice>
                Branding Dropship product <b className="mono">{dsModel}</b>{dsTitle ? ` (${dsTitle})` : ''}. Your account manager links this model when preparing your proof and quote.
              </Notice>
            </div>
          )}
          <BrandRequestWizard products={products} methods={brandMethods(settings)} initialProduct={chosenOk ? wanted : null}
            initialDsModel={dsModel} initialDsTitle={dsTitle} orgId={session?.org?.id ?? null}
            mode={mode} loginHref={loginHref} countries={countries} />
        </div>
        <aside className="space-y-4 min-w-0">
          <section className="card p-5" aria-labelledby="am-h">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-11 h-11 rounded-full bg-ink text-white"><Icon name="user" /></span>
              <div><h2 id="am-h" className="font-bold text-ink">Your account manager</h2><p className="text-[13px] text-muted">{reply ? `Replies within ${reply} working hours` : 'One person for your whole project'}</p></div>
            </div>
          </section>
          <section className="rounded-[14px] bg-ink text-white p-6" aria-labelledby="mmb-steps-h">
            <h2 id="mmb-steps-h" className="!text-white text-lg font-semibold">What happens next</h2>
            <ol className="mt-4 space-y-3">
              {MMB_STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <span className="w-7 h-7 shrink-0 rounded-full border-2 border-coral flex items-center justify-center text-[11px] font-semibold" aria-hidden>{i + 1}</span>
                  <div><div className="font-semibold text-[14.5px]">{s.title}</div><div className="text-[12.5px] text-on-ink">{s.tag === 'You' ? 'You' : 'Octopus'}</div></div>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </div>
  );
}

