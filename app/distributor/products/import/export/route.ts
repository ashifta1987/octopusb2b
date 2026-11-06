import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getManagedSuppliers } from '@/components/backoffice/server-utils';
import { buildProductWorkbook, XLSX_HEADERS } from '@/components/backoffice/product-workbook';
import { categoryPaths } from '@/components/backoffice/category-paths';
import { exportImageName, exportPrice } from '@/lib/product-import';

/** "Download my products" (ADDON-33 §8): the caller's suppliers' products in the v2 layout, SKU and current image names filled in.
 *  Re-uploading it unedited changes nothing. ?supplier=<code> limits to one supplier. */
export async function GET(req: Request) {
  const s = await getSession();
  if (!s || (!s.isAdmin && !s.roles.includes('distributor'))) return new Response('Forbidden', { status: 403 });
  const sb = await createClient();
  const [suppliers, { paths }] = await Promise.all([getManagedSuppliers(s), categoryPaths(sb)]);
  const only = new URL(req.url).searchParams.get('supplier')?.trim().toUpperCase();
  const mine = suppliers.filter((x) => !only || x.code.toUpperCase() === only);
  // suppliers come from the caller's RLS view: an unassigned or unknown code is not found (never an empty or full export)
  if (only && !mine.length) return new Response('Supplier not found', { status: 404 });
  const codeOf = new Map(mine.map((x) => [x.id, x.code]));
  const ids = mine.map((x) => x.id);
  const products: Record<string, unknown>[] = [];
  for (let from = 0; ids.length; from += 1000) {
    const { data } = await sb.from('products')
      .select('sku, title, category_id, supplier_id, unit, moq, lead_time_days, incoterm, origin_country, hs_code, currency, octopus_dropship, ready_to_ship, description, created_at, price_tiers(min_qty, unit_price_cents), product_media(sort, url, source_file_name)')
      .in('supplier_id', ids).neq('status', 'archived').order('created_at').range(from, from + 999);
    products.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  const rows = products.map((p) => {
    const tiers = ((p.price_tiers ?? []) as { min_qty: number; unit_price_cents: number }[]).map((t) => ({ q: Number(t.min_qty), c: Number(t.unit_price_cents) })).sort((a, b) => a.q - b.q);
    const media = ((p.product_media ?? []) as { sort: number; url: string; source_file_name: string | null }[]);
    const img = (pos: number) => { const m = media.find((x) => x.sort === pos); return m ? exportImageName(m) : null; };
    return {
      sku: p.sku as string, title: p.title as string, category_path: paths.get(p.category_id as string) ?? null, supplier_code: codeOf.get(p.supplier_id as string) ?? null,
      unit: p.unit as string, moq: p.moq as number, lead_time_days: p.lead_time_days as number | null, incoterm: p.incoterm as string | null,
      origin_country: p.origin_country as string | null, hs_code: p.hs_code as string | null, currency: (p.currency as string) ?? 'USD',
      tier1_qty: tiers[0]?.q ?? null, tier1_price: tiers[0] ? exportPrice(tiers[0].c) : null,
      tier2_qty: tiers[1]?.q ?? null, tier2_price: tiers[1] ? exportPrice(tiers[1].c) : null,
      tier3_qty: tiers[2]?.q ?? null, tier3_price: tiers[2] ? exportPrice(tiers[2].c) : null,
      octopus_dropship: p.octopus_dropship ? 'yes' : 'no', ready_to_ship: p.ready_to_ship ? 'yes' : 'no',
      image_file: img(1), image_file_2: img(2), image_file_3: img(3), description: p.description as string | null,
    };
  });
  const buf = await buildProductWorkbook({ categoryPaths: [...paths.values()].sort(), supplierCodes: suppliers.map((x) => x.code), rows });
  return new Response(new Uint8Array(buf), { headers: XLSX_HEADERS(`octopus-my-products-${only ? `${only.toLowerCase()}-` : ''}${new Date().toISOString().slice(0, 10)}.xlsx`) });
}

