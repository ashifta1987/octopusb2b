import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getInvoices } from '@/lib/dropship-ds14';
import { csvLine } from '@/lib/dropship-ds14-shared';

/** CSV of the filtered invoice list (same RPC and filters as the page; spreadsheet-safe cells, up to 2,000 rows). Finance / Dropship staff only (the RPC checks). */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || !s.isStaff) return new NextResponse('Staff only', { status: 403 });
  const u = new URL(req.url).searchParams;
  try {
    const d = await getInvoices({ type: u.get('type') ?? '', q: u.get('q') ?? '', from: u.get('from') ?? '', to: u.get('to') ?? '', status: u.get('status') ?? '', limit: 2000 });
    const head = csvLine(['Number', 'Type', 'Date', 'Merchant', 'Amount', 'Currency', 'Status', 'Kind']);
    const lines = d.rows.map((r) => csvLine([r.number, r.type, r.created_at.slice(0, 10), r.merchant ?? '', r.amount_cents == null ? '' : (r.amount_cents / 100).toFixed(2), r.currency, r.status ?? '', r.kind ?? '']));
    return new NextResponse(`${[head, ...lines].join('\n')}\n`, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="octopus-ds-invoices.csv"', 'Cache-Control': 'private, no-store' } });
  } catch {
    return new NextResponse('You do not have access to invoicing', { status: 403 });
  }
}
