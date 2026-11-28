'use client';
// ODS T9
/**
 * ODS T9 · Customer geography (Part 7.6 list pattern): filter bar (period · KYC · business type, ?period ?kyc ?type),
 * KPI strip, region pills (?region), country grid and a read-only country drawer (KYC breakdown, GMV by currency, top
 * cities). Export CSV = today's /admin/geography/export route with the same query. No edits: today's page has none.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Drawer, Field, FilterPills, KpiStrip, OctopusDataGrid, Panel, Select, type GridColumn } from '@octopus/ui';
import { money, CURRENCIES } from '@/lib/format';
import { KYC_OPTIONS, PERIODS, exportHref, geoHref, isMixed, pct, share, topCities, topRegion, type GeoCountryRow, type GeoFilters, type GeoRegionCard } from '../_lib/geography-core';
import { KeyValueList } from '@/app/ods/office/_components/sales-bits';

export type GeographyViewProps = {
  sp: GeoFilters;
  rows: GeoCountryRow[];
  regions: GeoRegionCard[];
  kpis: { customers: number; verified: number; pending: number; pendingOld: number };
  types: string[];
  businessTypes: [string, number][];
  currency: string;
  rateLabel: string;
  base: string;
  loading?: boolean;
  error?: boolean;
  sample?: boolean;
  /** Fixtures: open this country's drawer on load. */
  initialOpen?: string | null;
};

const human = (s: string) => { const t = s.replace(/_/g, ' '); return t.charAt(0).toUpperCase() + t.slice(1); };

export function GeographyView({ sp, rows, regions, kpis, types, businessTypes, currency, rateLabel, base, loading, error, sample, initialOpen = null }: GeographyViewProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [openCode, setOpenCode] = useState<string | null>(initialOpen);
  const go = (patch: Partial<GeoFilters>) => { if (!sample) start(() => router.replace(geoHref(base, sp, patch))); };
  const gmv = (v: number) => money(v, currency, { compact: true });
  const totalGmv = rows.reduce((a, r) => a + r.gmv, 0);
  const allGmv = regions.reduce((a, x) => a + x.gmv, 0);
  const allCustomers = regions.reduce((a, x) => a + x.customers, 0);
  const top = topRegion(regions);
  const mixed = rows.some((r) => isMixed(r, currency));
  const open = rows.find((r) => r.country === openCode) ?? null;
  const btMax = Math.max(1, ...businessTypes.map(([, v]) => v));

  const cols: GridColumn<GeoCountryRow>[] = [
    { id: 'country', header: 'Country', accessor: (r) => r.name, width: 210, cell: (r) => <span className="inline-flex min-w-0 items-center gap-2"><span className="rounded-ods-control bg-ods-canvas px-1.5 font-mono text-ods-small">{r.country}</span><span className="truncate font-semibold">{r.name}</span></span> },
    { id: 'region', header: 'Region', accessor: (r) => r.region, width: 140 },
    { id: 'customers', header: 'Customers', accessor: (r) => r.customers, numeric: true, width: 110 },
    { id: 'verified', header: 'KYC verified', accessor: (r) => r.verified, numeric: true, width: 130, cell: (r) => `${r.verified} (${pct(r.verified, r.customers)}%)` },
    { id: 'pending', header: 'Pending', accessor: (r) => r.pending, numeric: true, width: 100 },
    { id: 'orders', header: 'Orders', accessor: (r) => r.orders, numeric: true, width: 100 },
    { id: 'gmv', header: 'GMV', accessor: (r) => r.gmv, numeric: true, width: 150, cell: (r) => <span className="flex flex-col items-end leading-tight"><span className="font-mono font-semibold">{gmv(r.gmv)}</span>{isMixed(r, currency) ? <span className="text-ods-small text-ods-slate">converted</span> : null}</span> },
    { id: 'share', header: 'Share of GMV', accessor: (r) => r.gmv, numeric: true, width: 120, cell: (r) => `${share(r.gmv, totalGmv)}%` },
  ];

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-end gap-3" role="search" aria-label="Geography filters">
        <Field label="Period" className="w-full ods-tablet:w-52"><Select value={sp.period ?? ''} onChange={(e) => go({ period: e.target.value || undefined })}>{PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="KYC status" className="w-full ods-tablet:w-48"><Select value={sp.kyc ?? ''} onChange={(e) => go({ kyc: e.target.value || undefined })}>{KYC_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        <Field label="Business type" className="w-full ods-tablet:w-48"><Select value={sp.type ?? ''} onChange={(e) => go({ type: e.target.value || undefined })}><option value="">All business types</option>{types.map((t) => <option key={t} value={t}>{t}</option>)}</Select></Field>
        <Button variant="secondary" href={exportHref(sp)} className="ods-tablet:ms-auto" data-testid="geo-export">Export CSV</Button>
      </div>
      <KpiStrip
        variant="strip"
        label="Customer geography"
        loading={loading}
        data-testid="geo-kpis"
        items={[
          { label: 'Customers', value: kpis.customers.toLocaleString('en-US'), hint: `${pct(kpis.verified, kpis.customers)}% KYC verified` },
          { label: 'Countries', value: rows.filter((r) => r.customers > 0).length, hint: 'with at least 1 customer' },
          { label: 'Top region by GMV', value: top ? top.region : '—', hint: top && allGmv ? `${pct(top.gmv, allGmv)}% of GMV` : undefined },
          { label: 'KYC pending review', value: kpis.pending, hint: `${kpis.pendingOld} older than 48 h` },
        ]}
      />
      <FilterPills
        label="Region"
        mode="single"
        allowEmpty={false}
        value={[sp.region ?? 'all']}
        onChange={(ids) => go({ region: ids[0] === 'all' ? undefined : ids[0] })}
        items={[{ id: 'all', label: `All regions · ${gmv(allGmv)}`, count: allCustomers }, ...regions.map((x) => ({ id: x.region, label: `${x.region} · ${gmv(x.gmv)}`, count: x.customers }))]}
        resultText={`Sorted by GMV · ${currency}${mixed ? `, converted at ${rateLabel}` : ''}`}
        data-testid="geo-regions"
      />
      <OctopusDataGrid
        label={`By country · ${sp.region ?? 'all regions'}`}
        rows={rows}
        columns={cols}
        getRowId={(r) => r.country}
        rowNumber={(r) => r.country}
        loading={loading || pending}
        error={error ? 'We couldn’t load the geography report.' : undefined}
        onRetry={sample ? undefined : () => router.refresh()}
        emptyTitle="No customers match these filters"
        emptyDescription="Try another period, KYC status or region."
        onClearFilters={sp.period || sp.kyc || sp.type || sp.region ? () => go({ period: undefined, kyc: undefined, type: undefined, region: undefined }) : undefined}
        onOpenRow={(r) => setOpenCode(r.country)}
        onOpenInDrawer={(r) => setOpenCode(r.country)}
        defaultSort={{ id: 'gmv', desc: true }}
        pagination
        headingLevel={2}
        data-testid="geo-grid"
      />
      <div className="grid gap-3 ods-desktop:grid-cols-2">
        <Panel title="Top cities" headingLevel={2}>
          {topCities(rows).length === 0 ? <p className="m-0 text-ods-small text-ods-slate">No cities recorded</p> : (
            <ul className="m-0 grid list-none divide-y divide-ods-line p-0">
              {topCities(rows).map((c) => <li key={c.city + c.country} className="flex justify-between py-1.5"><span><b>{c.city}</b> <span className="text-ods-slate">· {c.country}</span></span><span className="font-mono text-ods-small">{c.n} customer{c.n === 1 ? '' : 's'}</span></li>)}
            </ul>
          )}
        </Panel>
        <Panel title="Business types" headingLevel={2}>
          {businessTypes.length === 0 ? <p className="m-0 text-ods-small text-ods-slate">No customers</p> : (
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {businessTypes.map(([k, v]) => (
                <li key={k} className="grid grid-cols-[8rem_minmax(0,1fr)_3rem] items-center gap-2 text-ods-small">
                  <span className="truncate">{human(k)}</span>
                  <span className="h-2 rounded-full bg-ods-line" aria-hidden><span className="block h-2 rounded-full bg-ods-navy" style={{ width: `${(v / btMax) * 100}%` }} /></span>
                  <span className="text-end font-mono">{v}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Drawer open={!!open} onClose={() => setOpenCode(null)} title={open ? open.name : ''} description={open ? `${open.region} · ${open.country}` : undefined} data-testid="geo-drawer"
        footer={open ? <div className="flex justify-end"><Button size="sm" variant="secondary" href={`/admin/customers?q=${encodeURIComponent(open.country)}`}>Open customers</Button></div> : undefined}>
        {open ? (
          <div className="grid gap-3">
            <KeyValueList columns={1} rows={[
              ['Customers', String(open.customers)],
              ['KYC verified', `${open.verified} (${pct(open.verified, open.customers)}%)`],
              ['Pending review', String(open.pending)],
              ['Not started', String(open.notStarted)],
              ['Rejected', String(open.rejected)],
              ['Orders', String(open.orders)],
              ['GMV', `${gmv(open.gmv)} · ${share(open.gmv, totalGmv)}% of GMV`],
              ...(isMixed(open, currency) ? [['By order currency', CURRENCIES.filter((c) => open.gmvBy[c]).map((c) => money(open.gmvBy[c], c, { compact: true })).join(' · ') + ' · converted']] as [string, string][] : []),
            ]} />
            <section aria-labelledby="geo-cities">
              <h3 id="geo-cities" className="m-0 mb-1 text-ods-body font-semibold text-ods-navy">Cities</h3>
              {open.cities.length ? <ul className="m-0 grid list-none gap-1 p-0 text-ods-small">{open.cities.map((c) => <li key={c.city} className="flex justify-between"><span>{c.city}</span><span className="font-mono">{c.n}</span></li>)}</ul> : <p className="m-0 text-ods-small text-ods-slate">No cities recorded</p>}
            </section>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
