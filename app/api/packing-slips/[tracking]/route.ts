import { approvedSellerBrand, blockedResponse, printableShipment } from '@/lib/print-access';
import { DROPSHIP_SLIP_BLOCKED, packingSlipHtml } from '@/lib/dropship-print';
import { createAdminClient } from '@/lib/supabase/server';

/**
 * Printable packing slip for a DROPSHIP parcel (division DS, owner's decision 19 Nov 2026): the seller's brand as the
 * header, ship-to, order code, items and quantities, and the seller's APPROVED return address. Never prices, costs,
 * supplier details or Octopus branding. Same permission checks as the shipping label (staff orders:view + the
 * shipment's division or the 3PL warehouse). Other divisions have no packing slip (404).
 */
type SlipShipment = {
  tracking_no: string | null; created_at: string; division_id: string | null; org_id: string | null;
  orders: { code: string; title: string; quantity: number | null; organizations: unknown } | { code: string; title: string; quantity: number | null; organizations: unknown }[] | null;
};
export async function GET(_req: Request, { params }: { params: Promise<{ tracking: string }> }) {
  const { tracking } = await params;
  const got = await printableShipment<SlipShipment>(tracking,
    'tracking_no, created_at, division_id, org_id, orders(code, title, quantity, organizations(id, name, city, country))',
    { signIn: 'Sign in to print packing slips', forbidden: 'Packing slips are printed by the warehouse team.', notFound: 'Packing slip not found' });
  if ('res' in got) return got.res;
  const { sb, sh, dsDivisionId } = got;
  if (!sh.division_id || sh.division_id !== dsDivisionId) return new Response('Packing slips are printed for dropship parcels only', { status: 404 });
  const brand = await approvedSellerBrand(sb, sh.org_id);
  if (!brand) return blockedResponse(DROPSHIP_SLIP_BLOCKED);
  const o = Array.isArray(sh.orders) ? sh.orders[0] : sh.orders;
  const org = (Array.isArray(o?.organizations) ? o?.organizations[0] : o?.organizations) as { id: string; name: string; city: string | null; country: string | null } | null;
  const { data: addr } = org
    ? await sb.from('addresses').select('line1, line2, city, region, postal_code, country').eq('org_id', org.id).order('is_default', { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  // Step 13: the merchant's optional logo (only if they chose it for packing slips), returns policy and support email
  const { data: extra } = await sb.rpc('ds_brand_for_org', { p_org: sh.org_id });
  const ex = (extra ?? null) as { logo_path: string | null; returns_policy: string | null; support_email: string | null } | null;
  let logoUrl: string | null = null;
  if (ex?.logo_path) {
    try {
      logoUrl = (await createAdminClient().storage.from('dropship-branding').createSignedUrl(ex.logo_path, 600)).data?.signedUrl ?? null;
    } catch {
      logoUrl = null;
    }
  }
  const html = packingSlipHtml({
    brand,
    orderCode: o?.code ?? null,
    date: new Date(sh.created_at).toISOString().slice(0, 10),
    tracking: sh.tracking_no,
    shipTo: { name: org?.name ?? null, ...(addr ?? { city: org?.city, country: org?.country }) },
    items: o ? [{ description: o.title, quantity: o.quantity }] : [],
    extras: { logoUrl, returnsPolicy: ex?.returns_policy ?? null, supportEmail: ex?.support_email ?? null },
  });
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
}
