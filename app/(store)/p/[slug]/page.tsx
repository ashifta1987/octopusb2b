import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { categoryPath, block } from '@/lib/content';
import { getStoreContent } from '@/components/store/currency';
import { money, fmtDate, COUNTRY_NAMES } from '@/lib/format';
import { SupplierCode, StatusBadge } from '@/components/ui';
import { getProduct, getRecommendations, getServices } from '@/components/store/data';
import { ProductGrid, ProductImage, GridSkeleton, unitOne, fmtQty } from '@/components/store/product-card';
import { PriceCalculator } from '@/components/store/price-calculator';
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

const SERVICE_ORDER = ['sample', 'qc', 'certification', '3pl', 'dropship'] as const;
const SERVICE_CTA: Record<string, string> = {
  sourcing: 'Request quote', sample: 'Request sample', qc: 'Book QC inspection', certification: 'Request certification', '3pl': 'Request 3PL', dropship: 'Request dropship',
};

async function Content({ params }: { params: Params }) {
  const { slug } = await params;
  const p = await getProduct(slug);
  if (!p) notFound();
  const [{ categories, company, blocks }, services, recs] = await Promise.all([getStoreContent(), getServices(), getRecommendations(p.id, p.category_id)]);
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
  const steps = parts(blocks, 'product.services.steps', 'Source|Check quality|Store or dropship|Sell');
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

      <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_1fr] items-start">
        {/* Gallery + key facts */}
        <div className="space-y-4 min-w-0">
          <div className="card overflow-hidden">
            <ProductImage src={images[0]?.url ?? null} alt={images[0]?.alt ?? p.title} className="aspect-square" label="Main product photo" width={800} height={800} />
          </div>
          <ul className="grid grid-cols-4 gap-3" aria-label="More photos">
            {(images.length > 1 ? images.slice(1, 5) : [null, null, null, null]).map((img, i) => (
              <li key={i} className={`card overflow-hidden ${i === 0 && !img ? 'border-navy border-2' : ''}`}>
                {img ? <ProductImage src={img.url} alt={img.alt ?? p.title} className="aspect-[4/3]" width={200} height={150} /> : <div className="ph aspect-[4/3]" aria-hidden>{i === 3 ? 'Packaging' : i + 1}</div>}
              </li>
            ))}
          </ul>
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
          {p.octopus_dropship && <span className="inline-flex rounded-full bg-blue-soft text-[#1E4F9C] text-[12px] font-semibold px-2.5 py-1">Available on Octopus Dropship</span>}
          {p.ready_to_ship && <span className="inline-flex ml-2 rounded-full bg-[#E3F5EA] text-[#156B3A] text-[12px] font-semibold px-2.5 py-1">Ready to ship</span>}
          <h1 className="text-[30px] sm:text-[36px] font-extrabold leading-[1.12]">{p.title}</h1>
          {p.supplier && (
            <div className="flex flex-wrap items-center gap-3">
              <SupplierCode code={p.supplier.code} country={p.supplier.country} verified={p.supplier.verified} className="!text-[14px] !text-navy font-semibold" />
              {p.supplier.verified && <StatusBadge status="verified" />}
              <span className="text-[13px] text-muted">{[p.supplier.supplier_type, p.supplier.country && (COUNTRY_NAMES[p.supplier.country] ?? p.supplier.country)].filter(Boolean).join(' · ')}</span>
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
          <PriceCalculator productId={p.id} tiers={p.tiers} currency={p.currency} feeCurrency={services.rfq?.currency ?? p.currency} unit={p.unit} unitOne={u} moq={p.moq} incoterm={p.incoterm}
            rfqFee={services.rfq?.priceCents ?? null} sampleFee={services.sample?.priceCents ?? null} whatsapp={wa} />
          {/* SPEC §18 — group buying card after the Request quote CTA */}
          <Suspense fallback={null}>
            <ProductPoolCard productId={p.id} moq={p.moq} unit={p.unit} />
          </Suspense>
        </div>
      </div>

      {/* Services row */}
      <section className="card p-6 sm:p-8 mt-8" aria-labelledby="svc-h">
        <div className="flex flex-wrap justify-between items-end gap-4">
          <div>
            <div className="eyebrow">{block(blocks, 'product.services.eyebrow', 'Services for this product')}</div>
            <h2 id="svc-h" className="text-2xl font-bold mt-1">{block(blocks, 'product.services.title', 'Check it, certify it, then sell it')}</h2>
            <p className="text-sm text-muted mt-1">{block(blocks, 'product.services.subtitle')}</p>
          </div>
          <ol className="flex flex-wrap items-center gap-2 text-[12px] font-semibold">
            {steps.map((s, i) => (
              <li key={s} className="flex items-center gap-2">
                {i > 0 && <span aria-hidden className="text-muted">→</span>}
                <span className={`rounded-full px-2.5 py-1 ${i === 0 ? 'bg-navy text-white' : 'bg-blue-soft text-[#1E4F9C]'}`}>{i + 1} {s}</span>
              </li>
            ))}
          </ol>
        </div>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {(['sourcing', ...SERVICE_ORDER] as const).map((code) => {
            const svcCode = code === 'sourcing' ? 'rfq' : code;
            const s = services[svcCode];
            const [eyebrow, title, body, unitTxt] = parts(blocks, `product.service.${code}`, `${code}|${s?.name ?? code}|${s?.description ?? ''}|${s?.unit ?? ''}`);
            const price = s?.priceCents ?? 0;
            const dark = code === '3pl' || code === 'dropship';
            return (
              <li key={code} className="rounded-[12px] border border-line p-4 flex flex-col gap-2">
                <div className="mono text-[10px] uppercase tracking-wider text-muted">{eyebrow}</div>
                <h3 className="font-sans font-semibold text-[16px] leading-tight">{title}</h3>
                <p className="text-[13px] text-muted flex-1">{body}</p>
                <p className="text-[12px] text-muted">
                  {price > 0 ? <><span className="mono font-semibold text-navy">{money(price, s?.currency)}</span> {unitTxt}</> : <>Request free · {unitTxt}</>}
                </p>
                <Link href={`/request/${code}?product=${p.id}`} className={`btn btn-sm w-full ${dark ? 'btn-dark' : 'btn-ghost'}`}>
                  {SERVICE_CTA[code]}
                  <span className="sr-only"> for {p.title}</span>
                </Link>
              </li>
            );
          })}
        </ul>
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
            <section className="card p-5" aria-label="Supplier">
              <div className="flex gap-3 items-center">
                <span className="w-11 h-11 rounded-full bg-blue-soft flex items-center justify-center mono text-[12px] font-semibold" aria-hidden>{p.supplier.country}</span>
                <div>
                  <div className="font-semibold">Supplier <span className="mono">{p.supplier.code}</span></div>
                  <div className="text-[13px] text-muted">{[p.supplier.country && (COUNTRY_NAMES[p.supplier.country] ?? p.supplier.country), p.supplier.supplier_type, p.supplier.verified ? 'Verified' : 'Not yet verified'].filter(Boolean).join(' · ')}</div>
                </div>
              </div>
              <p className="text-[13px] text-muted mt-3">All messages and orders go through Octopus B2B.</p>
              <Link href={`/search?q=${encodeURIComponent(p.supplier.code)}`} className="btn btn-ghost btn-sm w-full mt-3">More from this supplier</Link>
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
        <div className="ph aspect-square rounded-[12px]" />
        <div className="space-y-4"><div className="h-10 bg-line rounded w-4/5" /><div className="card h-[420px]" /></div>
      </div>
      <div className="mt-10"><GridSkeleton n={6} cols="lg:grid-cols-6" /></div>
    </div>
  );
}
