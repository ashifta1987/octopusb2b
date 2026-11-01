import { Suspense } from 'react';
import Link from 'next/link';
import { block } from '@/lib/content';
import { getStoreContent } from '@/components/store/currency';
import { getFeatured, getVerifiedSuppliers, listOpenPools, getSupplierCategories } from '@/components/store/data';
import { ProductGrid, GridSkeleton } from '@/components/store/product-card';
import { AdSlot } from '@/components/store/ad-slot';
import { JsonLd, SITE_URL } from '@/components/store/seo';
import { HomePoolsSection } from '@/components/store/pools/home-section';
import { poolSettings } from '@/components/store/pools/shared';
import { HomeHero } from './hero';
import { LogisticsBand, type LogisticsStats } from './logistics-band';
import { PlatformServices } from './platform-services';
import { VerifiedSuppliers, Testimonials, HomeCta } from './sections';
import { SectionHead } from './shared';
import { getHomeLiveData } from './live-data';

/** Main.png (Nov 2026 redesign) — storefront home. All copy from content_blocks / site_settings / company_profile;
 *  every amount is already in the platform currency (catalogue) or the pool's own currency, formatted with money(). */
export async function HomeView() {
  const [{ blocks, settings, company, categories }, featured, suppliers, pools, live] = await Promise.all([
    getStoreContent(), getFeatured(4), getVerifiedSuppliers(4), listOpenPools({ sort: 'filled', limit: 4 }), getHomeLiveData(),
  ]);
  const supplierCats = await getSupplierCategories(suppliers.map((s) => s.id));
  const rules = poolSettings(settings);
  const topPool = rules.enabled ? pools.items[0] ?? null : null;
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  // Trust row = real figures from the database (keys match the CMS template "{products} products|{suppliers} …").
  const fmt = (v: number) => new Intl.NumberFormat('en-US').format(v);
  const stats: Record<string, string> = {};
  if (live.products) stats.products = fmt(live.products);
  if (live.verifiedSuppliers) stats.suppliers = fmt(live.verifiedSuppliers);
  if (live.markets) stats.countries = fmt(live.markets);
  if (live.maxBulkSavingPct) stats.bulk_saving = `${live.maxBulkSavingPct}%`;
  const logistics = (settings.logistics_stats ?? {}) as LogisticsStats;

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
      <HomeHero blocks={blocks} stats={stats} featured={featured} liveRfq={live.liveRfq} pool={topPool} poolsOn={rules.enabled} />
      <LogisticsBand blocks={blocks} stats={logistics} live={live} />
      <PlatformServices blocks={blocks} poolsOn={rules.enabled} depositPct={rules.depositPct} />

      <section aria-labelledby="home-featured-h" className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-[72px]">
        <SectionHead id="home-featured-h" title={block(blocks, 'home.featured.title', 'Featured products')} href="/products" link={block(blocks, 'home.featured.link', 'View all products')} />
        {featured.length ? <ProductGrid products={featured} categoryNames={catName} variant="featured" /> : (
          <div className="card p-10 text-center text-muted">No featured products yet. <Link href="/products" className="text-blue font-semibold">Browse all products</Link></div>
        )}
      </section>

      <Suspense fallback={null}>
        <HomePoolsSection />
      </Suspense>

      <VerifiedSuppliers blocks={blocks} suppliers={suppliers} categories={supplierCats} />

      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-14">
        <AdSlot placement="home_banner" />
      </div>

      <Testimonials blocks={blocks} />
      <HomeCta blocks={blocks} />
    </>
  );
}

export function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="bg-white h-[560px]" />
      <div className="bg-navy h-[640px] mt-8" />
      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-12 space-y-16">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <div key={i} className="card h-[180px]" />)}</div>
        <GridSkeleton n={4} />
      </div>
    </div>
  );
}
