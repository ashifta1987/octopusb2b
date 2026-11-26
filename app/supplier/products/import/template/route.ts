import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { templateCsv } from '@/lib/dropship-ds14-shared';

/** Bulk upload template: the header row only (the design lists the columns; no example data is shipped). Supplier accounts only. */
export async function GET() {
  const s = await getSession();
  if (!s || !s.roles.includes('supplier')) return new NextResponse('Sign in with your supplier account', { status: 401 });
  return new NextResponse(templateCsv(), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="octopus-supplier-products-template.csv"', 'Cache-Control': 'private, no-store' } });
}
