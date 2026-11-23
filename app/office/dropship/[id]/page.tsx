import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { requireDropshipStaff } from '@/lib/dropship-staff';
import { dropshipSettings } from '@/lib/dropship';
import { createClient } from '@/lib/supabase/server';
import { DropshipProductForm, type InitialProductData } from '../product-form';

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
  const [cfg, prodRes, varsRes, routesRes, supsRes, catsRes] = await Promise.all([
    dropshipSettings(),
    sb.from('dropship_products').select('*').eq('id', id).maybeSingle(),
    sb
      .from('dropship_variants')
      .select('*')
      .eq('product_id', id)
      .order('sort', { ascending: true }),
    sb
      .from('dropship_routes')
      .select('*')
      .eq('product_id', id)
      .order('destination_country', { ascending: true })
      .order('shipping_method', { ascending: true }),
    staff.canSeeCosts
      ? sb
          .from('suppliers')
          .select('id, code, legal_name, verified')
          .eq('verified', true)
          .is('archived_at', null)
          .order('code')
      : Promise.resolve({ data: null }),
    sb.from('categories').select('name').order('name'),
  ]);

  const p = prodRes.data;
  if (!p) notFound();

  const suppliers = (supsRes.data ?? []) as {
    id: string;
    code: string;
    legal_name: string;
    verified: boolean;
  }[];
  const categories = (catsRes.data ?? []).map((c) => String(c.name));
  const specsObj =
    p.specs && typeof p.specs === 'object' ? (p.specs as Record<string, string>) : {};
  const specsText = Object.entries(specsObj)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const dims = (p.dimensions_cm ?? {}) as { l?: number; w?: number; h?: number };

  const initial: InitialProductData = {
    id: p.id as string,
    octopus_sku: String(p.octopus_sku),
    title: String(p.title),
    description: p.description ? String(p.description) : '',
    category: p.category ? String(p.category) : '',
    images: Array.isArray(p.images) ? (p.images as string[]) : [],
    specsText,
    weight_g: Number(p.weight_g ?? 400),
    dim_l: dims.l != null ? String(dims.l) : '',
    dim_w: dims.w != null ? String(dims.w) : '',
    dim_h: dims.h != null ? String(dims.h) : '',
    unit_cost_cents: staff.canSeeCosts ? Number(p.unit_cost_cents ?? 0) : 0,
    min_order_qty: Number(p.min_order_qty ?? 1),
    stock_status: (p.stock_status as 'in_stock' | 'low' | 'out') ?? 'in_stock',
    stock_qty: p.stock_qty != null ? String(p.stock_qty) : '',
    source_type:
      (p.source_type as 'own_warehouse' | 'partner_supplier') ?? 'partner_supplier',
    supplier_id: staff.canSeeCosts && p.supplier_id ? String(p.supplier_id) : '',
    supplier_sku: staff.canSeeCosts && p.supplier_sku ? String(p.supplier_sku) : '',
    origin_country: String(p.origin_country ?? 'CN').trim(),
    status: (p.status as 'draft' | 'active' | 'archived') ?? 'draft',
    variants: (varsRes.data ?? []).map((v) => {
      const opts =
        v.options && typeof v.options === 'object'
          ? (v.options as Record<string, string>)
          : {};
      return {
        id: v.id as string,
        octopus_sku: String(v.octopus_sku),
        optionsText: Object.entries(opts)
          .map(([k, val]) => `${k}: ${val}`)
          .join(', '),
        cost_cents: staff.canSeeCosts ? Number(v.cost_cents ?? 0) : 0,
        price_adjust_cents: Number(v.price_adjust_cents ?? 0),
        stock_status: (v.stock_status as 'in_stock' | 'low' | 'out') ?? 'in_stock',
        stock_qty: v.stock_qty != null ? String(v.stock_qty) : '',
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
