import { NextResponse, type NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { toCsv } from '@/lib/dropship-ds12-shared';
import { PRODUCT_FEED_HEADERS, TRACKING_CSV_HEADERS } from '@/lib/connectors/csv';
import { minorToDecimal, toInternalShipment } from '@/lib/connectors/formats';
import { getProductFeed, getTrackingExport } from '@/lib/dropship-c0';

/**
 * GET /account/dropship/integrations/file/export?kind=products|tracking[&from=YYYY-MM-DD&to=YYYY-MM-DD] — C0 file connector downloads.
 * products: the merchant's own copy (DS model numbers, the merchant's titles / SKUs / prices), never supplier names or Octopus cost.
 * tracking: shipped store orders; company from carrier_tracking_names ("Other" when not set), link = the merchant-branded /t/ page.
 * Each RPC checks the organisation, the feature and the team role. CSV cells are formula-safe (toCsv).
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL('/login?next=/account/dropship/integrations/file', req.url));
  if (!session.org) return new NextResponse('No organisation', { status: 403 });
  const kind = req.nextUrl.searchParams.get('kind') ?? '';
  let csv: string;
  try {
    if (kind === 'products') {
      const rows = await getProductFeed();
      csv = toCsv(PRODUCT_FEED_HEADERS, rows.map((r) => [r.model_no, r.sku, r.variant_model_no, r.title, r.description, r.option_text ?? '',
        r.price_minor == null || !r.currency ? '' : minorToDecimal(r.price_minor, r.currency), r.compare_at_minor == null || !r.currency ? '' : minorToDecimal(r.compare_at_minor, r.currency),
        r.currency ?? '', r.weight_g ?? '', r.product_type ?? '', r.vendor ?? '', r.tags ?? '']));
    } else if (kind === 'tracking') {
      const from = req.nextUrl.searchParams.get('from');
      const to = req.nextUrl.searchParams.get('to');
      const rows = await getTrackingExport(from && DATE.test(from) ? from : null, to && DATE.test(to) ? to : null);
      csv = toCsv(TRACKING_CSV_HEADERS, rows.map((r) => {
        const s = toInternalShipment(r, req.nextUrl.origin);
        return [s.externalOrderId ?? '', s.externalOrderName ?? '', s.storeOrderNumber, s.trackingNumbers.join(' '), s.trackingCompany, s.trackingUrl ?? '', String(s.shippedAt ?? '').slice(0, 19).replace('T', ' ')];
      }));
    } else {
      return new NextResponse('Choose products or tracking.', { status: 400 });
    }
  } catch {
    return new NextResponse('This file is not available for this account.', { status: 403 });
  }
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="dropship-${kind}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
