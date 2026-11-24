import { Suspense } from 'react';
import { requireDropshipStaff } from '@/lib/dropship-staff';
import { dropshipSettings } from '@/lib/dropship';
import { createClient } from '@/lib/supabase/server';
import { DropshipProductForm, type InitialProductData } from '../product-form';
import type { SourcingSupplierProductOption } from '../actions';

export const metadata = { title: 'Add Dropshipping product · Back office' };

export default function Page() {
  return (
    <Suspense fallback={<div className="card p-6 animate-pulse">Loading form…</div>}>
      <NewDropshipProduct />
    </Suspense>
  );
}

async function NewDropshipProduct() {
  const staff = await requireDropshipStaff(true);
  const sb = await createClient();
  const [cfg, spsRes, catsRes] = await Promise.all([
    dropshipSettings(),
    sb.rpc('list_sourcing_supplier_products', { p_limit: 500 }),
    sb.from('categories').select('name').order('name'),
  ]);

  const supplierProducts = ((spsRes.data ?? []) as SourcingSupplierProductOption[]).map((sp) => ({
    ...sp,
    unit_cost_cents: Number(sp.unit_cost_cents ?? 0),
  }));
  const categories = (catsRes.data ?? []).map((c) => String(c.name));
  const firstSp = supplierProducts.find((s) => s.unit_cost_cents > 0) ?? supplierProducts[0];

  const initial: InitialProductData = {
    id: null,
    model_no: null,
    title: '',
    description: '',
    category: categories[0] ?? 'Lighting',
    images: [],
    specsText: '',
    weight_g: 400,
    dim_l: '',
    dim_w: '',
    dim_h: '',
    min_order_qty: 1,
    stock_status: 'in_stock',
    stock_qty: '100',
    source_type: 'partner_supplier',
    default_supplier_product_id: firstSp?.supplier_product_id ?? '',
    origin_country: '', // Nullable — never defaults to 'CN' (Item 1)
    status: 'draft',
    variants: [],
    routes: [
      {
        destination_country: 'AE',
        shipping_method: 'express',
        landed_price_cents: 1890,
        est_shipping_cents: 520,
        est_duties_cents: 35,
        est_days_min: 3,
        est_days_max: 5,
        carrier: 'YunExpress Priority',
        is_active: true,
      },
    ],
  };

  return (
    <DropshipProductForm
      initial={initial}
      supplierProducts={supplierProducts}
      categories={categories}
      supportedCountries={cfg.supportedCountries}
      canEdit={staff.canEdit}
      canSeeCosts={staff.canSeeCosts}
      minMarginBp={cfg.minMarginBp}
      categoryMinMarginBp={cfg.categoryMinMarginBp}
    />
  );
}
