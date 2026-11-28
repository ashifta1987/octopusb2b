'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ExternalLink, FileText, Settings2, Users } from 'lucide-react';
import { Breadcrumbs, Button, Drawer, KpiStrip, Money, OctopusDataGrid, StatusPill, Tabs, formatDate, formatNumber, formatTime, type ContextMenuItem, type GridColumn } from '@octopus/ui';
import { ActionForm, RunButton, ToggleSetting } from '@/components/admin/client';
import { cancelPool, confirmDeposit, defaultPledge, extendPool, forceSettlePool, savePoolRules, togglePools } from '@/app/admin/pools/actions';
import { money as fmtMoney, asCurrency, type Currency } from '@/lib/format';
import { CurrencyTotals, convertedTotal, perCurrencyText, rateLabel, type FxCtx } from '@/components/admin/currency';
import type { PoolSettings } from '@/components/store/pools/shared';
import { POOL_TABS, payLabel, pledgeActions, pledgeStatusName, poolActions, poolQueryHref, paidQty, type Minor, type PoolPerms, type PoolQuery, type PoolTab } from '../_lib/pools-core';
import type { PoolKpis, PoolRowVM } from '../_lib/pools-data';

type R = Awaited<ReturnType<typeof cancelPool>>;
/** Today's server actions (app/admin/pools/actions.ts), unchanged. Fixtures pass sample functions. */
export type PoolsActions = {
  togglePools: (on: boolean) => Promise<R>;
  savePoolRules: (prev: R | null, fd: FormData) => Promise<R>;
  extendPool: (prev: R | null, fd: FormData) => Promise<R>;
  forceSettlePool: (id: string) => Promise<R>;
  cancelPool: (id: string, reason?: string) => Promise<R>;
  confirmDeposit: (pledgeId: string) => Promise<R>;
  defaultPledge: (pledgeId: string) => Promise<R>;
};
const LIVE: PoolsActions = { togglePools, savePoolRules, extendPool, forceSettlePool, cancelPool, confirmDeposit, defaultPledge };

export type PoolsResult = { kind: 'ok'; rows: PoolRowVM[]; kpis: PoolKpis; rules: PoolSettings } | { kind: 'error'; error: string; rules: PoolSettings | null } | { kind: 'loading' };

const cur = (c: string) => (c === 'USD' ? 'US$' : c);
const money = (minor: number | null, c: string) => (minor == null ? '—' : <Money amount={minor / 100} currency={cur(c)} />);
const toMap = (list: Minor[]) => {
  const m = new Map<Currency, number>();
  for (const t of list) m.set(asCurrency(t.currency), (m.get(asCurrency(t.currency)) ?? 0) + t.minor);
  return m;
};
/** Today's CurrencyTotals (per-currency + converted total line) when the FX context is known; plain amounts otherwise. */
const fxTotals = (list: Minor[], fx: FxCtx | null) => (fx ? <CurrencyTotals totals={toMap(list)} ctx={fx} /> : totals(list));
const totals = (list: Minor[]) =>
  list.length ? (
    <span className="inline-flex flex-wrap gap-x-1">
      {list.map((t, i) => (
        <span key={t.currency}>
          {i ? '+ ' : ''}
          <Money amount={t.minor / 100} currency={cur(t.currency)} />
        </span>
      ))}
    </span>
  ) : (
    <span className="text-ods-slate">—</span>
  );
const when = (iso: string) => `${formatDate(iso)}, ${formatTime(iso)}`;
const btn = 'inline-flex min-h-8 items-center rounded-ods-control border border-ods-line-strong bg-ods-surface px-2.5 text-ods-small font-semibold text-ods-navy hover:border-ods-navy disabled:opacity-60';
const danger = 'inline-flex min-h-8 items-center rounded-ods-control border border-ods-danger bg-ods-surface px-2.5 text-ods-small font-semibold text-ods-danger hover:bg-ods-danger-tint disabled:opacity-60';

function Fill({ p }: { p: Pick<PoolRowVM, 'filledQty' | 'targetQty' | 'pct' | 'unit'> }) {
  return (
    <span className="flex min-w-0 flex-col gap-1 leading-tight" data-testid="pool-fill">
      <span className="tabular-nums">
        {formatNumber(p.filledQty)} / {formatNumber(p.targetQty)} <span className="text-ods-slate">· {p.pct}%</span>
      </span>
      <span className="block h-1.5 w-full overflow-hidden rounded-full bg-ods-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct} aria-label={`${p.pct}% filled`}>
        <span className="block h-full rounded-full bg-ods-teal" style={{ width: `${p.pct}%` }} />
      </span>
    </span>
  );
}

/** KPI: today's converted total in the platform currency as the value; the per-currency amounts as the hint. */
function heldKpi(held: Minor[] | null, fx: FxCtx | null, scope: string) {
  if (!held) return { label: 'Deposits held in escrow', value: '—', hint: scope };
  if (!fx) return { label: 'Deposits held in escrow', value: totals(held), hint: scope };
  const m = toMap(held);
  const mixed = m.size > 1 || (m.size === 1 && !m.has(fx.currency));
  return {
    label: 'Deposits held in escrow',
    value: fmtMoney(convertedTotal(fx, m), fx.currency),
    hint: `${perCurrencyText(m, fx.currency)}${mixed ? ` · converted at ${rateLabel(fx)}` : ''} · ${scope}`,
  };
}

/**
 * ODS T9 · Back Office › Services › MOQ pools (today's Admin › Group buying): ON/OFF switch + rules (Admin), KpiStrip,
 * status tabs (today's ?status= / ?closing=1), grid with fill progress, and a pool drawer (?pool=, today's param) with
 * the pledges and today's actions. Who sees which action = today's page.
 */
export function PoolsScreen({ basePath = '/admin/pools', extraParams, query, result, perms, now, fx, actions = LIVE }: {
  basePath?: string; extraParams?: Record<string, string>; query: PoolQuery; result: PoolsResult; perms: PoolPerms; now: number; fx: FxCtx | null; actions?: PoolsActions;
}) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [open, setOpen] = useState<string | null>(query.pool);
  const [rulesOpen, setRulesOpen] = useState(false);
  const rows = result.kind === 'ok' ? result.rows : [];
  const kpis = result.kind === 'ok' ? result.kpis : null;
  const rules = result.kind === 'loading' ? null : result.rules;
  const go = (tab: PoolTab) => startNav(() => router.push(poolQueryHref(basePath, { tab, pool: null }, extraParams), { scroll: false }));
  const setPool = (id: string | null) => {
    setOpen(id);
    const u = new URL(window.location.href);
    if (id) u.searchParams.set('pool', id);
    else u.searchParams.delete('pool');
    window.history.replaceState(null, '', u.toString());
  };
  const drawerRow = open ? rows.find((r) => r.id === open) ?? null : null;

  const columns: GridColumn<PoolRowVM>[] = [
    {
      id: 'code', header: 'Pool', width: 128, accessor: (r) => r.code,
      cell: (r) => (
        <button type="button" data-testid="pool-row" onClick={() => setPool(r.id)} className="max-w-full truncate font-mono font-semibold text-ods-navy hover:underline">
          {r.code}
        </button>
      ),
    },
    { id: 'product', header: 'Product', width: 200, accessor: (r) => r.product, cell: (r) => <span className="truncate" title={r.product}>{r.product}</span> },
    { id: 'supplier', header: 'Supplier', width: 96, accessor: (r) => r.supplierCode ?? '', cell: (r) => <span className="font-mono">{r.supplierCode ?? '—'}</span> },
    { id: 'filled', header: 'Filled', width: 150, accessor: (r) => r.pct, cell: (r) => <Fill p={r} /> },
    { id: 'price', header: 'Price / unit', width: 108, numeric: true, accessor: (r) => r.unitPriceMinor ?? -1, cell: (r) => money(r.unitPriceMinor, r.currency) },
    { id: 'buyers', header: 'Buyers', width: 80, numeric: true, accessor: (r) => r.buyers, cell: (r) => `${r.buyers} / ${r.maxBuyers}` },
    { id: 'deposits', header: 'Deposits held', width: 130, numeric: true, accessor: (r) => r.deposits.reduce((a, t) => a + t.minor, 0), cell: (r) => fxTotals(r.deposits, fx) },
    {
      id: 'deadline', header: 'Deadline', width: 132, accessor: (r) => r.deadlineAt,
      cell: (r) => (
        <span className="flex flex-col leading-tight">
          <span className={r.closingSoon ? 'font-semibold text-ods-warning' : undefined}>{formatDate(r.deadlineAt, { short: true })}, {formatTime(r.deadlineAt)}</span>
          {r.balanceDueAt ? <span className="text-ods-small text-ods-slate">balance by {formatDate(r.balanceDueAt, { short: true })}</span> : null}
        </span>
      ),
    },
    {
      id: 'status', header: 'Status', width: 150, accessor: (r) => r.status,
      cell: (r) => (
        <span className="flex flex-col items-start leading-tight">
          <StatusPill status={r.status} />
          {r.statusDetail ? <span className="text-ods-small text-ods-slate">{r.statusDetail}</span> : null}
        </span>
      ),
    },
  ];

  const rowActions = (r: PoolRowVM): ContextMenuItem[] => [
    { id: 'pledges', label: `Pledges (${r.pledges.length})`, icon: Users, onSelect: () => setPool(r.id) },
    { id: 'public', label: 'Open the public pool page', icon: ExternalLink, onSelect: () => window.open(`/pool/${r.code}`, '_blank', 'noopener') },
    ...(r.poDocumentId ? [{ id: 'po', label: 'Purchase order (PDF)', icon: FileText, onSelect: () => window.open(`/api/documents/${r.poDocumentId}/pdf`, '_blank', 'noopener') }] : []),
  ];

  const grid = (
    <OctopusDataGrid<PoolRowVM>
      label="Pools"
      data-testid="pools-grid"
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      rowNumber={(r) => r.code}
      loading={result.kind === 'loading' || navigating}
      error={result.kind === 'error' ? result.error : undefined}
      onRetry={() => startNav(() => router.refresh())}
      emptyTitle="No pools here"
      emptyDescription="Pools appear when buyers start them from a product page."
      headingLevel={2}
      onOpenRow={(r) => setPool(r.id)}
      onOpenInDrawer={(r) => setPool(r.id)}
      rowActions={rowActions}
      pagination
      defaultPageSize={50}
      searchPlaceholder="Search pool or product"
      densityToggle
      onRefresh={() => startNav(() => router.refresh())}
    />
  );
  const c = kpis?.counts;

  return (
    <div data-testid="pools-page" className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <Breadcrumbs items={[{ label: 'Services', href: '/office' }, { label: 'MOQ pools' }]} />
          <h1 className="mt-1 text-ods-h1 font-bold text-ods-navy">MOQ pools</h1>
          <p className="m-0 text-ods-small text-ods-slate">Buyers share a factory minimum, pay a deposit held in escrow and the balance only when the pool fills.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {rules ? (
            <span className="inline-flex items-center gap-2 text-ods-small" data-testid="pools-switch">
              <span className="font-semibold text-ods-navy">Group buy</span>
              <ToggleSetting checked={rules.enabled} label="Group buying" disabled={!perms.isAdmin} showText onToggle={actions.togglePools} />
            </span>
          ) : null}
          <Button variant="secondary" size="sm" iconStart={Settings2} onClick={() => setRulesOpen(true)} disabled={!rules} data-testid="pool-rules-button">
            Pool rules
          </Button>
        </div>
      </header>

      {rules && !rules.enabled ? (
        <p className="m-0 rounded-ods-control border border-ods-warning bg-ods-warning-tint px-3 py-2 text-ods-small text-ods-text" role="note">
          Group buying is OFF — the storefront hides pools and no one can open or join a pool. Existing pools keep running (cron still settles / expires them).
        </p>
      ) : null}

      <KpiStrip
        data-testid="pools-kpis"
        label="Pool figures"
        variant="strip"
        loading={result.kind === 'loading'}
        items={[
          { label: 'Open pools', value: kpis ? formatNumber(kpis.open) : '—', hint: kpis?.soon ? `${kpis.soon} closing within 48 h` : undefined },
          heldKpi(kpis?.held ?? null, fx, query.tab === 'open' ? 'paid pledges in open pools' : 'for the pools listed'),
          { label: 'Waiting for balances', value: kpis ? formatNumber(kpis.locked) : '—', hint: rules ? `${rules.balanceHours} h window` : undefined },
          { label: 'Expired · cancelled', value: kpis ? `${kpis.expired} · ${kpis.cancelled}` : '—' },
        ]}
      />

      <Tabs
        data-testid="pools-tabs"
        label="Pool status"
        value={query.tab}
        onChange={(t) => go(t as PoolTab)}
        items={POOL_TABS.map(([t, label]) => ({
          id: t, label, testId: `pools-tab-${t}`,
          count: t === 'all' || t === 'closing' ? (t === 'closing' ? kpis?.soon : undefined) : c?.[t],
          panel: () => (t === query.tab ? <div className="pt-3">{grid}</div> : null),
        }))}
      />

      {drawerRow ? <PoolDrawer key={drawerRow.id} p={drawerRow} perms={perms} actions={actions} onClose={() => setPool(null)} now={now} fx={fx} /> : null}

      {rules && rulesOpen ? (
        <Drawer open onClose={() => setRulesOpen(false)} width={460} title="Pool rules" description="Applies to new pools and pledges." data-testid="pool-rules-drawer">
          <ActionForm action={actions.savePoolRules} submitLabel="Save rules">
            <fieldset disabled={!perms.isAdmin} className="grid gap-3 ods-tablet:grid-cols-2">
              {(
                [
                  ['pool_deposit_pct', 'Deposit (%)', rules.depositPct, 'of the pledge value, held in escrow'],
                  ['pool_min_pledge_default', 'Default minimum pledge', rules.minPledgeDefault, 'units · products can override'],
                  ['pool_max_buyers', 'Max buyers per pool', rules.maxBuyers, 'keeps logistics simple'],
                  ['pool_balance_hours', 'Balance window (hours)', rules.balanceHours, 'after the pool fills'],
                  ['pool_min_days', 'Shortest deadline (days)', rules.minDays, ''],
                  ['pool_max_days', 'Longest deadline (days)', rules.maxDays, ''],
                  ['pool_default_days', 'Default deadline (days)', rules.defaultDays, ''],
                ] as const
              ).map(([k, l, v, h]) => (
                <label key={k} htmlFor={k} className="flex flex-col gap-1 text-ods-label font-semibold text-ods-navy">
                  {l}
                  <input id={k} name={k} type="number" min={1} defaultValue={v} required className="h-ods-control rounded-ods-control border border-ods-line-strong bg-ods-surface px-2 font-mono text-ods-body font-normal text-ods-text" />
                  {h ? <span className="text-ods-small font-normal text-ods-slate">{h}</span> : null}
                </label>
              ))}
            </fieldset>
            {!perms.isAdmin ? <p className="mt-2 text-ods-small text-ods-slate">Only an Admin can change the rules.</p> : null}
          </ActionForm>
        </Drawer>
      ) : null}
    </div>
  );
}

function PoolDrawer({ p, perms, actions, onClose, now, fx }: { p: PoolRowVM; perms: PoolPerms; actions: PoolsActions; onClose: () => void; now: number; fx: FxCtx | null }) {
  const a = poolActions(p.statusRaw, perms);
  const pledgeLike = p.pledges.map((x) => ({ status: x.status, qty: x.qty, deposit_minor: x.depositMinor, currency: x.currency }));
  const left = Date.parse(p.deadlineAt) - now;
  return (
    <Drawer
      open
      onClose={onClose}
      width={460}
      data-testid="pool-drawer"
      title={p.code}
      description={
        <span className="inline-flex flex-wrap items-center gap-2">
          <StatusPill status={p.status} />
          {p.statusDetail ? <span>{p.statusDetail}</span> : null}
        </span>
      }
    >
      <div className="grid gap-4">
        <dl className="m-0 grid grid-cols-2 gap-3 rounded-ods-control bg-ods-canvas p-3 text-ods-small">
          <div className="col-span-2">
            <dt className="text-ods-slate">Product{p.supplierCode ? ' · supplier' : ''}</dt>
            <dd className="m-0 font-semibold text-ods-navy">
              {p.product}
              {p.supplierCode ? <span className="font-mono font-normal text-ods-slate"> · {p.supplierCode}</span> : null}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-ods-slate">Filled</dt>
            <dd className="m-0"><Fill p={p} /></dd>
          </div>
          <div><dt className="text-ods-slate">Price / unit</dt><dd className="m-0 font-semibold">{money(p.unitPriceMinor, p.currency)}</dd></div>
          <div><dt className="text-ods-slate">Buyers</dt><dd className="m-0 font-semibold">{p.buyers} / {p.maxBuyers}</dd></div>
          <div><dt className="text-ods-slate">Deposits held</dt><dd className="m-0 font-semibold">{fxTotals(p.deposits, fx)}</dd></div>
          <div>
            <dt className="text-ods-slate">Deadline</dt>
            <dd className="m-0 font-semibold">{when(p.deadlineAt)}{p.statusRaw === 'open' && left > 0 && left < 48 * 3600e3 ? <span className="block font-normal text-ods-warning">closing within 48 h</span> : null}</dd>
          </div>
          {p.balanceDueAt ? <div className="col-span-2"><dt className="text-ods-slate">Balance by</dt><dd className="m-0 font-semibold">{when(p.balanceDueAt)}</dd></div> : null}
          <div className="col-span-2"><dt className="text-ods-slate">Opened</dt><dd className="m-0">{formatDate(p.createdAt)}</dd></div>
        </dl>

        <div className="flex flex-wrap items-start gap-2" data-testid="pool-actions">
          <a href={`/pool/${p.code}`} target="_blank" rel="noreferrer" className={btn}>Public page</a>
          {p.poDocumentId ? <a href={`/api/documents/${p.poDocumentId}/pdf`} target="_blank" rel="noreferrer" className={btn}>PO</a> : null}
          {a.extend ? (
            <ActionForm action={actions.extendPool} inline submitLabel="Extend" submitClass={btn} className="inline-flex items-center gap-1">
              <input type="hidden" name="pool_id" value={p.id} />
              <label className="sr-only" htmlFor={`days-${p.id}`}>Extend by days</label>
              <input id={`days-${p.id}`} name="days" type="number" min={1} max={60} defaultValue={3} className="h-8 w-16 rounded-ods-control border border-ods-line-strong px-2 font-mono text-ods-small" />
            </ActionForm>
          ) : null}
          {a.forceSettle ? (
            <RunButton
              action={actions.forceSettlePool.bind(null, p.id)}
              className={btn}
              confirm={`Force-settle ${p.code}? Unpaid card pledges lapse, the target drops to the paid quantity (${paidQty(pledgeLike).toLocaleString('en-US')} ${p.unit}) and every paid buyer gets a proforma invoice.`}
            >
              Force-settle
            </RunButton>
          ) : null}
          {a.cancel ? (
            <RunButton action={actions.cancelPool.bind(null, p.id)} className={danger} prompt={`Cancel ${p.code} and refund every buyer to their wallet. Reason (shown in the pool timeline):`}>
              Cancel &amp; refund
            </RunButton>
          ) : null}
        </div>

        <section aria-labelledby={`pledges-${p.id}`} className="grid gap-2">
          <h3 id={`pledges-${p.id}`} className="m-0 text-ods-h3 font-bold text-ods-navy">Pledges · {p.pledges.length}</h3>
          {p.pledges.length === 0 ? <p className="m-0 text-ods-small text-ods-slate">No pledges.</p> : null}
          <ul className="m-0 grid list-none gap-2 p-0">
            {p.pledges.map((x) => {
              const pa = pledgeActions({ status: x.status, order_id: x.orderId }, p.statusRaw, perms);
              return (
                <li key={x.id} data-testid="pledge-row" className="grid gap-1 rounded-ods-control border border-ods-line p-2.5 text-ods-small">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono font-semibold text-ods-navy">{x.buyerCode ?? '—'}</span>
                    <StatusPill status={pledgeStatusName(x.status)}>{pledgeStatusName(x.status).toLowerCase() === x.status ? pledgeStatusName(x.status) : `${pledgeStatusName(x.status)} · ${x.status}`}</StatusPill>
                  </div>
                  <div className="text-ods-slate">
                    Company (staff only): <span className="text-ods-text">{x.company ?? '—'}{x.country ? ` · ${x.country}` : ''}</span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5">
                    <span>{formatNumber(x.qty)} {p.unit}</span>
                    <span>Deposit {money(x.depositMinor, x.currency)}</span>
                    {x.balanceMinor != null ? <span>Balance {money(x.balanceMinor, x.currency)}</span> : null}
                    <span>{payLabel(x.paySource)}</span>
                    <span className="text-ods-slate">joined {formatDate(x.joinedAt)}</span>
                  </div>
                  {x.orderId || pa.confirmDeposit || pa.markDefaulted ? (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {x.orderId ? <a href={`/office/orders/${x.orderId}`} className={btn}>Order</a> : null}
                      {pa.confirmDeposit ? (
                        <RunButton action={actions.confirmDeposit.bind(null, x.id)} className={btn} confirm={`Confirm that the ${fmtMoney(x.depositMinor, x.currency)} deposit was received by card / bank transfer?`}>
                          Confirm deposit
                        </RunButton>
                      ) : null}
                      {pa.markDefaulted ? (
                        <RunButton action={actions.defaultPledge.bind(null, x.id)} className={danger} confirm={`Mark this pledge defaulted? The unpaid balance is reversed and the ${fmtMoney(x.depositMinor, x.currency)} deposit is forfeited to cover the shortfall.`}>
                          Mark defaulted
                        </RunButton>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </Drawer>
  );
}
