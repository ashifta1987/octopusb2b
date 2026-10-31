import { Suspense } from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { block, descendantIds } from '@/lib/content';
import { money, COUNTRY_NAMES } from '@/lib/format';
import { getStoreContent } from '@/components/store/currency';
import { getCategoryCounts, getFeatured, getVerifiedSuppliers } from '@/components/store/data';
import { ProductGrid, GridSkeleton, unitOne } from '@/components/store/product-card';
import { AdSlot } from '@/components/store/ad-slot';
import { JsonLd, parts, SITE_URL } from '@/components/store/seo';
import { HomePoolsSection } from '@/components/store/pools/home-section';

export const metadata: Metadata = { alternates: { canonical: '/' } };

/** Main.png — storefront home. All copy from content_blocks / site_settings / company_profile. */
export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <Home />
    </Suspense>
  );
}

function Check() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1F9D55" strokeWidth="2.5" aria-hidden><path d="m5 12 5 5 9-10" /></svg>;
}

function SectionHead({ title, href, link }: { title: string; href?: string; link?: string }) {
  return (
    <div className="flex flex-wrap justify-between items-end gap-4 mb-6">
      <h2 className="text-[28px] sm:text-[34px] font-extrabold leading-tight">{title}</h2>
      {href && link && <Link href={href} className="font-semibold text-blue">{link} <span aria-hidden>→</span></Link>}
    </div>
  );
}

async function Home() {
  const [{ blocks, settings, company, categories }, counts, featured, suppliers] = await Promise.all([
    getStoreContent(), getCategoryCounts(), getFeatured(4), getVerifiedSuppliers(4),
  ]);
  const top = categories.filter((c) => c.level === 1);
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const stats = (settings.stats ?? {}) as Record<string, string>;
  const statLabels = parts(blocks, 'home.stats.labels', 'Products listed|Verified suppliers|Countries shipped to|Saved with bulk tiers');
  const trust = parts(blocks, 'home.trust').filter(Boolean);
  const how = [1, 2, 3].map((n) => parts(blocks, `home.how.${n}`)).filter((p) => p[0]);
  const testimonials = (blocks.testimonials ?? '').split('\n').map((l) => l.split('|').map((s) => s.trim())).filter((t) => t[0]);

  // Illustrative RFQ card: built from a live featured product + verified supplier codes, clearly labelled.
  const demo = featured.find((p) => p.tiers.length) ?? null;
  const demoQuotes = demo
    ? suppliers.slice(0, 3).map((s, i) => ({
        s, price: Math.round((demo.tiers[demo.tiers.length - 1].unit_price_cents) * (1 + i * 0.06)),
        incoterm: ['FOB', 'CIF', 'FOB'][i], days: 18 + i * 3,
      }))
    : [];

  const orgLd = company && {
    '@context': 'https://schema.org', '@type': 'Organization',
    name: company.brand ?? company.legal_name, legalName: company.legal_name, url: SITE_URL, logo: `${SITE_URL}/logo.png`,
    email: company.email ?? undefined, telephone: company.phone ?? undefined, slogan: company.tagline ?? undefined,
    address: company.address ? { '@type': 'PostalAddress', streetAddress: company.address } : undefined,
    contactPoint: company.phone ? [{ '@type': 'ContactPoint', telephone: company.phone, email: company.email ?? undefined, contactType: 'sales' }] : undefined,
  };

  return (
    <>
      {orgLd && <JsonLd data={orgLd} />}
      {/* Hero */}
      <section className="bg-white border-b border-line">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-14 pb-16 sm:pt-[72px] sm:pb-20 flex flex-wrap gap-14 items-center">
          <div className="flex-[1_1_520px] min-w-0 flex flex-col gap-5">
            <div className="eyebrow">{block(blocks, 'home.eyebrow')}</div>
            <h1 className="text-[38px] sm:text-[52px] font-extrabold leading-[1.08] tracking-tight">{block(blocks, 'home.title')}</h1>
            <p className="text-[17px] text-[#3B4556] leading-relaxed max-w-[600px]">{block(blocks, 'home.subtitle')}</p>
            <div className="flex flex-wrap gap-3 pt-1">
              <Link href="/products" className="btn btn-primary">Browse products <span aria-hidden>→</span></Link>
              <Link href="/request/sourcing" className="btn btn-ghost">Request a quote</Link>
            </div>
            {trust.length > 0 && (
              <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-muted pt-2">
                {trust.map((t) => <li key={t} className="inline-flex items-center gap-1.5"><Check />{t}</li>)}
              </ul>
            )}
          </div>
          {demo && (
            <figure className="flex-[1_1_420px] min-w-0 bg-navy text-white rounded-[18px] p-6 shadow-xl" aria-label={block(blocks, 'home.rfq_card.label', 'Illustrative example')}>
              <div className="flex justify-between items-start gap-3">
                <div className="min-w-0">
                  <div className="mono text-[12px] text-[#9AA6B8]">RFQ · {block(blocks, 'home.rfq_card.label', 'Illustrative example')}</div>
                  <div className="font-display font-bold text-[18px] mt-1 truncate">{(demo.moq * 5).toLocaleString('en-US')} {demo.unit} · {demo.title}</div>
                </div>
                <span className="shrink-0 rounded-full bg-[#FFF3D6] text-[#8A5A00] text-xs font-semibold px-2.5 py-1">{demoQuotes.length} quotes in</span>
              </div>
              <ol className="grid grid-cols-5 gap-1.5 mt-5 mono text-[10px] uppercase tracking-wider text-[#9AA6B8]">
                {['Submitted', 'Quoted', 'Accepted', 'Shipped', 'Delivered'].map((s, i) => (
                  <li key={s}><div className={`h-1 rounded-full mb-1.5 ${i < 2 ? 'bg-blue' : 'bg-white/15'}`} />{s}</li>
                ))}
              </ol>
              <ul className="mt-5 space-y-2.5">
                {demoQuotes.map((q, i) => (
                  <li key={q.s.id} className={`flex justify-between items-center gap-3 px-4 py-3.5 rounded-xl border-[1.5px] ${i === 0 ? 'bg-[#262A6B] border-blue' : 'bg-[#1B1E52] border-[#1B1E52]'}`}>
                    <div className="min-w-0">
                      <div className="font-semibold text-[15px]">Supplier {q.s.code}</div>
                      <div className="mono text-[12px] text-[#9AA6B8]">{q.s.country} · {q.incoterm} · {q.days} days</div>
                    </div>
                    <div className="text-right">
                      <div className="font-display font-bold text-[18px]">{money(q.price, demo.currency)}</div>
                      <div className="text-[12px] text-[#9AA6B8]">per {unitOne(demo.unit)}</div>
                    </div>
                  </li>
                ))}
              </ul>
              <Link href="/request/sourcing" className="btn btn-light w-full mt-4">Compare quotes</Link>
            </figure>
          )}
        </div>
      </section>

      {/* Stats */}
      <section aria-label="Platform numbers" className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-10">
        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {(['products', 'suppliers', 'countries', 'bulk_saving'] as const).map((k, i) => stats[k] && (
            <div key={k} className="card rounded-[14px] px-6 py-[22px] flex flex-col-reverse gap-1.5">
              <dt className="text-sm text-muted">{statLabels[i]}</dt>
              <dd className="font-display font-extrabold text-[28px] sm:text-[32px] leading-none">{k === 'bulk_saving' ? `Up to ${stats[k]}` : stats[k]}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Categories */}
      <section className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-[72px]">
        <SectionHead title={block(blocks, 'home.categories.title', 'Shop by category')} href="/products" link="All categories" />
        {top.length ? (
          <ul className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
            {top.map((c) => {
              const n = descendantIds(categories, c.id).reduce((s, id) => s + (counts[id] ?? 0), 0);
              return (
                <li key={c.id}>
                  <Link href={`/c/${c.slug}`} className="card rounded-[14px] p-5 flex gap-4 items-center hover:border-blue h-full">
                    <span className="w-14 h-14 shrink-0 rounded-xl bg-[#F1F3F6] flex items-center justify-center mono text-[13px] font-semibold text-[#3B4556]" aria-label={c.hs_code ? `HS code ${c.hs_code}` : undefined}>
                      {c.hs_code ? `HS ${c.hs_code}` : '—'}
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold">{c.name}</span>
                      <span className="block text-[13px] text-muted">{n.toLocaleString('en-US')} {n === 1 ? 'product' : 'products'}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : <p className="text-muted">Categories are being set up.</p>}
      </section>

      {/* How it works */}
      {how.length > 0 && (
        <section className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-[72px]">
          <SectionHead title={block(blocks, 'home.how.title', 'How it works')} />
          <ol className="grid gap-4 md:grid-cols-3">
            {how.map(([t, b], i) => (
              <li key={i} className="card rounded-[14px] p-6">
                <div className="mono text-xs font-semibold text-blue">{String(i + 1).padStart(2, '0')}</div>
                <h3 className="text-lg font-semibold mt-3">{t}</h3>
                <p className="text-[15px] text-muted mt-2">{b}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Featured */}
      <section className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-[72px]">
        <SectionHead title={block(blocks, 'home.featured.title', 'Featured products')} href="/products" link="View all products" />
        {featured.length ? <ProductGrid products={featured} categoryNames={catName} variant="featured" /> : (
          <div className="card p-10 text-center text-muted">No featured products yet. <Link href="/products" className="text-blue font-semibold">Browse all products</Link></div>
        )}
      </section>

      {/* Group buying pools (SPEC §18) */}
      <Suspense fallback={null}>
        <HomePoolsSection />
      </Suspense>

      {/* 3PL + Dropshipping */}
      <section className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-[72px] grid gap-4 md:grid-cols-2">
        {([['3pl', '/request/3pl', 'Request a 3PL quote', true], ['dropship', '/request/dropship', 'Start a dropshipping request', false]] as const).map(([k, href, cta, dark]) => (
          <div key={k} className={`rounded-[14px] p-8 flex flex-col gap-4 ${dark ? 'bg-navy text-[#D5DBE4]' : 'card'}`}>
            <span className={`w-11 h-11 rounded-lg flex items-center justify-center ${dark ? 'bg-[#262A6B]' : 'bg-blue-soft'}`} aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={dark ? '#8FB4F0' : '#2A6FD6'} strokeWidth="2">
                {k === '3pl' ? <path d="M3 21V9l9-6 9 6v12M7 21v-7h10v7M7 17h10" /> : <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-.01M17 19a2 2 0 1 0 0-.01" />}
              </svg>
            </span>
            <h2 className={`text-2xl font-bold ${dark ? '!text-white' : ''}`}>{block(blocks, `home.${k}.title`)}</h2>
            <p className={`text-[15px] ${dark ? '' : 'text-muted'}`}>{block(blocks, `home.${k}.body`)}</p>
            <ul className="list-disc pl-5 space-y-1.5 text-[14px]">
              {parts(blocks, `home.${k}.points`).filter(Boolean).map((pt) => <li key={pt}>{pt}</li>)}
            </ul>
            <div className="pt-2"><Link href={href} className={`btn btn-sm ${dark ? 'btn-primary' : 'btn-dark'}`}>{cta}</Link></div>
          </div>
        ))}
      </section>

      {/* Verified suppliers */}
      <section className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-[72px]">
        <SectionHead title={block(blocks, 'home.suppliers.title', 'Verified suppliers')} href="/contact" link="Become a supplier" />
        {suppliers.length ? (
          <ul className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            {suppliers.map((s) => (
              <li key={s.id} className="card rounded-[14px] p-5 flex gap-4">
                <span className="w-12 h-12 shrink-0 rounded-full bg-blue-soft flex items-center justify-center mono text-[13px] font-semibold text-navy" aria-hidden>{s.country}</span>
                <div className="min-w-0 space-y-2">
                  <div>
                    <div className="font-semibold">Supplier {s.code}</div>
                    <div className="text-[13px] text-muted">{(s.country && COUNTRY_NAMES[s.country]) ?? s.country}</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.verified && <span className="rounded-md bg-[#E3F5EA] text-[#156B3A] text-[11px] font-semibold px-1.5 py-0.5">Verified</span>}
                    {s.supplier_type && <span className="rounded-md bg-blue-soft text-[#1E4F9C] text-[11px] font-semibold px-1.5 py-0.5">{s.supplier_type}</span>}
                  </div>
                  <Link href={`/search?q=${encodeURIComponent(s.code)}`} className="text-[13px] font-semibold text-blue">View products<span className="sr-only"> from supplier {s.code}</span></Link>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-muted">Supplier verification is in progress.</p>}
      </section>

      <section className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-10">
        <AdSlot placement="home_banner" />
      </section>

      {/* Testimonials */}
      {testimonials.length > 0 && (
        <section className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-[72px]">
          <SectionHead title={block(blocks, 'home.testimonials.title', 'What buyers say')} />
          <ul className="grid gap-4 md:grid-cols-3">
            {testimonials.map(([quote, who], i) => (
              <li key={i}>
                <figure className="card rounded-[14px] p-6 h-full border-dashed">
                  <blockquote className="text-[16px] leading-relaxed">{quote}</blockquote>
                  {who && <figcaption className="mt-4 text-[13px] font-semibold">{who}</figcaption>}
                </figure>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* CTA */}
      <section className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-[72px]">
        <div className="rounded-[18px] bg-blue text-white px-8 sm:px-12 py-10 flex flex-wrap gap-6 justify-between items-center">
          <div>
            <h2 className="!text-white text-[28px] font-bold">{block(blocks, 'home.cta.title')}</h2>
            <p className="mt-1 text-[#E6EFFC]">{block(blocks, 'home.cta.body')}</p>
          </div>
          <Link href="/request/sourcing" className="btn btn-light">{block(blocks, 'home.cta.button', 'Request a product')}</Link>
        </div>
      </section>
    </>
  );
}

function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="bg-white border-b border-line h-[520px]" />
      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-10 space-y-16">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <div key={i} className="card h-[96px]" />)}</div>
        <GridSkeleton n={4} />
      </div>
    </div>
  );
}
