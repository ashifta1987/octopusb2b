'use client';

import type { ReactNode } from 'react';
import { Download, Lock } from 'lucide-react';
import { Button, EmptyState, Icon, KpiStrip, Select, StatusPill, cx, formatDate, type KpiItem } from '@octopus/ui';
import type { FinanceOverviewData } from '../_lib/accounts-a-data';
import { moneyText, partsText, pct, type Totals } from '../_lib/accounts-a-core';
import { ActionFormOds, ConfirmRun, type ActionResult } from './accounts-a-actions';
import { LocalTime, Panel } from './dashboard';

/**
 * ODS T9 · /admin/finance — Finance overview (ODS screen over today's Admin › Finance & revenue). Same data, same
 * permissions, same actions: decideApproval / requestApproval / recordPayment / confirmTopup from
 * app/admin/finance/actions.ts are passed in unchanged. Ageing + "money in and out" reuse the T9 dashboard widgets.
 */

export type FinancePerms = { canApprove: boolean; canCreate: boolean; canExport: boolean; canWalletApprove: boolean; isAdmin: boolean };
export type FinanceActions = {
  decide: (id: string, approve: boolean, note?: string) => Promise<ActionResult>;
  confirmTopup: (id: string) => Promise<ActionResult>;
  recordPayment: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
  requestApproval: (prev: ActionResult | null, fd: FormData) => Promise<ActionResult>;
};

/** Converted total in the platform currency when mixed (with each currency underneath), else the one currency. */
export function TotalsValue({ t, currency }: { t: Totals; currency: string }) {
  if (!t.mixed) return <span data-money="">{partsText(t, currency)}</span>;
  return <span data-money="">{moneyText(t.convMinor, currency)}</span>;
}
const totalsHint = (t: Totals, rateText: string) => (t.mixed ? `${partsText(t)} · converted at ${rateText}` : null);

const inputCls = 'h-ods-control w-full rounded-ods-control border border-ods-line-strong bg-ods-surface px-2.5 text-ods-body text-ods-text';
function F({ id, label, hint, children, wide }: { id: string; label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1', wide && 'ods-tablet:col-span-2')}>
      <label htmlFor={id} className="text-ods-label font-semibold text-ods-navy">{label}</label>
      {children}
      {hint ? <p id={`${id}-hint`} className="m-0 text-ods-small text-ods-slate">{hint}</p> : null}
    </div>
  );
}

export function FinanceOverview({
  data, perms, actions, ageing, chart, basePath = '/admin/finance',
}: {
  data: FinanceOverviewData; perms: FinancePerms; actions: FinanceActions; ageing: ReactNode; chart: ReactNode; basePath?: string;
}) {
  const k = data.kpis;
  const C = data.currency;
  const kpi = (label: string, t: Totals, hint: ReactNode): KpiItem => ({ label, value: <TotalsValue t={t} currency={C} />, hint: totalsHint(t, data.rateText) ?? hint });
  const items: KpiItem[] = [
    kpi('Gross revenue', k.gross, data.monthLabel),
    kpi('Refunds & credits', k.refunds, k.refundShare),
    kpi('Net revenue', k.net, 'after refunds'),
    kpi('Customer payments in', k.paymentsIn, 'confirmed, this month'),
    kpi('Supplier payouts due', k.payoutsDue, `${k.payoutsAwaiting} awaiting approval`),
    kpi('Held in wallets', k.wallets, 'customer money, per currency'),
  ];
  const maxStream = Math.max(1, ...data.streams.map((s) => s.convMinor));
  const limit = moneyText(data.limitUsdMinor, 'USD');

  return (
    <div className="flex min-w-0 flex-col gap-ods-gap" data-testid="finance-overview">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <p className="m-0 text-ods-small text-ods-slate">Accounts › Finance overview</p>
          <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">Finance &amp; revenue</h1>
          <p className="m-0 mt-0.5 text-ods-small text-ods-slate">
            All money in and out, approvals, and every record ready to export. Each amount is shown in its own currency; totals are also converted into {C} at the approved rate ({data.rateText}).
          </p>
          <p className="m-0 mt-1 inline-flex items-center gap-1 text-ods-small text-ods-slate"><Icon icon={Lock} size="xs" />Sensitive actions ask for your 2FA code again if it is older than 10 minutes.</p>
        </div>
        <form action={basePath} className="flex flex-wrap items-center gap-2" data-testid="finance-month">
          <label htmlFor="fin-month" className="sr-only">Month</label>
          <Select id="fin-month" name="month" defaultValue={data.month} className="w-40">
            {data.months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </Select>
          <Button type="submit" variant="secondary">Show</Button>
          {perms.canExport ? (
            <>
              <Button href="/admin/finance/export?type=revenue" variant="ghost" iconStart={Download}>Revenue CSV</Button>
              <Button href={`/admin/finance/export?type=journals&month=${data.month}`} variant="ghost" iconStart={Download}>Journals CSV</Button>
              <Button href={`/admin/finance/export?type=payments&month=${data.month}`} variant="ghost" iconStart={Download}>Payments CSV</Button>
            </>
          ) : null}
        </form>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-ods-gap ods-desktop:grid-cols-2" data-testid="kpi-strip">
        <KpiStrip variant="strip" items={items.slice(0, 3)} label={`Revenue · ${data.monthLabel}`} />
        <KpiStrip variant="strip" items={items.slice(3)} label="Money in, out and held" />
      </div>

      <div className="grid min-w-0 grid-cols-1 items-start gap-ods-gap ods-desktop:grid-cols-12">
        <div className="min-w-0 ods-desktop:col-span-7">{chart}</div>
        <div className="min-w-0 ods-desktop:col-span-5">{ageing}</div>
      </div>

      <div className="grid min-w-0 grid-cols-1 items-start gap-ods-gap ods-desktop:grid-cols-2">
        <Panel title={`Revenue by source · ${data.monthLabel}`} testId="revenue-streams">
          {data.streams.length === 0 ? <EmptyState title="No revenue posted this month" /> : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {data.streams.map((s) => (
                <li key={s.stream}>
                  <div className="flex flex-wrap justify-between gap-2 text-ods-body">
                    <span>{s.label}</span>
                    <span className="font-semibold tabular-nums">{partsText({ parts: s.parts }, C)}</span>
                  </div>
                  <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-ods-canvas" aria-hidden="true">
                    <span className="block h-full rounded-full bg-ods-navy" style={{ width: `${pct(s.convMinor, maxStream)}%` }} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          {data.streams.length ? (
            <div className="mt-3 flex flex-wrap justify-between gap-2 border-t border-ods-line pt-2 text-ods-body">
              <span className="font-semibold">Total net</span>
              <span className="text-end font-semibold tabular-nums">
                {partsText(data.revNet, C)}
                {data.revNet.mixed ? <span className="block text-ods-small font-normal text-ods-slate">Total {moneyText(data.revNet.convMinor, C)} · converted at {data.rateText}</span> : null}
              </span>
            </div>
          ) : null}
          <p className="m-0 mt-2 text-ods-small text-ods-slate">Credits minus debits on revenue accounts, grouped by journal stream. Wallet top-ups are customer money, not revenue — they count only when spent on a service.</p>
        </Panel>

        <Panel title="Approval rules & ledger check" testId="ledger-check">
          <dl className="m-0 divide-y divide-ods-line text-ods-body">
            <div className="flex justify-between gap-3 py-1.5"><dt>Refunds, credit notes, adjustments up to {limit}{data.limitPlatMinor != null ? ` (≈ ${moneyText(data.limitPlatMinor, C)})` : ''}</dt><dd className="m-0 font-semibold">Finance (checker ≠ maker)</dd></div>
            <div className="flex justify-between gap-3 py-1.5"><dt>Anything over {limit}</dt><dd className="m-0 font-semibold">Finance → Admin</dd></div>
            <div className="flex justify-between gap-3 py-1.5"><dt>Supplier payouts</dt><dd className="m-0 font-semibold">Finance → Admin over limit</dd></div>
            <div className="flex justify-between gap-3 py-1.5"><dt>Wallet top-ups</dt><dd className="m-0 font-semibold">Wallet approve permission</dd></div>
          </dl>
          {perms.isAdmin ? <Button href="/admin/wallet#settings" variant="link" size="sm">Edit limit</Button> : null}
          <h3 className="m-0 mt-3 text-ods-body font-bold">Journal balance check · per currency</h3>
          {data.ledger.error ? <p className="m-0 mt-1 rounded-ods-control bg-ods-warning-tint px-3 py-2 text-ods-small">Ledger check unavailable.</p> : data.ledger.rows.length === 0 ? (
            <p className="m-0 mt-1 rounded-ods-control bg-ods-info-tint px-3 py-2 text-ods-small">No ledger entries yet.</p>
          ) : (
            <ul className="m-0 mt-1 flex list-none flex-col gap-1.5 p-0" data-testid="ledger-rows">
              {data.ledger.rows.map((l) => (
                <li key={l.currency} className={cx('rounded-ods-control px-3 py-2 text-ods-small', l.balanced ? 'bg-ods-success-tint' : 'bg-ods-danger-tint')}>
                  <b>{l.currency}</b> · {l.balanced ? 'Balanced ✓' : 'NOT balanced ✗'} · Debits <b>{moneyText(l.debit, l.currency)}</b> · Credits <b>{moneyText(l.credit, l.currency)}</b> · {l.journals} journals · {l.unbalanced} unbalanced
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel
        title={`Waiting for approval · ${data.pending.length}`}
        testId="finance-approvals"
        actions={<Button href="/office/approvals" variant="link" size="sm">All approvals</Button>}
      >
        {data.pending.length === 0 ? <EmptyState title="Nothing waiting for approval" /> : (
          <div className="-mx-ods-pad-card overflow-x-auto" tabIndex={0} role="region" aria-label="Finance approvals waiting">
            <table className="w-full border-collapse text-ods-table">
              <caption className="sr-only">Finance approvals waiting · signed in as {data.signedInAs}</caption>
              <thead><tr className="text-ods-label text-ods-slate">{['Type', 'For', 'Amount', 'Reason', 'Prepared by', 'Stage', ''].map((h, i) => <th key={i} scope="col" className={cx('px-3 py-1.5 text-start font-semibold', h === 'Amount' && 'text-end')}>{h || <span className="sr-only">Decision</span>}</th>)}</tr></thead>
              <tbody>
                {data.pending.map((a) => (
                  <tr key={a.id} className="border-t border-ods-line align-top" data-testid="finance-approval-row">
                    <td className="px-3 py-2">{a.label}<div className="font-ods text-ods-small text-ods-slate">{a.ref}</div></td>
                    <td className="px-3 py-2 font-semibold">{a.forName}</td>
                    <td className="px-3 py-2 text-end font-semibold whitespace-nowrap tabular-nums">{moneyText(a.amountMinor, a.currency)}</td>
                    <td className="max-w-[260px] px-3 py-2 text-ods-small">{a.reason}</td>
                    <td className="px-3 py-2 text-ods-small">{a.preparedBy}{a.mine ? <div className="text-ods-warning" data-testid="self-approval-note">You prepared this</div> : null}</td>
                    <td className="px-3 py-2"><StatusPill tone={a.stage === 'Needs Admin' ? 'danger' : 'warning'}>{a.stage}</StatusPill></td>
                    <td className="px-3 py-2">
                      {perms.canApprove ? (
                        <span className="flex gap-2">
                          <ConfirmRun action={() => actions.decide(a.id, true)} variant="primary" confirmTitle={`Approve ${a.label} of ${moneyText(a.amountMinor, a.currency)}?`} confirmText="Money will move." confirmLabel="Approve" testId="approve-btn">Approve</ConfirmRun>
                          <ConfirmRun action={(r) => actions.decide(a.id, false, r)} confirmTitle={`Reject ${a.label}?`} reason="Reason for rejecting" confirmLabel="Reject" destructive testId="reject-btn">Reject</ConfirmRun>
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.decided.length ? (
          <details className="mt-3 border-t border-ods-line pt-2">
            <summary className="cursor-pointer text-ods-small font-semibold">Recently decided ({data.decided.length})</summary>
            <ul className="m-0 mt-2 flex list-none flex-col divide-y divide-ods-line p-0 text-ods-small">
              {data.decided.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center gap-2 py-1.5">
                  <StatusPill tone={a.status === 'rejected' ? 'danger' : 'success'}>{a.status === 'rejected' ? 'Rejected' : a.status === 'executed' ? 'Executed' : 'Approved'}</StatusPill>
                  <span>{a.label}</span><span className="tabular-nums">{moneyText(a.amountMinor, a.currency)}</span>
                  <span className="text-ods-slate">by {a.requestedBy} → {a.approvedBy}{a.decidedAt ? ` · ${formatDate(a.decidedAt)}` : ''}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Panel>

      {perms.canCreate || perms.canApprove ? (
        <div className="grid min-w-0 grid-cols-1 items-start gap-ods-gap ods-desktop:grid-cols-2">
          {perms.canCreate ? (
            <Panel title="New approval request" testId="finance-request-form">
              <ActionFormOds action={actions.requestApproval} submitLabel="Send for approval" resetOnSuccess className="grid gap-3 ods-tablet:grid-cols-2">
                <F id="fa-kind" label="Type">
                  <select id="fa-kind" name="kind" className={inputCls} required defaultValue="refund">
                    <option value="refund">Refund (to wallet)</option><option value="credit_note">Credit note</option>
                    <option value="payout">Supplier payout</option><option value="adjustment">Manual wallet adjustment</option>
                  </select>
                </F>
                <F id="fa-amount" label="Amount" hint={`In the order’s currency if an order is chosen, otherwise ${C}.`}>
                  <input id="fa-amount" name="amount" inputMode="decimal" className={cx(inputCls, 'text-end tabular-nums')} placeholder="0.00" required aria-describedby="fa-amount-hint" />
                </F>
                <F id="fa-org" label="Customer (refund / credit / adjustment)">
                  <select id="fa-org" name="org_id" className={inputCls} defaultValue=""><option value="">—</option>{data.orgs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
                </F>
                <F id="fa-sup" label="Supplier (payout)">
                  <select id="fa-sup" name="supplier_id" className={inputCls} defaultValue=""><option value="">—</option>{data.suppliers.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select>
                </F>
                <F id="fa-order" label="Order (optional)" wide>
                  <select id="fa-order" name="order_id" className={inputCls} defaultValue=""><option value="">—</option>{data.openOrders.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
                </F>
                <F id="fa-reason" label="Reason" wide>
                  <textarea id="fa-reason" name="reason" className={cx(inputCls, 'min-h-20 py-2')} required minLength={5} />
                </F>
                <p className="m-0 text-ods-small text-ods-slate ods-tablet:col-span-2">Maker–checker: you cannot approve your own request. Amounts over {limit} (converted at the approved rate) need an Admin.</p>
              </ActionFormOds>
            </Panel>
          ) : null}
          {perms.canApprove ? (
            <Panel title="Record order payment" testId="finance-record-payment">
              <ActionFormOds action={actions.recordPayment} submitLabel="Record payment" confirm="Record this payment? It posts to the ledger and may advance the order." resetOnSuccess className="grid gap-3 ods-tablet:grid-cols-2">
                <F id="rp-order" label="Order" wide>
                  <select id="rp-order" name="order_id" className={inputCls} required defaultValue="">
                    <option value="" disabled>Select an order with a balance…</option>
                    {data.unpaid.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                </F>
                <F id="rp-amount" label="Amount (in the order’s currency)" hint="Orders are paid in the currency locked on their PI.">
                  <input id="rp-amount" name="amount" inputMode="decimal" className={cx(inputCls, 'text-end tabular-nums')} required placeholder="0.00" aria-describedby="rp-amount-hint" />
                </F>
                <F id="rp-method" label="Method">
                  <select id="rp-method" name="method" className={inputCls} defaultValue="bank_transfer">
                    <option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="paypal">PayPal</option><option value="other">Other</option>
                  </select>
                </F>
                <F id="rp-ref" label="Bank / payment reference" wide hint="Must match the bank statement line.">
                  <input id="rp-ref" name="reference" className={cx(inputCls, 'font-ods')} required aria-describedby="rp-ref-hint" />
                </F>
                {data.unpaid.length === 0 ? <p className="m-0 text-ods-small text-ods-slate ods-tablet:col-span-2">No orders with an open balance.</p> : null}
              </ActionFormOds>
            </Panel>
          ) : null}
        </div>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 items-start gap-ods-gap ods-desktop:grid-cols-2">
        <Panel title="Pending wallet top-ups" testId="finance-topups" actions={<Button href="/admin/wallet" variant="link" size="sm">Wallets</Button>}>
          {data.topups.length === 0 ? <EmptyState title="No top-ups waiting" /> : (
            <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
              {data.topups.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block font-semibold">{t.org}</span>
                    <span className="block text-ods-small text-ods-slate">{formatDate(t.createdAt)} · {t.reference ?? <span className="text-ods-warning">no reference</span>} · {t.method}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-semibold text-ods-success tabular-nums">+{moneyText(t.amountMinor, t.currency)}</span>
                    {perms.canWalletApprove ? (
                      <ConfirmRun action={() => actions.confirmTopup(t.id)} variant="primary" confirmTitle={`Confirm ${moneyText(t.amountMinor, t.currency)} received?`} confirmText={`This credits the ${t.currency} wallet.`} testId="confirm-topup">Confirm</ConfirmRun>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Incoming payments" testId="finance-payments">
          {data.payments.length === 0 ? <EmptyState title="No payments yet" /> : (
            <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
              {data.payments.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0">
                    <span className="block font-semibold">{p.org}</span>
                    <span className="block text-ods-small text-ods-slate">{formatDate(p.createdAt)} · {p.purpose} · {p.method}{p.reference ? ` · ${p.reference}` : ''}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-semibold tabular-nums">{moneyText(p.amountMinor, p.currency)}</span>
                    <StatusPill tone={p.status === 'confirmed' ? 'success' : p.status === 'failed' ? 'danger' : 'warning'}>{p.status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}</StatusPill>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid min-w-0 grid-cols-1 items-start gap-ods-gap ods-desktop:grid-cols-2">
        <Panel title="Supplier payouts" testId="finance-payouts">
          {data.payouts.length === 0 ? <EmptyState title="No payouts yet" /> : (
            <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
              {data.payouts.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span className="min-w-0"><span className="block font-semibold">{p.supplier}</span><span className="block text-ods-small text-ods-slate">{formatDate(p.createdAt)}</span></span>
                  <span className="flex items-center gap-3"><span className="font-semibold tabular-nums">{moneyText(p.amountMinor, p.currency)}</span><StatusPill tone={p.status === 'settled' || p.status === 'sent' ? 'success' : p.status === 'failed' ? 'danger' : 'info'}>{p.status.replace(/^./, (c) => c.toUpperCase())}</StatusPill></span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Finance activity log" testId="finance-journals" actions={perms.canExport ? <Button href="/admin/finance/export?type=journals" variant="link" size="sm">Download (CSV)</Button> : undefined}>
          {data.journals.length === 0 ? <EmptyState title="No journals yet" /> : (
            <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0">
              {data.journals.map((j) => (
                <li key={j.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 py-2 text-ods-body [overflow-wrap:anywhere]">
                  <span>{j.memo} <span className="font-ods text-ods-small text-ods-slate">{j.number}{j.stream ? ` · ${j.stream}` : ''}</span></span>
                  <span className="text-end text-ods-small font-semibold tabular-nums">{j.totals.map((t) => moneyText(t.minor, t.currency)).join(' · ') || '—'}</span>
                  <span className="col-span-2 text-ods-small text-ods-slate">{formatDate(j.createdAt)} <LocalTime iso={j.createdAt} /> · {j.who}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
