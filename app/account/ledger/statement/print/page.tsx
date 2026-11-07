import { requireCustomer } from '@/lib/auth';
import { getSiteContent } from '@/lib/content';
import { Notice } from '@/components/ui';
import { fmtDate, money, CURRENCY_PREFIX } from '@/lib/format';
import { getOrgLedger, parseRange, ledgerGroups, CLOSING_LABEL } from '@/components/account/ledger-data';
import { LedgerTable } from '@/components/account/ledger-table';
import { PrintButton } from '@/components/account/print-button';

export const metadata = { title: 'Account statement' };

/** Printable statement (browser "Save as PDF"). Hides the portal chrome when printing. */
export default async function StatementPrint({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; account?: string; currency?: string; print?: string }> }) {
  const s = await requireCustomer('/account/ledger/statement/print');
  if (!s.org) return <Notice tone="amber">Complete your company profile first.</Notice>;
  const sp = await searchParams;
  const range = parseRange(sp);
  const [ledger, content] = await Promise.all([getOrgLedger(s.org.id, range), getSiteContent()]);
  const { currencies, totals } = ledger;
  const c = content.company;
  return (
    <div className="statement bg-white mx-auto max-w-[210mm] p-[14mm] text-[13px] text-navy shadow-sm print:shadow-none">
      <style>{`
        @page { size: A4; margin: 12mm; }
        @media print {
          body { background: #fff !important; }
          body header, body nav, body aside, .no-print { display: none !important; }
          body main { padding: 0 !important; }
          .statement { padding: 0 !important; max-width: none !important; }
        }
      `}</style>
      <div className="no-print flex justify-end gap-2 mb-6"><PrintButton autoPrint={sp.print === '1'} /></div>
      <div className="flex flex-wrap justify-between gap-6">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="Octopus B2B" className="h-10 w-auto" />
          <h1 className="text-2xl font-bold mt-4">ACCOUNT STATEMENT</h1>
          <p className="text-muted">{fmtDate(range.from)} – {fmtDate(range.to)} · {range.currency === 'all' ? (currencies.length ? currencies.join(' + ') : 'No entries') : range.currency} · amounts in each account&apos;s own currency</p>
        </div>
        <div className="text-xs leading-relaxed max-w-[300px]">
          <div className="font-semibold text-sm">{c?.legal_name}</div>
          <div className="text-muted">{c?.address}</div>
          <div className="text-muted">{[c?.phone, c?.email].filter(Boolean).join(' · ')}</div>
        </div>
      </div>
      <div className="mt-6 rounded-[10px] bg-surface p-4 grid grid-cols-2 gap-4">
        <div><div className="mono text-[10px] uppercase tracking-wider text-muted">Account holder</div><div className="font-semibold">{s.org.name}</div><div className="text-muted">{[s.org.city, s.org.country].filter(Boolean).join(', ')}</div></div>
        <div className="text-right">
          <div className="mono text-[10px] uppercase tracking-wider text-muted">Closing balances</div>
          {currencies.map((cur) => ledgerGroups(ledger, cur).map((g) => (
            <div key={cur + g.kind}>{CLOSING_LABEL[g.kind]} ({cur}) <strong className="mono">{money(g.closing, cur)}</strong></div>
          )))}
        </div>
      </div>
      {currencies.length === 0 && <p className="mt-6 py-6 text-center text-muted border-y border-line">No entries in this period.</p>}
      {currencies.map((cur) => (
        <section key={cur} className="mt-6">
          <h2 className="text-sm font-bold">{cur} ({CURRENCY_PREFIX[cur]}) accounts</h2>
          <LedgerTable groups={ledgerGroups(ledger, cur)} cur={cur} from={range.from} totals={totals[cur] ?? { debit: 0, credit: 0 }} />
        </section>
      ))}
      <p className="mt-6 text-xs text-muted">Orders balance = invoices issued minus payments received. On hold = money held for work in progress. Wallet balance = top-ups and refunds minus service fees and wallet payments. Balances in different currencies are never added together. Generated {fmtDate(new Date(), true)} for {s.email ?? s.org.name}.</p>
    </div>
  );
}
