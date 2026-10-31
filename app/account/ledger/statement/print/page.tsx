import { requireCustomer } from '@/lib/auth';
import { getSiteContent } from '@/lib/content';
import { Notice } from '@/components/ui';
import { fmtDate, money, CURRENCY_PREFIX } from '@/lib/format';
import { getOrgLedger, parseRange, balOf } from '@/components/account/ledger-data';
import { PrintButton } from '@/components/account/print-button';

export const metadata = { title: 'Account statement' };

/** Printable statement (browser "Save as PDF"). Hides the portal chrome when printing. */
export default async function StatementPrint({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; account?: string; currency?: string; print?: string }> }) {
  const s = await requireCustomer('/account/ledger/statement/print');
  if (!s.org) return <Notice tone="amber">Complete your company profile first.</Notice>;
  const sp = await searchParams;
  const range = parseRange(sp);
  const [{ rows, currencies, opening, closing, totals }, content] = await Promise.all([getOrgLedger(s.org.id, range), getSiteContent()]);
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
          <p className="text-muted">{range.from ? fmtDate(range.from) : 'Start'} – {range.to ? fmtDate(range.to) : fmtDate(new Date())} · {range.currency === 'all' ? (currencies.length ? currencies.join(' + ') : 'No entries') : range.currency} · amounts in each account&apos;s own currency</p>
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
          {currencies.map((cur) => (
            <div key={cur}>
              {range.account !== 'wallet' && <div>Orders due ({cur}) <strong className="mono">{money(balOf(closing, cur).receivable, cur)}</strong></div>}
              {range.account !== 'receivable' && <div>Wallet ({cur}) <strong className="mono">{money(balOf(closing, cur).wallet, cur)}</strong></div>}
            </div>
          ))}
        </div>
      </div>
      {currencies.length === 0 && <p className="mt-6 py-6 text-center text-muted border-y border-line">No entries in this period.</p>}
      {currencies.map((cur) => {
        const list = rows.filter((r) => r.currency === cur);
        const o = balOf(opening, cur), c2 = balOf(closing, cur), t = totals[cur] ?? { debit: 0, credit: 0 };
        return (
          <section key={cur} className="mt-6 break-inside-avoid-page">
            <h2 className="text-sm font-bold">{cur} ({CURRENCY_PREFIX[cur]}) accounts</h2>
            <table className="w-full mt-2 border-collapse">
              <thead>
                <tr className="border-b-2 border-navy text-[10px] uppercase tracking-wider mono">
                  <th className="text-left py-2">Date</th><th className="text-left py-2">Journal</th><th className="text-left py-2">Description</th><th className="text-left py-2">Account</th>
                  <th className="text-left py-2">Cur.</th><th className="text-right py-2">Debit</th><th className="text-right py-2">Credit</th><th className="text-right py-2">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line bg-surface">
                  <td className="py-2" colSpan={4}><strong>Opening balance</strong></td>
                  <td className="py-2 mono text-xs">{cur}</td><td /><td />
                  <td className="py-2 text-right mono text-xs">
                    {range.account !== 'wallet' && <div>Orders {money(o.receivable, cur)}</div>}
                    {range.account !== 'receivable' && <div>Wallet {money(o.wallet, cur)}</div>}
                  </td>
                </tr>
                {list.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-muted">No {cur} entries in this period.</td></tr>}
                {list.map((r) => (
                  <tr key={r.id} className="border-b border-line align-top">
                    <td className="py-2 whitespace-nowrap">{fmtDate(r.at)}</td>
                    <td className="py-2 mono text-xs">{r.journal}</td>
                    <td className="py-2">{r.memo}</td>
                    <td className="py-2">{r.account === 'wallet' ? 'Wallet' : r.account === 'receivable' ? 'Orders' : r.accountName}</td>
                    <td className="py-2 mono text-xs">{r.currency}</td>
                    <td className="py-2 text-right mono">{r.debit ? money(r.debit, r.currency) : ''}</td>
                    <td className="py-2 text-right mono">{r.credit ? money(r.credit, r.currency) : ''}</td>
                    <td className="py-2 text-right mono font-semibold">{money(r.balance, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-navy text-white" style={{ printColorAdjust: 'exact', WebkitPrintColorAdjust: 'exact' }}>
                  <td className="p-2 font-semibold" colSpan={4}>Totals / closing · {cur}</td>
                  <td className="p-2 mono text-xs">{cur}</td>
                  <td className="p-2 text-right mono">{money(t.debit, cur)}</td>
                  <td className="p-2 text-right mono">{money(t.credit, cur)}</td>
                  <td className="p-2 text-right mono text-xs">
                    {range.account !== 'wallet' && <div>Orders {money(c2.receivable, cur)}</div>}
                    {range.account !== 'receivable' && <div>Wallet {money(c2.wallet, cur)}</div>}
                  </td>
                </tr>
              </tfoot>
            </table>
          </section>
        );
      })}
      <p className="mt-6 text-xs text-muted">Orders balance = proforma invoices issued minus payments received. Wallet balance = top-ups and refunds minus service fees and wallet payments. Balances in different currencies are never added together. Generated {fmtDate(new Date(), true)} for {s.email ?? s.org.name}.</p>
    </div>
  );
}
