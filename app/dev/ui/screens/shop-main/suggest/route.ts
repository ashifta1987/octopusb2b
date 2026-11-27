import { NextResponse, type NextRequest } from 'next/server';
import { isStaging } from '@/lib/core/account';
import { buildSuggestGroups, clampLimit, cleanQuery } from '@/app/ods/shop/_lib/suggest';
import { SAMPLE_SUGGEST_SOURCES } from '../sample-data';

/** Staging-only: the same suggestion shape as /api/shop/suggest, from SAMPLE data (the fixture can't sign in). */
export async function GET(req: NextRequest) {
  if (!isStaging()) return new NextResponse(null, { status: 404 });
  const q = cleanQuery(req.nextUrl.searchParams.get('q'));
  const products = SAMPLE_SUGGEST_SOURCES.products.filter((p) => p.title.toLowerCase().includes(q.toLowerCase()));
  const groups = buildSuggestGroups(q, { ...SAMPLE_SUGGEST_SOURCES, products }, clampLimit(req.nextUrl.searchParams.get('limit')));
  return NextResponse.json({ groups }, { headers: { 'Cache-Control': 'private, no-store' } });
}
