import 'server-only';
import { can, getSession } from '@/lib/auth';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import type { SellerBrand } from '@/lib/dropship-print';

type Admin = ReturnType<typeof createAdminClient>;

/**
 * Who may print a shipment's paperwork (shipping label, packing slip): staff with orders:view, AND either in the
 * shipment's division or in the 3PL warehouse (it packs every division's shipments); company-wide roles pass both.
 * The service-role read skips row-level security, so the division is checked here (divisions, 19 Nov 2026).
 * Returns the shipment row selected with `columns` (must include division_id), or a Response to send back.
 */
export async function printableShipment<T extends { division_id: string | null }>(
  tracking: string, columns: string, msg: { signIn: string; forbidden: string; notFound: string },
): Promise<{ sb: Admin; sh: T; dsDivisionId: string | null } | { res: Response }> {
  const s = await getSession();
  if (!s) return { res: new Response(msg.signIn, { status: 401 }) };
  if (!s.isStaff || !can(s, 'orders', 'view')) return { res: new Response(msg.forbidden, { status: 403 }) };
  const sb = createAdminClient(); // permission checked above
  const { data: sh } = await sb.from('shipments').select(columns).eq('tracking_no', tracking).maybeSingle();
  if (!sh) return { res: new Response(msg.notFound, { status: 404 }) };
  const row = sh as unknown as T;
  const { data: divs } = await sb.from('divisions').select('id, code').in('code', ['3PL', 'DS']);
  const idOf = (c: string) => divs?.find((d) => d.code === c)?.id ?? null;
  const user = await createClient();
  const [{ data: own }, { data: warehouse }] = await Promise.all([
    user.rpc('in_division', { p_division: row.division_id }),
    user.rpc('in_division', { p_division: idOf('3PL'), p_roles: ['warehouse', 'manager'] }),
  ]);
  if (!own && !warehouse) return { res: new Response(msg.notFound, { status: 404 }) };
  return { sb, sh: row, dsDivisionId: idOf('DS') };
}

/** The seller's brand + return address, only when Dropshipping staff have APPROVED it (migration 196). */
export async function approvedSellerBrand(sb: Admin, orgId: string | null | undefined): Promise<SellerBrand | null> {
  if (!orgId) return null;
  const { data } = await sb.from('dropship_seller_profiles')
    .select('brand_name, return_name, return_line1, return_line2, return_city, return_region, return_postal_code, return_country')
    .eq('org_id', orgId).eq('status', 'approved').maybeSingle();
  return (data as SellerBrand | null) ?? null;
}

/** "Dropship … blocked" page (409): printed nothing, says why. */
export function blockedResponse(message: string) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Blocked</title></head><body style="font-family:sans-serif;padding:24px">
<h1 style="font-size:18px">${message.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]!))}</h1>
<p>Dropshipping staff must approve the seller's brand and return address before this can be printed.</p></body></html>`,
  { status: 409, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } });
}
