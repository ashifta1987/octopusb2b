import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { categoryPath, block } from '@/lib/content';
import { getStoreContent } from '@/components/store/currency';
import { money, fmtDate, COUNTRY_NAMES } from '@/lib/format';
import { VerifiedBadge, ServiceChoiceCard, Icon } from '@/components/ds';
import { getProduct, getRecommendations, getServices, getMoreFromFactory, type PublicSupplier } from '@/components/store/data';
import { ProductGrid, GridSkeleton, unitOne, fmtQty } from '@/components/store/product-card';
import { PriceCalculator } from '@/components/store/price-calculator';
import { cartonQty } from '@/lib/qty';
import { ProductGallery } from '@/components/store/product-gallery';
import { AdSlot } from '@/components/store/ad-slot';
import { Breadcrumbs, JsonLd, breadcrumbLd, parts, SITE_URL } from '@/components/store/seo';
import { ProductPoolCard } from '@/components/store/pools/product-pool-card';

type Params = Promise<{ slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const p = await getProduct(slug);
  if (!p) return { title: 'Product not found', robots: { index: false } };
  const title = p.seo_title ?? p.title;
  const description = p.seo_description ?? p.description?.slice(0, 160) ?? undefined;
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/p/${p.slug}` },
    openGraph: { title, description, type: 'website', url: `/p/${p.slug}`, images: p.image_url ? [p.image_url] : undefined },
  };
}

/** Product.png — product detail. Cached data (`use cache`, 5-min revalidate) streamed inside Suspense. */
export default function ProductPage({ params }: { params: Params }) {
  return (
    <Suspense fallback={<ProductSkeleton />}>
      <Content params={params} />
    </Suspense>
  );
}

/** "Octopus verified factory · Guangdong" — the public never sees the supplier code or name (ADDON-44 rule 4). */
function factoryLine(s: PublicSupplier) {
  const where = s.province || (s.country ? (COUNTRY_NAMES[s.country] ?? s.country) : null);
  return [s.verified ? 'Octopus verified factory' : 'Factory', where].filter(Boolean).join(' · ');
}
const SERVICE_CTA: Record<string, string> = {
  sourcing: 'Request quote', sample: 'Request sample', qc: 'Book QC inspection', certification: 'Request certification', '3pl': 'Request 3PL', dropship: 'Request dropship',
};

async function Content({ params }: { params: Params }) {
  const { slug } = await params;
  const p = await getProduct(slug);
  if (!p) notFound();
  const [{ categories, company, blocks }, services, recs, more] = await Promise.all([getStoreContent(), getServices(), getRecommendations(p.id, p.category_id), p.supplier_id ? getMoreFromFactory(p.id, p.supplier_id) : Promise.resolve([])]);
  const verified = !!p.supplier?.verified;
  const path = categoryPath(categories, p.category_id);
  const crumbs = [
    { name: 'Home', href: '/' },
    ...path.map((c, i) => ({ name: c.name, href: `/c/${path.slice(0, i + 1).map((x) => x.slug).join('/')}` })),
    { name: p.title, href: `/p/${p.slug}` },
  ];
  const u = unitOne(p.unit);
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const wa = company?.whatsapp ? `https://wa.me/${company.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Hello Octopus B2B, I have a question about ${p.title} (${SITE_URL}/p/${p.slug})`)}` : null;
  const certTags = p.tags.filter((t) => t.kind === 'certification');
  const origin = p.origin_country ? (COUNTRY_NAMES[p.origin_country] ?? p.origin_country) : null;
  const prices = p.tiers.map((t) => t.unit_price_cents);
  const [shipT, shipA, shipB] = parts(blocks, 'product.shipping', 'Shipping and customs|Quotes include Incoterm, port and lead time.|');
  const images = p.media.length ? p.media : p.image_url ? [{ url: p.image_url, alt: p.title }] : [];

  const productLd = {
    '@context': 'https://schema.org', '@type': 'Product',
    name: p.title, description: p.description ?? undefined, sku: p.id, url: `${SITE_URL}/p/${p.slug}`,
    image: images.length ? images.map((i) => i.url) : undefined,
    category: path.map((c) => c.name).join(' > ') || undefined,
    brand: { '@type': 'Brand', name: company?.brand ?? 'Octopus B2B' },
    countryOfOrigin: p.origin_country ?? undefined,
    offers: prices.length ? {
      '@type': 'AggregateOffer', priceCurrency: p.currency, lowPrice: (Math.min(...prices) / 100).toFixed(2), highPrice: (Math.max(...prices) / 100).toFixed(2),
      offerCount: p.tiers.length, availability: 'https://schema.org/InStock', url: `${SITE_URL}/p/${p.slug}`,
      eligibleQuantity: { '@type': 'QuantitativeValue', minValue: p.moq, unitText: p.unit },
      seller: { '@type': 'Organization', name: company?.brand ?? 'Octopus B2B' },
    } : undefined,
  };

  const facts: [string, string][] = [
    ['Minimum order', fmtQty(p.moq, p.unit)],
    ['Lead time', p.lead_time_days ? `${p.lead_time_days} days` : 'On request'],
    ['Incoterm', p.incoterm ?? 'On request'],
    ['Ships from', origin ?? '—'],
    ['HS code', p.hs_code ? (p.hs_code_status === 'suggested' ? `${p.hs_code} (indicative)` : p.hs_code) : '—'],
    ['Unit', p.unit],
  ];

  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-6">
      <JsonLd data={productLd} />
      <JsonLd data={breadcrumbLd(crumbs)} />
      <Breadcrumbs items={crumbs} />

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_1fr] items-start" data-testid="product-top">
        {/* Gallery + key facts */}
        <div className="space-y-4 min-w-0">
          {/* only real images: none → no gallery, one → no thumbnail strip (6 Nov 2026) */}
          <ProductGallery images={images} title={p.title} />
          <section className="card p-6" aria-labelledby="facts-h">
            <h2 id="facts-h" className="text-base font-semibold mb-4">Key facts</h2>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
              {facts.map(([k, v]) => <div key={k}><dt className="text-[12px] text-muted">{k}</dt><dd className="font-semibold text-[14px]">{v}</dd></div>)}
            </dl>
          </section>
        </div>

        {/* Buy box */}
        <div className="space-y-4 min-w-0 stick">
          <div className="mono text-[12px] text-muted flex flex-wrap gap-x-4">
            {p.hs_code && <span>HS {p.hs_code}</span>}
            {p.origin_country && <span>Origin: {p.origin_country}</span>}
            {p.lead_time_days && <span>Lead time: {p.lead_time_days} days</span>}
          </div>
          {p.octopus_dropship && <span className="inline-flex rounded-full bg-blue-soft text-[#1E4F9C] text-[12px] font-semibold px-2.5 py-1">Available for dropshipping</span>}
          {p.ready_to_ship && <span className="inline-flex ml-2 rounded-full bg-[#E3F5EA] text-[#156B3A] text-[12px] font-semibold px-2.5 py-1">Ready to ship</span>}
          <h1 className="text-[30px] sm:text-[36px] font-extrabold leading-[1.12]">{p.title}</h1>
          {/* ADDON-44-F board 24: verified badge + factory line, never the supplier code */}
          {p.supplier && (
            <div className="space-y-1.5" data-testid="factory-line">
              <VerifiedBadge verified={p.supplier.verified} explain={p.supplier.verified ? 'Octopus checked this factory: licence, site visit, QC record' : undefined} />
              <div className="text-[13.5px] text-body-2 flex items-center gap-1.5"><Icon name="warehouse" size={16} className="text-muted" />{factoryLine(p.supplier)}</div>
            </div>
          )}
          {certTags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-muted">Certifications</span>
              {certTags.map((t) => (
                <span key={t.slug} className="inline-flex items-center gap-1 rounded-full border border-ok/40 bg-[#E3F5EA] text-[#156B3A] px-2 py-0.5 font-semibold">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden><path d="m5 12 5 5 9-10" /></svg>{t.name}
                </span>
              ))}
            </div>
          )}
          <PriceCalculator productId={p.id} tiers={p.tiers} currency={p.currency} feeCurrency={services.rfq?.currency ?? p.currency} unit={p.unit} unitOne={u} moq={p.moq} orderMultiple={cartonQty(p.qty_per_carton)} incoterm={p.incoterm}
            rfqFee={services.rfq?.priceCents ?? null} sampleFee={services.sample?.priceCents ?? null} whatsapp={wa} />
          {/* SPEC §18 — group buying card after the Request quote CTA */}
          <Suspense fallback={null}>
            <ProductPoolCard productId={p.id} moq={p.moq} unit={p.unit} />
          </Suspense>
        </div>
      </div>

      {/* ADDON-44-F board 24: four ways to use this product */}
      <section className="mt-10" aria-labelledby="ways-h" data-testid="product-ways">
        <div className="k !text-blue">Four ways to use this product</div>
        <h2 id="ways-h" className="mt-1.5 text-[25px] sm:text-[30px] font-extrabold leading-[1.15]">What do you want to do with this product?</h2>
        <p className="mt-1.5 text-[15px] text-body-2 max-w-[640px]">Each choice opens a request with this product already filled in. Every request gets a reference number you can follow in My account.</p>
        <div className={`mt-5 grid gap-4 sm:grid-cols-2 ${verified ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
          <ServiceChoiceCard icon="search" title="Buy in bulk" body="Tell us the quantity and your country. We send a quote in US dollars with the price for your order."
            note={services.rfq?.priceCents ? <span className="text-muted">RFQ fee <b className="text-navy">{money(services.rfq.priceCents, services.rfq.currency)}</b></span> : undefined}
            cta="Request quote" href={`/request/sourcing?product=${p.id}`} testId="way-bulk" />
          {verified && (
            <ServiceChoiceCard icon="tag" title="Put your brand on it" isNew primary body="Your logo on the product and its box, made by this verified factory. We store the stock and ship it where you sell."
              note={<span className="text-muted">Free to request · quote before you pay</span>} cta="Start a brand project" href={`/request/brand?product=${p.id}`} testId="way-brand" />
          )}
          <ServiceChoiceCard icon="truck" title="Dropship it" body="We ship each order to your customer under your packing slip. You hold no stock."
            note={<span className="text-muted">See costs per country in your dropship catalogue</span>} cta="Dropship this product" href={`/request/dropship?product=${p.id}`} testId="way-dropship" />
          <ServiceChoiceCard icon="warehouse" title="Store it near your buyers" body="Send your stock to the Octopus warehouse. We pick, pack and ship each order from there."
            note={<span className="text-muted">Free to request · rates in your quote</span>} cta="Get a 3PL quote" href={`/request/3pl?product=${p.id}`} testId="way-3pl" />
        </div>
      </section>

      <section className="mt-10 grid gap-5 lg:grid-cols-[1.4fr_1fr] items-start" aria-labelledby="addons-h">
        <div>
          <div className="k !text-blue">Add-ons</div>
          <h2 id="addons-h" className="mt-1.5 text-[22px] font-extrabold">Services for this product</h2>
          <ul className="mt-4 card divide-y divide-line">
            {(['sample', 'qc', 'certification'] as const).map((code) => {
              const sv = services[code];
              const [, title, body] = parts(blocks, `product.service.${code}`, `${code}|${sv?.name ?? code}|${sv?.description ?? ''}|`);
              return (
                <li key={code} className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                  <div><div className="font-bold text-navy text-[15px]">{title}</div><p className="text-[13.5px] text-muted mt-0.5">{body}{sv?.priceCents ? <> Fee <b className="text-navy">{money(sv.priceCents, sv.currency)}</b>.</> : null}</p></div>
                  <Link href={`/request/${code}?product=${p.id}`} className="btn btn-ghost shrink-0">{SERVICE_CTA[code]}<span className="sr-only"> for {p.title}</span></Link>
                </li>
              );
            })}
          </ul>
        </div>
        <aside className="rounded-[14px] bg-blue-soft border border-[#C9DBF7] p-5" aria-labelledby="pay-h" data-testid="how-you-pay">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-[10px] bg-white text-blue"><Icon name="doc" /></span>
          <h2 id="pay-h" className="mt-3 text-[17px] font-bold">How you pay</h2>
          <p className="mt-1.5 text-[14.5px] text-body-2">Prices in US dollars, paid from your Octopus wallet. Top up by bank transfer — no card payments.</p>
          <ul className="mt-3 space-y-1.5 text-[14px] text-body-2">
            <li className="flex gap-2"><Icon name="check" size={16} className="text-ok mt-0.5" />Top up your wallet in My account › Wallet and invoices</li>
            <li className="flex gap-2"><Icon name="check" size={16} className="text-ok mt-0.5" />Your wallet reference and our bank details are shown there</li>
          </ul>
          <Link href="/account/wallet" className="inline-flex items-center min-h-11 mt-1 font-semibold text-blue">Open my wallet <span aria-hidden>→</span></Link>
        </aside>
      </section>

      {/* Specs + side cards */}
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr] items-start">
        <div className="space-y-6 min-w-0">
          <section className="card p-6" aria-labelledby="spec-h">
            <h2 id="spec-h" className="text-lg font-semibold mb-3">Specifications</h2>
            {p.specs.length ? (
              <table className="w-full text-[14px]">
                <tbody>
                  {p.specs.map((s) => (
                    <tr key={s.name} className="border-b border-line last:border-0">
                      <th scope="row" className="text-left font-normal text-muted py-2.5 pr-4 w-[40%]">{s.name}</th>
                      <td className="py-2.5">{s.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-sm text-muted">No specifications listed yet. Ask for details in your RFQ.</p>}
          </section>
          {p.description && (
            <section className="card p-6" aria-labelledby="desc-h">
              <h2 id="desc-h" className="text-lg font-semibold mb-3">Description</h2>
              <p className="text-[15px] leading-7 whitespace-pre-line">{p.description}</p>
            </section>
          )}
        </div>
        <div className="space-y-4 min-w-0">
          <section className="card p-5" aria-labelledby="cert-h">
            <h2 id="cert-h" className="text-base font-semibold mb-3">Certificates</h2>
            {p.certificates.length ? (
              <ul className="space-y-2.5">
                {p.certificates.map((c) => (
                  <li key={c.id} className="rounded-[10px] border border-line p-3">
                    <div className="font-semibold text-[14px]">{c.name}</div>
                    <div className="text-[12px] text-muted">{[c.issuer, c.expires_at && `valid to ${fmtDate(c.expires_at)}`].filter(Boolean).join(' · ')}</div>
                    <div className={`text-[12px] font-semibold mt-0.5 ${c.status === 'verified' ? 'text-ok' : 'text-warn'}`}>
                      {c.status === 'verified' ? 'Verified by Octopus B2B' : c.status === 'expiring' ? 'Expiring soon' : 'Supplier-provided, not yet checked'}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">No certificates on file yet.</p>}
            <p className="text-[12px] text-muted mt-3">
              Need a certificate for your market? <Link href={`/request/certification?product=${p.id}`} className="text-blue font-semibold">Request certification</Link>.
              Certificates are the manufacturer&apos;s documents; check they cover your import requirements.
            </p>
          </section>
          {p.supplier && (
            <section className="card p-5" aria-label="Factory">
              <div className="flex gap-3 items-center">
                <span className="w-11 h-11 rounded-full bg-blue-soft text-blue flex items-center justify-center" aria-hidden><Icon name="warehouse" /></span>
                <div>
                  <div className="font-semibold">{factoryLine(p.supplier)}</div>
                  <div className="text-[13px] text-muted">{p.supplier.supplier_type ?? 'Factory'}</div>
                  <div className="mt-1.5"><VerifiedBadge verified={p.supplier.verified} /></div>
                </div>
              </div>
              <p className="text-[13px] text-muted mt-3">All messages and orders go through Octopus B2B.</p>
              {more.length > 0 && <a href="#more-factory" className="btn btn-ghost btn-sm w-full mt-3">More from this factory</a>}
            </section>
          )}
          <section className="card p-5" aria-labelledby="ship-h">
            <h2 id="ship-h" className="text-base font-semibold mb-2">{shipT}</h2>
            {shipA && <p className="text-[13px] text-muted">{shipA}</p>}
            {shipB && <p className="text-[13px] text-muted mt-2">{shipB}</p>}
          </section>
        </div>
      </div>

      <div className="mt-8"><AdSlot placement="product_side" /></div>

      {more.length > 0 && (
        <section className="mt-12" id="more-factory" aria-labelledby="more-h" data-testid="more-factory">
          <div className="k !text-blue">Same {p.supplier?.verified ? 'verified ' : ''}factory</div>
          <h2 id="more-h" className="mt-1.5 text-[26px] font-extrabold">More from this factory</h2>
          <ul className="mt-5 grid gap-4 sm:grid-cols-3">
            {more.map((m) => {
              const low = m.tiers.length ? Math.min(...m.tiers.map((t) => t.unit_price_cents)) : m.min_price_cents;
              return (
                <li key={m.id} className="card overflow-hidden">
                  <Link href={`/p/${m.slug}`} className="block group">
                    <div className="relative aspect-[4/3] bg-surface">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {m.image_url && <img src={m.image_url} alt={m.title} loading="lazy" decoding="async" className="absolute inset-0 w-full h-full object-cover" />}
                    </div>
                    <div className="p-4">
                      {m.supplier?.verified && <VerifiedBadge />}
                      <div className="mt-2 font-bold text-navy group-hover:text-blue line-clamp-2">{m.title}</div>
                      <div className="mt-1 text-[13px] text-muted">{low ? <>From {money(low, m.currency)}</> : 'Price on request'} · MOQ {fmtQty(m.moq, m.unit)}</div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Recommended */}
      <section className="mt-12" aria-labelledby="rec-h">
        <div className="flex flex-wrap justify-between items-end gap-4 mb-5">
          <div>
            <h2 id="rec-h" className="text-[26px] font-extrabold">Recommended products</h2>
            <p className="text-sm text-muted">{block(blocks, 'product.recommended.subtitle', `Often sourced together · Prices in ${p.currency}`)}</p>
          </div>
          <Link href={path.length ? `/c/${path.map((c) => c.slug).join('/')}` : '/products'} className="font-semibold text-blue">View all products <span aria-hidden>→</span></Link>
        </div>
        {recs.length ? <ProductGrid products={recs} categoryNames={catName} variant="compact" cols="lg:grid-cols-6" /> : <p className="text-muted">No recommendations yet.</p>}
      </section>
    </div>
  );
}

function ProductSkeleton() {
  return (
    <div className="max-w-[1280px] mx-auto px-4 sm:px-8 py-6" aria-busy="true" aria-label="Loading product">
      <div className="h-4 w-64 bg-line rounded" />
      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div className="aspect-square rounded-[12px] bg-surface animate-pulse" />
        <div className="space-y-4"><div className="h-10 bg-line rounded w-4/5" /><div className="card h-[420px]" /></div>
      </div>
      <div className="mt-10"><GridSkeleton n={6} cols="lg:grid-cols-6" /></div>
    </div>
  );
}
