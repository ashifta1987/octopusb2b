import { Suspense } from 'react';
import Link from 'next/link';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, PageHeader, Notice } from '@/components/ui';
import { money, humanize } from '@/lib/format';
import { getCurrencyContext } from '@/lib/currency';
import { getDivisionScope } from '@/lib/divisions/scope';
import { isStaging } from '@/lib/core/account';

export const metadata = { title: 'Reports by division' };

type Row = {
  line: 'division' | 'advertising' | 'company'; division_code: string | null; division_name: string; sort_order: number;
  revenue_by_currency: Record<string, number>; revenue_converted_minor: number; orders_count: number;
  orders_by_currency: Record<string, number>; orders_converted_minor: number; open_work: number; open_detail: Record<string, number>;
  pipeline_count: number; pipeline_by_currency: Record<string, number>; pipeline_converted_minor: number;
};
const WORK_LABEL: Record<string, string> = {
  rfqs: 'RFQs', service_requests: 'Service requests', orders: 'Orders in progress', brand_projects: 'Brand projects', pools: 'Open pools',
  turnkey_leads: 'Turnkey leads', shipments: 'Shipments',
};

/**
 * Divisions step 5 — Reports › By division: revenue, orders and open work for each division of Shenzhen Octopus Trading
 * Co., Ltd., advertising as its own line, company-wide revenue and the company total. Revenue counts from the TAX INVOICE
 * (invoices − credit notes + other ledger revenue such as fees and ad clicks); issued proformas are shown as Pipeline and
 * never added to revenue. Open work is live, not limited to the period.
 */
async function DivisionReport({ searchParams }: { searchParams: Promise<{ months?: string; test?: string }> }) {
  const s = await requireStaff('dashboard', 'view', '/admin/reports/divisions');
  const sp = await searchParams;
  const months = sp.months === '12' ? 12 : sp.months === '3' ? 3 : sp.months === 'all' ? 0 : 6;
  const includeTest = isStaging() && sp.test === '1';
  const since = new Date(); since.setUTCDate(1); since.setUTCHours(0, 0, 0, 0); since.setUTCMonth(since.getUTCMonth() - (months - 1));
  const sb = await createClient();
  const [scope, ctx, res] = await Promise.all([
    getDivisionScope(s), getCurrencyContext(),
    sb.rpc('division_report', { p_from: months ? since.toISOString() : null, p_to: null, p_include_test: includeTest }),
  ]);
  if (res.error) throw new Error(`Could not load the division report: ${res.error.message}`);
  let rows = (res.data ?? []) as Row[];
  if (!scope.all) rows = rows.filter((r) => r.division_code === scope.division.code);   // header switcher: one division
  const divs = rows.filter((r) => r.line === 'division');
  const extra = rows.filter((r) => r.line !== 'division');
  const total = rows.reduce((a, r) => ({ rev: a.rev + Number(r.revenue_converted_minor), ord: a.ord + r.orders_count, val: a.val + Number(r.orders_converted_minor), work: a.work + r.open_work, pipe: a.pipe + Number(r.pipeline_converted_minor ?? 0), pipeN: a.pipeN + (r.pipeline_count ?? 0) }), { rev: 0, ord: 0, val: 0, work: 0, pipe: 0, pipeN: 0 });
  const max = Math.max(1, ...rows.map((r) => Number(r.revenue_converted_minor)));
  const byCur = (m: Record<string, number>) => Object.entries(m ?? {}).filter(([, v]) => Number(v) !== 0);
  const mixed = rows.some((r) => [...Object.keys(r.revenue_by_currency ?? {}), ...Object.keys(r.orders_by_currency ?? {})].some((c) => c !== ctx.currency));
  const q = (patch: Record<string, string>) => `/admin/reports/divisions?${new URLSearchParams({ months: months ? String(months) : 'all', ...(includeTest ? { test: '1' } : {}), ...patch })}`;

  const revCell = (r: Row) => (
    <td className="td">
      <div className="font-semibold mono">{money(Number(r.revenue_converted_minor), ctx.currency)}</div>
      {mixed && byCur(r.revenue_by_currency).length > 0 && <div className="text-xs text-muted mono">{byCur(r.revenue_by_currency).map(([c, v]) => money(Number(v), c)).join(' + ')}</div>}
      <div className="h-1.5 mt-1 rounded bg-pearl overflow-hidden" aria-hidden><div className="h-full bg-coral-text" style={{ width: `${Math.max(0, Number(r.revenue_converted_minor)) / max * 100}%` }} /></div>
    </td>
  );
  return (
    <>
      <PageHeader eyebrow={<span className="eyebrow">Admin · Reports</span>} title="Reports by division"
        subtitle={`Shenzhen Octopus Trading Co., Ltd. · revenue counts from the tax invoice; issued proformas are pipeline; advertising on its own line. Amounts in ${ctx.currency}${mixed ? ' (other currencies converted at the approved rate)' : ''}.`}
        actions={
          <form className="flex flex-wrap items-center gap-3" action="/admin/reports/divisions">
            <label htmlFor="months" className="text-sm text-muted">Period</label>
            <select id="months" name="months" defaultValue={months ? String(months) : 'all'} className="input w-auto">
              <option value="3">Last 3 months</option><option value="6">Last 6 months</option><option value="12">Last 12 months</option><option value="all">All time</option>
            </select>
            {isStaging() && <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="test" value="1" defaultChecked={includeTest} className="w-5 h-5" /> Include test data (staging)</label>}
            <button className="btn btn-ghost" type="submit">Apply</button>
            <Link className="btn btn-ghost" href="/admin/reports">Platform overview</Link>
          </form>
        } />
      {!scope.all && <div className="mb-4"><Notice>Showing {scope.division.name} only (header switcher). Choose &quot;All divisions&quot; for the company total and advertising.</Notice></div>}
      {includeTest && <div className="mb-4"><Notice tone="amber">Includes staging TEST data.</Notice></div>}
      <Card title="Revenue, orders and open work" action={<span className="text-xs text-muted">Open work is live (today), not limited to the period</span>}>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Division report">
          <table className="w-full border-collapse min-w-[860px]" data-testid="division-report">
            <thead><tr><th className="th">Division</th><th className="th">Revenue</th><th className="th text-right">Pipeline (proformas)</th><th className="th text-right">Orders</th><th className="th text-right">Order value</th><th className="th">Open work</th></tr></thead>
            <tbody>
              {divs.map((r) => (
                <tr key={r.division_code} data-testid={`report-row-${r.division_code}`}>
                  <td className="td"><div className="font-semibold">{r.division_name}</div><div className="mono text-xs text-muted">{r.division_code}</div></td>
                  {revCell(r)}
                  <td className="td text-right" data-testid={`pipeline-${r.division_code ?? r.line}`}><div className="mono">{money(Number(r.pipeline_converted_minor ?? 0), ctx.currency)}</div>{(r.pipeline_count ?? 0) > 0 && <div className="text-xs text-muted">{r.pipeline_count} proforma{r.pipeline_count === 1 ? '' : 's'}</div>}</td>
                  <td className="td text-right mono">{r.orders_count.toLocaleString()}</td>
                  <td className="td text-right mono">{money(Number(r.orders_converted_minor), ctx.currency)}</td>
                  <td className="td">
                    <div className="font-semibold">{r.open_work}</div>
                    <div className="flex flex-wrap gap-1 mt-1">{Object.entries(r.open_detail ?? {}).map(([k, v]) => <span key={k} className="text-xs rounded-full bg-pearl px-2 py-0.5">{WORK_LABEL[k] ?? humanize(k)} {v}</span>)}</div>
                  </td>
                </tr>
              ))}
              {extra.map((r) => (
                <tr key={r.line} data-testid={`report-row-${r.line}`} className="bg-pearl/40">
                  <td className="td"><div className="font-semibold">{r.division_name}</div><div className="text-xs text-muted">{r.line === 'advertising' ? 'Ad clicks · company-wide' : 'Not tied to a division'}</div></td>
                  {revCell(r)}
                  {r.line === 'company' ? (<td className="td text-right" data-testid={`pipeline-${r.division_code ?? r.line}`}><div className="mono">{money(Number(r.pipeline_converted_minor ?? 0), ctx.currency)}</div>{(r.pipeline_count ?? 0) > 0 && <div className="text-xs text-muted">{r.pipeline_count} proforma{r.pipeline_count === 1 ? '' : 's'}</div>}</td>) : <td className="td text-right text-muted">—</td>}
                  <td className="td text-right text-muted">—</td><td className="td text-right text-muted">—</td><td className="td text-muted">—</td>
                </tr>
              ))}
              {scope.all && (
                <tr data-testid="report-row-total" className="border-t-2 border-ink">
                  <td className="td font-bold">Company total</td>
                  <td className="td font-bold mono">{money(total.rev, ctx.currency)}</td>
                  <td className="td text-right mono text-muted" title="Not included in the company total">{money(total.pipe, ctx.currency)}<div className="text-xs">{total.pipeN} proforma{total.pipeN === 1 ? '' : 's'} · not in total</div></td>
                  <td className="td text-right font-bold mono">{total.ord.toLocaleString()}</td>
                  <td className="td text-right font-bold mono">{money(total.val, ctx.currency)}</td>
                  <td className="td font-bold">{total.work}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="px-6 py-4 text-xs text-muted">Revenue = tax invoices issued minus credit notes, plus other ledger revenue that is not a proforma (fees, service charges, ad clicks), by division. Pipeline = proformas issued and not yet invoiced; it is never counted as revenue. Wallet top-ups are customer money, not revenue. Advertising (ad clicks) is company-wide and shown on its own line. <Link className="text-coral-text" href={q({ months: '12' })}>Last 12 months</Link></p>
      </Card>
    </>
  );
}

export default function DivisionReportPage(props: { searchParams: Promise<{ months?: string; test?: string }> }) {
  return <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" aria-label="Loading" />}><DivisionReport {...props} /></Suspense>;
}
