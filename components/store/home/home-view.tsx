import { Suspense } from 'react';
import { getStoreContent } from '@/components/store/currency';
import { getFeatured, getVerifiedSuppliers, listOpenPools, getSupplierCategories, listProducts, getServices } from '@/components/store/data';
import { GridSkeleton } from '@/components/store/product-card';
import { AdSlot } from '@/components/store/ad-slot';
import { JsonLd, SITE_URL } from '@/components/store/seo';
import { poolSettings } from '@/components/store/pools/shared';
import { getTurnkeyCatalogue } from '@/lib/turnkey/data';
import { HomeCta } from './sections';
import { getHomeLiveData } from './live-data';
import { OctoCard } from './top';
import { SourcingHero, ServiceCards, SourcingSteps, MakeMyBrand, Dropshipping, Pools, Warehousing, ShippingBand, Turnkey, StatsAndServices, Suppliers, type ShippingStats } from './v2';

/** Storefront home — Nov 2026 design (Home-desktop-full.png): five numbered services (sourcing hero with quote form,
 *  dropshipping, MOQ pools, 3PL, Turnkey), how-it-works steps, ready-to-order products, open pools, shipping band,
 *  stats, other services, verified suppliers, CTA. Only REAL data is rendered; sections without data are hidden. */
export async function HomeView() {
  const [{ blocks, settings, company, branches }, featured, suppliers, pools, live, turnkey, services] = await Promise.all([
    getStoreContent(), getFeatured(4), getVerifiedSuppliers(3), listOpenPools({ sort: 'filled', limit: 3 }), getHomeLiveData(), getTurnkeyCatalogue(), getServices(),
  ]);
  const supplierCats = await getSupplierCategories(suppliers.map((s) => s.id));
  // "Ready to order": featured products, else the newest live products that have a photo (real listings only)
  const ready = featured.length ? featured : (await listProducts({ sort: 'newest' })).items.filter((p) => p.image_url).slice(0, 4);
  const rules = poolSettings(settings);
  const turnkeyOn = settings['turnkey.enabled'] !== false;
  const fmt = (v: number) => new Intl.NumberFormat('en-US').format(v);
  const stats = (settings.logistics_stats ?? {}) as ShippingStats;
  const offices = typeof settings['home.china_offices'] === 'number' ? (settings['home.china_offices'] as number) : branches.filter((b) => (b.country ?? 'CN') === 'CN').length;
  const turnkeyCount = turnkeyOn ? turnkey.projects.length : 0;
  const defaultCountry = typeof settings['home.default_destination'] === 'string' ? (settings['home.default_destination'] as string) : 'AE';

  const orgLd = company && {
    '@context': 'https://schema.org', '@type': 'Organization',
    name: company.brand ?? company.legal_name, legalName: company.legal_name, url: SITE_URL, logo: `${SITE_URL}/logo.png`,
    email: company.email ?? undefined, telephone: company.phone ?? undefined, slogan: company.tagline ?? undefined,
    address: company.address ? { '@type': 'PostalAddress', streetAddress: company.address } : undefined,
    contactPoint: company.phone ? [{ '@type': 'ContactPoint', telephone: company.phone, email: company.email ?? undefined, contactType: 'sales' }] : undefined,
  };

  return (
    <div className="home-v2">
      {orgLd && <JsonLd data={orgLd} />}
      <SourcingHero blocks={blocks} defaultCountry={defaultCountry} fee={services.rfq ? { cents: services.rfq.priceCents ?? 0, currency: services.rfq.currency } : null} />
      <ServiceCards blocks={blocks} poolsOn={rules.enabled} turnkeyOn={turnkeyOn} />
      <SourcingSteps blocks={blocks} products={ready} />
      <MakeMyBrand blocks={blocks} />
      <Dropshipping blocks={blocks} countries={stats.countries} />
      {rules.enabled && <Pools blocks={blocks} pools={pools.items} depositPct={rules.depositPct} />}
      <Warehousing blocks={blocks} />
      <ShippingBand blocks={blocks} stats={stats} />
      {turnkeyOn && <Turnkey blocks={blocks} projects={turnkey.projects} packages={turnkey.packages} />}
      <StatsAndServices blocks={blocks} tiles={[
        { label: 'Products live', value: live.products ? fmt(live.products) : null },
        { label: 'Verified suppliers', value: live.verifiedSuppliers ? fmt(live.verifiedSuppliers) : null },
        { label: 'Turnkey projects', value: turnkeyCount ? fmt(turnkeyCount) : null },
        { label: offices === 1 ? 'China office' : 'China offices', value: offices ? fmt(offices) : null },
      ]} />
      <Suppliers blocks={blocks} suppliers={suppliers} categories={supplierCats}
        sponsored={<Suspense fallback={null}><AdSlot placement="home_banner" layout="card" houseFallback={false} /></Suspense>} />
      <HomeCta blocks={blocks} aside={<OctoCard blocks={blocks} />} />
    </div>
  );
}

export function HomeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <div className="bg-pearl h-[380px]" />
      <div className="max-w-[1280px] mx-auto px-4 sm:px-8 pt-12 space-y-16">
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">{[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="card h-[72px]" />)}</div>
        <GridSkeleton n={4} />
      </div>
    </div>
  );
}
