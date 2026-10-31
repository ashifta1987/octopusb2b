import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getSiteContent } from '@/lib/content';
import { PageHeader, Card, Stat, StatusBadge, EmptyState, Notice, Money } from '@/components/ui';
import { DocumentButton } from '@/components/client';
import { fmtDate, money, humanize, asCurrency, CURRENCIES, CURRENCY_PREFIX, type Currency } from '@/lib/format';
import { DOC_LABEL, getSettings, latestTermsId, supplierMap } from '@/components/account/data';
import { getOrgLedger, parseRange, balOf } from '@/components/account/ledger-data';
import { ApproveQuoteButton } from '@/components/account/approve-quote';
import { approveQuote } from '../rfqs/actions';

export const metadata = { title: 'Ledger & invoices' };

/** Sum amounts per currency (SPEC §15.1: never add different currencies together). */
function perCurrency<T>(rows: T[], cur: (r: T) => string | null | undefined, amt: (r: T) => number) {
  const out: Partial<Record<Currency, number>> = {};
  rows.forEach((r) => { const c = asCurrency(cur(r)); out[c] = (out[c] ?? 0) + amt(r); });
  return out;
}

/** "US$ 10.00 · CN¥ 5.00" — one line per currency that has a value (falls back to the platform currency at 0). */
function MultiMoney({ values, fallback }: { values: Partial<Record<Currency, number>>; fallback: Currency }) {
  const list = CURRENCIES.filter((c) => values[c] != null && values[c] !== 0);
  if (!list.length) return <>{money(0, fallback)}</>;
  return <>{list.map((c) => <div key={c} className={list.length > 1 ? 'text-[22px]' : undefined}>{money(values[c]!, c)}</div>)}</>;
}

export default async function LedgerPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; account?: string; currency?: string }> }) {
  const s = await requireCustomer('/account/ledger');
  if (!s.org) return <Notice tone="amber">Complete your company profile first.</Notice>;
  const range = parseRange(await searchParams);
  const sb = await createClient();
  const [ledger, content, { data: docs }, { data: payments }, { data: openOrders }, { data: quote }, settings, terms, { data: platform }] = await Promise.all([
    getOrgLedger(s.org.id, range),
    getSiteContent(),
    sb.from('documents').select('id, doc_type, number, amount_cents, currency, status, created_at, orders(code)').eq('org_id', s.org.id).order('created_at', { ascending: false }).limit(30),
    sb.from('payments').select('amount_cents, currency, confirmed_at, status').eq('org_id', s.org.id).eq('status', 'confirmed'),
    sb.from('orders').select('code, status, total_cents, paid_cents, deposit_cents, currency').eq('org_id', s.org.id).not('status', 'in', '(cancelled,closed)'),
    sb.from('quotes').select('id, code, supplier_id, unit_price_cents, quantity, incoterm, lead_time_days, shipping_cents, currency, valid_until, rfqs!inner(code, title, unit, org_id)').in('status', ['sent', 'viewed']).eq('rfqs.org_id', s.org.id).gt('valid_until', new Date().toISOString()).order('unit_price_cents').limit(1).maybeSingle(),
    getSettings(),
    latestTermsId(),
    sb.rpc('current_platform_currency'),
  ]);
  const platformCur = asCurrency(platform as string | null);
  const curFilter = (c: string | null | undefined) => range.currency === 'all' || asCurrency(c) === range.currency;
  const fromTs = range.from ? new Date(range.from) : null;
  const toTs = range.to ? new Date(range.to + 'T23:59:59Z') : null;
  const periodPayments = (payments ?? []).filter((p) => { const t = new Date(p.confirmed_at as string); return (!fromTs || t >= fromTs) && (!toTs || t <= toTs) && curFilter(p.currency as string); });
  const paidPeriod = perCurrency(periodPayments, (p) => p.currency as string, (p) => Number(p.amount_cents));
  const balanceDue = Object.fromEntries(ledger.currencies.map((c) => [c, balOf(ledger.closing, c).receivable])) as Partial<Record<Currency, number>>;
  const walletBal = Object.fromEntries(ledger.currencies.map((c) => [c, balOf(ledger.closing, c).wallet])) as Partial<Record<Currency, number>>;
  const dueNowSum = perCurrency((openOrders ?? []).filter((o) => curFilter(o.currency as string)), (o) => o.currency as string, (o) => {
    const paid = Number(o.paid_cents);
    if (['pi_issued', 'deposit_pending'].includes(o.status as string)) return Math.max(0, Number(o.deposit_cents) - paid);
    if (o.status === 'balance_pending') return Math.max(0, Number(o.total_cents) - paid);
    return 0;
  });
  const anyDue = Object.values(dueNowSum).some((v) => !!v);
  const qSup = quote ? (await supplierMap([quote.supplier_id as string])).get(quote.supplier_id as string) : undefined;
  const qRfq = quote?.rfqs as unknown as { code: string; title: string; unit: string } | undefined;
  const qTotal = quote ? Number(quote.unit_price_cents) * Number(quote.quantity) + Number(quote.shipping_cents) : 0;
  const qCur = asCurrency(quote?.currency as string | undefined);
  const qs = new URLSearchParams(Object.entries({
    from: range.from, to: range.to, account: range.account === 'all' ? undefined : range.account, currency: range.currency === 'all' ? undefined : range.currency,
  }).filter(([, v]) => v) as [string, string][]).toString();
  const showWallet = range.account !== 'receivable';
  const showAr = range.account !== 'wallet';
  const sections = ledger.currencies.length ? ledger.currencies : [range.currency === 'all' ? platformCur : range.currency];

  return (
    <>
      <PageHeader title="Ledger & invoices"
        subtitle={`Your account with ${content.company?.legal_name ?? 'Octopus B2B'}: every invoice, payment and credit, with a running balance per currency. Each amount stays in the currency it was issued in.`} />

      <form method="get" className="flex flex-wrap items-end gap-3 mb-6" aria-label="Filter ledger">
        <div><label htmlFor="from" className="label">From</label><input id="from" name="from" type="date" className="input" defaultValue={range.from} /></div>
        <div><label htmlFor="to" className="label">To</label><input id="to" name="to" type="date" className="input" defaultValue={range.to} /></div>
        <div>
          <label htmlFor="account" className="label">Account</label>
          <select id="account" name="account" className="input" defaultValue={range.account}>
            <option value="all">All accounts</option><option value="receivable">Orders (receivable)</option><option value="wallet">Wallet</option>
          </select>
        </div>
        <div>
          <label htmlFor="currency" className="label">Currency</label>
          <select id="currency" name="currency" className="input" defaultValue={range.currency}>
            <option value="all">All currencies</option>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c} ({CURRENCY_PREFIX[c]})</option>)}
          </select>
        </div>
        <button className="btn btn-dark" type="submit">Apply</button>
        <a className="btn btn-ghost" href={`/account/ledger/statement/print${qs ? `?${qs}` : ''}`} target="_blank" rel="noopener">Statement PDF</a>
        <a className="btn btn-ghost" href={`/account/ledger/statement${qs ? `?${qs}` : ''}`}>Download CSV</a>
      </form>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Stat label="Balance due" value={<MultiMoney values={balanceDue} fallback={platformCur} />} hint="Order value not yet paid" />
        <Stat label="Due now" value={<MultiMoney values={dueNowSum} fallback={platformCur} />} hint="Deposits and issued balance invoices" hintTone={anyDue ? 'warn' : 'ok'} />
        <Stat label="Wallet balance" value={<MultiMoney values={walletBal} fallback={platformCur} />} hint={<Link href="/account/wallet" className="underline">Open wallet</Link>} />
        <Stat label={range.from || range.to ? 'Paid this period' : 'Paid to date'} value={<MultiMoney values={paidPeriod} fallback={platformCur} />} hint={`${periodPayments.length} payments`} />
      </div>

      {quote && qRfq && (
        <Card className="p-6 mb-6">
          <div className="flex flex-wrap justify-between gap-3 mb-3"><h2 className="text-lg font-semibold">Quotation waiting for your approval</h2><StatusBadge status="pending" label="Awaiting your approval" /></div>
          <div className="rounded-[10px] border border-line p-4 flex flex-wrap items-center gap-4 justify-between">
            <div>
              <div className="mono text-xs text-muted">{quote.code} · from {qRfq.code} · valid until {fmtDate(quote.valid_until as string)}{qSup ? ` · Supplier ${qSup.code}${qSup.country ? ` · ${qSup.country}` : ''}` : ''}</div>
              <div className="font-semibold mt-1">{Number(quote.quantity).toLocaleString('en-US')} {qRfq.unit} · {qRfq.title}</div>
              <div className="text-sm text-muted">{money(Number(quote.unit_price_cents), qCur)} per unit · {quote.incoterm}{quote.lead_time_days ? ` · ${quote.lead_time_days} days lead time` : ''}</div>
            </div>
            <div className="text-right"><div className="text-xs text-muted">Total</div><Money cents={qTotal} currency={qCur} className="text-xl" /><div className="text-xs text-muted">{settings.deposit_pct}% deposit {money(Math.round(qTotal * settings.deposit_pct / 100), qCur)}</div></div>
            <div className="flex gap-2">
              <Link href="/account/rfqs" className="btn btn-ghost">View quotations</Link>
              <ApproveQuoteButton quoteId={quote.id as string} quoteCode={quote.code as string} totalCents={qTotal} currency={qCur} depositPct={settings.deposit_pct} termsVersion={terms?.version} action={approveQuote} label="Approve quote and create proforma invoice" className="btn btn-primary" />
            </div>
          </div>
        </Card>
      )}

      {sections.map((cur) => {
        const rows = ledger.rows.filter((r) => r.currency === cur);
        const opening = balOf(ledger.opening, cur);
        const closing = balOf(ledger.closing, cur);
        const totals = ledger.totals[cur] ?? { debit: 0, credit: 0 };
        return (
          <Card key={cur} className="mb-6 overflow-hidden" title={`Account ledger · ${cur} (${CURRENCY_PREFIX[cur]})`}
            action={<span className="text-sm text-muted">Debits increase what you owe on orders; wallet credits are top-ups and refunds.</span>}>
            {rows.length === 0 && !opening.receivable && !opening.wallet ? (
              <EmptyState title={`No ${cur} ledger entries for this period`} body="Entries appear when a proforma invoice is issued, a payment is matched or your wallet is used." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <caption className="sr-only">Ledger entries in {cur}</caption>
                  <thead><tr>{['Date', 'Journal', 'Description', 'Account', 'Currency', 'Debit', 'Credit', 'Balance'].map((h, i) => <th key={h} className={`th ${i >= 5 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                  <tbody>
                    <tr className="bg-surface">
                      <td className="td text-sm">{range.from ? fmtDate(range.from) : '—'}</td>
                      <td className="td font-semibold" colSpan={3}>Opening balance</td>
                      <td className="td mono text-xs">{cur}</td>
                      <td className="td" /><td className="td" />
                      <td className="td text-right mono text-sm font-semibold">
                        {showAr && <div>Orders {money(opening.receivable, cur)}</div>}
                        {showWallet && <div className="text-muted">Wallet {money(opening.wallet, cur)}</div>}
                      </td>
                    </tr>
                    {rows.map((r) => (
                      <tr key={r.id}>
                        <td className="td text-sm whitespace-nowrap">{fmtDate(r.at)}</td>
                        <td className="td mono text-xs">{r.journal}</td>
                        <td className="td text-sm">{r.memo}</td>
                        <td className="td"><StatusBadge status={r.account} tone={r.account === 'wallet' ? 'blue' : 'gray'} label={r.account === 'wallet' ? 'Wallet' : r.account === 'receivable' ? 'Orders' : humanize(r.accountName)} /></td>
                        <td className="td mono text-xs">{r.currency}</td>
                        <td className="td text-right mono text-sm">{r.debit ? money(r.debit, r.currency) : ''}</td>
                        <td className="td text-right mono text-sm text-ok">{r.credit ? money(r.credit, r.currency) : ''}</td>
                        <td className="td text-right mono text-sm font-semibold">{money(r.balance, r.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-navy text-white">
                      <td className="px-4 py-3 font-semibold" colSpan={4}>Closing balance</td>
                      <td className="px-4 py-3 mono text-xs">{cur}</td>
                      <td className="px-4 py-3 text-right mono text-sm">{money(totals.debit, cur)}</td>
                      <td className="px-4 py-3 text-right mono text-sm">{money(totals.credit, cur)}</td>
                      <td className="px-4 py-3 text-right mono text-sm font-semibold">
                        {showAr && <div>Orders due {money(closing.receivable, cur)}</div>}
                        {showWallet && <div className="text-white/80">Wallet {money(closing.wallet, cur)}</div>}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </Card>
        );
      })}

      <Card title="Invoices & documents">
        {(docs ?? []).length === 0 ? <EmptyState title="No documents yet" body="Proforma invoices, commercial invoices, receipts and credit notes appear here." /> : (
          <ul className="px-6 pb-4">
            {(docs ?? []).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 border-t border-line text-sm">
                <span className="mono flex-[1_1_140px]">{d.number}</span>
                <span className="flex-[2_1_220px] text-muted">{DOC_LABEL[d.doc_type as string] ?? humanize(d.doc_type as string)}{(d.orders as unknown as { code: string } | null)?.code ? ` · ${(d.orders as unknown as { code: string }).code}` : ''} · {fmtDate(d.created_at as string)}</span>
                <span className="flex-[1_1_100px]">{d.amount_cents != null ? <Money cents={Number(d.amount_cents)} currency={d.currency as string} /> : '—'}</span>
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
