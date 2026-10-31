import Link from 'next/link';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, Stat, PageHeader, EmptyState, StatusBadge, Table, Notice } from '@/components/ui';
import { Bar, Field } from '@/components/admin/ui';
import { ActionForm, RunButton } from '@/components/admin/client';
import { money, humanize, fmtDate, convertMinor, CURRENCIES } from '@/lib/format';
import { getCurrencyContext } from '@/lib/currency';
import { CurrencyTotals, sumByCurrency, perCurrencyText, rateLabel } from '@/components/admin/currency';
import { monthLabel } from '@/components/admin/server';
import { confirmTopup, recordPayment, decideApproval, requestApproval } from './actions';

export const metadata = { title: 'Finance & revenue' };

type Approval = { id: string; kind: string; org_id: string | null; supplier_id: string | null; order_id: string | null; amount_cents: number; currency: string; reason: string; status: string; requested_by: string; approved_by: string | null; created_at: string; decided_at: string | null };

/** Admin → Finance & revenue (Finance.png). */
export default async function FinancePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const s = await requireStaff('finance', 'view', '/admin/finance');
  const { month: mp } = await searchParams;
  const now = new Date();
  const month = /^\d{4}-\d{2}$/.test(mp ?? '') ? mp! : now.toISOString().slice(0, 7);
  const from = new Date(month + '-01T00:00:00Z');
  const to = new Date(from); to.setUTCMonth(to.getUTCMonth() + 1);
  const sb = await createClient();

  const [rev, revAll, check, payments, topups, approvals, payouts, journals, openOrders, orgs, suppliers, limitRow, wallets, refundsRow, ctx] = await Promise.all([
    sb.rpc('admin_revenue_by_stream', { p_from: from.toISOString(), p_to: to.toISOString() }),
    sb.rpc('admin_revenue_by_stream', {}),
    sb.rpc('admin_ledger_check'),
    sb.from('payments').select('id, org_id, order_id, purpose, method, amount_cents, currency, reference, status, created_at, confirmed_at').order('created_at', { ascending: false }).limit(25),
    sb.from('wallet_topups').select('id, org_id, amount_cents, currency, method, reference, status, created_at').eq('status', 'pending').order('created_at'),
    sb.from('finance_approvals').select('*').order('created_at', { ascending: false }).limit(40),
    sb.from('payouts').select('id, supplier_id, amount_cents, currency, status, reference, created_at, approval_id').order('created_at', { ascending: false }).limit(25),
    sb.from('journals').select('id, number, memo, stream, created_at, created_by').order('created_at', { ascending: false }).limit(10),
    sb.from('orders').select('id, code, org_id, total_cents, paid_cents, deposit_cents, currency, status').not('status', 'in', '(cancelled,closed)').order('created_at', { ascending: false }).limit(200),
    sb.from('organizations').select('id, name, country').order('name').limit(1000),
    sb.from('suppliers').select('id, code, legal_name').order('code'),
    sb.from('site_settings').select('value').eq('key', 'finance_approval_limit_cents').maybeSingle(),
    sb.rpc('admin_wallet_balances'),
    sb.from('ledger_entries').select('debit_cents, credit_cents, currency, created_at, ledger_accounts!inner(code)').in('ledger_accounts.code', ['exp:refunds', 'exp:refunds:CNY']).gte('created_at', from.toISOString()).lt('created_at', to.toISOString()),
    getCurrencyContext(),
  ]);

  const limit = Number(limitRow.data?.value ?? 100000);
  // Every aggregate is kept per currency (SPEC §15.1) + a total converted into the platform currency at the approved rate.
  type RevRow = { stream: string; credit_cents: number; debit_cents: number; net_cents: number; currency: string; net_converted_minor: number };
  const revRows = (rev.data ?? []) as RevRow[];
  const grossBy = sumByCurrency(revRows, (r) => r.credit_cents, (r) => r.currency);
  const refundsBy = sumByCurrency([
    ...(refundsRow.data ?? []).map((r) => ({ v: Number(r.debit_cents) - Number(r.credit_cents), c: r.currency as string })),
    ...revRows.map((r) => ({ v: Number(r.debit_cents), c: r.currency })),
  ], (x) => x.v, (x) => x.c);
  const netBy = new Map(CURRENCIES.filter((c) => grossBy.has(c) || refundsBy.has(c)).map((c) => [c, (grossBy.get(c) ?? 0) - (refundsBy.get(c) ?? 0)] as const));
  const negBy = new Map([...refundsBy].map(([c, v]) => [c, -v] as const));
  const toPlat = (v: number, c: string) => convertMinor(v, c, ctx.currency, ctx.rate, ctx.rounding[ctx.currency]?.step_minor ?? 1);
  const grossConv = [...grossBy].reduce((a, [c, v]) => a + toPlat(v, c), 0);
  const refundsConv = [...refundsBy].reduce((a, [c, v]) => a + toPlat(v, c), 0);
  const paymentsInBy = sumByCurrency((payments.data ?? []).filter((p) => p.status === 'confirmed' && p.confirmed_at && p.confirmed_at >= from.toISOString() && p.confirmed_at < to.toISOString()), (p) => p.amount_cents, (p) => p.currency);
  const payoutsDueBy = sumByCurrency((payouts.data ?? []).filter((p) => ['scheduled', 'approved'].includes(p.status)), (p) => p.amount_cents, (p) => p.currency);
  const walletsBy = sumByCurrency((wallets.data ?? []) as { balance_cents: number; currency: string }[], (w) => w.balance_cents, (w) => w.currency);
  type LedgerRow = { total_debit: number; total_credit: number; journals: number; unbalanced_journals: number; currency: string };
  const ledgerRows = (check.data ?? []) as LedgerRow[];
  const ledgerOk = (l: LedgerRow) => Number(l.total_debit) === Number(l.total_credit) && Number(l.unbalanced_journals) === 0;
  // revenue by stream: bar length = converted net, label = per-currency amounts
  const streams = new Map<string, { conv: number; rows: RevRow[] }>();
  revRows.forEach((r) => { const x = streams.get(r.stream) ?? { conv: 0, rows: [] }; x.conv += Number(r.net_converted_minor ?? r.net_cents); x.rows.push(r); streams.set(r.stream, x); });
  const streamList = [...streams.entries()].sort((a, b) => b[1].conv - a[1].conv);
  const revNetBy = sumByCurrency(revRows, (r) => r.net_cents, (r) => r.currency);
  const orgName = new Map((orgs.data ?? []).map((o) => [o.id, o.name]));
  const supName = new Map((suppliers.data ?? []).map((x) => [x.id, `${x.legal_name} · ${x.code}`]));
  const appr = (approvals.data ?? []) as Approval[];
  const pending = appr.filter((a) => a.status === 'requested');
  const decided = appr.filter((a) => a.status !== 'requested').slice(0, 10);
  const peopleIds = [...new Set([...appr.flatMap((a) => [a.requested_by, a.approved_by]), ...(journals.data ?? []).map((j) => j.created_by)].filter(Boolean) as string[])];
  const { data: people } = peopleIds.length ? await sb.from('profiles').select('id, full_name, email').in('id', peopleIds) : { data: [] };
  const who = new Map((people ?? []).map((p) => [p.id, p.full_name || p.email]));
  // journal amounts per currency (a journal balances per currency; cross-currency moves have one leg per currency)
  const jIds = (journals.data ?? []).map((j) => j.id);
  const { data: jEntries } = jIds.length ? await sb.from('ledger_entries').select('journal_id, debit_cents, currency').in('journal_id', jIds) : { data: [] };
  const jTotals = new Map<string, Map<string, number>>();
  (jEntries ?? []).forEach((e) => {
    const m = jTotals.get(e.journal_id) ?? new Map<string, number>();
    m.set(e.currency, (m.get(e.currency) ?? 0) + Number(e.debit_cents));
    jTotals.set(e.journal_id, m);
  });
  const unpaid = (openOrders.data ?? []).filter((o) => Number(o.paid_cents) < Number(o.total_cents));
  const maxStream = Math.max(1, ...streamList.map(([, x]) => x.conv));

  // months for selector: from revenue history + current
  const monthsSet = new Set<string>([now.toISOString().slice(0, 7), month]);
  ((revAll.data ?? []) as { month: string }[]).forEach((r) => monthsSet.add(String(r.month).slice(0, 7)));
  const monthOpts = [...monthsSet].sort().reverse();

  return (
    <>
      <PageHeader
        title="Finance & revenue"
        subtitle={`All money in and out, approvals, and every record ready to export. Each amount is shown in its own currency; totals are also converted into ${ctx.currency} at the approved rate (${rateLabel(ctx)}).`}
        actions={
          <form action="/admin/finance" className="flex flex-wrap items-center gap-3">
            <label htmlFor="month" className="sr-only">Month</label>
            <select id="month" name="month" defaultValue={month} className="input w-auto">
              {monthOpts.map((m) => <option key={m} value={m}>{monthLabel(m + '-01')}</option>)}
            </select>
            <button className="btn btn-ghost" type="submit">Show</button>
            {can(s, 'finance', 'export') && (
              <>
                <a className="btn btn-ghost" href={`/admin/finance/export?type=revenue`}>Revenue CSV</a>
                <a className="btn btn-ghost" href={`/admin/finance/export?type=journals&month=${month}`}>Journals CSV</a>
                <a className="btn btn-ghost" href={`/admin/finance/export?type=payments&month=${month}`}>Payments CSV</a>
              </>
            )}
          </form>
        }
      />

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 mb-6">
        <Stat label="Gross revenue" value={<CurrencyTotals totals={grossBy} ctx={ctx} />} hint={monthLabel(from)} />
        <Stat label="Refunds & credits" value={<CurrencyTotals totals={negBy} ctx={ctx} />} hint={grossConv ? `${((refundsConv / grossConv) * 100).toFixed(1)}% of revenue` : '—'} />
        <Stat label="Net revenue" value={<CurrencyTotals totals={netBy} ctx={ctx} />} hint="after refunds" />
        <Stat label="Customer payments in" value={<CurrencyTotals totals={paymentsInBy} ctx={ctx} />} hint="confirmed, this month" />
        <Stat label="Supplier payouts due" value={<CurrencyTotals totals={payoutsDueBy} ctx={ctx} />} hint={`${pending.filter((a) => a.kind === 'payout').length} awaiting approval`} hintTone="warn" />
        <Stat label="Held in wallets" value={<CurrencyTotals totals={walletsBy} ctx={ctx} />} hint="customer money, per currency" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <Card title={`Revenue by source · ${monthLabel(from)}`}>
          <div className="px-6 pb-6">
            {streamList.length === 0 ? <EmptyState title="No revenue posted this month" /> :
              streamList.map(([stream, x]) => (
                <Bar key={stream} label={humanize(stream)} value={x.conv} max={maxStream}
                  display={perCurrencyText(sumByCurrency(x.rows, (r) => r.net_cents, (r) => r.currency), ctx.currency)} />
              ))}
            {streamList.length > 0 && (
              <div className="mt-3 flex justify-between gap-3 border-t border-line pt-3 text-[15px]">
                <span className="font-semibold">Total net</span>
                <CurrencyTotals totals={revNetBy} ctx={ctx} className="text-right" />
              </div>
            )}
            <p className="text-xs text-muted mt-3">Credits minus debits on revenue accounts, grouped by journal stream. Wallet top-ups are customer money, not revenue — they count only when spent on a service.</p>
          </div>
        </Card>
        <Card title="Approval rules & ledger check">
          <div className="px-6 pb-6">
            <dl className="divide-y divide-line text-[15px]">
              <div className="flex justify-between py-2.5"><dt>Refunds, credit notes, adjustments up to {money(limit, 'USD')}{ctx.currency !== 'USD' && ` (≈ ${money(toPlat(limit, 'USD'), ctx.currency)})`}</dt><dd className="font-semibold">Finance (checker ≠ maker)</dd></div>
              <div className="flex justify-between py-2.5"><dt>Anything over {money(limit, 'USD')}</dt><dd className="font-semibold">Finance → Admin</dd></div>
              <div className="flex justify-between py-2.5"><dt>Supplier payouts</dt><dd className="font-semibold">Finance → Admin over limit</dd></div>
              <div className="flex justify-between py-2.5"><dt>Wallet top-ups</dt><dd className="font-semibold">Wallet approve permission</dd></div>
            </dl>
            {s.isAdmin && <Link href="/admin/wallet#settings" className="btn btn-ghost btn-sm mt-3">Edit limit</Link>}
            <div className="mt-5">
              <h3 className="font-semibold mb-2">Journal balance check · per currency</h3>
              {check.error ? <Notice tone="amber">Ledger check unavailable.</Notice> : ledgerRows.length === 0 ? <Notice tone="blue">No ledger entries yet.</Notice> : (
                <div className="grid gap-2">
                  {ledgerRows.map((l) => (
                    <Notice key={l.currency} tone={ledgerOk(l) ? 'green' : 'red'}>
                      <b className="mono">{l.currency}</b> · {ledgerOk(l) ? 'Balanced ✓ ' : 'NOT balanced ✗ '}
                      Debits <b className="mono">{money(Number(l.total_debit), l.currency)}</b> · Credits <b className="mono">{money(Number(l.total_credit), l.currency)}</b> · {l.journals} journals · {l.unbalanced_journals} unbalanced
                    </Notice>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>
      </div>

      <Card title="Waiting for approval" className="mb-6" action={<span className="text-sm text-muted">{pending.length} items · signed in as {s.profile?.full_name ?? s.email}</span>}>
        <Table head={['Type', 'For', 'Amount', 'Reason', 'Prepared by', 'Stage', '']} empty={<EmptyState title="Nothing waiting for approval" />}>
          {pending.map((a) => {
            const mine = a.requested_by === s.userId;
            const overLimit = convertMinor(Number(a.amount_cents), a.currency, 'USD', ctx.rate) > limit; // limit is set in USD
            return (
              <tr key={a.id}>
                <td className="td">{humanize(a.kind)}<div className="mono text-xs text-muted">{a.id.slice(0, 8).toUpperCase()}</div></td>
                <td className="td font-semibold">{a.supplier_id ? supName.get(a.supplier_id) : a.org_id ? orgName.get(a.org_id) : '—'}</td>
                <td className="td mono font-semibold">{money(Number(a.amount_cents), a.currency)}</td>
                <td className="td text-sm max-w-[260px]">{a.reason}</td>
                <td className="td text-sm">{who.get(a.requested_by) ?? '—'}{mine && <div className="text-xs text-warn">You prepared this</div>}</td>
                <td className="td"><StatusBadge status="requested" label={overLimit ? 'Needs Admin' : 'Needs Finance'} /></td>
                <td className="td">
                  {can(s, 'finance', 'approve') && (
                    <span className="flex gap-2">
                      <RunButton className="btn btn-primary btn-sm" confirm={`Approve ${humanize(a.kind)} of ${money(Number(a.amount_cents), a.currency)}? Money will move.`} action={decideApproval.bind(null, a.id, true)}>Approve</RunButton>
                      <RunButton className="btn btn-ghost btn-sm" prompt="Reason for rejecting:" action={decideApproval.bind(null, a.id, false)}>Reject</RunButton>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
        {decided.length > 0 && (
          <details className="px-6 py-4 border-t border-line">
            <summary className="cursor-pointer font-semibold text-sm">Recently decided ({decided.length})</summary>
            <ul className="mt-3 text-sm divide-y divide-line">
              {decided.map((a) => (
                <li key={a.id} className="py-2 flex flex-wrap gap-3 items-center">
                  <StatusBadge status={a.status} /> <span>{humanize(a.kind)}</span> <span className="mono">{money(Number(a.amount_cents), a.currency)}</span>
                  <span className="text-muted">by {who.get(a.requested_by) ?? '—'} → {a.approved_by ? who.get(a.approved_by) ?? '—' : '—'} · {fmtDate(a.decided_at, true)}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        {can(s, 'finance', 'create') && (
          <Card title="New approval request">
            <ActionForm action={requestApproval} className="px-6 pb-6 grid gap-4 sm:grid-cols-2" submitLabel="Send for approval" resetOnSuccess>
              <Field label="Type" htmlFor="fa-kind">
                <select id="fa-kind" name="kind" className="input" required defaultValue="refund">
                  <option value="refund">Refund (to wallet)</option><option value="credit_note">Credit note</option>
                  <option value="payout">Supplier payout</option><option value="adjustment">Manual wallet adjustment</option>
                </select>
              </Field>
              <Field label="Amount" htmlFor="fa-amount" hint={`In the order’s currency if an order is chosen, otherwise ${ctx.currency}.`}><input id="fa-amount" name="amount" inputMode="decimal" className="input mono" placeholder="0.00" required /></Field>
              <Field label="Customer (refund / credit / adjustment)" htmlFor="fa-org">
                <select id="fa-org" name="org_id" className="input" defaultValue=""><option value="">—</option>{(orgs.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}{o.country ? ` · ${o.country}` : ''}</option>)}</select>
              </Field>
              <Field label="Supplier (payout)" htmlFor="fa-sup">
                <select id="fa-sup" name="supplier_id" className="input" defaultValue=""><option value="">—</option>{(suppliers.data ?? []).map((x) => <option key={x.id} value={x.id}>{x.code} · {x.legal_name}</option>)}</select>
              </Field>
              <Field label="Order (optional)" htmlFor="fa-order" className="sm:col-span-2">
                <select id="fa-order" name="order_id" className="input" defaultValue=""><option value="">—</option>{(openOrders.data ?? []).map((o) => <option key={o.id} value={o.id}>{o.code} · {orgName.get(o.org_id)} · {o.currency}</option>)}</select>
              </Field>
              <Field label="Reason" htmlFor="fa-reason" className="sm:col-span-2"><textarea id="fa-reason" name="reason" className="input min-h-20 py-2" required minLength={5} /></Field>
              <p className="sm:col-span-2 text-xs text-muted">Maker–checker: you cannot approve your own request. Amounts over {money(limit, 'USD')} (converted at the approved rate) need an Admin.</p>
            </ActionForm>
          </Card>
        )}
        {can(s, 'finance', 'approve') && (
          <Card title="Record order payment">
            <ActionForm action={recordPayment} className="px-6 pb-6 grid gap-4 sm:grid-cols-2" submitLabel="Record payment" confirm="Record this payment? It posts to the ledger and may advance the order." resetOnSuccess>
              <Field label="Order" htmlFor="rp-order" className="sm:col-span-2">
                <select id="rp-order" name="order_id" className="input" required defaultValue="">
                  <option value="" disabled>Select an order with a balance…</option>
                  {unpaid.map((o) => <option key={o.id} value={o.id}>{o.code} · {orgName.get(o.org_id)} · due {money(Number(o.total_cents) - Number(o.paid_cents), o.currency)} ({humanize(o.status)})</option>)}
                </select>
              </Field>
              <Field label="Amount (in the order’s currency)" htmlFor="rp-amount" hint="Orders are paid in the currency locked on their PI."><input id="rp-amount" name="amount" inputMode="decimal" className="input mono" required placeholder="0.00" /></Field>
              <Field label="Method" htmlFor="rp-method">
                <select id="rp-method" name="method" className="input" defaultValue="bank_transfer"><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="paypal">PayPal</option><option value="other">Other</option></select>
              </Field>
              <Field label="Bank / payment reference" htmlFor="rp-ref" className="sm:col-span-2"><input id="rp-ref" name="reference" className="input mono" required /></Field>
              {unpaid.length === 0 && <p className="sm:col-span-2 text-sm text-muted">No orders with an open balance.</p>}
            </ActionForm>
          </Card>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2 mb-6">
        <Card title="Pending wallet top-ups" action={<Link href="/admin/wallet" className="text-sm text-blue font-semibold">Wallets →</Link>}>
          <Table head={['Date', 'Customer', 'Reference', 'Amount', '']} empty={<EmptyState title="No top-ups waiting" />}>
            {(topups.data ?? []).map((t) => (
              <tr key={t.id}>
                <td className="td text-sm">{fmtDate(t.created_at, true)}</td>
                <td className="td font-semibold">{orgName.get(t.org_id) ?? '—'}</td>
                <td className="td mono text-sm">{t.reference ?? <span className="text-warn">no reference</span>}<div className="text-xs text-muted">{humanize(t.method)}</div></td>
                <td className="td mono font-semibold text-ok">+{money(Number(t.amount_cents), t.currency)}</td>
                <td className="td">{can(s, 'wallet', 'approve') && <RunButton className="btn btn-primary btn-sm" confirm={`Confirm ${money(Number(t.amount_cents), t.currency)} received and credit the ${t.currency} wallet?`} action={confirmTopup.bind(null, t.id)}>Confirm</RunButton>}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Incoming payments">
          <Table head={['Date', 'Customer', 'Purpose', 'Amount', 'Status']} empty={<EmptyState title="No payments yet" />}>
            {(payments.data ?? []).map((p) => (
              <tr key={p.id}>
                <td className="td text-sm">{fmtDate(p.created_at, true)}</td>
                <td className="td font-semibold">{p.org_id ? orgName.get(p.org_id) : '—'}<div className="mono text-xs text-muted">{p.reference}</div></td>
                <td className="td text-sm">{humanize(p.purpose)} · {humanize(p.method)}</td>
                <td className="td mono font-semibold">{money(Number(p.amount_cents), p.currency)}</td>
                <td className="td"><StatusBadge status={p.status} /></td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Supplier payouts">
          <Table head={['Supplier', 'Amount', 'Status', 'Created']} empty={<EmptyState title="No payouts yet" />}>
            {(payouts.data ?? []).map((p) => (
              <tr key={p.id}>
                <td className="td font-semibold">{supName.get(p.supplier_id) ?? '—'}</td>
                <td className="td mono font-semibold">{money(Number(p.amount_cents), p.currency)}</td>
                <td className="td"><StatusBadge status={p.status} /></td>
                <td className="td text-sm">{fmtDate(p.created_at)}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Finance activity log" action={can(s, 'finance', 'export') && <a className="btn btn-ghost btn-sm" href="/admin/finance/export?type=journals">Download (CSV)</a>}>
          {(journals.data ?? []).length === 0 ? <EmptyState title="No journals yet" /> : (
            <ul className="px-6 pb-5">
              {(journals.data ?? []).map((j) => (
                <li key={j.id} className="grid grid-cols-[110px_120px_1fr_auto] gap-3 py-2.5 border-b border-line last:border-0 text-sm">
                  <span className="mono text-xs text-muted">{fmtDate(j.created_at, true)}</span>
                  <span className="font-semibold truncate">{j.created_by ? who.get(j.created_by) ?? 'Staff' : 'System'}</span>
                  <span>{j.memo} <span className="mono text-xs text-muted">{j.number}{j.stream ? ` · ${j.stream}` : ''}</span></span>
                  <span className="mono text-xs font-semibold text-right">{[...(jTotals.get(j.id) ?? new Map<string, number>())].map(([c, v]) => money(v, c)).join(' · ') || '—'}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
