'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { Button, EmptyState, KpiStrip, Select, StatusPill, cx, formatDate, type KpiItem } from '@octopus/ui';
import type { DivisionReportData, ReportsData } from '../_lib/accounts-a-data';
import { byCurrencyText, moneyText, pct, WORK_LABEL, type DivisionRow } from '../_lib/accounts-a-core';
import { SettingSwitch, type ActionResult } from './accounts-a-actions';
import { TotalsValue } from './accounts-a-finance';
import { LocalTime, Panel } from './dashboard';

/**
 * ODS T9 · /admin/reports (Platform overview) and /admin/reports/divisions (Reports by division). Same data and
 * permissions as today; CSV export links unchanged (/admin/finance/export, finance:export); master switches call
 * today's setSetting (admin only, the action checks again).
 */

function Bars({ items, max }: { items: { key: string; label: string; value: number; text: ReactNode }[]; max: number }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((i) => (
        <li key={i.key}>
          <div className="flex flex-wrap justify-between gap-2 text-ods-body"><span>{i.label}</span><span className="font-semibold tabular-nums">{i.text}</span></div>
          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-ods-canvas" aria-hidden="true">
            <span className="block h-full rounded-full bg-ods-navy" style={{ width: `${pct(i.value, max)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 7 figures: money + customers (4) and live queues (3) as two strips, so no empty cell shows. */
function PlatformKpis({ items }: { items: KpiItem[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-ods-gap" data-testid="kpi-strip">
      <KpiStrip variant="strip" items={items.slice(0, 4)} label="Money and customers" />
      <KpiStrip variant="strip" items={items.slice(4)} label="Catalogue and queues" />
    </div>
  );
}

const compact = (minor: number, c: string) => {
  const v = minor / 100;
  const p = c === 'CNY' ? 'CN¥' : 'US$';
  return Math.abs(v) >= 10000 ? `${p} ${(v / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k` : moneyText(minor, c);
};

export function ReportsView({
  data, perms, setSetting, mailAlert,
}: {
  data: ReportsData;
  perms: { isAdmin: boolean; canExport: boolean; canFinance: boolean; canSuppliers: boolean; canStaffCreate: boolean; canStaffView: boolean; canSupplierCreate: boolean };
  setSetting: (key: string, value: boolean) => Promise<ActionResult>;
  mailAlert?: ReactNode;
}) {
  const C = data.currency;
  const k = data.kpis;
  const [table, setTable] = useState(false);
  const maxMonth = Math.max(1, ...data.gmvMonths.map((m) => m.minor));
  const gmvTotal = data.gmvMonths.reduce((a, m) => a + m.minor, 0);
  const maxStream = Math.max(1, ...data.streams.map((s) => s.convMinor));
  const srMax = Math.max(1, ...data.serviceTypes.map((s) => s.count));
  return (
    <div className="flex min-w-0 flex-col gap-ods-gap" data-testid="reports-page">
      {mailAlert}
      {data.firstSupplier ? (
        <section aria-label="Get started" className="flex flex-wrap items-center justify-between gap-3 rounded-ods-card border border-ods-info/30 bg-ods-info-tint p-ods-pad-card">
          <p className="m-0 text-ods-body">Demo data cleared on <b>{formatDate(data.firstSupplier.at)}</b>{data.firstSupplier.by ? <> by <b>{data.firstSupplier.by}</b></> : null}. Add your first supplier to get started.</p>
          {perms.canSupplierCreate ? <Button href="/admin/suppliers?new=1">Create first supplier</Button> : null}
        </section>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <p className="m-0 text-ods-small text-ods-slate">Accounts › Financial reports</p>
          <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">Platform overview</h1>
          <p className="m-0 mt-0.5 text-ods-small text-ods-slate">Figures come from orders, the ledger and live queues. Charts are in {C}{data.mixed ? `; amounts in other currencies are converted at the approved rate (${data.rateText})` : ''}.</p>
        </div>
        <form action="/admin/reports" className="flex flex-wrap items-center gap-2" data-testid="reports-period">
          <label htmlFor="rep-months" className="text-ods-small text-ods-slate">Period</label>
          <Select id="rep-months" name="months" defaultValue={String(data.months)} className="w-40">
            <option value="3">Last 3 months</option><option value="6">Last 6 months</option><option value="12">Last 12 months</option>
          </Select>
          <Button type="submit" variant="secondary">Apply</Button>
          <Button href="/admin/reports/divisions" variant="ghost">By division</Button>
          {perms.canExport ? <Button href="/admin/finance/export?type=revenue" variant="ghost" iconStart={Download}>Export CSV</Button> : null}
        </form>
      </div>

      <PlatformKpis
        items={[
          { label: 'GMV', value: <TotalsValue t={k.gmv} currency={C} />, hint: `${k.orders} orders` },
          { label: 'Platform revenue (non-order)', value: <TotalsValue t={k.nonOrder} currency={C} />, hint: 'fees, services, ads' },
          { label: 'Customers', value: k.customers.toLocaleString('en-US'), hint: `${k.kycPct}% KYC verified` },
          { label: 'KYC verified', value: `${k.kycPct}%`, hint: `${k.verified} of ${k.customers}` },
          { label: 'Live products', value: k.liveProducts.toLocaleString('en-US') },
          { label: 'Open RFQs', value: <Link href="/office/rfqs" className="text-inherit no-underline hover:underline">{k.openRfqs.toLocaleString('en-US')}</Link>, hint: 'sourcing queue' },
          { label: 'Tickets open', value: <Link href="/office/support" className="text-inherit no-underline hover:underline">{k.openTickets.toLocaleString('en-US')}</Link>, hint: 'support desk' },
        ]}
      />

      <div className="grid min-w-0 grid-cols-1 items-start gap-ods-gap ods-desktop:grid-cols-12">
        <Panel title="Gross merchandise value by month" testId="gmv-chart" className="ods-desktop:col-span-7"
          actions={<span className="text-ods-small text-ods-slate">{C}{data.mixed ? ' (converted)' : ''}, non-cancelled orders</span>}>
          {gmvTotal === 0 ? <EmptyState title="No orders in this period" /> : (
            <figure className="m-0" aria-labelledby="gmv-cap">
              <figcaption id="gmv-cap" className="sr-only">GMV by month, {data.gmvMonths.map((m) => `${m.label} ${moneyText(m.minor, C)}`).join(', ')}.</figcaption>
              <div className="flex h-52 items-end gap-2 border-b border-ods-line-strong" aria-hidden="true">
                {data.gmvMonths.map((m, i, arr) => (
                  <div key={m.month} className="flex h-full flex-1 flex-col items-center justify-end">
                    <span className="mb-1 text-[11px] font-semibold tabular-nums">{compact(m.minor, C)}</span>
                    <span className={cx('w-full max-w-14 rounded-t-[3px]', i === arr.length - 1 ? 'bg-ods-blue' : 'bg-ods-navy')} style={{ height: `${Math.max(1, pct(m.minor, maxMonth) * 0.8)}%` }} />
                  </div>
                ))}
              </div>
              <div className="mt-1 flex gap-2 text-ods-small text-ods-slate" aria-hidden="true">{data.gmvMonths.map((m) => <span key={m.month} className="flex-1 text-center">{m.label}</span>)}</div>
              <Button variant="link" size="sm" aria-expanded={table} aria-controls="gmv-table" onClick={() => setTable((t) => !t)}>{table ? 'Hide table' : 'Show as table'}</Button>
              <div id="gmv-table" className={table ? 'overflow-x-auto' : 'sr-only'}>
                <table className="w-full border-collapse text-ods-table" data-testid="gmv-table">
                  <caption className="sr-only">GMV by month ({C})</caption>
                  <thead><tr className="text-ods-label text-ods-slate"><th scope="col" className="px-2 py-1 text-start">Month</th><th scope="col" className="px-2 py-1 text-end">GMV ({C})</th></tr></thead>
                  <tbody>{data.gmvMonths.map((m) => <tr key={m.month} className="border-t border-ods-line"><th scope="row" className="px-2 py-1 text-start font-normal">{m.month}</th><td className="px-2 py-1 text-end tabular-nums">{moneyText(m.minor, C)}</td></tr>)}</tbody>
                </table>
              </div>
            </figure>
          )}
        </Panel>
        <Panel title="Revenue by stream" testId="revenue-streams" className="ods-desktop:col-span-5">
          {data.streams.length === 0 ? <EmptyState title="No revenue posted yet" /> : (
            <Bars max={maxStream} items={data.streams.map((s) => ({ key: s.stream, label: s.label, value: s.convMinor, text: s.text }))} />
          )}
          <p className="m-0 mt-2 text-ods-small text-ods-slate">From ledger revenue accounts grouped by journal stream. Wallet top-ups are customer money, not revenue. Bar length uses the total converted into {C}.</p>
          {perms.canFinance ? <Button href="/admin/finance" variant="link" size="sm">Finance &amp; revenue</Button> : null}
        </Panel>
      </div>

      <div className="grid min-w-0 grid-cols-1 items-start gap-ods-gap ods-desktop:grid-cols-2">
        <Panel title="Master switches" testId="master-switches" actions={!perms.isAdmin ? <span className="text-ods-small text-ods-slate">Admin only</span> : undefined}>
          <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
            {data.switches.map((x) => (
              <li key={x.key} className="py-2">
                <SettingSwitch label={x.label} description={x.hint} checked={x.on} disabled={!perms.isAdmin} onToggle={(v) => setSetting(x.key, v)} testId={`switch-${x.key}`} />
              </li>
            ))}
          </ul>
        </Panel>
        <Panel title="Service requests by type" testId="service-types">
          {data.serviceTypes.length === 0 ? <EmptyState title="No service requests yet" /> : (
            <Bars max={srMax} items={data.serviceTypes.map((s) => ({ key: s.code, label: s.label, value: s.count, text: s.count }))} />
          )}
          <div className="mt-3 border-t border-ods-line pt-2">
            <h3 className="m-0 text-ods-body font-bold">Top customer countries</h3>
            <p className="m-0 text-ods-small text-ods-slate">{data.topCountries.length ? data.topCountries.join(' · ') : '—'}</p>
          </div>
        </Panel>
      </div>

      <div className="grid min-w-0 grid-cols-1 items-start gap-ods-gap ods-desktop:grid-cols-2">
        <Panel title="Top suppliers" testId="top-suppliers" actions={perms.canSuppliers ? <Button href="/admin/suppliers" variant="link" size="sm">Manage</Button> : undefined}>
          {data.topSuppliers.length === 0 ? <EmptyState title="No supplier orders in this period" /> : (
            <table className="w-full border-collapse text-ods-table">
              <thead><tr className="text-ods-label text-ods-slate"><th scope="col" className="py-1 text-start">Supplier</th><th scope="col" className="py-1 text-end">GMV ({C})</th><th scope="col" className="py-1 text-end">Orders</th></tr></thead>
              <tbody>
                {data.topSuppliers.map((x) => (
                  <tr key={x.id} className="border-t border-ods-line">
                    <td className="py-1.5"><span className="font-semibold">{x.name}</span> <span className="font-ods text-ods-small text-ods-slate">{x.code}{x.country ? ` · ${x.country}` : ''}</span></td>
                    <td className="py-1.5 text-end font-semibold tabular-nums">{compact(x.gmvMinor, C)}{data.mixed ? <span className="block text-[10px] font-normal uppercase text-ods-slate">converted</span> : null}</td>
                    <td className="py-1.5 text-end tabular-nums">{x.orders}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="Staff and roles" testId="staff-roles" actions={perms.canStaffCreate ? <Button href="/admin/staff" size="sm">Add staff</Button> : undefined}>
          {data.staff.length === 0 ? <EmptyState title={perms.canStaffView ? 'No staff yet' : 'Staff list needs the Staff & roles permission'} /> : (
            <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
              {data.staff.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span className="font-semibold">{m.name}</span>
                  <span className="flex flex-wrap items-center gap-1">
                    {m.roles.map((r) => <StatusPill key={r} tone="info">{r.replace(/_/g, ' ')}</StatusPill>)}
                    <Button href={`/admin/staff?user=${m.id}`} variant="ghost" size="sm">Edit<span className="sr-only"> {m.name}</span></Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title="Recent activity" testId="recent-activity" actions={<span className="text-ods-small text-ods-slate">{data.auditShown ? 'Audit log + status changes' : 'Status changes (audit log needs permission)'}</span>}>
        {data.activity.length === 0 ? <EmptyState title="No activity yet" /> : (
          <ol className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
            {data.activity.map((a) => (
              <li key={a.key} className="grid grid-cols-1 gap-x-4 py-2 text-ods-body [overflow-wrap:anywhere] ods-tablet:grid-cols-[140px_160px_minmax(0,1fr)]">
                <span className="text-ods-small text-ods-slate">{formatDate(a.at)} <LocalTime iso={a.at} /></span>
                <span className="truncate font-semibold">{a.who}</span>
                <span className="text-ods-slate">{a.what}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

/* ───────── by division ───────── */

export function DivisionReportView({ data }: { data: DivisionReportData }) {
  const C = data.currency;
  const max = Math.max(1, ...[...data.divisions, ...data.extra].map((r) => Number(r.revenue_converted_minor)));
  const q = (patch: Record<string, string>) => `/admin/reports/divisions?${new URLSearchParams({ months: data.months ? String(data.months) : 'all', ...(data.includeTest ? { test: '1' } : {}), ...patch })}`;
  const revCell = (r: DivisionRow) => (
    <td className="px-3 py-2">
      <div className="font-semibold tabular-nums">{moneyText(Number(r.revenue_converted_minor), C)}</div>
      {data.mixed && byCurrencyText(r.revenue_by_currency) ? <div className="text-ods-small text-ods-slate tabular-nums">{byCurrencyText(r.revenue_by_currency)}</div> : null}
      <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-ods-canvas" aria-hidden="true"><span className="block h-full bg-ods-blue" style={{ width: `${pct(Number(r.revenue_converted_minor), max)}%` }} /></span>
    </td>
  );
  const pipe = (r: DivisionRow) => (
    <td className="px-3 py-2 text-end" data-testid={`pipeline-${r.division_code ?? r.line}`}>
      <div className="tabular-nums">{moneyText(Number(r.pipeline_converted_minor ?? 0), C)}</div>
      {(r.pipeline_count ?? 0) > 0 ? <div className="text-ods-small text-ods-slate">{r.pipeline_count} proforma{r.pipeline_count === 1 ? '' : 's'}</div> : null}
    </td>
  );
  const dash = <td className="px-3 py-2 text-end text-ods-slate">—</td>;
  return (
    <div className="flex min-w-0 flex-col gap-ods-gap" data-testid="division-report-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <p className="m-0 text-ods-small text-ods-slate">Accounts › Financial reports › By division</p>
          <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">Reports by division</h1>
          <p className="m-0 mt-0.5 text-ods-small text-ods-slate">Shenzhen Octopus Trading Co., Ltd. · revenue counts from the tax invoice; issued proformas are pipeline; advertising on its own line. Amounts in {C}{data.mixed ? ' (other currencies converted at the approved rate)' : ''}.</p>
        </div>
        <form action="/admin/reports/divisions" className="flex flex-wrap items-center gap-2" data-testid="division-period">
          <label htmlFor="div-months" className="text-ods-small text-ods-slate">Period</label>
          <Select id="div-months" name="months" defaultValue={data.months ? String(data.months) : 'all'} className="w-40">
            <option value="3">Last 3 months</option><option value="6">Last 6 months</option><option value="12">Last 12 months</option><option value="all">All time</option>
          </Select>
          {data.staging ? (
            <label className="inline-flex items-center gap-2 text-ods-small"><input type="checkbox" name="test" value="1" defaultChecked={data.includeTest} className="size-4" /> Include test data (staging)</label>
          ) : null}
          <Button type="submit" variant="secondary">Apply</Button>
          <Button href="/admin/reports" variant="ghost">Platform overview</Button>
        </form>
      </div>
      {!data.scopeAll ? <p className="m-0 rounded-ods-control bg-ods-info-tint px-3 py-2 text-ods-small" role="status">Showing {data.scopeName} only (header switcher). Choose &quot;All divisions&quot; for the company total and advertising.</p> : null}
      {data.includeTest ? <p className="m-0 rounded-ods-control bg-ods-warning-tint px-3 py-2 text-ods-small" role="status">Includes staging TEST data.</p> : null}

      <Panel title="Revenue, orders and open work" testId="division-report-panel" actions={<span className="text-ods-small text-ods-slate">Open work is live (today), not limited to the period</span>}>
        <div className="-mx-ods-pad-card overflow-x-auto" tabIndex={0} role="region" aria-label="Division report">
          <table className="w-full min-w-[860px] border-collapse text-ods-table" data-testid="division-report">
            <thead>
              <tr className="text-ods-label text-ods-slate">
                {['Division', 'Revenue', 'Pipeline (proformas)', 'Customer deposits', 'Held (payment protection)', 'Orders', 'Order value', 'Open work'].map((h, i) => (
                  <th key={h} scope="col" className={cx('px-3 py-1.5 font-semibold', i >= 2 && i <= 6 ? 'text-end' : 'text-start')}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.divisions.map((r) => {
                const held = data.held[r.division_code ?? ''] ?? { count: 0, cents: 0 };
                return (
                  <tr key={r.division_code} data-testid={`report-row-${r.division_code}`} className="border-t border-ods-line align-top">
                    <th scope="row" className="px-3 py-2 text-start font-normal"><div className="font-semibold">{r.division_name}</div><div className="font-ods text-ods-small text-ods-slate">{r.division_code}</div></th>
                    {revCell(r)}
                    {pipe(r)}
                    <td className="px-3 py-2 text-end tabular-nums" data-testid={`deposits-${r.division_code ?? r.line}`}>{moneyText(Number(r.deposits_converted_minor ?? 0), C)}</td>
                    <td className="px-3 py-2 text-end tabular-nums" data-testid={`held-protection-${r.division_code ?? r.line}`}>{moneyText(held.cents, C)}{held.count > 0 ? <div className="text-ods-small text-ods-slate">{held.count} hold{held.count === 1 ? '' : 's'}</div> : null}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{r.orders_count.toLocaleString('en-US')}</td>
                    <td className="px-3 py-2 text-end tabular-nums">{moneyText(Number(r.orders_converted_minor), C)}</td>
                    <td className="px-3 py-2">
                      <div className="font-semibold">{r.open_work}</div>
                      <div className="mt-1 flex flex-wrap gap-1">{Object.entries(r.open_detail ?? {}).map(([kk, v]) => <span key={kk} className="rounded-ods-pill bg-ods-canvas px-2 py-0.5 text-ods-small">{WORK_LABEL[kk] ?? kk.replace(/_/g, ' ')} {v}</span>)}</div>
                    </td>
                  </tr>
                );
              })}
              {data.extra.map((r) => (
                <tr key={r.line} data-testid={`report-row-${r.line}`} className="border-t border-ods-line bg-ods-canvas/60 align-top">
                  <th scope="row" className="px-3 py-2 text-start font-normal"><div className="font-semibold">{r.division_name}</div><div className="text-ods-small text-ods-slate">{r.line === 'advertising' ? 'Ad clicks · company-wide' : 'Not tied to a division'}</div></th>
                  {revCell(r)}
                  {r.line === 'company' ? pipe(r) : dash}
                  {r.line === 'company' ? <td className="px-3 py-2 text-end tabular-nums" data-testid={`deposits-${r.division_code ?? r.line}`}>{moneyText(Number(r.deposits_converted_minor ?? 0), C)}</td> : dash}
                  {dash}{dash}{dash}
                  <td className="px-3 py-2 text-ods-slate">—</td>
                </tr>
              ))}
              {data.scopeAll ? (
                <tr data-testid="report-row-total" className="border-t-2 border-ods-navy font-bold">
                  <th scope="row" className="px-3 py-2 text-start">Company total</th>
                  <td className="px-3 py-2 tabular-nums">{moneyText(data.total.rev, C)}</td>
                  <td className="px-3 py-2 text-end font-normal text-ods-slate tabular-nums">{moneyText(data.total.pipe, C)}<div className="text-ods-small">{data.total.pipeN} proforma{data.total.pipeN === 1 ? '' : 's'} · not in total</div></td>
                  <td className="px-3 py-2 text-end font-normal text-ods-slate tabular-nums" data-testid="deposits-total">{moneyText(data.total.dep, C)}<div className="text-ods-small">not in total</div></td>
                  <td className="px-3 py-2 text-end font-normal text-ods-slate tabular-nums" data-testid="held-protection-total">{moneyText(data.totalHeld, C)}<div className="text-ods-small">liability · not in total</div></td>
                  <td className="px-3 py-2 text-end tabular-nums">{data.total.ord.toLocaleString('en-US')}</td>
                  <td className="px-3 py-2 text-end tabular-nums">{moneyText(data.total.val, C)}</td>
                  <td className="px-3 py-2">{data.total.work}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="m-0 mt-3 text-ods-small text-ods-slate">
          Revenue = tax invoices issued minus credit notes, plus other ledger revenue that is not a proforma (fees, service charges, ad clicks), by division. Pipeline = what is still to be paid on proformas not yet invoiced. Customer deposits = part payments on proformas that no tax invoice covers yet. Neither is counted as revenue. Wallet top-ups are customer money, not revenue. Advertising (ad clicks) is company-wide and shown on its own line.{' '}
          <a className="text-ods-blue underline underline-offset-4" href={q({ months: '12' })}>Last 12 months</a>
        </p>
      </Panel>
    </div>
  );
}
