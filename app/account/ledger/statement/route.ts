import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { getOrgLedger, parseRange, ledgerGroups, CLOSING_LABEL } from '@/components/account/ledger-data';

function csvCell(v: string | number) {
  const s = String(v);
  // neutralise spreadsheet formula injection and quote
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === 'string' ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}
/** Plain decimal in the row's own currency (the Currency column says which). */
const money = (c: number) => (c / 100).toFixed(2);

/** GET /account/ledger/statement?from&to&account&currency → CSV statement (SPEC §4.2 step 3). */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.redirect(new URL('/login?next=/account/ledger', req.url));
  if (!s.org) return new NextResponse('No organisation', { status: 403 });
  const sp = req.nextUrl.searchParams;
  const range = parseRange({ from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined, account: sp.get('account') ?? undefined, currency: sp.get('currency') ?? undefined });
  const ledger = await getOrgLedger(s.org.id, range);
  const { currencies, totals } = ledger;
  const lines: string[] = [];
  const row = (cells: (string | number)[]) => lines.push(cells.map(csvCell).join(','));
  row(['Statement', s.org.name, `From ${range.from}`, `To ${range.to}`, range.currency === 'all' ? 'All currencies' : range.currency]);
  row(['Date', 'Journal', 'Description', 'Account', 'Currency', 'Debit', 'Credit', 'Running balance']);
  // Same grouping as the page and the printable statement: per currency, per account (Orders, Wallet, On hold).
  for (const cur of currencies) {
    for (const g of ledgerGroups(ledger, cur)) {
      row(['', '', 'Opening balance', g.label, cur, '', '', money(g.opening)]);
      for (const r of g.rows) row([r.at.slice(0, 10), r.journal, r.memo, g.label, r.currency, r.debit ? money(r.debit) : '', r.credit ? money(r.credit) : '', money(r.balance)]);
      row(['', '', `Closing balance · ${g.label}`, g.label, cur, money(g.totals.debit), money(g.totals.credit), money(g.closing)]);
    }
    const t = totals[cur] ?? { debit: 0, credit: 0 };
    row(['', '', 'Totals', '', cur, money(t.debit), money(t.credit), '']);
    for (const g of ledgerGroups(ledger, cur)) row(['', '', CLOSING_LABEL[g.kind], g.label, cur, '', '', money(g.closing)]);
  }
  if (!currencies.length) lines.push(['', '', 'No entries for this period', '', '', '', '', ''].map(csvCell).join(','));
  const name = `octopus-statement-${range.currency === 'all' ? '' : `${range.currency.toLowerCase()}-`}${range.from}-${range.to}.csv`;
  return new NextResponse('\uFEFF' + lines.join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' },
  });
}
