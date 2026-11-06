import { Suspense } from 'react';
import { block } from '@/lib/content';
import { getStoreContent } from '@/components/store/currency';
import { getFeatured, getVerifiedSuppliers, listOpenPools, getSupplierCategories } from '@/components/store/data';
import { ProductGrid, GridSkeleton } from '@/components/store/product-card';
import { AdSlot } from '@/components/store/ad-slot';
import { JsonLd, SITE_URL } from '@/components/store/seo';
import { HomePoolsSection } from '@/components/store/pools/home-section';
import { poolSettings } from '@/components/store/pools/shared';
import { getTurnkeyCatalogue } from '@/lib/turnkey/data';
import { getOpenProjectCard } from '@/lib/turnkey/live';
import { LogisticsBand, type LogisticsStats } from './logistics-band';
import { PlatformServices } from './platform-services';
import { VerifiedSuppliers, Testimonials, HomeCta } from './sections';
import { SectionHead } from './shared';
import { getHomeLiveData } from './live-data';
import { getHomeBanners } from './banners-data';
import { BannerGrid, StatsStrip, TurnkeySection, OctoCard } from './top';
import { LiveOnPlatform } from './live-on-platform';

/** ADDON-32 storefront home (design/Main.png): Turnkey lead banner + side banners, stats strip, live cards, Turnkey section,
 *  10-card feature grid, global shipping band, featured products, pools, verified suppliers, reviews, CTA + Octo.
 *  Only REAL data is rendered; a section without data is hidden (placeholders only with site_settings home.show_placeholders). */
export async function HomeView() {
  const [{ blocks, settings, company, categories, branches, ctx }, featured, suppliers, poolsFilled, poolsClosing, live, turnkey, banners, open] = await Promise.all([
    getStoreContent(), getFeatured(4), getVerifiedSuppliers(3), listOpenPools({ sort: 'filled', limit: 1 }), listOpenPools({ sort: 'closing', limit: 1 }),
    getHomeLiveData(), getTurnkeyCatalogue(), getHomeBanners(), getOpenProjectCard(),
  ]);
  const supplierCats = await getSupplierCategories(suppliers.map((s) => s.id));
  const rules = poolSettings(settings);
  const turnkeyOn = settings['turnkey.enabled'] !== false;
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const fmt = (v: number) => new Intl.NumberFormat('en-US').format(v);
  const logistics = (settings.logistics_stats ?? {}) as LogisticsStats;
  const showPlaceholders = settings['home.show_placeholders'] === true;
  const turnkeyCount = turnkeyOn ? turnkey.projects.length : 0;
  const vars = { turnkey: turnkeyCount || null, deposit_pct: rules.depositPct, countries: logistics.countries, currency: ctx.currency };
  const offices = typeof settings['home.china_offices'] === 'number' ? (settings['home.china_offices'] as number) : branches.filter((b) => (b.country ?? 'CN') === 'CN').length;
  const order = Array.isArray(settings['home.feature_cards']) ? (settings['home.feature_cards'] as unknown[]).filter((k) => turnkeyOn || k !== 'turnkey') : undefined;

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
      <BannerGrid blocks={blocks} banners={turnkeyOn ? banners : banners.filter((b) => !b.cta_href?.startsWith('/turnkey'))} open={turnkeyOn ? open : null}
        pool={rules.enabled ? poolsFilled.items[0] ?? null : null} poolsOn={rules.enabled} vars={vars} />
      <StatsStrip tiles={[
        { label: 'Products', value: live.products ? fmt(live.products) : null },
        { label: 'Verified suppliers', value: live.verifiedSuppliers ? fmt(live.verifiedSuppliers) : null },
        { label: 'Turnkey projects', value: turnkeyCount ? fmt(turnkeyCount) : null },
        { label: 'Countries shipped', value: logistics.countries ?? (live.destinations.length ? fmt(live.destinations.length) : null) },
        { label: offices === 1 ? 'China office' : 'China offices', value: offices ? fmt(offices) : null },
        { label: 'Saved with bulk tiers', value: live.maxBulkSavingPct ? `${live.maxBulkSavingPct}%` : null },
      ]} />
      <LiveOnPlatform blocks={blocks} liveRfq={live.liveRfq} pool={rules.enabled ? poolsClosing.items[0] ?? null : null} featured={featured} />
      {turnkeyOn && <TurnkeySection blocks={blocks} projects={turnkey.projects} packages={turnkey.packages} vars={vars} />}
      <PlatformServices blocks={blocks} poolsOn={rules.enabled} order={order} vars={vars} />
      <LogisticsBand blocks={blocks} stats={logistics} live={live} />

      {featured.length > 0 && (
        <section aria-labelledby="home-featured-h" className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-[72px]">
          <SectionHead id="home-featured-h" title={block(blocks, 'home.featured.title', 'Featured products')} href="/products" link={block(blocks, 'home.featured.link', 'View all products')} />
          <ProductGrid products={featured} categoryNames={catName} variant="featured" />
        </section>
      )}

      <Suspense fallback={null}>
        <HomePoolsSection />
      </Suspense>

      <VerifiedSuppliers blocks={blocks} suppliers={suppliers} categories={supplierCats} showPlaceholders={showPlaceholders}
        sponsored={<Suspense fallback={null}><AdSlot placement="home_banner" /></Suspense>} />

      <Testimonials blocks={blocks} showPlaceholders={showPlaceholders} />
      <HomeCta blocks={blocks} aside={<OctoCard blocks={blocks} />} />
    </>
  );
}

export function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="bg-surface h-[380px]" />
      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-12 space-y-16">
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="card h-[72px]" />)}</div>
        <GridSkeleton n={4} />
      </div>
    </div>
  );
}
