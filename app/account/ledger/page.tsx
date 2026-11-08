import { Suspense } from 'react';
import { PageSkeleton } from '@/components/shell/skeletons';
import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getSiteContent } from '@/lib/content';
import { PageHeader, Card, Stat, StatusBadge, EmptyState, Notice, Money } from '@/components/ui';
import { fmtDate, money, asCurrency, CURRENCIES, CURRENCY_PREFIX, type Currency } from '@/lib/format';
import { getSettings, latestTermsId, supplierMap } from '@/components/account/data';
import { getOrgLedger, parseRange, balOf, ledgerGroups } from '@/components/account/ledger-data';
import { getAmountsDue } from '@/lib/core/amounts-due';
import { LedgerTable } from '@/components/account/ledger-table';
import { ApproveQuoteButton } from '@/components/account/approve-quote';
import { approveQuote } from '../rfqs/actions';

export const metadata = { title: 'Ledger and statements' };

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

async function LedgerContent({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; account?: string; currency?: string }> }) {
  const s = await requireCustomer('/account/ledger');
  if (!s.org) return <Notice tone="amber">Complete your company profile first.</Notice>;
  const range = parseRange(await searchParams);
  const sb = await createClient();
  const [ledger, full, due, content, { data: payments }, { data: quote }, settings, terms, { data: platform }] = await Promise.all([
    getOrgLedger(s.org.id, range),
    // the summary cards always use every account, whatever the account filter
    range.account === 'all' ? Promise.resolve(null) : getOrgLedger(s.org.id, { ...range, account: 'all' }),
    getAmountsDue(s.org.id),
    getSiteContent(),
    sb.from('payments').select('amount_cents, currency, confirmed_at, status').eq('org_id', s.org.id).eq('status', 'confirmed'),
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
  const all = full ?? ledger;
  const balanceDue = Object.fromEntries(all.currencies.map((c) => [c, balOf(all.closing, c).receivable])) as Partial<Record<Currency, number>>;
  const walletBal = Object.fromEntries(all.currencies.map((c) => [c, balOf(all.closing, c).wallet])) as Partial<Record<Currency, number>>;
  // one definition with the Invoices page "Awaiting payment" total: order deposits/balances due + service proformas awaiting payment
  const dueNowSum = Object.fromEntries(Object.entries(due.byCurrency).filter(([c]) => curFilter(c))) as Partial<Record<Currency, number>>;
  const anyDue = Object.values(dueNowSum).some((v) => !!v);
  const qSup = quote ? (await supplierMap([quote.supplier_id as string])).get(quote.supplier_id as string) : undefined;
  const qRfq = quote?.rfqs as unknown as { code: string; title: string; unit: string } | undefined;
  const qTotal = quote ? Number(quote.unit_price_cents) * Number(quote.quantity) + Number(quote.shipping_cents) : 0;
  const qCur = asCurrency(quote?.currency as string | undefined);
  const hasRows = ledger.rows.length > 0;
  const qs = new URLSearchParams(Object.entries({
    from: range.from, to: range.to, account: range.account === 'all' ? undefined : range.account, currency: range.currency === 'all' ? undefined : range.currency,
  }).filter(([, v]) => v) as [string, string][]).toString();
  const sections = ledger.currencies.length ? ledger.currencies : [range.currency === 'all' ? platformCur : range.currency];

  return (
    <>
      <PageHeader title={<>Ledger and statements <span className="block sm:inline text-[18px] sm:text-[20px] font-semibold text-muted" data-testid="ledger-period">· {fmtDate(range.from)} – {fmtDate(range.to)}</span></>}
        subtitle={<>Your account with {content.company?.legal_name ?? 'Octopus B2B'}: every charge, payment and credit, with a running balance per currency. Invoices and receipts are on <Link href="/account/invoices" className="text-coral-text font-semibold">Invoices and receipts</Link>.</>} />

      <form method="get" className="flex flex-wrap items-end gap-3 mb-6" aria-label="Filter ledger">
        <div><label htmlFor="from" className="label">From</label><input id="from" name="from" type="date" className="input" defaultValue={range.from} /></div>
        <div><label htmlFor="to" className="label">To</label><input id="to" name="to" type="date" className="input" defaultValue={range.to} /></div>
        <div>
          <label htmlFor="account" className="label">Account</label>
          <select id="account" name="account" className="input" defaultValue={range.account}>
            <option value="all">All accounts</option><option value="receivable">Orders</option><option value="wallet">Wallet</option><option value="hold">Customer funds on hold</option>
          </select>
        </div>
        <div>
          <label htmlFor="currency" className="label">Currency</label>
          <select id="currency" name="currency" className="input" defaultValue={range.currency}>
            <option value="all">All currencies</option>
            {/* only currencies this company actually has entries in (e.g. CNY appears only after a CNY entry) */}
            {(ledger.available.length ? ledger.available : [platformCur]).map((c) => <option key={c} value={c}>{c} ({CURRENCY_PREFIX[c]})</option>)}
          </select>
        </div>
        <button className="btn btn-dark" type="submit">Apply</button>
        {hasRows ? (
          <>
            <a className="btn btn-ghost" href={`/account/ledger/statement/print${qs ? `?${qs}` : ''}`} target="_blank" rel="noopener" data-testid="export-pdf">Statement PDF</a>
            <a className="btn btn-ghost" href={`/account/ledger/statement${qs ? `?${qs}` : ''}`} data-testid="export-csv">Download CSV</a>
          </>
        ) : (
          <>
            <span className="btn btn-ghost opacity-50 cursor-not-allowed" aria-disabled="true" title="No entries in this period" data-testid="export-pdf">Statement PDF</span>
            <span className="btn btn-ghost opacity-50 cursor-not-allowed" aria-disabled="true" title="No entries in this period" data-testid="export-csv">Download CSV</span>
            <span className="text-[13px] text-muted self-center">No entries in this period to export.</span>
          </>
        )}
      </form>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <div data-testid="balance-due"><Stat label="Balance due" value={<MultiMoney values={balanceDue} fallback={platformCur} />} hint="Invoiced and not yet paid" /></div>
        <div data-testid="due-now"><Stat label="Due now" value={<MultiMoney values={dueNowSum} fallback={platformCur} />} hint="Deposits, balances and proformas awaiting payment" hintTone={anyDue ? 'warn' : 'ok'} /></div>
        <Stat label="Wallet balance" value={<MultiMoney values={walletBal} fallback={platformCur} />} hint={<Link href="/account/wallet" className="inline-flex items-center min-h-11 underline">Open wallet</Link>} />
        <Stat label={range.from || range.to ? 'Paid this period' : 'Paid to date'} value={<MultiMoney values={paidPeriod} fallback={platformCur} />} hint={`${periodPayments.length} order payments · wallet top-ups are in the ledger below`} />
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
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <Link href="/account/sourcing" className="btn btn-ghost">View quotations</Link>
              <ApproveQuoteButton quoteId={quote.id as string} quoteCode={quote.code as string} totalCents={qTotal} currency={qCur} depositPct={settings.deposit_pct} termsVersion={terms?.version} action={approveQuote} label="Approve quote and create proforma invoice" className="btn btn-primary whitespace-normal text-left leading-snug py-2.5 max-w-full" />
            </div>
          </div>
        </Card>
      )}

      {sections.map((cur) => (
        <Card key={cur} className="mb-6 overflow-hidden" title={`Account ledger · ${cur} (${CURRENCY_PREFIX[cur]})`}
          action={<span className="text-sm text-muted">Each account has its own opening, running and closing balance.</span>}>
          {ledgerGroups(ledger, cur).length === 0 ? (
            <EmptyState title={`No ${cur} ledger entries for this period`} body="Entries appear when an invoice is issued, a payment or transfer is confirmed, or money is held for work." />
          ) : <LedgerTable groups={ledgerGroups(ledger, cur)} cur={cur} from={range.from} totals={ledger.totals[cur] ?? { debit: 0, credit: 0 }} />}
        </Card>
      ))}

    </>
  );
}

/** Request-time content streams inside Suspense; the placeholder has the shape of the page. */
export default function LedgerPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; account?: string; currency?: string }> }) {
  return <Suspense fallback={<PageSkeleton cards={4} />}><LedgerContent searchParams={searchParams} /></Suspense>;
}
