import { Suspense } from 'react';
import { requireDropshipStaff } from '@/lib/dropship-staff';
import { dropshipSettings } from '@/lib/dropship';
import { createClient } from '@/lib/supabase/server';
import {
  DropshipProductForm,
  type DutyEntryHint,
  type InitialProductData,
  type RateCardHint,
} from '../product-form';
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
  const [cfg, spsRes, catsRes, rateCardsRes, feeVerRes, dutyVerRes, orgsRes] = await Promise.all([
    dropshipSettings(),
    sb.rpc('list_sourcing_supplier_products', { p_limit: 500 }),
    sb.from('categories').select('name').order('name'),
    sb
      .from('shipping_rate_cards')
      .select(
        'country, method, base_cents, per_100g_cents, step_g, volumetric_divisor, max_weight_g, allows_battery, allows_liquid, allows_magnet, allows_powder',
      )
      .eq('active', true),
    sb
      .from('fee_versions')
      .select('pick_pack_first_cents, packaging_cents')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle(),
    sb
      .from('duty_rate_versions')
      .select('id')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle(),
    sb
      .from('company_services')
      .select('org_id')
      .eq('service', 'dropship')
      .eq('status', 'on'),
  ]);

  const dutyEntriesRes = dutyVerRes.data?.id
    ? await sb
        .from('duty_rate_entries')
        .select('country, hs_prefix, duty_bp, tax_bp, de_minimis_cents, de_minimis_applies_to')
        .eq('version_id', dutyVerRes.data.id)
    : { data: [] };

  const enabledOrgIds = (orgsRes.data ?? []).map((r) => String(r.org_id));
  const orgNamesRes = enabledOrgIds.length
    ? await sb.from('organizations').select('id, name').in('id', enabledOrgIds).order('name')
    : { data: [] };
  const dropshipOrgs = (orgNamesRes.data ?? []).map((o) => ({
    id: String(o.id),
    name: String(o.name),
  }));

  const supplierProducts = ((spsRes.data ?? []) as SourcingSupplierProductOption[]).map((sp) => ({
    ...sp,
    unit_cost_cents: Number(sp.unit_cost_cents ?? 0),
  }));
  const categories = (catsRes.data ?? []).map((c) => String(c.name));
  const firstSp = supplierProducts.find((s) => s.unit_cost_cents > 0) ?? supplierProducts[0];

  const rateCards: RateCardHint[] = (rateCardsRes.data ?? []).map((rc) => ({
    country: String(rc.country).trim(),
    method: String(rc.method),
    base_cents: Number(rc.base_cents),
    per_100g_cents: Number(rc.per_100g_cents),
    step_g: Number(rc.step_g || 100),
    volumetric_divisor: Number(rc.volumetric_divisor || 5000),
    max_weight_g: Number(rc.max_weight_g || 30000),
    allows_battery: Boolean(rc.allows_battery),
    allows_liquid: Boolean(rc.allows_liquid),
    allows_magnet: Boolean(rc.allows_magnet),
    allows_powder: Boolean(rc.allows_powder),
  }));

  const dutyEntries: DutyEntryHint[] = (dutyEntriesRes.data ?? []).map((de) => ({
    country: String(de.country).trim(),
    hs_prefix: de.hs_prefix ? String(de.hs_prefix) : null,
    duty_bp: Number(de.duty_bp ?? 0),
    tax_bp: Number(de.tax_bp ?? 0),
    de_minimis_cents: Number(de.de_minimis_cents ?? 0),
    de_minimis_applies_to: String(de.de_minimis_applies_to ?? 'duty'),
  }));

  const processingFeeCents = feeVerRes.data
    ? Number(feeVerRes.data.pick_pack_first_cents) + Number(feeVerRes.data.packaging_cents)
    : null;

  const initial: InitialProductData = {
    id: null,
    model_no: null,
    title: '',
    description: '',
    category: categories[0] ?? 'Lighting',
    images: [],
    flagged_images: [],
    specsText: '',
    weight_g: null,
    dim_l: '',
    dim_w: '',
    dim_h: '',
    min_order_qty: 1,
    product_price_cents: null,
    source_type: 'partner_supplier',
    fulfilment_type: 'extended_catalog',
    default_supplier_product_id: firstSp?.supplier_product_id ?? '',
    visible_to_org_id: '',
    origin_country: '', // Nullable — never defaults to 'CN'
    hs_code: '',
    hs_verified: false,
    has_battery: false,
    has_liquid: false,
    has_magnet: false,
    has_powder: false,
    is_fragile: false,
    status: 'draft',
    needs_review: false,
    needs_review_reason: null,
    import_job_code: null,
    created_at_label: null,
    variants: [],
    routes: [
      {
        destination_country: 'AE',
        shipping_method: 'express',
        incoterm: 'DDP',
        landed_price_cents: 1890,
        est_shipping_cents: 520,
        est_duties_cents: 35,
        est_days_min: 3,
        est_days_max: 5,
        carrier: '',
        is_active: true,
      },
    ],
    price_tiers: [],
    history: [],
  };

  return (
    <DropshipProductForm
      initial={initial}
      supplierProducts={supplierProducts}
      categories={categories}
      supportedCountries={cfg.supportedCountries}
      dropshipOrgs={dropshipOrgs}
      rateCards={rateCards}
      dutyEntries={dutyEntries}
      processingFeeCents={processingFeeCents}
      canEdit={staff.canEdit}
      canSeeCosts={staff.canSeeCosts}
      minMarginBp={cfg.minMarginBp}
      categoryMinMarginBp={cfg.categoryMinMarginBp}
    />
  );
}
