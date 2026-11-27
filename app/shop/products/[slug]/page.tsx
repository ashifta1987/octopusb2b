import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';
import { categoryPath } from '@/lib/content';
import { money } from '@/lib/format';
import { getStoreContent } from '@/components/store/currency';
import { getProduct, getServices, listOpenPools } from '@/components/store/data';
import { ProductGallery } from '@/components/store/product-gallery';
import { unitOne, fmtQty } from '@/components/store/product-card';
import { ProductActions } from '@/components/site/product-actions';
import { isDropshipV2UiEnabled } from '@/lib/dropship';
import { getShopViewer } from '@/lib/shop/data';
import { shopCan, ROLE_REASON } from '@/lib/shop/shared';
import { AddToList, RecordView } from '@/components/shop/add-to-list';
import { ShopRequestForm, SampleForm } from '@/components/shop/request-forms';
import { leadText } from '@/components/shop/shop-card';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const p = await getProduct(slug);
  // the public /p/… page is the indexed one; the shop copy is noindex (layout) and points at it
  return { title: p?.title ?? 'Product not found', alternates: { canonical: `/p/${slug}` } };
}

/** CH-1 Shop product page (Shop_Products.html "Product page" + "Request a quote"): price by quantity, MOQ, lead time, sample,
 *  material, customisation; Request quote / Order a sample / Add your brand / Add to quote list. Same getProduct() as /p/[slug]. */
export default function ShopProduct({ params }: { params: Params }) {
  return (
    <Suspense fallback={<div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-8"><div className="h-[520px] card" aria-busy="true" aria-label="Loading product" /></div>}>
      <Content params={params} />
    </Suspense>
  );
}

async function Content({ params }: { params: Params }) {
  const { slug } = await params;
  const p = await getProduct(slug);
  if (!p) notFound();
  const [v, services, { categories, settings }, pools, dropshipLive] = await Promise.all([
    getShopViewer(), getServices(), getStoreContent(), listOpenPools({ productId: p.id, limit: 1 }), isDropshipV2UiEnabled(),
  ]);
  const canAct = shopCan(v.role);
  const u = unitOne(p.unit);
  const path = categoryPath(categories, p.category_id);
  const tiers = p.tiers.filter((t) => t.unit_price_cents > 0);
  const material = p.specs.find((s) => /material/i.test(s.name))?.value ?? null;
  const custom = p.tags.some((t) => t.slug === 'customisable');
  const sample = services.sample;
  const rfqFee = services.rfq;
  const fee = (s?: { priceCents: number; currency: string }) => (s && s.priceCents > 0 ? money(s.priceCents, s.currency) : s ? 'free' : null);
  const images = p.media.length ? p.media : p.image_url ? [{ url: p.image_url, alt: p.title }] : [];
  const pool = pools.items[0];
  const row = 'grid grid-cols-[150px_1fr] gap-3 py-2.5 border-b border-divider text-[15px]';

  return (
    <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-6">
      <RecordView productId={p.id} />
      <nav aria-label="Breadcrumb" className="text-[14px] text-muted mb-4">
        <ol className="flex flex-wrap gap-x-1.5 list-none m-0 p-0">
          <li><Link href="/shop" className="underline text-ink">Shop</Link> <span aria-hidden>›</span></li>
          <li><Link href="/shop/products" className="underline text-ink">Products</Link> <span aria-hidden>›</span></li>
          {path.map((c) => <li key={c.id}><Link href={`/shop/products?c=${encodeURIComponent(c.slug)}`} className="underline text-ink">{c.name}</Link> <span aria-hidden>›</span></li>)}
          <li aria-current="page" className="line-clamp-1">{p.title}</li>
        </ol>
      </nav>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start">
        <ProductGallery images={images} title={p.title} />
        <div className="min-w-0">
          <h1 className="m-0 text-[26px] sm:text-[32px] font-bold leading-tight">{p.title}</h1>
          {p.factory?.verified && <span className="mt-2 pill bg-ok-bg text-ok"><ShieldCheck size={13} strokeWidth={2} aria-hidden />Verified supplier</span>}
          <section aria-labelledby="tiers-h" className="mt-5">
            <h2 id="tiers-h" className="m-0 text-[18px] font-bold">Price by quantity</h2>
            {tiers.length === 0 ? <p className="mt-2 text-[15px] text-muted">Price on request: send a request and we quote you.</p> : (
              <div className="mt-2 overflow-x-auto" tabIndex={0} role="region" aria-label="Price by quantity">
                <table className="w-full border-collapse text-[15px]" data-testid="price-tiers">
                  <thead><tr><th scope="col" className="th">Quantity</th><th scope="col" className="th">Price per {u}</th></tr></thead>
                  <tbody>
                    {tiers.map((t, i) => {
                      const next = tiers[i + 1];
                      const range = next ? `${t.min_qty.toLocaleString('en-US')}–${(next.min_qty - 1).toLocaleString('en-US')}` : `${t.min_qty.toLocaleString('en-US')}+`;
                      return <tr key={t.min_qty}><td className="td mono">{range}</td><td className="td font-semibold">{money(t.unit_price_cents, p.currency)}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <dl className="mt-4">
            <div className={row}><dt className="text-muted">MOQ</dt><dd className="m-0 font-semibold">{fmtQty(p.moq, p.unit)}</dd></div>
            <div className={row}><dt className="text-muted">Lead time</dt><dd className="m-0">{p.lead_time_days ? `${leadText(p.lead_time_days)} after deposit` : 'On request'}</dd></div>
            <div className={row}><dt className="text-muted">Sample</dt><dd className="m-0">{fee(sample) ? `Sample request fee ${fee(sample)}` : 'On request'}</dd></div>
            {material && <div className={row}><dt className="text-muted">Material</dt><dd className="m-0">{material}</dd></div>}
            <div className={row}><dt className="text-muted">Customisable</dt><dd className="m-0">{custom ? 'Yes: logo print, colour, colour box' : 'Ask in your request'}</dd></div>
          </dl>
          {pool && (
            <p className="mt-4 rounded-[12px] bg-tint px-4 py-3 text-[15px] text-black">
              This product is in an open MOQ pool. <Link href={`/pool/${pool.code}`} className="font-semibold text-coral-text underline">Join the pool</Link> to buy below the factory minimum.
            </p>
          )}
          <div className="mt-5 grid sm:grid-cols-2 gap-3" data-testid="product-buttons">
            {canAct ? (
              <>
                <a href="#request" className="btn btn-primary">Request quote</a>
                <a href="#sample" className="btn btn-dark">Order a sample</a>
                <Link href={`/request/brand?product=${p.id}`} className="btn btn-ghost">Add your brand</Link>
                <AddToList productId={p.id} title={p.title} quantity={p.moq} size="md" />
              </>
            ) : (
              <>
                <button type="button" className="btn btn-primary" disabled aria-describedby="role-reason">Request quote</button>
                <button type="button" className="btn btn-dark" disabled aria-describedby="role-reason">Order a sample</button>
                <p id="role-reason" className="sm:col-span-2 m-0 text-[14px] text-muted" data-testid="role-reason">{ROLE_REASON}</p>
              </>
            )}
          </div>
        </div>
      </div>

      {p.description && (
        <section className="mt-10 max-w-[820px]" aria-labelledby="about-h">
          <h2 id="about-h" className="text-[20px] font-bold m-0">About this product</h2>
          <p className="mt-2 text-[15px] text-black whitespace-pre-line">{p.description}</p>
        </section>
      )}

      {canAct && (
        <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] items-start">
          <section id="request" className="scroll-mt-28" aria-label="Request a quote">
            <ShopRequestForm productId={p.id} title={p.title} moq={p.moq} unit={p.unit} defaultCountry={v.org.country} feeLabel={fee(rfqFee)} />
          </section>
          <section id="sample" className="scroll-mt-28" aria-label="Order a sample">
            <SampleForm productId={p.id} title={p.title} defaultCountry={v.org.country} feeLabel={fee(sample)} />
          </section>
        </div>
      )}

      <ProductActions productId={p.id} verified={!!p.factory?.verified} poolsOn={settings.pool_enabled !== false} dropshipLive={dropshipLive}
        rfq={rfqFee ? { priceCents: rfqFee.priceCents, currency: rfqFee.currency } : null} />
    </div>
  );
}
