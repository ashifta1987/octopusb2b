import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { requireDropshipStaff } from '@/lib/dropship-staff';
import { dropshipSettings } from '@/lib/dropship';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import {
  DropshipProductForm,
  type DutyEntryHint,
  type InitialProductData,
  type ProductHistoryItem,
  type RateCardHint,
} from '../product-form';
import type { PublishChecklistResult, SourcingSupplierProductOption } from '../actions';

export const metadata = { title: 'Edit Dropshipping product · Back office' };

const UUID = /^[0-9a-f-]{36}$/i;

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function auditSummary(action: string, details: Record<string, unknown> | null): string {
  if (action === 'dropship.csv_imported') {
    const jc = details?.job_code ? ` (${String(details.job_code)})` : '';
    return `Imported via CSV${jc}`;
  }
  if (action === 'dropship.imported_from_sourcing') {
    const jc = details?.job_code ? ` (${String(details.job_code)})` : '';
    return `Created from Sourcing item${jc}`;
  }
  if (action === 'dropship.product_published') return 'Published';
  if (action === 'dropship.product_archived') return 'Archived';
  if (action === 'dropship.product_created') return 'Created draft';
  if (action === 'dropship.review_saved') return 'HS & compliance review saved';
  if (action === 'dropship.batch_images_uploaded' || action === 'dropship.image_uploaded') {
    return 'Images uploaded';
  }
  return 'Edited product';
}

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
  const [
    cfg,
    prodRes,
    varsRes,
    routesRes,
    tiersRes,
    spsRes,
    catsRes,
    wsRes,
    rateCardsRes,
    feeVerRes,
    dutyVerRes,
    orgsRes,
    chkRes,
  ] = await Promise.all([
    dropshipSettings(),
    sb
      .from('dropship_products')
      .select(
        'id, model_no, title, description, category, images, flagged_images, specs, weight_g, dimensions_cm, min_order_qty, product_price_cents, source_type, fulfilment_type, visible_to_org_id, origin_country, status, needs_review, needs_review_reason, import_job_id, created_at',
      )
      .eq('id', id)
      .maybeSingle(),
    sb
      .from('dropship_variants')
      .select('id, model_no, options, item_id, supplier_product_id, price_adjust_cents, sort')
      .eq('product_id', id)
      .order('sort', { ascending: true }),
    sb
      .from('dropship_routes')
      .select(
        'destination_country, shipping_method, incoterm, landed_price_cents, est_shipping_cents, est_duties_cents, est_days_min, est_days_max, carrier, is_active',
      )
      .eq('product_id', id)
      .order('destination_country', { ascending: true })
      .order('shipping_method', { ascending: true }),
    sb
      .from('dropship_price_tiers')
      .select('min_qty, unit_price_cents')
      .eq('product_id', id)
      .order('min_qty', { ascending: true }),
    staff.canSeeCosts
      ? sb.rpc('list_sourcing_supplier_products', { p_limit: 500 })
      : Promise.resolve({ data: null }),
    sb.from('categories').select('name').order('name'),
    sb
      .from('warehouse_stock')
      .select('item_id, on_hand_qty, reserved_qty')
      .eq('warehouse_id', 'SZ-01'),
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
    sb.rpc('get_dropship_publish_checklist', { p_product_id: id }),
  ]);

  const p = prodRes.data;
  if (!p) notFound();

  const varRows = varsRes.data ?? [];
  const itemIds = [...new Set(varRows.map((v) => String(v.item_id)).filter(Boolean))];

  const [itemsRes, dutyEntriesRes, importJobRes] = await Promise.all([
    itemIds.length
      ? sb
          .from('item_master')
          .select(
            'id, hs_code, hs_verified, origin_country, weight_g, box_l_cm, box_w_cm, box_h_cm, has_battery, has_liquid, has_magnet, has_powder, is_fragile',
          )
          .in('id', itemIds)
      : Promise.resolve({ data: [] }),
    dutyVerRes.data?.id
      ? sb
          .from('duty_rate_entries')
          .select('country, hs_prefix, duty_bp, tax_bp, de_minimis_cents, de_minimis_applies_to')
          .eq('version_id', dutyVerRes.data.id)
      : Promise.resolve({ data: [] }),
    staff.canSeeCosts && p.import_job_id
      ? sb
          .from('dropship_import_jobs')
          .select('job_code')
          .eq('id', p.import_job_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const enabledOrgIds = (orgsRes.data ?? []).map((r) => String(r.org_id));
  const orgNamesRes = enabledOrgIds.length
    ? await sb.from('organizations').select('id, name').in('id', enabledOrgIds).order('name')
    : { data: [] };
  const dropshipOrgs = (orgNamesRes.data ?? []).map((o) => ({
    id: String(o.id),
    name: String(o.name),
  }));

  // Fetch audit_log history via admin client, stripping any internal details for !canSeeCosts
  const admin = createAdminClient();
  const { data: auditRows } = await admin
    .from('audit_log')
    .select('id, action, actor_id, details, created_at')
    .eq('entity_id', id)
    .order('created_at', { ascending: false })
    .limit(8);

  const actorIds = [
    ...new Set((auditRows ?? []).map((a) => String(a.actor_id ?? '')).filter(Boolean)),
  ];
  const { data: actorProfiles } = actorIds.length
    ? await admin.from('profiles').select('id, full_name').in('id', actorIds)
    : { data: [] };
  const actorMap = new Map(
    (actorProfiles ?? []).map((pr) => [String(pr.id), String(pr.full_name || 'Staff')]),
  );

  const history: ProductHistoryItem[] = (auditRows ?? []).map((a) => ({
    id: String(a.id),
    action: String(a.action),
    created_at: formatShortDate(String(a.created_at)),
    actor_label: a.actor_id ? actorMap.get(String(a.actor_id)) ?? 'Staff' : 'System',
    summary: auditSummary(
      String(a.action),
      staff.canSeeCosts ? ((a.details as Record<string, unknown> | null) ?? null) : null,
    ),
  }));

  const primaryIm = (itemsRes.data ?? [])[0] as
    | {
        hs_code: string | null;
        hs_verified: boolean;
        origin_country: string | null;
        weight_g: number | null;
        box_l_cm: number | null;
        box_w_cm: number | null;
        box_h_cm: number | null;
        has_battery: boolean;
        has_liquid: boolean;
        has_magnet: boolean;
        has_powder: boolean;
        is_fragile: boolean;
      }
    | undefined;

  const wsByItem = new Map<string, { on_hand: number; reserved: number }>();
  for (const w of wsRes.data ?? []) {
    wsByItem.set(String(w.item_id), {
      on_hand: Number(w.on_hand_qty ?? 0),
      reserved: Number(w.reserved_qty ?? 0),
    });
  }

  const supplierProducts = staff.canSeeCosts
    ? ((spsRes.data ?? []) as SourcingSupplierProductOption[]).map((sp) => ({
        ...sp,
        unit_cost_cents: Number(sp.unit_cost_cents ?? 0),
      }))
    : [];

  const categories = (catsRes.data ?? []).map((c) => String(c.name));
  const specsObj =
    p.specs && typeof p.specs === 'object' ? (p.specs as Record<string, string>) : {};
  const specsText = Object.entries(specsObj)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  const dims = (p.dimensions_cm ?? {}) as { l?: number; w?: number; h?: number };

  const defaultSpId =
    staff.canSeeCosts && varRows[0]?.supplier_product_id
      ? String(varRows[0].supplier_product_id)
      : '';

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
    id: p.id as string,
    model_no: String(p.model_no),
    title: String(p.title),
    description: p.description ? String(p.description) : '',
    category: p.category ? String(p.category) : '',
    images: Array.isArray(p.images) ? (p.images as string[]) : [],
    flagged_images: Array.isArray(p.flagged_images) ? (p.flagged_images as string[]) : [],
    specsText,
    weight_g:
      primaryIm?.weight_g != null
        ? Number(primaryIm.weight_g)
        : p.weight_g != null
          ? Number(p.weight_g)
          : null,
    dim_l:
      primaryIm?.box_l_cm != null
        ? String(primaryIm.box_l_cm)
        : dims.l != null
          ? String(dims.l)
          : '',
    dim_w:
      primaryIm?.box_w_cm != null
        ? String(primaryIm.box_w_cm)
        : dims.w != null
          ? String(dims.w)
          : '',
    dim_h:
      primaryIm?.box_h_cm != null
        ? String(primaryIm.box_h_cm)
        : dims.h != null
          ? String(dims.h)
          : '',
    min_order_qty: Number(p.min_order_qty ?? 1),
    product_price_cents:
      p.product_price_cents != null ? Number(p.product_price_cents) : null,
    source_type:
      (p.source_type as 'own_warehouse' | 'partner_supplier') ?? 'partner_supplier',
    fulfilment_type:
      (p.fulfilment_type as 'fast_ship' | 'extended_catalog') ??
      (p.source_type === 'own_warehouse' ? 'fast_ship' : 'extended_catalog'),
    default_supplier_product_id: defaultSpId,
    visible_to_org_id: p.visible_to_org_id ? String(p.visible_to_org_id) : '',
    origin_country: primaryIm?.origin_country
      ? String(primaryIm.origin_country).trim()
      : p.origin_country
        ? String(p.origin_country).trim()
        : '',
    hs_code: primaryIm?.hs_code ? String(primaryIm.hs_code) : '',
    hs_verified: Boolean(primaryIm?.hs_verified),
    has_battery: Boolean(primaryIm?.has_battery),
    has_liquid: Boolean(primaryIm?.has_liquid),
    has_magnet: Boolean(primaryIm?.has_magnet),
    has_powder: Boolean(primaryIm?.has_powder),
    is_fragile: Boolean(primaryIm?.is_fragile),
    status: (p.status as 'draft' | 'active' | 'archived') ?? 'draft',
    needs_review: Boolean(p.needs_review),
    needs_review_reason: p.needs_review_reason ? String(p.needs_review_reason) : null,
    import_job_code: importJobRes.data?.job_code ? String(importJobRes.data.job_code) : null,
    created_at_label: formatShortDate(p.created_at ? String(p.created_at) : null),
    variants: varRows.map((v) => {
      const opts =
        v.options && typeof v.options === 'object'
          ? (v.options as Record<string, string>)
          : {};
      const ws = wsByItem.get(String(v.item_id));
      const onHand = ws?.on_hand ?? 0;
      const reserved = ws?.reserved ?? 0;
      return {
        id: v.id as string,
        model_no: String(v.model_no),
        optionsText: Object.entries(opts)
          .map(([k, val]) => `${k}: ${val}`)
          .join(', '),
        supplier_product_id:
          staff.canSeeCosts && v.supplier_product_id ? String(v.supplier_product_id) : '',
        price_adjust_cents: Number(v.price_adjust_cents ?? 0),
        on_hand_qty: onHand,
        reserved_qty: reserved,
        available_qty: Math.max(0, onHand - reserved),
      };
    }),
    routes: (routesRes.data ?? []).map((r) => ({
      destination_country: String(r.destination_country).trim(),
      shipping_method: r.shipping_method as 'express' | 'standard' | 'economy',
      incoterm: (r.incoterm === 'DAP' ? 'DAP' : 'DDP') as 'DDP' | 'DAP',
      landed_price_cents: Number(r.landed_price_cents ?? 0),
      est_shipping_cents: staff.canSeeCosts ? Number(r.est_shipping_cents ?? 0) : 0,
      est_duties_cents: staff.canSeeCosts ? Number(r.est_duties_cents ?? 0) : 0,
      est_days_min: Number(r.est_days_min ?? 3),
      est_days_max: Number(r.est_days_max ?? 7),
      carrier: staff.canSeeCosts && r.carrier ? String(r.carrier) : '',
      is_active: Boolean(r.is_active),
    })),
    price_tiers: (tiersRes.data ?? []).map((t) => ({
      min_qty: Number(t.min_qty),
      unit_price_cents: Number(t.unit_price_cents),
    })),
    checklist: (chkRes.data as PublishChecklistResult | null) ?? undefined,
    history,
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
