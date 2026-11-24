'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { money, fmtDate } from '@/lib/format';
import {
  decideCreditTermsAction,
  generateDropshipStatementAction,
  proposeCreditTermsAction,
} from './actions';

export type StaffCreditTermRow = {
  id: string;
  org_id: string;
  org_name: string;
  kyc_status: string;
  division_id: string | null;
  division_code: string;
  credit_limit_cents: number;
  currency: string;
  net_days: number;
  status: string;
  overdue_blocked: boolean;
  proposed_by: string;
  approved_by: string | null;
  note: string | null;
  unpaid_invoices_cents: number;
  reserved_cents: number;
  updated_at: string;
};

export type StaffDropshipStatementRow = {
  id: string;
  number: string;
  org_name: string;
  legal_entity_code: string;
  legal_entity_name: string;
  invoice_count: number;
  sample_count: number;
  amount_cents: number;
  paid_cents: number;
  currency: string;
  status: string;
  created_at: string;
};

export function CreditTermsClient({
  terms,
  statements = [],
  orgs,
  divisions,
  currentUserId,
}: {
  terms: StaffCreditTermRow[];
  statements?: StaffDropshipStatementRow[];
  orgs: { id: string; name: string; kyc_status: string; credit_eligible?: boolean }[];
  divisions: { id: string; code: string; name: string }[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function handlePropose(formData: FormData) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await proposeCreditTermsAction(formData);
      if (!res.ok) {
        setError(res.error ?? 'Could not propose credit terms.');
        return;
      }
      setNotice('Credit limit proposal saved — awaiting second Finance approver.');
      router.refresh();
    });
  }

  function handleDecide(formData: FormData) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await decideCreditTermsAction(formData);
      if (!res.ok) {
        setError(res.error ?? 'Approval failed.');
        return;
      }
      setNotice('Two-person credit limit decision recorded.');
      router.refresh();
    });
  }

  function handleStatement(formData: FormData) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await generateDropshipStatementAction(formData);
      if (!res.ok) {
        setError(res.error ?? 'Could not generate statement.');
        return;
      }
      setNotice(
        `Dropshipping weekly statement ${res.statementNumber} generated (${res.invoiceCount ?? 0} shipment invoices, ${res.sampleCount ?? 0} sample orders).`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-6" data-testid="finance-credit-page">
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3.5 text-xs text-red-900" role="alert" data-testid="credit-error">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-xs text-emerald-950" data-testid="credit-notice">
          {notice}
        </div>
      )}

      {/* Propose New / Updated Credit Limit */}
      <section className="card p-5 space-y-3" data-testid="propose-credit-terms-card">
        <div>
          <h2 className="text-base font-semibold text-ink">Propose Customer Credit Terms (Always Two-Person Approved)</h2>
          <p className="text-xs text-muted">
            Credit limits ALWAYS require two-person Finance approval (<code>proposed_by &lt;&gt; approved_by</code>),
            whatever the amount, and the customer company must have <code>kyc_status = &apos;verified&apos;</code> to
            check out with Pay later.
          </p>
        </div>

        <form action={handlePropose} className="grid gap-3 sm:grid-cols-5 text-xs items-end">
          <div className="sm:col-span-2">
            <label className="block text-muted mb-1">Customer company</label>
            <select
              name="org_id"
              required
              data-testid="propose-credit-org"
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-xs"
            >
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} (KYC: {o.kyc_status}{o.credit_eligible ? ' · Credit eligible' : ''})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-muted mb-1">Division scope</label>
            <select
              name="division_id"
              defaultValue="all"
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-xs"
            >
              <option value="all">Company-wide (all divisions)</option>
              {divisions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-muted mb-1">Credit limit (US$)</label>
            <input
              type="number"
              name="credit_limit_usd"
              defaultValue={5000}
              min={0}
              step={100}
              required
              data-testid="propose-credit-limit-usd"
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-2 font-mono text-xs"
            />
          </div>

          <div>
            <label className="block text-muted mb-1">Net payment terms</label>
            <select
              name="net_days"
              defaultValue={30}
              data-testid="propose-credit-net-days"
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-xs"
            >
              <option value={7}>Net 7 days</option>
              <option value={15}>Net 15 days</option>
              <option value={30}>Net 30 days</option>
              <option value={45}>Net 45 days</option>
              <option value={60}>Net 60 days</option>
            </select>
          </div>

          <div className="sm:col-span-4">
            <input
              type="text"
              name="note"
              placeholder="Underwriting note / trade credit rationale"
              className="w-full rounded-lg border border-line bg-canvas px-2.5 py-2 text-xs"
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={pending}
              data-testid="propose-credit-submit-btn"
              className="inline-flex min-h-10 w-full items-center justify-center rounded-lg bg-ink px-4 py-2 text-xs font-semibold text-canvas hover:opacity-95 disabled:opacity-40"
            >
              Propose credit limit
            </button>
          </div>
        </form>
      </section>

      {/* Credit terms table */}
      <section className="card p-5 space-y-3" data-testid="credit-terms-list">
        <h2 className="text-base font-semibold text-ink">Customer Credit Lines &amp; Usage</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-line text-muted uppercase tracking-wider text-[11px]">
                <th className="py-2.5 pr-3">Customer</th>
                <th className="py-2.5 pr-3">Division</th>
                <th className="py-2.5 pr-3">Terms</th>
                <th className="py-2.5 pr-3">Limit</th>
                <th className="py-2.5 pr-3">Unpaid Invoices</th>
                <th className="py-2.5 pr-3">Reserved Orders</th>
                <th className="py-2.5 pr-3">Available</th>
                <th className="py-2.5 pr-3">Status</th>
                <th className="py-2.5 text-right">Two-Person Approval / Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {terms.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-muted">
                    No customer credit lines configured yet.
                  </td>
                </tr>
              ) : (
                terms.map((t) => {
                  const avail = Math.max(0, t.credit_limit_cents - t.unpaid_invoices_cents - t.reserved_cents);
                  const isSelf = t.proposed_by === currentUserId;
                  return (
                    <tr key={t.id} data-testid={`credit-term-row-${t.id}`}>
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold text-ink">{t.org_name}</div>
                        <div className="text-[11px] text-muted">KYC: {t.kyc_status}</div>
                      </td>
                      <td className="py-2.5 pr-3 font-mono">{t.division_code}</td>
                      <td className="py-2.5 pr-3 font-semibold">Net {t.net_days}</td>
                      <td className="py-2.5 pr-3 font-mono font-semibold">{money(t.credit_limit_cents, t.currency)}</td>
                      <td className="py-2.5 pr-3 font-mono">{money(t.unpaid_invoices_cents, t.currency)}</td>
                      <td className="py-2.5 pr-3 font-mono">{money(t.reserved_cents, t.currency)}</td>
                      <td className="py-2.5 pr-3 font-mono font-bold text-emerald-800">{money(avail, t.currency)}</td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase ${
                            t.status === 'active'
                              ? 'bg-emerald-100 text-emerald-900'
                              : t.status === 'pending_approval'
                                ? 'bg-amber-100 text-amber-900'
                                : 'bg-surface text-muted'
                          }`}
                        >
                          {t.status.replace('_', ' ')}
                        </span>
                        {t.overdue_blocked && (
                          <div className="mt-1 text-[10px] font-semibold text-red-700">Overdue blocked</div>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        {t.status === 'pending_approval' ? (
                          <div className="inline-flex items-center gap-1.5">
                            <form action={handleDecide}>
                              <input type="hidden" name="terms_id" value={t.id} />
                              <input type="hidden" name="approve" value="true" />
                              <button
                                type="submit"
                                disabled={pending || isSelf}
                                title={isSelf ? 'Proposer cannot approve their own proposal' : 'Approve credit limit'}
                                data-testid={`approve-credit-btn-${t.id}`}
                                className="rounded bg-emerald-800 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
                              >
                                {isSelf ? 'Awaiting 2nd approver' : 'Approve'}
                              </button>
                            </form>
                            <form action={handleDecide}>
                              <input type="hidden" name="terms_id" value={t.id} />
                              <input type="hidden" name="approve" value="false" />
                              <button
                                type="submit"
                                disabled={pending || isSelf}
                                className="rounded border border-line bg-canvas px-2.5 py-1 text-xs text-ink disabled:opacity-40"
                              >
                                Reject
                              </button>
                            </form>
                          </div>
                        ) : (
                          <span className="text-[11px] text-muted">Updated {fmtDate(t.updated_at)}</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Weekly Dropshipping Statement Generator */}
      <section className="card p-5 space-y-3" data-testid="dropship-weekly-statement-card">
        <div>
          <h2 className="text-base font-semibold text-ink">Dropshipping Weekly Statements (STMT-DS)</h2>
          <p className="text-xs text-muted">
            Dropshipping Pay-later orders issue one <span className="font-mono">OCT-DS-</span> tax invoice per order at
            shipment, and the weekly <span className="font-mono">STMT-DS-</span> statement consolidates all shipment
            invoices plus paid sample orders (<span className="font-mono">DSO-…</span>) under the active legal entity
            (default <span className="font-mono">SZ-OCTOPUS</span>).
          </p>
        </div>
        <form action={handleStatement} className="flex flex-wrap items-center gap-3 text-xs">
          <select
            name="org_id"
            aria-label="Customer company for statement"
            className="rounded-lg border border-line bg-canvas px-3 py-2 text-xs"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={pending}
            data-testid="generate-ds-statement-btn"
            className="rounded-lg border border-ink bg-surface px-4 py-2 text-xs font-semibold text-ink hover:bg-canvas"
          >
            Generate weekly Dropshipping statement
          </button>
        </form>
        {statements.length > 0 && (
          <div className="overflow-x-auto pt-2">
            <table className="w-full text-left text-xs border-collapse" data-testid="ds-statements-table">
              <thead>
                <tr className="border-b border-line text-muted uppercase tracking-wider text-[11px]">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">Statement</th>
                  <th className="py-2 pr-3">Merchant</th>
                  <th className="py-2 pr-3">Legal entity</th>
                  <th className="py-2 pr-3">Lines</th>
                  <th className="py-2 pr-3">Total</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 text-right">PDF</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {statements.map((st) => (
                  <tr key={st.id} data-testid={`ds-statement-row-${st.number}`}>
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(st.created_at)}</td>
                    <td className="py-2 pr-3 font-mono font-semibold text-ink whitespace-nowrap">{st.number}</td>
                    <td className="py-2 pr-3">{st.org_name}</td>
                    <td className="py-2 pr-3">
                      <span className="font-mono font-semibold">{st.legal_entity_code}</span>
                      <span className="text-muted"> · {st.legal_entity_name}</span>
                    </td>
                    <td className="py-2 pr-3 font-mono whitespace-nowrap">
                      {st.invoice_count} inv · {st.sample_count} sample
                    </td>
                    <td className="py-2 pr-3 font-mono font-semibold whitespace-nowrap">
                      {money(st.amount_cents, st.currency)}
                    </td>
                    <td className="py-2 pr-3 uppercase text-[11px] font-semibold">{st.status}</td>
                    <td className="py-2 text-right">
                      <a
                        href={`/api/documents/${st.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded border border-line bg-canvas px-2.5 py-1 text-xs font-semibold text-ink hover:bg-surface"
                      >
                        PDF
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
