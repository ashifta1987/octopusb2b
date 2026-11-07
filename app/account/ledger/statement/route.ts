import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { getOrgLedger, parseRange, balOf } from '@/components/account/ledger-data';

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
  const { rows, currencies, opening, closing, totals } = await getOrgLedger(s.org.id, range);
  const lines: string[] = [];
  const acctLabel = (k: string, name: string) => (k === 'wallet' ? 'Wallet' : k === 'receivable' ? 'Orders (receivable)' : name);
  lines.push(['Statement', s.org.name, `From ${range.from ?? 'start'}`, `To ${range.to ?? 'today'}`, range.currency === 'all' ? 'All currencies' : range.currency].map(csvCell).join(','));
  lines.push(['Date', 'Journal', 'Description', 'Account', 'Currency', 'Debit', 'Credit', 'Running balance'].map(csvCell).join(','));
  // One block per currency: balances and totals are never summed across currencies (SPEC §15.1).
  for (const cur of currencies) {
    const o = balOf(opening, cur), c = balOf(closing, cur), t = totals[cur] ?? { debit: 0, credit: 0 };
    if (range.account !== 'wallet') lines.push(['', '', 'Opening balance', 'Orders (receivable)', cur, '', '', money(o.receivable)].map(csvCell).join(','));
    if (range.account !== 'receivable') lines.push(['', '', 'Opening balance', 'Wallet', cur, '', '', money(o.wallet)].map(csvCell).join(','));
    for (const r of rows.filter((x) => x.currency === cur)) {
      lines.push([r.at.slice(0, 10), r.journal, r.memo, acctLabel(r.account, r.accountName), r.currency,
        r.debit ? money(r.debit) : '', r.credit ? money(r.credit) : '', money(r.balance)].map(csvCell).join(','));
    }
    lines.push(['', '', `Total ${cur}`, '', cur, money(t.debit), money(t.credit), ''].map(csvCell).join(','));
    if (range.account !== 'wallet') lines.push(['', '', 'Closing balance', 'Orders (receivable)', cur, '', '', money(c.receivable)].map(csvCell).join(','));
    if (range.account !== 'receivable') lines.push(['', '', 'Closing balance', 'Wallet', cur, '', '', money(c.wallet)].map(csvCell).join(','));
  }
  if (!currencies.length) lines.push(['', '', 'No entries for this period', '', '', '', '', ''].map(csvCell).join(','));
  const name = `octopus-statement-${range.currency === 'all' ? '' : `${range.currency.toLowerCase()}-`}${range.from}-${range.to}.csv`;
  return new NextResponse('\uFEFF' + lines.join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' },
  });
}
