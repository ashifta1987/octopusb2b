// ODS T9 · Customer geography (Admin › Geography, Part 7.6 list + drawer). Replaces the T8 re-export of
// app/admin/geography/page.tsx. Same guard (requireStaff('customers','view')), same data (today's loadGeography: seed rows
// dropped, GMV converted at the approved rate), same filters and the same CSV export route. Read-only, as today.
import { Suspense } from 'react';
import { requireStaff } from '@/lib/auth';
import { COUNTRY_NAMES } from '@/lib/format';
import { rateLabel } from '@/components/admin/currency';
import { nowMs } from '@/components/admin/server';
import { loadGeography, REGIONS } from '@/app/admin/geography/data';
import { periodDays, type GeoCountryRow, type GeoFilters } from './_lib/geography-core';
import { GeographyView } from './_components/geography-view';
import { SalesPageHead } from '../../office/_components/sales-bits';

export const metadata = { title: 'Customer geography' };

type SP = Promise<GeoFilters>;

export default function GeographyPage({ searchParams }: { searchParams: SP }) {
  return (
    <div className="grid min-w-0 gap-3">
      <SalesPageHead crumbs={[{ label: 'Admin' }, { label: 'Geography' }]} title="Customer geography" subtitle="Built from customer company profiles and KYC: business country, KYC status and order value." />
      <Suspense fallback={<GeographyView sp={{}} rows={[]} regions={[]} kpis={{ customers: 0, verified: 0, pending: 0, pendingOld: 0 }} types={[]} businessTypes={[]} currency="USD" rateLabel="" base="/admin/geography" loading sample />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Content({ searchParams }: { searchParams: SP }) {
  await requireStaff('customers', 'view', '/admin/geography');
  const raw = await searchParams;
  const sp: GeoFilters = { period: raw.period || undefined, kyc: raw.kyc || undefined, type: raw.type || undefined, region: raw.region || undefined };
  const days = periodDays(sp.period);
  const now = nowMs();
  const { rows, orgs, allOrgs, regionGmv, ctx } = await loadGeography({ kyc: sp.kyc, type: sp.type, since: days ? new Date(now - days * 864e5).toISOString() : undefined, region: sp.region });
  const cityBy = new Map<string, Map<string, number>>();
  orgs.forEach((o) => {
    if (!o.city) return;
    const c = o.country ?? '??';
    const m = cityBy.get(c) ?? new Map<string, number>();
    m.set(o.city, (m.get(o.city) ?? 0) + 1);
    cityBy.set(c, m);
  });
  const vm: GeoCountryRow[] = rows.map((r) => ({
    ...r,
    name: COUNTRY_NAMES[r.country] ?? r.country,
    cities: [...(cityBy.get(r.country) ?? new Map()).entries()].map(([city, n]) => ({ city, n })).sort((a, b) => b.n - a.n).slice(0, 8),
  }));
  const pendingOrgs = orgs.filter((o) => ['submitted', 'in_review', 'more_info'].includes(o.kyc_status));
  const bt = new Map<string, number>();
  orgs.forEach((o) => bt.set(o.business_type ?? 'Not set', (bt.get(o.business_type ?? 'Not set') ?? 0) + 1));
  return (
    <GeographyView
      sp={sp}
      rows={vm}
      regions={REGIONS.map((r) => ({ region: r, ...(regionGmv.get(r) ?? { customers: 0, gmv: 0 }) })).filter((x) => x.customers > 0 || x.gmv > 0)}
      kpis={{
        customers: orgs.length,
        verified: orgs.filter((o) => o.kyc_status === 'verified').length,
        pending: pendingOrgs.length,
        pendingOld: pendingOrgs.filter((o) => now - new Date(o.created_at).getTime() > 48 * 36e5).length,
      }}
      types={[...new Set(allOrgs.map((o) => o.business_type).filter(Boolean) as string[])].sort()}
      businessTypes={[...bt.entries()].sort((a, b) => b[1] - a[1])}
      currency={ctx.currency}
      rateLabel={rateLabel(ctx)}
      base="/admin/geography"
    />
  );
}
