import { createClient } from '@/lib/supabase/server';
import { commercialInvoicePdf, type CommercialInvoice } from '@/lib/carriers/commercial-invoice';

/**
 * GET /api/labels/commercial-invoice/{shipment} — CONN S4: the commercial invoice PDF of a Warehouse OS label. Runs as the signed-in
 * staff member: c4_commercial_invoice checks the warehouse and the dispatch role, refuses voided / domestic labels and Dropship
 * parcels whose brand is not approved (white-label), and audits the print.
 */
const page = (status: number, title: string, text: string) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:sans-serif;padding:24px"><h1 style="font-size:18px">${title}</h1><p>${text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</p></body></html>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return page(404, 'Not found', 'This label does not exist.');
  const sb = await createClient();
  const { data, error } = await sb.rpc('c4_commercial_invoice', { p_shipment: id });
  if (error) {
    const [code, ...rest] = error.message.split(':');
    const text = rest.join(':').trim();
    if (code === 'NOT_NEEDED') return page(409, 'No commercial invoice needed', text);
    if (code === 'BRAND_NOT_APPROVED') return page(409, 'Commercial invoice blocked', text);
    if (code === 'VOIDED' || code === 'NO_CUSTOMS') return page(409, 'No commercial invoice', text);
    return page(404, 'Not found', 'This label does not exist or you cannot print it.');
  }
  const ci = data as CommercialInvoice;
  return new Response(Buffer.from(commercialInvoicePdf(ci)), {
    status: 200,
    headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${ci.number}.pdf"`, 'Cache-Control': 'private, no-store' },
  });
}
