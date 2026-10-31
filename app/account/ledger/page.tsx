import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getSiteContent } from '@/lib/content';
import { PageHeader, Card, Stat, StatusBadge, EmptyState, Notice, Money } from '@/components/ui';
import { DocumentButton } from '@/components/client';
import { fmtDate, usd, humanize } from '@/lib/format';
import { DOC_LABEL, getSettings, latestTermsId, supplierMap } from '@/components/account/data';
import { getOrgLedger, parseRange } from '@/components/account/ledger-data';
import { ApproveQuoteButton } from '@/components/account/approve-quote';
import { approveQuote } from '../rfqs/actions';

export const metadata = { title: 'Ledger & invoices' };

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; account?: string }> }) {
  const s = await requireCustomer('/account/ledger');
  if (!s.org) return <Notice tone="amber">Complete your company profile first.</Notice>;
  const range = parseRange(await searchParams);
  const sb = await createClient();
  const [ledger, content, { data: docs }, { data: payments }, { data: openOrders }, { data: quote }, settings, terms] = await Promise.all([
    getOrgLedger(s.org.id, range),
    getSiteContent(),
    sb.from('documents').select('id, doc_type, number, amount_cents, status, created_at, orders(code)').eq('org_id', s.org.id).order('created_at', { ascending: false }).limit(30),
    sb.from('payments').select('amount_cents, confirmed_at, status').eq('org_id', s.org.id).eq('status', 'confirmed'),
    sb.from('orders').select('code, status, total_cents, paid_cents, deposit_cents').eq('org_id', s.org.id).not('status', 'in', '(cancelled,closed)'),
    sb.from('quotes').select('id, code, supplier_id, unit_price_cents, quantity, incoterm, lead_time_days, shipping_cents, valid_until, rfqs!inner(code, title, unit, org_id)').in('status', ['sent', 'viewed']).eq('rfqs.org_id', s.org.id).gt('valid_until', new Date().toISOString()).order('unit_price_cents').limit(1).maybeSingle(),
    getSettings(),
    latestTermsId(),
  ]);
  const fromTs = range.from ? new Date(range.from) : null;
  const toTs = range.to ? new Date(range.to + 'T23:59:59Z') : null;
  const periodPayments = (payments ?? []).filter((p) => { const t = new Date(p.confirmed_at as string); return (!fromTs || t >= fromTs) && (!toTs || t <= toTs); });
  const paidPeriod = periodPayments.reduce((a, p) => a + Number(p.amount_cents), 0);
  const balanceDue = ledger.closing.receivable;
  const dueNowSum = (openOrders ?? []).reduce((a, o) => {
    const paid = Number(o.paid_cents);
    if (['pi_issued', 'deposit_pending'].includes(o.status as string)) return a + Math.max(0, Number(o.deposit_cents) - paid);
    if (o.status === 'balance_pending') return a + Math.max(0, Number(o.total_cents) - paid);
    return a;
  }, 0);
  const qSup = quote ? (await supplierMap([quote.supplier_id as string])).get(quote.supplier_id as string) : undefined;
  const qRfq = quote?.rfqs as unknown as { code: string; title: string; unit: string } | undefined;
  const qTotal = quote ? Number(quote.unit_price_cents) * Number(quote.quantity) + Number(quote.shipping_cents) : 0;
  const qs = new URLSearchParams(Object.entries({ from: range.from, to: range.to, account: range.account === 'all' ? undefined : range.account }).filter(([, v]) => v) as [string, string][]).toString();
  const showWallet = range.account !== 'receivable';
  const showAr = range.account !== 'wallet';

  return (
    <>
      <PageHeader title="Ledger & invoices"
        subtitle={`Your account with ${content.company?.legal_name ?? 'Octopus B2B'}: every invoice, payment and credit, with a running balance. USD.`} />

      <form method="get" className="flex flex-wrap items-end gap-3 mb-6" aria-label="Filter ledger">
        <div><label htmlFor="from" className="label">From</label><input id="from" name="from" type="date" className="input" defaultValue={range.from} /></div>
        <div><label htmlFor="to" className="label">To</label><input id="to" name="to" type="date" className="input" defaultValue={range.to} /></div>
        <div>
          <label htmlFor="account" className="label">Account</label>
          <select id="account" name="account" className="input" defaultValue={range.account}>
            <option value="all">All accounts</option><option value="receivable">Orders (receivable)</option><option value="wallet">Wallet</option>
          </select>
        </div>
        <button className="btn btn-dark" type="submit">Apply</button>
        <a className="btn btn-ghost" href={`/account/ledger/statement/print${qs ? `?${qs}` : ''}`} target="_blank" rel="noopener">Statement PDF</a>
        <a className="btn btn-ghost" href={`/account/ledger/statement${qs ? `?${qs}` : ''}`}>Download CSV</a>
      </form>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label="Balance due" value={usd(balanceDue)} hint="Order value not yet paid" />
        <Stat label="Due now" value={usd(dueNowSum)} hint="Deposits and issued balance invoices" hintTone={dueNowSum ? 'warn' : 'ok'} />
        <Stat label="Wallet balance" value={usd(ledger.closing.wallet)} hint={<Link href="/account/wallet" className="underline">Open wallet</Link>} />
        <Stat label={range.from || range.to ? 'Paid this period' : 'Paid to date'} value={usd(paidPeriod)} hint={`${periodPayments.length} payments`} />
      </div>

      {quote && qRfq && (
        <Card className="p-6 mb-6">
          <div className="flex flex-wrap justify-between gap-3 mb-3"><h2 className="text-lg font-semibold">Quotation waiting for your approval</h2><StatusBadge status="pending" label="Awaiting your approval" /></div>
          <div className="rounded-[10px] border border-line p-4 flex flex-wrap items-center gap-4 justify-between">
            <div>
              <div className="mono text-xs text-muted">{quote.code} · from {qRfq.code} · valid until {fmtDate(quote.valid_until as string)}{qSup ? ` · Supplier ${qSup.code}${qSup.country ? ` · ${qSup.country}` : ''}` : ''}</div>
              <div className="font-semibold mt-1">{Number(quote.quantity).toLocaleString('en-US')} {qRfq.unit} · {qRfq.title}</div>
              <div className="text-sm text-muted">{usd(Number(quote.unit_price_cents))} per unit · {quote.incoterm}{quote.lead_time_days ? ` · ${quote.lead_time_days} days lead time` : ''}</div>
            </div>
            <div className="text-right"><div className="text-xs text-muted">Total</div><Money cents={qTotal} className="text-xl" /><div className="text-xs text-muted">{settings.deposit_pct}% deposit {usd(Math.round(qTotal * settings.deposit_pct / 100))}</div></div>
            <div className="flex gap-2">
              <Link href="/account/rfqs" className="btn btn-ghost">View quotations</Link>
              <ApproveQuoteButton quoteId={quote.id as string} quoteCode={quote.code as string} totalCents={qTotal} depositPct={settings.deposit_pct} termsVersion={terms?.version} action={approveQuote} label="Approve quote and create proforma invoice" className="btn btn-primary" />
            </div>
          </div>
        </Card>
      )}

      <Card className="mb-6 overflow-hidden" title="Account ledger" action={<span className="text-sm text-muted">Debits increase what you owe on orders; wallet credits are top-ups and refunds.</span>}>
        {ledger.rows.length === 0 && !ledger.opening.receivable && !ledger.opening.wallet ? (
          <EmptyState title="No ledger entries for this period" body="Entries appear when a proforma invoice is issued, a payment is matched or your wallet is used." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead><tr>{['Date', 'Journal', 'Description', 'Account', 'Debit', 'Credit', 'Balance'].map((h, i) => <th key={h} className={`th ${i >= 4 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>
                <tr className="bg-surface">
                  <td className="td text-sm">{range.from ? fmtDate(range.from) : '—'}</td>
                  <td className="td font-semibold" colSpan={3}>Opening balance</td>
                  <td className="td" /><td className="td" />
                  <td className="td text-right mono text-sm font-semibold">
                    {showAr && <div>Orders {usd(ledger.opening.receivable)}</div>}
                    {showWallet && <div className="text-muted">Wallet {usd(ledger.opening.wallet)}</div>}
                  </td>
                </tr>
                {ledger.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="td text-sm whitespace-nowrap">{fmtDate(r.at)}</td>
                    <td className="td mono text-xs">{r.journal}</td>
                    <td className="td text-sm">{r.memo}</td>
                    <td className="td"><StatusBadge status={r.account} tone={r.account === 'wallet' ? 'blue' : 'gray'} label={r.account === 'wallet' ? 'Wallet' : r.account === 'receivable' ? 'Orders' : humanize(r.accountName)} /></td>
                    <td className="td text-right mono text-sm">{r.debit ? usd(r.debit) : ''}</td>
                    <td className="td text-right mono text-sm text-ok">{r.credit ? usd(r.credit) : ''}</td>
                    <td className="td text-right mono text-sm font-semibold">{usd(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-navy text-white">
                  <td className="px-4 py-3 font-semibold" colSpan={4}>Closing balance</td>
                  <td className="px-4 py-3 text-right mono text-sm">{usd(ledger.totals.debit)}</td>
                  <td className="px-4 py-3 text-right mono text-sm">{usd(ledger.totals.credit)}</td>
                  <td className="px-4 py-3 text-right mono text-sm font-semibold">
                    {showAr && <div>Orders due {usd(ledger.closing.receivable)}</div>}
                    {showWallet && <div className="text-white/80">Wallet {usd(ledger.closing.wallet)}</div>}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <Card title="Invoices & documents">
        {(docs ?? []).length === 0 ? <EmptyState title="No documents yet" body="Proforma invoices, commercial invoices, receipts and credit notes appear here." /> : (
          <ul className="px-6 pb-4">
            {(docs ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 border-t border-line text-sm">
                <span className="mono flex-[1_1_140px]">{d.number}</span>
                <span className="flex-[2_1_220px] text-muted">{DOC_LABEL[d.doc_type as string] ?? humanize(d.doc_type as string)}{(d.orders as unknown as { code: string } | null)?.code ? ` · ${(d.orders as unknown as { code: string }).code}` : ''} · {fmtDate(d.created_at as string)}</span>
                <span className="flex-[1_1_100px]">{d.amount_cents != null ? <Money cents={Number(d.amount_cents)} /> : '—'}</span>
                <StatusBadge status={(d.status as string) ?? 'issued'} />
                <DocumentButton docId={d.id as string} compact />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
