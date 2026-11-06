import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getManagedSuppliers } from '@/components/backoffice/server-utils';
import { buildProductWorkbook, XLSX_HEADERS } from '@/components/backoffice/product-workbook';
import { categoryPaths } from '@/components/backoffice/category-paths';

/** Blank bulk template v2 (ADDON-33): Products (SKU first, 3 image columns) + Lists + Instructions. */
export async function GET() {
  const s = await getSession();
  if (!s || (!s.isAdmin && !s.roles.includes('distributor'))) return new Response('Forbidden', { status: 403 });
  const sb = await createClient();
  const [suppliers, { paths }] = await Promise.all([getManagedSuppliers(s), categoryPaths(sb)]);
  const sorted = [...paths.values()].sort();
  const sample = suppliers[0]?.code ?? 'OCT-1101';
  const buf = await buildProductWorkbook({
    categoryPaths: sorted, supplierCodes: suppliers.map((x) => x.code),
    rows: [{
      sku: 'FST-BLT-M10X40-A2', title: 'Stainless steel hex bolts, M10 × 40 mm, A2-70', category_path: sorted.find((p) => p.split(' > ').length >= 3) ?? sorted[0] ?? 'Fasteners > Bolts > Hex bolts',
      supplier_code: sample, unit: 'pcs', moq: 1000, lead_time_days: 15, incoterm: 'FOB', origin_country: 'CN', hs_code: '7318.15',
      currency: 'USD', tier1_qty: 1000, tier1_price: 0.19, tier2_qty: 5000, tier2_price: 0.16, tier3_qty: 10000, tier3_price: 0.14,
      octopus_dropship: 'no', ready_to_ship: 'yes', image_file: 'M10x40-bolt.jpg', image_file_2: null, image_file_3: null,
      description: 'Full-thread hex head bolts in A2-70 stainless steel to DIN 933 / ISO 4017.',
    }],
  });
  return new Response(new Uint8Array(buf), { headers: XLSX_HEADERS('octopus-product-template.xlsx') });
}
