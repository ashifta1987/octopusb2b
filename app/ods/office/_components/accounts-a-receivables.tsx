'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Drawer, EmptyState, FilterPills, KpiStrip, OctopusDataGrid, StatusPill, formatDate, type GridColumn } from '@octopus/ui';
import type { ReconciliationAlert } from '../_lib/accounts-a-data';
import { customerReceivables, moneyText, partsText, receivableAge, RECEIVABLE_BUCKETS, type ReceivableBucket, type ReceivableRow } from '../_lib/accounts-a-core';
import { Panel } from './dashboard';

/**
 * ODS T9 · /admin/finance/receivables — today's Receivables & ageing data as KPI strip + OctopusDataGrid + a customer
 * drill-down drawer. The two jobs call TODAY's actions unchanged (runCreditAndSaasOverdueCheckAction,
 * runPaymentReconciliationAction). Bucket sums are today's (balances added as they are; per currency in the drawer).
 */

type JobResult = { ok: boolean; error?: string } & Record<string, unknown>;
export type ReceivablesActions = {
  overdueCheck: () => Promise<JobResult & { remindersSent?: number; orgsBlocked?: number; saasSuspended?: number; expiredPledges?: number }>;
  reconcile: () => Promise<JobResult & { checked?: number; alertsRaised?: number }>;
};

export function ReceivablesView({
  rows, buckets, alerts, actions, canSeeCustomers, initialCustomer, error,
}: {
  rows: ReceivableRow[];
  buckets: Record<ReceivableBucket, number>;
  alerts: ReconciliationAlert[];
  actions: ReceivablesActions;
  canSeeCustomers: boolean;
  /** Fixtures: open the drawer for this customer name. */
  initialCustomer?: string | null;
  error?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bucket, setBucket] = useState<string>('all');
  const firstHit = initialCustomer ? rows.find((r) => r.orgName === initialCustomer) : undefined;
  const [customer, setCustomer] = useState<{ orgId: string | null; orgName: string } | null>(firstHit ? { orgId: firstHit.orgId, orgName: firstHit.orgName } : null);
  const shown = bucket === 'all' ? rows : rows.filter((r) => r.bucket === bucket);
  const drill = useMemo(() => (customer ? customerReceivables(rows, customer) : null), [rows, customer]);

  const run = (job: 'overdue' | 'reconcile') => {
    setErr(null);
    setNotice(null);
    start(async () => {
      if (job === 'overdue') {
        const r = await actions.overdueCheck();
        if (!r.ok) return setErr(r.error ?? 'Overdue check failed.');
        setNotice(`Overdue & reminder job finished: ${r.remindersSent ?? 0} reminder(s) sent, ${r.orgsBlocked ?? 0} overdue customer(s) paused, ${r.saasSuspended ?? 0} SaaS subscription(s) suspended, ${r.expiredPledges ?? 0} unpaid pool pledge(s) expired.`);
      } else {
        const r = await actions.reconcile();
        if (!r.ok) return setErr(r.error ?? 'Reconciliation failed.');
        setNotice(`Daily reconciliation completed: ${r.checked ?? 0} settlement(s) checked, ${r.alertsRaised ?? 0} alert(s) raised.`);
      }
      router.refresh();
    });
  };

  const columns: GridColumn<ReceivableRow>[] = [
    { id: 'number', header: 'Invoice', accessor: (r) => r.number, width: 150, cell: (r) => <span className="font-ods font-semibold" data-testid={`receivable-row-${r.number}`}>{r.number}</span> },
    { id: 'customer', header: 'Customer', accessor: (r) => r.orgName, width: 200 },
    { id: 'division', header: 'Division', accessor: (r) => r.divisionCode, width: 90, cell: (r) => <span className="font-ods">{r.divisionCode}</span> },
    { id: 'option', header: 'Option', accessor: (r) => (r.paymentOption ?? 'pay_later').replace('_', ' '), width: 110 },
    { id: 'due', header: 'Due', accessor: (r) => r.dueAt ?? '', width: 110, cell: (r) => (r.dueAt ? formatDate(r.dueAt) : 'On receipt') },
    { id: 'age', header: 'Ageing', accessor: (r) => r.daysOverdue, width: 140, cell: (r) => { const a = receivableAge(r.daysOverdue); return <StatusPill tone={a.tone}>{a.label}</StatusPill>; } },
    { id: 'reminder', header: 'Last reminder', accessor: (r) => r.lastReminder ?? '', width: 120, cell: (r) => <span className="font-ods text-ods-slate">{r.lastReminder ?? '—'}</span> },
    { id: 'balance', header: 'Balance due', numeric: true, accessor: (r) => r.balanceMinor, width: 140, cell: (r) => <span className="font-semibold">{moneyText(r.balanceMinor, r.currency)}</span> },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-ods-gap" data-testid="finance-receivables-page">
      <div>
        <p className="m-0 text-ods-small text-ods-slate">Accounts › Receivables and ageing</p>
        <h1 className="m-0 text-ods-h1 font-bold text-ods-navy">Receivables, ageing &amp; settlement reconciliation</h1>
        <p className="m-0 mt-0.5 max-w-3xl text-ods-small text-ods-slate">Unpaid Pay-later tax invoices by ageing bucket, automated due / overdue reminders, and provider settlements checked against the ledger.</p>
      </div>

      {err ? <div role="alert" className="rounded-ods-control bg-ods-danger-tint px-3 py-2 text-ods-small">{err}</div> : null}
      {notice ? <div role="status" className="rounded-ods-control bg-ods-success-tint px-3 py-2 text-ods-small" data-testid="receivables-notice">{notice}</div> : null}

      <KpiStrip
        variant="strip"
        label="Ageing buckets"
        data-testid="receivables-ageing-buckets"
        items={RECEIVABLE_BUCKETS.map((b) => ({ label: b.label, value: <span data-testid={`ageing-bucket-${b.id}`}>{moneyText(buckets[b.id], 'USD')}</span> }))}
      />

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => run('overdue')} loading={pending} data-testid="run-overdue-reminders-btn">Run Pay-later reminders &amp; overdue check</Button>
        <Button variant="secondary" onClick={() => run('reconcile')} loading={pending} data-testid="run-reconciliation-btn">Run provider reconciliation</Button>
        <span className="text-ods-small text-ods-slate">Reminders go out at −3, 0, +3, +7 and +14 days.</span>
      </div>

      <FilterPills
        mode="single"
        allowEmpty={false}
        label="Ageing bucket"
        value={[bucket]}
        onChange={(ids) => setBucket(ids[0] ?? 'all')}
        items={[{ id: 'all', label: 'All', count: rows.length }, ...RECEIVABLE_BUCKETS.map((b) => ({ id: b.id, label: b.label.replace(' (not yet due)', '').replace(' days overdue', ''), count: rows.filter((r) => r.bucket === b.id).length }))]}
        data-testid="receivables-bucket-filter"
      />

      <div data-testid="receivables-invoices-table">
        <OctopusDataGrid<ReceivableRow>
          label="Open receivables"
          data-testid="receivables-grid"
          rows={shown}
          columns={columns}
          getRowId={(r) => r.id}
          rowNumber={(r) => r.number}
          error={error ? 'We couldn’t load receivables.' : undefined}
          onRetry={() => router.refresh()}
          emptyTitle={rows.length ? 'No invoices in this bucket' : 'No unpaid tax invoices at the moment'}
          onClearFilters={bucket !== 'all' ? () => setBucket('all') : undefined}
          onOpenRow={(r) => setCustomer({ orgId: r.orgId, orgName: r.orgName })}
          onOpenInDrawer={(r) => setCustomer({ orgId: r.orgId, orgName: r.orgName })}
          onRefresh={() => router.refresh()}
          defaultSort={{ id: 'age', desc: true }}
          pageSizes={[25, 50, 100]}
          defaultPageSize={25}
        />
        <p className="m-0 mt-1 text-ods-small text-ods-slate">Open a row to see everything this customer owes.</p>
      </div>

      <Panel title="Provider settlement reconciliation alerts" testId="reconciliation-alerts-section">
        <p className="m-0 mb-2 text-ods-small text-ods-slate">Compares Stripe, Airwallex and Mock settlements against double-entry ledger journals and flags any missing entry or amount mismatch.</p>
        {alerts.length === 0 ? (
          <p className="m-0 rounded-ods-control bg-ods-success-tint px-3 py-2 text-ods-small">0 reconciliation discrepancies — all provider settlements match the ledger.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {alerts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-ods-control bg-ods-danger-tint px-3 py-2 text-ods-small">
                <span><b className="uppercase">{a.provider}</b> · {a.kind.replace(/_/g, ' ')} · {a.detail}</span>
                <span className="font-ods">{formatDate(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Drawer
        open={!!drill}
        onClose={() => setCustomer(null)}
        title={drill?.orgName ?? 'Customer'}
        description={drill ? `${drill.invoices.length} open invoice${drill.invoices.length === 1 ? '' : 's'} · oldest ${drill.oldestDays > 0 ? `${drill.oldestDays} days overdue` : 'not yet due'}` : null}
        width={460}
        data-testid="receivables-drawer"
        actions={drill?.orgId && canSeeCustomers ? <Button href={`/admin/customers/${drill.orgId}`} variant="secondary" size="sm">Customer record</Button> : undefined}
      >
        {drill ? (
          <div className="flex flex-col gap-4">
            <dl className="m-0 grid grid-cols-2 gap-3 rounded-ods-card border border-ods-line bg-ods-canvas p-3">
              <div><dt className="text-ods-small text-ods-slate">Balance due</dt><dd className="m-0 text-ods-h2 font-bold tabular-nums" data-testid="drawer-balance">{partsText(drill.balance)}</dd></div>
              <div><dt className="text-ods-small text-ods-slate">Overdue</dt><dd className="m-0 text-ods-h2 font-bold tabular-nums">{partsText(drill.overdue)}</dd></div>
            </dl>
            <table className="w-full border-collapse text-ods-table">
              <caption className="sr-only">Balance by ageing bucket</caption>
              <tbody>
                {RECEIVABLE_BUCKETS.map((b) => (
                  <tr key={b.id} className="border-b border-ods-line last:border-0">
                    <th scope="row" className="py-1 text-start font-normal">{b.label}</th>
                    <td className="py-1 text-end font-semibold tabular-nums">{partsText(drill.byBucket[b.id])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <h3 className="m-0 mb-1 text-ods-body font-bold">Open invoices</h3>
              <ul className="m-0 flex list-none flex-col divide-y divide-ods-line p-0" data-testid="drawer-invoices">
                {drill.invoices.map((i) => {
                  const a = receivableAge(i.daysOverdue);
                  return (
                    <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="min-w-0">
                        <span className="block font-ods font-semibold">{i.number}</span>
                        <span className="block text-ods-small text-ods-slate">Due {i.dueAt ? formatDate(i.dueAt) : 'on receipt'} · last reminder {i.lastReminder ?? '—'}</span>
                      </span>
                      <span className="flex items-center gap-2"><StatusPill tone={a.tone}>{a.label}</StatusPill><span className="font-semibold tabular-nums">{moneyText(i.balanceMinor, i.currency)}</span></span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        ) : (
          <EmptyState title="No customer selected" />
        )}
      </Drawer>
    </div>
  );
}
