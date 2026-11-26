import { Suspense } from 'react';
import Link from 'next/link';
import { DsCard, DsSkeleton, DsTableCard } from '@/components/dropship-ui';
import { nowMs } from '@/components/admin/server';
import { requireWarehouseStaff } from '@/lib/warehouse';
import { createClient } from '@/lib/supabase/server';
import {
  EXCEPTION_KIND_LABEL, fmtHours, periodPreset, validYmd, withinShare, type Report, type RetentionRow, type TimeStat,
} from '@/lib/warehouse-w6';
import { WhHeader } from '../wh-header';
import { SettingsCard } from './reports-client';

export const metadata = { title: 'Reports · Warehouse' };

const PRESETS: [string, string][] = [['this_month', 'This month'], ['last_month', 'Last month'], ['last_30', 'Last 30 days']];

/** Service-quality bar: share inside the target; no target (or nothing measured) = no bar, said in words. */
function QualityBar({ label, stat, target, testId }: { label: string; stat: TimeStat; target: string; testId: string }) {
  const share = withinShare(stat);
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <div className="flex justify-between gap-3 text-[14px]">
        <span className="font-semibold">{label}</span>
        <span>{share == null ? '—' : `${share}% within ${target}`}</span>
      </div>
      {share == null ? (
        <p className="m-0 text-[13px] text-muted">{stat.measured === 0 && stat.n > 0 ? 'No target set for these warehouses — set one below to see this bar.' : 'Nothing measured in this period.'}</p>
      ) : (
        <div role="img" aria-label={`${label}: ${share}% within target`} className="h-3 rounded-full bg-line overflow-hidden">
          <div className={`h-full ${share >= 90 ? 'bg-ok' : share >= 70 ? 'bg-warn' : 'bg-bad'}`} style={{ width: `${share}%` }} />
        </div>
      )}
      <p className="m-0 text-[12.5px] text-muted">{stat.n} measured · average {fmtHours(stat.avg_h)} · median {fmtHours(stat.median_h)}</p>
    </div>
  );
}

function targetText(r: Report, key: 'handoff_hours' | 'dock_to_shelf_hours') {
  const set = r.targets.map((t) => t[key]).filter((x): x is number => x != null);
  if (!set.length) return 'target';
  return new Set(set).size === 1 ? `${set[0]} h` : 'each warehouse’s target';
}

/**
 * Warehouse OS · W6 Reports (board 30): orders shipped, order-to-handoff time, dock-to-shelf time and exceptions by period,
 * client and warehouse, with service-quality bars (share inside the warehouse's target; no target = no bar). Counted by
 * wh_report() from real rows only; CSV export uses the same function. Targets and return-photo retention are set here.
 */
async function Content({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; org?: string; preset?: string }> }) {
  const access = await requireWarehouseStaff('/office/warehouse/reports');
  const sp = await searchParams;
  const preset = periodPreset(sp.preset ?? 'this_month', nowMs());
  const from = validYmd(sp.from) ?? preset.from;
  const to = validYmd(sp.to) ?? preset.to;
  const org = /^[0-9a-f-]{36}$/i.test(sp.org ?? '') ? sp.org! : null;
  const sb = await createClient();
  const [rep, ret] = await Promise.all([
    sb.rpc('wh_report', { p_from: from, p_to: to, p_warehouse: access.current?.code ?? null, p_org: org }),
    sb.rpc('wh_retention_summary', { p_warehouse: access.current?.code ?? null }),
  ]);
  const badPeriod = rep.error && /INVALID_PERIOD/.test(rep.error.message);
  if (rep.error && !badPeriod) throw new Error(`Could not load the report: ${rep.error.message}`);
  const r = rep.data as Report | null;
  const csv = `/office/warehouse/reports/csv?from=${from}&to=${to}${org ? `&org=${org}` : ''}`;
  const kinds = r ? Object.keys(EXCEPTION_KIND_LABEL).filter((k) => r.totals.exceptions.by_kind[k]) : [];
  return (
    <div className="flex flex-col gap-5" data-testid="wh-reports-page">
      <WhHeader access={access} title="Reports" icon="chart"
        subtitle={`${access.current ? access.current.name : 'All warehouses'} · orders shipped, handoff and dock-to-shelf times, exceptions — real records only.`} />
      <DsCard title="Period and client" icon="clock">
        <form method="get" className="flex flex-wrap items-end gap-3" data-testid="wh-rep-filter">
          <label className="flex flex-col text-[12px] text-muted" htmlFor="wh-rep-from"><span>From</span>
            <input id="wh-rep-from" type="date" name="from" defaultValue={from} className="ds-input min-h-[44px]" /></label>
          <label className="flex flex-col text-[12px] text-muted" htmlFor="wh-rep-to"><span>To</span>
            <input id="wh-rep-to" type="date" name="to" defaultValue={to} className="ds-input min-h-[44px]" /></label>
          <label className="flex flex-col text-[12px] text-muted" htmlFor="wh-rep-client"><span>Client</span>
            <select id="wh-rep-client" name="org" defaultValue={org ?? ''} className="ds-input min-h-[44px]">
              <option value="">All clients</option>
              {(r?.clients ?? []).map((c) => <option key={c.org_id} value={c.org_id}>{c.name}</option>)}
            </select></label>
          <button type="submit" className="ds-btn ds-btn-primary">Show</button>
          <span className="flex flex-wrap gap-2">
            {PRESETS.map(([k, l]) => <Link key={k} href={`/office/warehouse/reports?preset=${k}${org ? `&org=${org}` : ''}`} className="ds-btn ds-btn-secondary">{l}</Link>)}
          </span>
        </form>
        <p className="mt-2 mb-0 text-[12.5px] text-muted">Dates are China time (the warehouse day). Up to one year.</p>
      </DsCard>
      {badPeriod || !r ? (
        <p role="alert" className="m-0 ds-card text-[14px]" data-testid="wh-rep-bad-period">Choose a period of up to one year where “To” is not before “From”.</p>
      ) : (
        <>
          <section aria-label="Totals" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              ['Orders shipped', r.totals.orders_shipped.toLocaleString('en-US'), `${r.totals.units_shipped.toLocaleString('en-US')} units`, 'orders'],
              ['Order to handoff', fmtHours(r.totals.handoff.median_h), `median of ${r.totals.handoff.n} order${r.totals.handoff.n === 1 ? '' : 's'}`, 'handoff'],
              ['Dock to shelf', fmtHours(r.totals.dock_to_shelf.median_h), `median of ${r.totals.dock_to_shelf.n} notice${r.totals.dock_to_shelf.n === 1 ? '' : 's'}${r.totals.dock_to_shelf.open ? ` · ${r.totals.dock_to_shelf.open} still being put away` : ''}`, 'd2s'],
              ['Exceptions', r.totals.exceptions.total.toLocaleString('en-US'), kinds.length ? kinds.map((k) => `${EXCEPTION_KIND_LABEL[k]} ${r.totals.exceptions.by_kind[k]}`).join(' · ') : 'None raised', 'exceptions'],
            ].map(([label, value, sub, id]) => (
              <div key={id} className="ds-card" data-testid={`wh-rep-tile-${id}`}>
                <div className="text-[13px] text-muted">{label}</div>
                <div className="text-[28px] font-bold leading-tight">{value}</div>
                <div className="text-[12.5px] text-muted">{sub}</div>
              </div>
            ))}
          </section>
          <DsCard title="Service quality" icon="activity" testId="wh-rep-quality" subtitle="Share of orders and stock notices inside the warehouse’s target.">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <QualityBar label="Order to handoff" stat={r.totals.handoff} target={targetText(r, 'handoff_hours')} testId="wh-rep-bar-handoff" />
              <QualityBar label="Dock to shelf" stat={r.totals.dock_to_shelf} target={targetText(r, 'dock_to_shelf_hours')} testId="wh-rep-bar-d2s" />
            </div>
          </DsCard>
          <DsTableCard testId="wh-rep-table" title="By client and warehouse" icon="users" minWidth={900}
            actions={<a href={csv} className="ds-btn ds-btn-secondary" download data-testid="wh-rep-csv">Download CSV</a>}
            headers={['Client', 'Warehouse', 'Orders shipped', 'Order to handoff (median)', 'Within target', 'Dock to shelf (median)', 'Within target', 'Exceptions']}>
            {r.rows.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-muted" data-testid="wh-rep-empty">Nothing shipped, received or raised in this period.</td></tr>
            ) : r.rows.map((x) => {
              const hs = withinShare(x.handoff), ds = withinShare(x.dock_to_shelf);
              return (
                <tr key={`${x.org_id ?? 'octopus'}-${x.warehouse_code}`} data-testid={`wh-rep-row-${x.org_id ?? 'octopus'}-${x.warehouse_code}`}>
                  <td className="font-semibold">{x.client}</td>
                  <td>{x.warehouse ?? x.warehouse_code}</td>
                  <td data-testid="wh-rep-shipped">{x.orders_shipped}</td>
                  <td data-testid="wh-rep-handoff">{fmtHours(x.handoff.median_h)}{x.handoff.n ? ` (${x.handoff.n})` : ''}</td>
                  <td>{hs == null ? '—' : `${hs}%`}</td>
                  <td>{fmtHours(x.dock_to_shelf.median_h)}{x.dock_to_shelf.n ? ` (${x.dock_to_shelf.n})` : ''}{x.dock_to_shelf.open ? ` · ${x.dock_to_shelf.open} open` : ''}</td>
                  <td>{ds == null ? '—' : `${ds}%`}</td>
                  <td>{x.exceptions.total ? `${x.exceptions.total} (${Object.entries(x.exceptions.by_kind).map(([k, n]) => `${EXCEPTION_KIND_LABEL[k] ?? k} ${n}`).join(', ')})` : '0'}</td>
                </tr>
              );
            })}
          </DsTableCard>
          <p className="m-0 text-[12.5px] text-muted">
            Order to handoff: from when the order reached the warehouse to its first hand-over to the carrier (or shipped time). Dock to shelf: from the
            delivery’s check-in at the dock to the last putaway, once every lot of the notice is released and placed. “Octopus stock” is Octopus’s own stock (Dropship).
          </p>
        </>
      )}
      <SettingsCard rows={ret.error ? [] : (ret.data as RetentionRow[])} />
    </div>
  );
}

export default function Page(props: { searchParams: Promise<{ from?: string; to?: string; org?: string; preset?: string }> }) {
  return <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}><Content {...props} /></Suspense>;
}
