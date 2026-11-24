import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { requireDropshipStaff } from '@/lib/dropship-staff';
import { dropshipSettings } from '@/lib/dropship';
import { createClient } from '@/lib/supabase/server';
import { DropshipProductForm, type InitialProductData } from '../product-form';
import type { SourcingSupplierProductOption } from '../actions';

export const metadata = { title: 'Edit Dropshipping product · Back office' };

const UUID = /^[0-9a-f-]{36}$/i;

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="card p-6 animate-pulse">Loading product…</div>}>
      <EditDropshipProduct params={params} />
    </Suspense>
  );
}

async function EditDropshipProduct({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireDropshipStaff(false);
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const sb = await createClient();
  const [cfg, prodRes, varsRes, routesRes, spsRes, catsRes] = await Promise.all([
    dropshipSettings(),
    sb
      .from('dropship_products')
      .select(
        'id, model_no, title, description, category, images, specs, weight_g, dimensions_cm, min_order_qty, source_type, fulfilment_type, origin_country, status',
      )
      .eq('id', id)
      .maybeSingle(),
    sb
      .from('dropship_variants')
      .select('id, model_no, options, supplier_product_id, price_adjust_cents, sort')
      .eq('product_id', id)
      .order('sort', { ascending: true }),
    sb
      .from('dropship_routes')
      .select('destination_country, shipping_method, landed_price_cents, est_shipping_cents, est_duties_cents, est_days_min, est_days_max, carrier, is_active')
      .eq('product_id', id)
      .order('destination_country', { ascending: true })
      .order('shipping_method', { ascending: true }),
    staff.canSeeCosts
      ? sb.rpc('list_sourcing_supplier_products', { p_limit: 500 })
      : Promise.resolve({ data: null }),
    sb.from('categories').select('name').order('name'),
  ]);

  const p = prodRes.data;
  if (!p) notFound();

  const supplierProducts = ((spsRes.data ?? []) as SourcingSupplierProductOption[]).map((sp) => ({
    ...sp,
    unit_cost_cents: Number(sp.unit_cost_cents ?? 0),
  }));
  const categories = (catsRes.data ?? []).map((c) => String(c.name));
  const specsObj =
    p.specs && typeof p.specs === 'object' ? (p.specs as Record<string, string>) : {};
  const specsText = Object.entries(specsObj)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const dims = (p.dimensions_cm ?? {}) as { l?: number; w?: number; h?: number };
  const varRows = varsRes.data ?? [];
  const defaultSpId =
    staff.canSeeCosts && varRows[0]?.supplier_product_id
      ? String(varRows[0].supplier_product_id)
      : '';

  const initial: InitialProductData = {
    id: p.id as string,
    model_no: String(p.model_no),
    title: String(p.title),
    description: p.description ? String(p.description) : '',
    category: p.category ? String(p.category) : '',
    images: Array.isArray(p.images) ? (p.images as string[]) : [],
    specsText,
    weight_g: Number(p.weight_g ?? 400),
    dim_l: dims.l != null ? String(dims.l) : '',
    dim_w: dims.w != null ? String(dims.w) : '',
    dim_h: dims.h != null ? String(dims.h) : '',
    min_order_qty: Number(p.min_order_qty ?? 1),
    source_type:
      (p.source_type as 'own_warehouse' | 'partner_supplier') ?? 'partner_supplier',
    fulfilment_type:
      (p.fulfilment_type as 'fast_ship' | 'extended_catalog') ??
      (p.source_type === 'own_warehouse' ? 'fast_ship' : 'extended_catalog'),
    default_supplier_product_id: defaultSpId,
    origin_country: p.origin_country ? String(p.origin_country).trim() : '',
    status: (p.status as 'draft' | 'active' | 'archived') ?? 'draft',
    variants: varRows.map((v) => {
      const opts =
        v.options && typeof v.options === 'object'
          ? (v.options as Record<string, string>)
          : {};
      return {
        id: v.id as string,
        model_no: String(v.model_no),
        optionsText: Object.entries(opts)
          .map(([k, val]) => `${k}: ${val}`)
          .join(', '),
        supplier_product_id:
          staff.canSeeCosts && v.supplier_product_id ? String(v.supplier_product_id) : '',
        price_adjust_cents: Number(v.price_adjust_cents ?? 0),
      };
    }),
    routes: (routesRes.data ?? []).map((r) => ({
      destination_country: String(r.destination_country).trim(),
      shipping_method: r.shipping_method as 'express' | 'standard' | 'economy',
      landed_price_cents: Number(r.landed_price_cents ?? 0),
      est_shipping_cents: staff.canSeeCosts ? Number(r.est_shipping_cents ?? 0) : 0,
      est_duties_cents: staff.canSeeCosts ? Number(r.est_duties_cents ?? 0) : 0,
      est_days_min: Number(r.est_days_min ?? 3),
      est_days_max: Number(r.est_days_max ?? 7),
      carrier: staff.canSeeCosts && r.carrier ? String(r.carrier) : '',
      is_active: Boolean(r.is_active),
    })),
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
