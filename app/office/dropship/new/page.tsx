import { Suspense } from 'react';
import { requireDropshipStaff } from '@/lib/dropship-staff';
import { dropshipSettings } from '@/lib/dropship';
import { createClient } from '@/lib/supabase/server';
import { DropshipProductForm, type InitialProductData } from '../product-form';

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
  const [cfg, supsRes, catsRes] = await Promise.all([
    dropshipSettings(),
    sb
      .from('suppliers')
      .select('id, code, legal_name, verified')
      .eq('verified', true)
      .is('archived_at', null)
      .order('code'),
    sb.from('categories').select('name').order('name'),
  ]);

  const suppliers = (supsRes.data ?? []) as {
    id: string;
    code: string;
    legal_name: string;
    verified: boolean;
  }[];
  const categories = (catsRes.data ?? []).map((c) => String(c.name));

  const initial: InitialProductData = {
    id: null,
    octopus_sku: '',
    title: '',
    description: '',
    category: categories[0] ?? 'Lighting',
    images: [],
    specsText: '',
    weight_g: 400,
    dim_l: '',
    dim_w: '',
    dim_h: '',
    unit_cost_cents: 650,
    min_order_qty: 1,
    stock_status: 'in_stock',
    stock_qty: '100',
    source_type: 'partner_supplier',
    supplier_id: suppliers[0]?.id ?? '',
    supplier_sku: '',
    origin_country: 'CN',
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
      suppliers={suppliers}
      categories={categories}
      supportedCountries={cfg.supportedCountries}
      canEdit={staff.canEdit}
      canSeeCosts={staff.canSeeCosts}
      minMarginBp={cfg.minMarginBp}
      categoryMinMarginBp={cfg.categoryMinMarginBp}
    />
  );
}
