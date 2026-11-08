import { fmtDate, money, type Currency } from '@/lib/format';
import { CLOSING_LABEL, type LedgerGroup } from './ledger-data';

/**
 * Ledger of one currency, grouped by account (Orders, Wallet, Customer funds on hold): each group has its own opening
 * balance, running balance and closing balance. Then "Totals" (debit and credit sums) and the closing balance of each account.
 * Amounts and journal numbers never wrap; on a phone the table scrolls sideways.
 */
export function LedgerTable({ groups, cur, from, totals }: { groups: LedgerGroup[]; cur: Currency; from: string; totals: { debit: number; credit: number } }) {
  const nw = 'whitespace-nowrap';
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`Ledger ${cur}, scrolls sideways`} data-testid={`ledger-${cur}`}>
      <table className="w-full min-w-[820px] border-collapse">
        <caption className="sr-only">Ledger entries in {cur}, grouped by account</caption>
        <thead><tr>{['Date', 'Journal', 'Description', 'Debit', 'Credit', 'Balance'].map((h, i) => <th key={h} className={`th ${i >= 3 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
        {groups.map((g) => (
          <tbody key={g.kind} data-account={g.kind}>
            <tr><th colSpan={6} scope="rowgroup" className="text-left px-4 pt-5 pb-2 text-[15px] font-bold text-ink border-t-2 border-ink">{g.label}</th></tr>
            <tr className="bg-pearl" data-row="opening">
              <td className={`td text-sm ${nw}`}>{fmtDate(from)}</td>
              <td className="td font-semibold" colSpan={2}>Opening balance</td>
              <td className="td" /><td className="td" />
              <td className={`td text-right mono text-sm font-semibold ${nw}`}>{money(g.opening, cur)}</td>
            </tr>
            {g.rows.map((r) => (
              <tr key={r.id} data-row="entry">
                <td className={`td text-sm ${nw}`}>{fmtDate(r.at)}</td>
                <td className={`td mono text-xs ${nw}`}>{r.journal}</td>
                <td className="td text-sm min-w-[260px]">{r.memo}</td>
                <td className={`td text-right mono text-sm ${nw}`}>{r.debit ? money(r.debit, cur) : ''}</td>
                <td className={`td text-right mono text-sm text-ok ${nw}`}>{r.credit ? money(r.credit, cur) : ''}</td>
                <td className={`td text-right mono text-sm font-semibold ${nw}`}>{money(r.balance, cur)}</td>
              </tr>
            ))}
            <tr className="border-b border-line" data-row="closing">
              <td className="td" /><td className="td font-semibold" colSpan={2}>Closing balance · {g.label}</td>
              <td className={`td text-right mono text-sm ${nw}`}>{money(g.totals.debit, cur)}</td>
              <td className={`td text-right mono text-sm ${nw}`}>{money(g.totals.credit, cur)}</td>
              <td className={`td text-right mono text-sm font-bold ${nw}`} data-closing={g.kind}>{money(g.closing, cur)}</td>
            </tr>
          </tbody>
        ))}
        <tfoot>
          <tr className="bg-ink text-white" data-row="totals">
            <td className="px-4 py-3 font-semibold" colSpan={3}>Totals</td>
            <td className={`px-4 py-3 text-right mono text-sm ${nw}`}>{money(totals.debit, cur)}</td>
            <td className={`px-4 py-3 text-right mono text-sm ${nw}`}>{money(totals.credit, cur)}</td>
            <td className="px-4 py-3" />
          </tr>
          {groups.map((g) => (
            <tr key={g.kind} className="bg-ink text-white" data-row="closing-summary">
              <td className="px-4 py-2.5" colSpan={5}>{CLOSING_LABEL[g.kind]}</td>
              <td className={`px-4 py-2.5 text-right mono text-sm font-semibold ${nw}`}>{money(g.closing, cur)}</td>
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}
