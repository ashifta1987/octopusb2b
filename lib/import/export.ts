import type { SupabaseClient } from '@supabase/supabase-js';
import { safeSheetName, type TemplateRow, type TemplateSupplier } from './template.ts';

/**
 * "Template pre-filled with existing products" (ADDON-29): one supplier's products exported in the 20-column layout
 * so an admin can edit in place and re-upload. Re-uploading an unedited export changes nothing (round trip).
 * Needs a service-role client; callers check staff permissions first.
 */
const num = (minor: number) => String(Number((minor / 10000).toFixed(4)));

type PriceRow = { product_id: string; incoterm: string; moq_tier_min: number; variant_label: string; price_minor: number };

/** Current supplier prices → the "Price options as quoted" text the parser reads back to the same rows. */
export function quoteText(rows: PriceRow[]): { price: number | null; quote: string | null } {
  if (!rows.length) return { price: null, quote: null };
  const inc = rows[0].incoterm;
  const moqs = [...new Set(rows.map((r) => r.moq_tier_min))].sort((a, b) => b - a);
  const label = (r: PriceRow) => (r.variant_label ? `${r.variant_label}: ${num(r.price_minor)}` : num(r.price_minor));
  const lowest = Number(num(Math.min(...rows.map((r) => r.price_minor))));
  if (moqs.length === 1) {
    if (rows.length === 1 && !rows[0].variant_label) return { price: lowest, quote: `${inc}, MOQ ${moqs[0]}` };
    return { price: lowest, quote: `${rows.map(label).join(' / ')}  |  ${inc}, MOQ ${moqs[0]}` };
  }
  const segs = moqs.map((m) => `MOQ ${m} / ${rows.filter((r) => r.moq_tier_min === m).map(label).join(' / ')}`);
  return { price: lowest, quote: `${segs.join('  |  ')}  |  ${inc}` };
}

export async function exportSupplierWorkbookData(sb: SupabaseClient, supplierId: string): Promise<{ supplier: TemplateSupplier; rows: TemplateRow[] }> {
  const [{ data: s }, { data: variants }, { data: contacts }, { data: links }] = await Promise.all([
    sb.from('suppliers').select('id, external_id, manufacturer_code, handle, contact_name, contact_email, contact_phone').eq('id', supplierId).single(),
    sb.from('supplier_name_variants').select('variant_name, variant_address, seen_in, is_canonical').eq('supplier_id', supplierId).order('created_at'),
    sb.from('supplier_contacts').select('name, role, phone, email, is_primary').eq('supplier_id', supplierId).order('is_primary', { ascending: false }),
    sb.from('supplier_products').select('product_id, supplier_model, moq, exclusive_channels, exclusivity_flag, status').eq('supplier_id', supplierId),
  ]);
  if (!s) throw new Error('NOT_FOUND');
  const linkBy = new Map((links ?? []).map((l) => [l.product_id as string, l]));
  // products of this supplier: linked through supplier_products, or owned directly (supplier_id)
  const { data: prods } = await sb.from('products')
    .select('id, external_id, title, factory_model, moq, net_weight, product_size_mm, size_notes, colour_box_mm, carton_size_mm, qty_per_carton, gross_weight, specification_raw, selling_points_raw, listing_status, import_notes, created_at, categories(name)')
    .or(`supplier_id.eq.${supplierId}${linkBy.size ? `,id.in.(${[...linkBy.keys()].join(',')})` : ''}`)
    .is('archived_at', null).order('created_at');
  const ids = (prods ?? []).map((p) => p.id as string);
  const [{ data: prices }, { data: media }] = await Promise.all([
    ids.length ? sb.from('supplier_product_prices').select('product_id, incoterm, moq_tier_min, variant_label, price_minor').eq('supplier_id', supplierId).eq('is_superseded', false).in('product_id', ids).order('created_at') : Promise.resolve({ data: [] }),
    ids.length ? sb.from('product_media').select('product_id, url, sort').in('product_id', ids).order('sort') : Promise.resolve({ data: [] }),
  ]);
  const priceBy = new Map<string, PriceRow[]>();
  (prices ?? []).forEach((p) => priceBy.set(p.product_id as string, [...(priceBy.get(p.product_id as string) ?? []), { ...(p as PriceRow), price_minor: Number(p.price_minor) }]));
  const imgBy = new Map<string, string>();
  (media ?? []).forEach((m) => { if (!imgBy.has(m.product_id as string)) imgBy.set(m.product_id as string, decodeURIComponent(String(m.url).split('/').pop() ?? '')); });

  const flags = (links ?? []).map((l) => l.exclusivity_flag as string | null).filter(Boolean) as string[];
  const flag = flags.length ? [...flags].sort((a, b) => flags.filter((x) => x === b).length - flags.filter((x) => x === a).length)[0] : null;
  const c = contacts?.[0];

  const rows: TemplateRow[] = (prods ?? []).map((p) => {
    const link = linkBy.get(p.id as string);
    const q = quoteText(priceBy.get(p.id as string) ?? []);
    const notQuoted = link?.status === 'needs_quote';
    const cat = (Array.isArray(p.categories) ? p.categories[0] : p.categories) as { name?: string } | null;
    return {
      sheet: notQuoted ? 'Not Quoted' : safeSheetName(cat?.name ?? 'Products'),
      'Product Id': p.external_id as string,
      'Factory model': (p.factory_model as string | null) ?? (link?.supplier_model as string | null) ?? null,
      'Product name (live on platform)': p.title as string,
      Category: cat?.name ?? null,
      'Price USD': q.price,
      'Price options as quoted': q.quote,
      MOQ: q.quote ? (p.moq as number) : null,
      Sample: null,
      'Image file': imgBy.get(p.id as string) ?? null,
      'Net weight': p.net_weight as string | null,
      'Product size (mm)': p.product_size_mm ? `${p.product_size_mm}${p.size_notes ? `（${p.size_notes}）` : ''}` : null,
      'Colour box (mm)': p.colour_box_mm as string | null,
      'Carton size (mm)': p.carton_size_mm as string | null,
      'Qty / carton': p.qty_per_carton as string | null,
      'Gross weight': p.gross_weight as string | null,
      'Specification (supplier)': p.specification_raw as string | null,
      'Selling points (supplier)': p.selling_points_raw as string | null,
      'Exclusive channels': (link?.exclusive_channels as string | null) ?? null,
      'Platform status': p.listing_status as string,
      'Notes / discrepancies': p.import_notes as string | null,
    };
  });
  return {
    supplier: {
      external_id: s.external_id as string | null, manufacturer_code: s.manufacturer_code as string | null,
      contact: c ? [c.name, c.role].filter(Boolean).join(', ') : (s.contact_name as string | null),
      phone: (c?.phone as string | null) ?? (s.contact_phone as string | null), email: (c?.email as string | null) ?? (s.contact_email as string | null),
      handle: s.handle as string | null,
      variants: (variants ?? []).map((v) => ({ variant_name: v.variant_name as string, variant_address: v.variant_address as string | null, seen_in: v.seen_in as string | null, is_canonical: !!v.is_canonical })),
      exclusivity_flag: flag,
    },
    rows,
  };
}

