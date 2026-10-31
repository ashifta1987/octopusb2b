import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { getOrgLedger, parseRange } from '@/components/account/ledger-data';

function csvCell(v: string | number) {
  const s = String(v);
  // neutralise spreadsheet formula injection and quote
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === 'string' ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}
const money = (c: number) => (c / 100).toFixed(2);

/** GET /account/ledger/statement?from&to&account → CSV statement (SPEC §4.2 step 3). */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.redirect(new URL('/login?next=/account/ledger', req.url));
  if (!s.org) return new NextResponse('No organisation', { status: 403 });
  const sp = req.nextUrl.searchParams;
  const range = parseRange({ from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined, account: sp.get('account') ?? undefined });
  const { rows, opening, closing } = await getOrgLedger(s.org.id, range);
  const lines: string[] = [];
  lines.push(['Statement', s.org.name, `From ${range.from ?? 'start'}`, `To ${range.to ?? 'today'}`, 'USD'].map(csvCell).join(','));
  lines.push(['Date', 'Journal', 'Description', 'Account', 'Debit (USD)', 'Credit (USD)', 'Running balance (USD)'].map(csvCell).join(','));
  if (range.account !== 'wallet') lines.push(['', '', 'Opening balance', 'Orders (receivable)', '', '', money(opening.receivable)].map(csvCell).join(','));
  if (range.account !== 'receivable') lines.push(['', '', 'Opening balance', 'Wallet', '', '', money(opening.wallet)].map(csvCell).join(','));
  for (const r of rows) {
    lines.push([r.at.slice(0, 10), r.journal, r.memo, r.account === 'wallet' ? 'Wallet' : r.account === 'receivable' ? 'Orders (receivable)' : r.accountName,
      r.debit ? money(r.debit) : '', r.credit ? money(r.credit) : '', money(r.balance)].map(csvCell).join(','));
  }
  if (range.account !== 'wallet') lines.push(['', '', 'Closing balance', 'Orders (receivable)', '', '', money(closing.receivable)].map(csvCell).join(','));
  if (range.account !== 'receivable') lines.push(['', '', 'Closing balance', 'Wallet', '', '', money(closing.wallet)].map(csvCell).join(','));
  const name = `octopus-statement-${range.from ?? 'all'}-${range.to ?? new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse('\uFEFF' + lines.join('\r\n') + '\r\n', {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'private, no-store' },
  });
}
