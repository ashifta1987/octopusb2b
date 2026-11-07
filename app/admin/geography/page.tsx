import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { Card, Stat, PageHeader, EmptyState, Table } from '@/components/ui';
import { Bar, CountryTag } from '@/components/admin/ui';
import { money, humanize, COUNTRY_NAMES, CURRENCIES } from '@/lib/format';
import { rateLabel } from '@/components/admin/currency';
import { cn } from '@/lib/cn';
import { loadGeography, REGIONS } from './data';
import { nowMs } from '@/components/admin/server';

export const metadata = { title: 'Customer geography' };

type SP = { period?: string; kyc?: string; type?: string; region?: string };

function sinceFor(period?: string) {
  const days = period === '30' ? 30 : period === '90' ? 90 : period === '365' ? 365 : 0;
  return days ? new Date(nowMs() - days * 864e5).toISOString() : undefined;
}

/** Admin → Customer geography (Geo.png). Built from organizations.country, KYC status and order GMV. */
export default async function GeographyPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requireStaff('customers', 'view', '/admin/geography');
  const sp = await searchParams;
  const { rows, orgs, allOrgs, regionGmv, ctx } = await loadGeography({ kyc: sp.kyc, type: sp.type, since: sinceFor(sp.period), region: sp.region });
  const total = orgs.length;
  const verified = orgs.filter((o) => o.kyc_status === 'verified').length;
  const pendingOrgs = orgs.filter((o) => ['submitted', 'in_review', 'more_info'].includes(o.kyc_status));
  const totalGmv = rows.reduce((a, r) => a + r.gmv, 0);
  const regionList = REGIONS.map((r) => ({ r, ...(regionGmv.get(r) ?? { customers: 0, gmv: 0 }) })).filter((x) => x.customers > 0 || x.gmv > 0);
  const allRegionGmv = regionList.reduce((a, x) => a + x.gmv, 0);
  const allRegionCustomers = regionList.reduce((a, x) => a + x.customers, 0);
  const topRegion = [...regionList].sort((a, b) => b.gmv - a.gmv)[0];
  const types = [...new Set(allOrgs.map((o) => o.business_type).filter(Boolean) as string[])].sort();
  const maxCustomers = Math.max(1, ...rows.map((r) => r.customers));
  const cities = new Map<string, { city: string; country: string | null; n: number }>();
  orgs.forEach((o) => { if (!o.city) return; const k = `${o.city}|${o.country}`; const a = cities.get(k) ?? { city: o.city, country: o.country, n: 0 }; a.n++; cities.set(k, a); });
  const bt = new Map<string, number>();
  orgs.forEach((o) => bt.set(o.business_type ?? 'Not set', (bt.get(o.business_type ?? 'Not set') ?? 0) + 1));
  const btMax = Math.max(1, ...bt.values());
  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/admin/geography${p.size ? '?' + p : ''}`;
  };
  const gmv = (v: number) => money(v, ctx.currency, { compact: true });
  const mixed = rows.some((r) => Object.keys(r.gmvBy).some((c) => c !== ctx.currency));
  const exportQs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();

  return (
    <>
      <PageHeader title="Customer geography" subtitle={`Built from customer company profiles and KYC: business country, KYC status and order value. GMV is shown in ${ctx.currency}; orders in another currency are converted at the approved rate (${rateLabel(ctx)}).`} />
      <form action="/admin/geography" className="flex flex-wrap gap-3 mb-6">
        {sp.region && <input type="hidden" name="region" value={sp.region} />}
        <label className="sr-only" htmlFor="g-period">Period</label>
        <select id="g-period" name="period" className="input w-auto" defaultValue={sp.period ?? ''}>
          <option value="">All time</option><option value="30">Signed up last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option>
        </select>
        <label className="sr-only" htmlFor="g-kyc">KYC status</label>
        <select id="g-kyc" name="kyc" className="input w-auto" defaultValue={sp.kyc ?? ''}>
          <option value="">All KYC statuses</option><option value="verified">Verified</option><option value="pending">Pending review</option><option value="not_started">Not started</option><option value="rejected">Rejected</option>
        </select>
        <label className="sr-only" htmlFor="g-type">Business type</label>
        <select id="g-type" name="type" className="input w-auto" defaultValue={sp.type ?? ''}>
          <option value="">All business types</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="btn btn-ghost" type="submit">Apply</button>
        <a className="btn btn-ghost" href={`/admin/geography/export${exportQs ? '?' + exportQs : ''}`}>Export CSV</a>
      </form>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label="Customers" value={total.toLocaleString()} hint={`${total ? Math.round((verified / total) * 100) : 0}% KYC verified`} />
        <Stat label="Countries" value={rows.filter((r) => r.customers > 0).length} hint="with at least 1 customer" />
        <Stat label="Top region by GMV" value={topRegion && topRegion.gmv > 0 ? topRegion.r : '—'} hint={topRegion && allRegionGmv ? `${Math.round((topRegion.gmv / allRegionGmv) * 100)}% of GMV` : undefined} />
        <Stat label="KYC pending review" value={pendingOrgs.length} hint={`${pendingOrgs.filter((o) => nowMs() - new Date(o.created_at).getTime() > 48 * 36e5).length} older than 48 h`} hintTone={pendingOrgs.length ? 'warn' : undefined} />
      </div>

      <Card title="By region" className="mb-6">
        <div className="px-6 pb-6 grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
          <Link href={qs({ region: undefined })} aria-current={!sp.region ? 'true' : undefined} className={cn('rounded-[10px] border p-4', !sp.region ? 'bg-navy text-white border-navy' : 'border-line hover:border-navy')}>
            <div className="text-sm opacity-80">All regions</div><div className="font-display text-2xl font-bold">{allRegionCustomers}</div><div className="text-xs opacity-80">{gmv(allRegionGmv)} GMV</div>
          </Link>
          {regionList.map((x) => (
            <Link key={x.r} href={qs({ region: x.r })} aria-current={sp.region === x.r ? 'true' : undefined} className={cn('rounded-[10px] border p-4', sp.region === x.r ? 'bg-navy text-white border-navy' : 'border-line hover:border-navy')}>
              <div className="text-sm opacity-80">{x.r}</div><div className="font-display text-2xl font-bold">{x.customers}</div><div className="text-xs opacity-80">{gmv(x.gmv)} GMV</div>
            </Link>
          ))}
        </div>
      </Card>

      <Card title={`By country · ${sp.region ?? 'all regions'}`} className="mb-6" action={<span className="text-sm text-muted">Sorted by GMV · {ctx.currency}{mixed ? `, converted at ${rateLabel(ctx)}` : ''}</span>}>
        <Table head={['Country', 'Region', 'Customers', 'KYC verified', 'Pending', 'Orders', 'GMV', 'Share of GMV']} empty={<EmptyState title="No customers match these filters" />}>
          {rows.map((r) => (
            <tr key={r.country}>
              <td className="td font-semibold"><span className="inline-flex items-center gap-2"><CountryTag code={r.country} />{COUNTRY_NAMES[r.country] ?? r.country}</span></td>
              <td className="td text-sm">{r.region}</td>
              <td className="td">
                <span className="inline-flex items-center gap-2"><span className="mono w-8">{r.customers}</span><span className="h-1.5 w-20 rounded-full bg-line" aria-hidden><span className="block h-1.5 rounded-full bg-navy" style={{ width: `${(r.customers / maxCustomers) * 100}%` }} /></span></span>
              </td>
              <td className="td">{r.verified} ({r.customers ? Math.round((r.verified / r.customers) * 100) : 0}%)</td>
              <td className="td">{r.pending}</td>
              <td className="td">{r.orders}</td>
              <td className="td">
                <span className="mono font-semibold">{gmv(r.gmv)}</span>
                {Object.keys(r.gmvBy).some((c) => c !== ctx.currency) && (
                  <span className="block text-xs text-muted">
                    {CURRENCIES.filter((c) => r.gmvBy[c]).map((c) => money(r.gmvBy[c], c, { compact: true })).join(' · ')} · converted
                  </span>
                )}
              </td>
              <td className="td w-[180px]">
                <span className="flex items-center gap-2">
                  <span className="h-2 flex-1 rounded-full bg-line" aria-hidden><span className="block h-2 rounded-full bg-blue-fill" style={{ width: `${totalGmv ? (r.gmv / totalGmv) * 100 : 0}%` }} /></span>
                  <span className="mono text-xs w-12 text-right">{totalGmv ? ((r.gmv / totalGmv) * 100).toFixed(1) : '0.0'}%</span>
                </span>
              </td>
            </tr>
          ))}
        </Table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Top cities">
          {cities.size === 0 ? <EmptyState title="No cities recorded" /> : (
            <ul className="px-6 pb-5 divide-y divide-line">
              {[...cities.values()].sort((a, b) => b.n - a.n).slice(0, 8).map((c) => (
                <li key={c.city + c.country} className="flex justify-between py-2.5"><span><b>{c.city}</b> <span className="text-muted">· {c.country}</span></span><span className="mono text-sm">{c.n} customer{c.n === 1 ? '' : 's'}</span></li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Business types">
          <div className="px-6 pb-6">
            {bt.size === 0 ? <EmptyState title="No customers" /> : [...bt.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => <Bar key={k} label={humanize(k)} value={v} max={btMax} display={v} tone="navy" />)}
          </div>
        </Card>
      </div>
    </>
  );
}
