'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { DsButton, DsCard, DsEmptyState, DsInput, DsLinkButton, DsNotice, DsPageHeader, DsSelect } from '@/components/dropship-ui';
import type { ReportsPageData } from '@/lib/dropship-ds12';
import { bpPct, days, fmtDate, pctChange, pointsChange, shareOf, usd, usdWhole, weekLabel, type PeriodKey } from '@/lib/dropship-ds12-shared';

/**
 * Release 5 · Step 13 — Reports screen (screens/Reports.html, mobile/M_Reports.html): filters (period, store, country),
 * six KPI tiles, profit by week (12 weeks), where the costs go, top products, Export CSV. Numbers come only from the server;
 * an empty period shows the empty state, never sample numbers.
 */

const METHOD: Record<string, string> = { economy: 'Economy', standard: 'Standard', express: 'Express' };

function Tile({ label, value, sub, testId }: { label: string; value: string; sub?: string | null; testId: string }) {
  return (
    <div className="ds-card !py-4 flex flex-col gap-1" data-testid={testId}>
      <span className="text-[13px] text-muted">{label}</span>
      <strong className="text-[22px] text-ink" data-testid={`${testId}-value`}>{value}</strong>
      {sub ? <span className="text-[13px] text-muted">{sub}</span> : null}
    </div>
  );
}

export function ReportsClient({ data, period, customFrom, customTo, badCustom, countryNames }: {
  data: ReportsPageData; period: PeriodKey; customFrom: string | null; customTo: string | null; badCustom: boolean; countryNames: Record<string, string>;
}) {
  const router = useRouter();
  const [p, setP] = useState<PeriodKey>(period);
  const [from, setFrom] = useState(customFrom ?? '');
  const [to, setTo] = useState(customTo ?? '');
  const [country, setCountry] = useState(data.country ?? '');
  const c = data.current;
  const prev = data.previous;
  const q = new URLSearchParams({ period: p, ...(p === 'custom' ? { from, to } : {}), ...(country ? { country } : {}) }).toString();
  const csvHref = `/account/dropship/reports/csv?${new URLSearchParams({ from: data.from, to: data.to, ...(data.country ? { country: data.country } : {}) }).toString()}`;
  const maxWeek = Math.max(1, ...data.weeks.map((w) => Math.abs(Number(w.profit_cents))));
  const route = data.delivery_route ? [data.delivery_route.country ? countryNames[data.delivery_route.country] ?? data.delivery_route.country : null, data.delivery_route.method ? METHOD[data.delivery_route.method] ?? data.delivery_route.method : null].filter(Boolean).join(', ') : null;
  const costs = [
    ['Product', c.product_cents], ['Processing', c.processing_cents], ['Shipping', c.shipping_cents], ['Duties and tax', c.duties_cents],
    ...(Number(c.refunds_cents) !== 0 ? [['Refunds', c.refunds_cents] as [string, number]] : []),
  ] as [string, number][];

  function apply(e: React.FormEvent) {
    e.preventDefault();
    router.push(`/account/dropship/reports?${q}`);
  }

  return (
    <div className="flex flex-col gap-5" data-testid="ds-reports-page">
      <DsPageHeader title="Reports" icon="chart" subtitle="Sales, costs and profit by product, store and period."
        actions={c.orders > 0 ? <DsLinkButton href={csvHref} variant="secondary" icon="download" testId="reports-csv">Export CSV</DsLinkButton> : undefined} />

      <form onSubmit={apply} className="ds-card grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end" aria-label="Report filters" data-testid="reports-filters">
        <DsSelect id="rep-period" label="Period" value={p} onChange={(e) => setP(e.target.value as PeriodKey)}>
          <option value="30d">Last 30 days</option>
          <option value="7d">Last 7 days</option>
          <option value="quarter">This quarter</option>
          <option value="custom">Custom</option>
        </DsSelect>
        {p === 'custom' && (
          <>
            <DsInput id="rep-from" type="date" label="From" value={from} onChange={(e) => setFrom(e.target.value)} error={badCustom ? 'Choose a start date before the end date (up to 400 days).' : undefined} />
            <DsInput id="rep-to" type="date" label="To" value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        <DsSelect id="rep-store" label="Store" value="" onChange={() => undefined} hint={data.stores.length ? undefined : 'No store connected yet'}>
          <option value="">All stores</option>
          {data.stores.map((s) => <option key={s.id} value={s.id} disabled>{s.shop_domain}</option>)}
        </DsSelect>
        <DsSelect id="rep-country" label="Country" value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">All countries</option>
          {data.countries.map((cc) => <option key={cc} value={cc}>{countryNames[cc] ?? cc}</option>)}
        </DsSelect>
        <DsButton type="submit" variant="secondary" icon="refresh" testId="reports-apply">Show</DsButton>
      </form>
      <p className="m-0 -mt-2 text-[13px] text-muted" data-testid="reports-range">{fmtDate(data.from)} to {fmtDate(new Date(new Date(data.to).getTime() - 1).toISOString())} · amounts in US$ at each order&rsquo;s locked exchange rate</p>

      {c.orders === 0 ? (
        <DsEmptyState icon="chart" testId="reports-empty" title="No orders in this period"
          description="Reports fill in as paid orders come in. Try a longer period, or find products to sell." actionLabel="Find products" actionHref="/account/dropship/catalogue" />
      ) : (
        <>
          {c.orders_without_price > 0 && (
            <DsNotice tone="info" title={`${c.orders_without_price} order${c.orders_without_price === 1 ? '' : 's'} without a store price`} testId="reports-unknown-sales">
              Their store sales are not known yet, so they are left out of sales and profit (their Octopus costs are counted).
            </DsNotice>
          )}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3" data-testid="reports-kpis">
            <Tile label="Store sales" value={usdWhole(c.sales_cents)} sub={pctChange(c.sales_cents, prev.sales_cents)} testId="kpi-sales" />
            <Tile label="Octopus costs" value={usdWhole(c.costs_cents)} sub={shareOf(c.costs_cents, c.sales_cents)} testId="kpi-costs" />
            <Tile label="Profit before ads" value={usdWhole(c.profit_cents)} sub={pctChange(c.profit_cents, prev.profit_cents)} testId="kpi-profit" />
            <Tile label="Orders" value={String(c.orders)} sub={pctChange(c.orders, prev.orders)} testId="kpi-orders" />
            <Tile label="Refund rate" value={bpPct(c.refund_rate_bp)} sub={pointsChange(c.refund_rate_bp, prev.refund_rate_bp)} testId="kpi-refunds" />
            <Tile label="Average delivery" value={days(c.avg_delivery_days)} sub={route} testId="kpi-delivery" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <DsCard title="Profit by week" subtitle="Weekly profit before ads, last 12 weeks" icon="chart" className="lg:col-span-2" testId="reports-weeks">
              <div className="flex items-end gap-1.5 h-[160px]" role="img" aria-label={`Weekly profit, last 12 weeks: ${data.weeks.map((w, i) => `${weekLabel(i)} ${usd(Number(w.profit_cents))}`).join(', ')}`}>
                {data.weeks.map((w, i) => {
                  const v = Number(w.profit_cents);
                  return (
                    <div key={w.week_start} className="flex-1 flex flex-col items-center justify-end h-full gap-1">
                      <div className={`w-full rounded-t ${v < 0 ? 'bg-needs' : 'bg-ok'}`} style={{ height: `${Math.max(2, Math.round((Math.abs(v) / maxWeek) * 130))}px` }} title={`${weekLabel(i)} (from ${fmtDate(w.week_start)}): ${usd(v)}`} />
                      <span className="text-[11px] text-muted" aria-hidden="true">{weekLabel(i)}</span>
                    </div>
                  );
                })}
              </div>
            </DsCard>
            <DsCard title="Where the costs go" icon="dollar" testId="reports-costs">
              <dl className="m-0 flex flex-col gap-2 text-[14px]">
                {costs.map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-3"><dt className="text-black">{k}</dt><dd className="m-0 font-medium text-ink" data-testid={`cost-${k.toLowerCase().replace(/\s+/g, '-')}`}>{usd(Number(v))}</dd></div>
                ))}
                <div className="flex justify-between gap-3 border-t border-divider pt-2"><dt className="font-semibold text-ink">Total Octopus costs</dt><dd className="m-0 font-semibold text-ink" data-testid="cost-total">{usd(c.costs_cents)}</dd></div>
              </dl>
            </DsCard>
          </div>

          <section aria-labelledby="top-h" className="ds-card !p-0 overflow-hidden" data-testid="reports-top">
            <h2 id="top-h" className="m-0 px-5 pt-4 pb-3 text-[17px] font-semibold text-ink">Top products</h2>
            <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Top products">
              <table className="w-full min-w-[720px] text-[14px] border-collapse">
                <thead className="bg-pearl text-left text-muted">
                  <tr>
                    <th scope="col" className="px-5 py-2.5 font-medium">Product</th><th scope="col" className="px-3 py-2.5 font-medium text-right">Units</th>
                    <th scope="col" className="px-3 py-2.5 font-medium text-right">Sales</th><th scope="col" className="px-3 py-2.5 font-medium text-right">Costs</th>
                    <th scope="col" className="px-3 py-2.5 font-medium text-right">Profit</th><th scope="col" className="px-3 py-2.5 font-medium text-right">Refunds</th>
                    <th scope="col" className="px-5 py-2.5 font-medium text-right">Avg delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {data.top_products.map((t) => (
                    <tr key={t.product_id} className="border-t border-divider hover:bg-pearl">
                      <td className="px-5 py-2.5 text-ink">{t.title} · <span className="text-muted">{t.model_no}</span></td>
                      <td className="px-3 py-2.5 text-right">{t.units ?? 0}</td>
                      <td className="px-3 py-2.5 text-right">{usdWhole(t.sales_cents)}</td>
                      <td className="px-3 py-2.5 text-right">{usdWhole(t.costs_cents)}</td>
                      <td className="px-3 py-2.5 text-right">{t.sales_cents == null || t.costs_cents == null ? 'Not known yet' : usdWhole(t.sales_cents - t.costs_cents)}</td>
                      <td className="px-3 py-2.5 text-right">{t.refunds}</td>
                      <td className="px-5 py-2.5 text-right">{t.avg_delivery_days == null ? '—' : days(t.avg_delivery_days)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
