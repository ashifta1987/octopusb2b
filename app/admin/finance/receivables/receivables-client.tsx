'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money, fmtDate } from '@/lib/format';
import {
  runCreditAndSaasOverdueCheckAction,
  runPaymentReconciliationAction,
} from './actions';

export type ReceivableInvoiceRow = {
  id: string;
  number: string;
  org_name: string;
  division_code: string;
  amount_cents: number;
  paid_cents: number;
  balance_cents: number;
  currency: string;
  due_at: string | null;
  days_overdue: number;
  bucket: 'current' | '1_30' | '31_60' | '61_90' | '90_plus';
  payment_option: string | null;
  last_reminder_stage: string | null;
  created_at: string;
};

export type ReconciliationAlertRow = {
  id: string;
  provider: string;
  provider_payment_id: string | null;
  kind: string;
  expected_cents: number | null;
  actual_cents: number | null;
  currency: string | null;
  detail: string;
  status: string;
  created_at: string;
};

export function ReceivablesClient({
  invoices,
  alerts,
  buckets,
}: {
  invoices: ReceivableInvoiceRow[];
  alerts: ReconciliationAlertRow[];
  buckets: {
    current: number;
    d1_30: number;
    d31_60: number;
    d61_90: number;
    d90_plus: number;
  };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleRunReconciliation() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await runPaymentReconciliationAction();
      if (!res.ok) {
        setError(res.error ?? 'Reconciliation failed.');
        return;
      }
      setNotice(`Daily reconciliation completed: ${res.checked} settlement(s) checked, ${res.alertsRaised} alert(s) raised.`);
      router.refresh();
    });
  }

  function handleRunOverdueCheck() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await runCreditAndSaasOverdueCheckAction();
      if (!res.ok) {
        setError(res.error ?? 'Overdue check failed.');
        return;
      }
      setNotice(
        `Overdue & reminder job finished: ${res.remindersSent} reminder(s) sent, ${res.orgsBlocked} overdue customer(s) paused, ${res.saasSuspended} SaaS subscription(s) suspended, ${res.expiredPledges} unpaid pool pledge(s) expired.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-6" data-testid="finance-receivables-page">
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3.5 text-xs text-red-900" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-xs text-emerald-950" data-testid="receivables-notice">
          {notice}
        </div>
      )}

      {/* Ageing Buckets Summary */}
      <section className="grid gap-3 sm:grid-cols-5" data-testid="receivables-ageing-buckets">
        {[
          { key: 'current', label: 'Current (not yet due)', cents: buckets.current },
          { key: '1_30', label: '1–30 days overdue', cents: buckets.d1_30 },
          { key: '31_60', label: '31–60 days overdue', cents: buckets.d31_60 },
          { key: '61_90', label: '61–90 days overdue', cents: buckets.d61_90 },
          { key: '90_plus', label: '90+ days overdue', cents: buckets.d90_plus },
        ].map((b) => (
          <div
            key={b.key}
            data-testid={`ageing-bucket-${b.key}`}
            className="card p-4"
          >
            <div className="text-xs text-muted">{b.label}</div>
            <div className="mt-1 font-mono text-lg font-bold text-ink">{money(b.cents, 'USD')}</div>
          </div>
        ))}
      </section>

      {/* Controls: Overdue Reminders & Daily Provider Reconciliation */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={handleRunOverdueCheck}
          data-testid="run-overdue-reminders-btn"
          className="inline-flex min-h-10 items-center rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-canvas hover:opacity-95 disabled:opacity-40"
        >
          Run Pay-later reminders &amp; overdue check (-3d, 0d, +3d, +7d, +14d)
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={handleRunReconciliation}
          data-testid="run-reconciliation-btn"
          className="inline-flex min-h-10 items-center rounded-lg border border-ink bg-surface px-4 py-2 text-xs font-semibold text-ink hover:bg-canvas disabled:opacity-40"
        >
          Run daily provider settlement reconciliation
        </button>
      </div>

      {/* Unpaid Invoices & Ageing Table */}
      <section className="card p-5 space-y-3" data-testid="receivables-invoices-table">
        <h2 className="text-base font-semibold text-ink">Open Receivables (Unpaid Tax Invoices)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-line text-muted uppercase tracking-wider text-[11px]">
                <th className="py-2.5 pr-3">Invoice</th>
                <th className="py-2.5 pr-3">Division</th>
                <th className="py-2.5 pr-3">Customer</th>
                <th className="py-2.5 pr-3">Option</th>
                <th className="py-2.5 pr-3">Due Date</th>
                <th className="py-2.5 pr-3">Ageing Bucket</th>
                <th className="py-2.5 pr-3">Last Reminder</th>
                <th className="py-2.5 text-right">Balance Due</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-muted">
                    No unpaid tax invoices at the moment.
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} data-testid={`receivable-row-${inv.number}`}>
                    <td className="py-2.5 pr-3 font-mono font-semibold text-ink">{inv.number}</td>
                    <td className="py-2.5 pr-3 font-mono">{inv.division_code}</td>
                    <td className="py-2.5 pr-3 font-medium text-ink">{inv.org_name}</td>
                    <td className="py-2.5 pr-3">{(inv.payment_option ?? 'pay_later').replace('_', ' ')}</td>
                    <td className="py-2.5 pr-3 font-mono">{inv.due_at ? fmtDate(inv.due_at) : 'On receipt'}</td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          inv.days_overdue <= 0
                            ? 'bg-emerald-100 text-emerald-900'
                            : inv.days_overdue <= 30
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-red-100 text-red-900'
                        }`}
                      >
                        {inv.days_overdue <= 0 ? 'Current' : `${inv.days_overdue}d overdue`}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-muted">{inv.last_reminder_stage ?? '—'}</td>
                    <td className="py-2.5 text-right font-mono font-bold text-ink">
                      {money(inv.balance_cents, inv.currency)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Daily Provider Settlement Reconciliation Alerts */}
      <section className="card p-5 space-y-3" data-testid="reconciliation-alerts-section">
        <div>
          <h2 className="text-base font-semibold text-ink">Provider Settlement Reconciliation Alerts</h2>
          <p className="text-xs text-muted">
            Compares Stripe, Airwallex, and Mock settlements against double-entry ledger journals and flags any
            missing entry or amount mismatch.
          </p>
        </div>

        {alerts.length === 0 ? (
          <div className="rounded-xl border border-emerald-300 bg-emerald-50/50 p-4 text-xs text-emerald-950">
            0 reconciliation discrepancies — all provider settlements match the ledger.
          </div>
        ) : (
          <ul className="space-y-2 text-xs">
            {alerts.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-red-950"
              >
                <div>
                  <strong className="uppercase">{a.provider}</strong> · {a.kind.replace(/_/g, ' ')} · {a.detail}
                </div>
                <span className="font-mono text-[11px]">{fmtDate(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
