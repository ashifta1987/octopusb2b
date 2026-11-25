import { Suspense } from 'react';
import Link from 'next/link';
import { requireDropshipStaff } from '@/lib/dropship-staff';
import { dropshipSettings } from '@/lib/dropship';
import { createClient } from '@/lib/supabase/server';
import { hiddenColumnsByIds } from '@/components/backoffice/hidden-columns';
import { bulkArchiveDropshipProducts, type PublishChecklistResult } from './actions';
import { DsIcon } from '@/components/dropship-ui';
import {
  CatalogReviewDrawer,
  type DropshipOrgOption,
  type ReviewProductPayload,
} from './catalog-review-drawer';

export const metadata = { title: 'Dropshipping catalogue · Back office' };

type SP = {
  q?: string;
  status?: string;
  supplier?: string;
  view?: string; // '' | 'hs_review' | 'missing_data' | 'drafts'
  review?: string;
};

type SourcingLinkRow = {
  variant_id: string;
  product_id: string;
  supplier_product_id: string | null;
  sourcing_product_id: string | null;
  sourcing_sku: string | null;
  sourcing_title: string | null;
  supplier_id: string | null;
  supplier_code: string | null;
  supplier_name: string | null;
  supplier_verified: boolean;
  supplier_model: string | null;
  unit_cost_cents: number | null;
};

type ItemMasterRow = {
  id: string;
  hs_code: string | null;
  hs_code_source: string | null;
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
  needs_data: boolean;
};

const usd = (c: number) =>
  `US$ ${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function hsSourceLabel(src: string | null): string {
  if (src === 'sheet') return 'Supplier data';
  if (src === 'ai' || src === 'rule') return 'Suggested automatically';
  if (src === 'manual') return 'Staff';
  return 'Not set';
}

export default function Page({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<div className="card p-6 text-ink" role="status">Loading Dropshipping catalogue…</div>}>
      <StaffDropshipList searchParams={searchParams} />
    </Suspense>
  );
}

async function StaffDropshipList({ searchParams }: { searchParams: Promise<SP> }) {
  const staff = await requireDropshipStaff(false);
  const sp = await searchParams;
  const sb = await createClient();

  const [
    cfg,
    prodsRes,
    varsRes,
    itemsRes,
    routesRes,
    supsRes,
    linksRes,
    wsRes,
    rateCardsRes,
    feeVerRes,
    dutyVerRes,
    orgsRes,
  ] = await Promise.all([
    dropshipSettings(),
    sb
      .from('dropship_products')
      .select(
        'id, model_no, title, category, images, weight_g, min_order_qty, product_price_cents, source_type, fulfilment_type, visible_to_org_id, origin_country, status, needs_review, needs_review_reason, is_test, updated_at',
      )
      .order('updated_at', { ascending: false }),
    sb
      .from('dropship_variants')
      .select('id, product_id, item_id, price_adjust_cents, sort')
      .order('sort', { ascending: true }),
    sb
      .from('item_master')
      .select(
        'id, hs_code, hs_code_source, hs_verified, origin_country, weight_g, box_l_cm, box_w_cm, box_h_cm, has_battery, has_liquid, has_magnet, has_powder, is_fragile, needs_data',
      ),
    sb
      .from('dropship_routes')
      .select(
        'product_id, destination_country, shipping_method, incoterm, landed_price_cents, est_shipping_cents, est_duties_cents, is_active',
      )
      .order('destination_country', { ascending: true })
      .order('shipping_method', { ascending: true }),
    staff.canSeeCosts
      ? sb
          .from('suppliers')
          .select('id, code, legal_name, verified')
          .is('archived_at', null)
          .order('code')
      : Promise.resolve({ data: null }),
    staff.canSeeCosts
      ? sb.rpc('dropship_sourcing_links')
      : Promise.resolve({ data: null }),
    sb
      .from('warehouse_stock')
      // W0: stock labels count every warehouse (was the single hard-coded 'SZ-01')
      .select('item_id, on_hand_qty, reserved_qty'),
    staff.canSeeCosts
      ? sb
          .from('shipping_rate_cards')
          .select('country, method, base_cents, per_100g_cents, step_g, volumetric_divisor, max_weight_g')
          .eq('active', true)
      : Promise.resolve({ data: [] }),
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

  const activeDutyEntriesRes = dutyVerRes.data?.id
    ? await sb
        .from('duty_rate_entries')
        .select('country, hs_prefix, duty_bp, tax_bp, de_minimis_cents, de_minimis_applies_to')
        .eq('version_id', dutyVerRes.data.id)
    : { data: [] };

  const enabledOrgIds = (orgsRes.data ?? []).map((r) => String(r.org_id));
  const orgNamesRes = enabledOrgIds.length
    ? await sb.from('organizations').select('id, name').in('id', enabledOrgIds).order('name')
    : { data: [] };
  const dropshipOrgs: DropshipOrgOption[] = (orgNamesRes.data ?? []).map((o) => ({
    id: String(o.id),
    name: String(o.name),
  }));

  const sups = (supsRes.data ?? []) as {
    id: string;
    code: string;
    legal_name: string;
    verified: boolean;
  }[];

  const linksByProd = new Map<string, SourcingLinkRow[]>();
  for (const row of (linksRes.data ?? []) as SourcingLinkRow[]) {
    const pid = String(row.product_id);
    const list = linksByProd.get(pid) ?? [];
    list.push(row);
    linksByProd.set(pid, list);
  }

  const itemById = new Map<string, ItemMasterRow>();
  for (const im of (itemsRes.data ?? []) as ItemMasterRow[]) {
    itemById.set(String(im.id), im);
  }

  const wsByItem = new Map<string, { on_hand_qty: number; reserved_qty: number }>();
  for (const w of wsRes.data ?? []) {
    // summed across warehouses (multi-warehouse, W0)
    const prev = wsByItem.get(String(w.item_id));
    wsByItem.set(String(w.item_id), {
      on_hand_qty: (prev?.on_hand_qty ?? 0) + Number(w.on_hand_qty ?? 0),
      reserved_qty: (prev?.reserved_qty ?? 0) + Number(w.reserved_qty ?? 0),
    });
  }

  const varSupMap = staff.canSeeCosts
    ? await hiddenColumnsByIds<{ id: string; supplier_product_id: string | null }>(
        'dropship_variants',
        (varsRes.data ?? []).map((v) => String(v.id)),
        'supplier_product_id',
      )
    : new Map<string, { id: string; supplier_product_id: string | null }>();

  const varsByProd = new Map<string, { id: string; item_id: string; supplier_product_id: string | null }[]>();
  for (const v of varsRes.data ?? []) {
    const pid = String(v.product_id);
    const list = varsByProd.get(pid) ?? [];
    list.push({
      id: String(v.id),
      item_id: String(v.item_id),
      supplier_product_id: staff.canSeeCosts ? (varSupMap.get(String(v.id))?.supplier_product_id ?? null) : null,
    });
    varsByProd.set(pid, list);
  }

  const routesByProd = new Map<
    string,
    {
      countries: Set<string>;
      activeCount: number;
      rows: {
        destination_country: string;
        shipping_method: string;
        incoterm: 'DDP' | 'DAP';
        landed_price_cents: number;
        est_shipping_cents: number;
        est_duties_cents: number;
        is_active: boolean;
      }[];
    }
  >();
  for (const r of routesRes.data ?? []) {
    const pid = String(r.product_id);
    const cur = routesByProd.get(pid) ?? { countries: new Set<string>(), activeCount: 0, rows: [] };
    const country = String(r.destination_country).trim();
    if (r.is_active) {
      cur.countries.add(country);
      cur.activeCount++;
    }
    cur.rows.push({
      destination_country: country,
      shipping_method: String(r.shipping_method),
      incoterm: (r.incoterm === 'DAP' ? 'DAP' : 'DDP') as 'DDP' | 'DAP',
      landed_price_cents: Number(r.landed_price_cents ?? 0),
      est_shipping_cents: Number(r.est_shipping_cents ?? 0),
      est_duties_cents: Number(r.est_duties_cents ?? 0),
      is_active: Boolean(r.is_active),
    });
    routesByProd.set(pid, cur);
  }

  const allProds = prodsRes.data ?? [];

  // Classify each product for filter chips & supplier-verification pause banner
  const prodMeta = new Map<
    string,
    {
      primaryIm: ItemMasterRow | undefined;
      needsHsReview: boolean;
      needsData: boolean;
      supplierPaused: boolean;
      flags: string[];
    }
  >();

  let hsReviewCount = 0;
  let missingDataCount = 0;
  let draftCount = 0;
  let supplierPausedCount = 0;

  for (const p of allProds) {
    const pid = String(p.id);
    const pVars = varsByProd.get(pid) ?? [];
    const ims = pVars.map((v) => itemById.get(v.item_id)).filter((x): x is ItemMasterRow => !!x);
    const primaryIm = ims[0];

    const needsHsReview =
      p.status !== 'archived' &&
      (Boolean(p.needs_review) || ims.length === 0 || ims.some((im) => !im.hs_code || !im.hs_verified));
    const needsData =
      p.status !== 'archived' &&
      (ims.length === 0 || ims.some((im) => Boolean(im.needs_data)) || (p.images ?? []).length === 0);

    const pLinks = linksByProd.get(pid) ?? [];
    const supplierPaused =
      p.status === 'active' &&
      pLinks.some((l) => l.supplier_product_id && !l.supplier_verified);

    if (needsHsReview) hsReviewCount++;
    if (needsData) missingDataCount++;
    if (p.status === 'draft') draftCount++;
    if (supplierPaused) supplierPausedCount++;

    const flags: string[] = [];
    if (ims.some((im) => im.has_battery)) flags.push('Battery');
    if (ims.some((im) => im.has_liquid)) flags.push('Liquid');
    if (ims.some((im) => im.has_magnet)) flags.push('Magnet');
    if (ims.some((im) => im.has_powder)) flags.push('Powder');
    if (ims.some((im) => im.is_fragile)) flags.push('Fragile');

    prodMeta.set(pid, { primaryIm, needsHsReview, needsData, supplierPaused, flags });
  }

  const q = (sp.q ?? '').trim().toLowerCase();
  const statusFilter = ['draft', 'active', 'archived'].includes(sp.status ?? '')
    ? sp.status!
    : '';
  const viewChip = ['hs_review', 'missing_data', 'drafts'].includes(sp.view ?? '')
    ? sp.view!
    : '';
  const supplierFilter = staff.canSeeCosts && sp.supplier ? sp.supplier : '';

  const rows = allProds.filter((p) => {
    const pid = String(p.id);
    const meta = prodMeta.get(pid);
    if (viewChip === 'hs_review' && !meta?.needsHsReview) return false;
    if (viewChip === 'missing_data' && !meta?.needsData) return false;
    if (viewChip === 'drafts' && p.status !== 'draft') return false;
    if (statusFilter && p.status !== statusFilter) return false;
    if (supplierFilter) {
      const linked = linksByProd.get(pid) ?? [];
      if (!linked.some((l) => l.supplier_id === supplierFilter)) return false;
    }
    if (q) {
      const match =
        String(p.title ?? '').toLowerCase().includes(q) ||
        String(p.model_no ?? '').toLowerCase().includes(q) ||
        String(p.category ?? '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  // Select product for the live HS & Routes split review panel
  const selectedProd =
    rows.find((r) => String(r.id) === sp.review) ??
    rows.find((r) => prodMeta.get(String(r.id))?.needsHsReview) ??
    rows[0] ??
    null;

  let reviewPayload: ReviewProductPayload | null = null;
  if (selectedProd) {
    const selId = String(selectedProd.id);
    const selMeta = prodMeta.get(selId);
    const selIm = selMeta?.primaryIm;
    const selLinks = linksByProd.get(selId) ?? [];
    const selPrimaryLink = selLinks.find((l) => l.supplier_product_id) ?? null;

    const { data: chkRaw } = await sb.rpc('get_dropship_publish_checklist', {
      p_product_id: selId,
    });
    const checklist: PublishChecklistResult = (chkRaw as PublishChecklistResult | null) ?? {
      ok: false,
      ready: false,
      blockers: [],
      warnings: [],
      checks: [],
    };

    const rcMap = new Map<
      string,
      { base_cents: number; per_100g_cents: number; step_g: number; volumetric_divisor: number }
    >();
    for (const rc of rateCardsRes.data ?? []) {
      const k = `${String(rc.country).trim()}:${String(rc.method)}`;
      if (!rcMap.has(k)) {
        rcMap.set(k, {
          base_cents: Number(rc.base_cents),
          per_100g_cents: Number(rc.per_100g_cents),
          step_g: Number(rc.step_g || 100),
          volumetric_divisor: Number(rc.volumetric_divisor || 5000),
        });
      }
    }

    const processingCents = feeVerRes.data
      ? Number(feeVerRes.data.pick_pack_first_cents) + Number(feeVerRes.data.packaging_cents)
      : null;

    const lookupDutyEntry = (country: string, hsRaw: string | null) => {
      const digits = String(hsRaw ?? '').replace(/[^0-9]/g, '');
      const candidates = (activeDutyEntriesRes.data ?? []).filter((e) => {
        if (String(e.country).trim() !== country) return false;
        if (!e.hs_prefix) return true;
        const pref = String(e.hs_prefix).replace(/[^0-9]/g, '');
        return digits.length > 0 && digits.startsWith(pref);
      });
      if (candidates.length === 0) return null;
      candidates.sort(
        (a, b) =>
          String(b.hs_prefix ?? '').replace(/[^0-9]/g, '').length -
          String(a.hs_prefix ?? '').replace(/[^0-9]/g, '').length,
      );
      return candidates[0];
    };

    const selRoutes = routesByProd.get(selId)?.rows ?? [];
    const unitPurchaseCost =
      staff.canSeeCosts && selPrimaryLink?.unit_cost_cents != null
        ? Number(selPrimaryLink.unit_cost_cents)
        : 0;
    const catMinBp =
      selectedProd.category && cfg.categoryMinMarginBp[String(selectedProd.category)] != null
        ? cfg.categoryMinMarginBp[String(selectedProd.category)]
        : cfg.minMarginBp;

    const routesSplit = selRoutes.map((rt) => {
      const rc = rcMap.get(`${rt.destination_country}:${rt.shipping_method}`);
      let billedWeightG: number | null = null;
      if (
        rc &&
        selIm?.weight_g &&
        selIm?.box_l_cm &&
        selIm?.box_w_cm &&
        selIm?.box_h_cm
      ) {
        const volG = Math.ceil(
          ((Number(selIm.box_l_cm) * Number(selIm.box_w_cm) * Number(selIm.box_h_cm)) /
            rc.volumetric_divisor) *
            1000,
        );
        const rawG = Math.max(Number(selIm.weight_g), volG);
        billedWeightG = Math.ceil(rawG / rc.step_g) * rc.step_g;
      }

      const shippingCents =
        rc && billedWeightG != null
          ? rc.base_cents + Math.round(billedWeightG / rc.step_g) * rc.per_100g_cents
          : null;

      const productCents =
        selectedProd.product_price_cents != null
          ? Number(selectedProd.product_price_cents)
          : Math.max(
              0,
              rt.landed_price_cents - rt.est_shipping_cents - rt.est_duties_cents,
            );

      let dutiesStatus: 'known' | 'missing' | 'dap' = 'known';
      let dutiesCents: number | null = 0;
      if (rt.incoterm === 'DAP') {
        dutiesStatus = 'dap';
        dutiesCents = 0;
      } else {
        const de = lookupDutyEntry(rt.destination_country, selIm?.hs_code ?? null);
        if (!de) {
          dutiesStatus = 'missing';
          dutiesCents = null;
        } else {
          const dutyBp = Number(de.duty_bp ?? 0);
          const taxBp = Number(de.tax_bp ?? 0);
          const deMin = Number(de.de_minimis_cents ?? 0);
          const appliesTo = String(de.de_minimis_applies_to ?? 'duty');
          if (productCents <= deMin) {
            dutiesCents =
              appliesTo === 'duty_and_tax' ? 0 : Math.round((productCents * taxBp) / 10000);
          } else {
            dutiesCents = Math.round((productCents * (dutyBp + taxBp)) / 10000);
          }
        }
      }

      const landedCents =
        processingCents != null && shippingCents != null && dutiesCents != null
          ? productCents + processingCents + shippingCents + dutiesCents
          : null;

      const ourCostCents =
        staff.canSeeCosts && processingCents != null && shippingCents != null
          ? unitPurchaseCost + processingCents + shippingCents + (dutiesCents ?? 0)
          : null;

      const marginPct =
        staff.canSeeCosts && landedCents != null && landedCents > 0 && ourCostCents != null
          ? ((landedCents - ourCostCents) / landedCents) * 100
          : null;

      return {
        country: rt.destination_country,
        method: rt.shipping_method,
        incoterm: rt.incoterm,
        product_cents: productCents,
        processing_cents: processingCents,
        shipping_cents: shippingCents,
        duties_cents: dutiesCents,
        duties_status: dutiesStatus,
        landed_cents: landedCents,
        our_cost_cents: staff.canSeeCosts ? ourCostCents : null,
        margin_pct: staff.canSeeCosts ? marginPct : null,
        margin_below_min: marginPct != null ? marginPct * 100 < catMinBp : false,
      };
    });

    reviewPayload = {
      id: selId,
      model_no: String(selectedProd.model_no),
      title: String(selectedProd.title),
      status: (selectedProd.status as 'draft' | 'active' | 'archived') ?? 'draft',
      needs_review: Boolean(selectedProd.needs_review),
      needs_review_reason: selectedProd.needs_review_reason
        ? String(selectedProd.needs_review_reason)
        : null,
      // Correction 5: Support (!canSeeCosts) NEVER receives Sourcing model no.
      sourcing_sku: staff.canSeeCosts ? selPrimaryLink?.sourcing_sku ?? null : null,
      hs_code: selIm?.hs_code ? String(selIm.hs_code) : '',
      origin_country: selIm?.origin_country
        ? String(selIm.origin_country).trim()
        : selectedProd.origin_country
          ? String(selectedProd.origin_country).trim()
          : '',
      hs_verified: Boolean(selIm?.hs_verified),
      has_battery: Boolean(selIm?.has_battery),
      has_liquid: Boolean(selIm?.has_liquid),
      has_magnet: Boolean(selIm?.has_magnet),
      has_powder: Boolean(selIm?.has_powder),
      visible_to_org_id: selectedProd.visible_to_org_id
        ? String(selectedProd.visible_to_org_id)
        : null,
      checklist,
      routesSplit,
    };
  }

  const chipHref = (v: string) => {
    const params = new URLSearchParams();
    if (sp.q) params.set('q', sp.q);
    if (statusFilter) params.set('status', statusFilter);
    if (supplierFilter) params.set('supplier', supplierFilter);
    if (v) params.set('view', v);
    const qs = params.toString();
    return qs ? `/office/dropship?${qs}` : '/office/dropship';
  };

  return (
    <div data-testid="staff-dropship-list">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="m-0 text-[26px] font-bold leading-tight flex items-center gap-3 flex-wrap text-[#1A174A]">
            <span
              data-page-icon=""
              aria-hidden="true"
              className="w-10 h-10 rounded-[10px] bg-[#E6EFFB] text-[#2A6FD1] inline-flex items-center justify-center shrink-0"
            >
              <DsIcon name="package" size={20} strokeWidth={2} />
            </span>
            <span>Dropship products</span>
          </h1>
          <p className="text-[14px] text-[#5B6478] mt-1.5 mb-0">
            /office/dropship · what merchants can buy, and what they must never see.
            {!staff.canEdit && (
              <span className="ml-2 ds-badge ds-badge-neutral">
                Read-only ({staff.isSupportOnly ? 'Support — cost & supplier hidden' : 'Finance'})
              </span>
            )}
          </p>
        </div>
        {staff.canEdit && (
          <div className="flex flex-wrap gap-2.5">
            <Link
              href="/office/dropship/import"
              className="ds-btn ds-btn-secondary"
              data-testid="csv-import-link"
            >
              <DsIcon name="upload" size={16} />
              Import products
            </Link>
            <Link
              href="/office/dropship/new"
              className="ds-btn ds-btn-primary"
              data-testid="add-product-link"
            >
              <DsIcon name="plus" size={16} />
              Add product
            </Link>
          </div>
        )}
      </header>

      {/* States-Staff.html: Supplier lost verification banner */}
      {staff.canSeeCosts && supplierPausedCount > 0 && (
        <div
          role="status"
          className="mt-4 flex flex-wrap items-center justify-between gap-3.5 rounded-[12px] border border-[#F2C4C2] bg-[#FEF4F4] px-4 py-3.5"
          data-testid="supplier-paused-banner"
        >
          <div className="min-w-0 flex-1">
            <strong className="text-[14px] text-[#1A174A]">
              {supplierPausedCount} {supplierPausedCount === 1 ? 'product' : 'products'} paused
            </strong>
            <p className="m-0 mt-1 text-[13px] text-[#5B6478]">
              Their supplier is no longer verified in Sourcing. Merchants can&apos;t import them;
              pushed products show as out of stock.
            </p>
          </div>
        </div>
      )}

      {/* Filter chips: All, HS review, Missing data, Drafts */}
      <div className="flex flex-wrap gap-2 mt-5" data-testid="staff-filter-chips">
        {[
          ['', `All (${allProds.length})`],
          ['hs_review', `HS review (${hsReviewCount})`],
          ['missing_data', `Missing data (${missingDataCount})`],
          ['drafts', `Drafts (${draftCount})`],
        ].map(([val, label]) => {
          const active = viewChip === val;
          return (
            <Link
              key={val}
              href={chipHref(val)}
              aria-current={active ? 'true' : undefined}
              data-testid={`chip-${val || 'all'}`}
              className={`ds-chip ${active ? 'ds-chip-on' : ''}`}
            >
              {label}
            </Link>
          );
        })}
      </div>

      {/* Search & filters */}
      <form
        action="/office/dropship"
        className="card p-4 mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end"
        data-testid="staff-dropship-filters"
      >
        {viewChip && <input type="hidden" name="view" value={viewChip} />}
        <div>
          <label htmlFor="ds-q" className="k block mb-1.5">
            Search
          </label>
          <input
            id="ds-q"
            name="q"
            defaultValue={sp.q ?? ''}
            placeholder="Title, DS model no. or category"
            className="input"
          />
        </div>
        <div>
          <label htmlFor="ds-status" className="k block mb-1.5">
            Status
          </label>
          <select id="ds-status" name="status" defaultValue={statusFilter} className="input">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        </div>
        {staff.canSeeCosts && (
          <div>
            <label htmlFor="ds-sup" className="k block mb-1.5">
              Supplier
            </label>
            <select id="ds-sup" name="supplier" defaultValue={supplierFilter} className="input">
              <option value="">All suppliers</option>
              {sups.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.legal_name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex gap-2">
          <button type="submit" className="ds-btn ds-btn-primary">
            Filter
          </button>
          {(sp.q || statusFilter || supplierFilter || viewChip) && (
            <Link href="/office/dropship" className="ds-btn ds-btn-secondary">
              Clear
            </Link>
          )}
        </div>
      </form>

      {/* Main products table */}
      <form action={bulkArchiveDropshipProducts} className="card mt-5 p-0 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-[#E3E7EF] flex flex-wrap items-center justify-between gap-3">
          <span className="text-[14px] font-semibold">
            {rows.length} {rows.length === 1 ? 'product' : 'products'}
          </span>
          {staff.canEdit && rows.length > 0 && (
            <button
              type="submit"
              className="ds-btn ds-btn-secondary !min-h-[36px] !px-3 !text-[13px]"
              data-testid="bulk-archive-btn"
            >
              Archive selected
            </button>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="p-8 text-center text-[15px] text-[#5B6478] m-0">
            No Dropshipping products match these filters.
          </p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Dropship products">
            <table className="ds-tbl min-w-[860px]">
              <thead>
                <tr>
                  {staff.canEdit && <th scope="col" className="w-10">Select</th>}
                  <th scope="col">Product</th>
                  {staff.canSeeCosts && (
                    <>
                      <th scope="col">Source (staff only)</th>
                      <th scope="col" className="text-right">Sourcing cost</th>
                    </>
                  )}
                  <th scope="col">Suggested HS code</th>
                  <th scope="col">Where it came from</th>
                  <th scope="col">Flags</th>
                  <th scope="col">Stock &amp; routes</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const id = String(p.id);
                  const meta = prodMeta.get(id);
                  const im = meta?.primaryIm;
                  const rtInfo = routesByProd.get(id);
                  const countries = rtInfo && rtInfo.countries.size > 0
                    ? [...rtInfo.countries].sort().join(', ')
                    : 'None';
                  const prodLinks = linksByProd.get(id) ?? [];
                  const primaryLink = prodLinks.find((l) => l.supplier_product_id) ?? null;
                  const isSelected = reviewPayload?.id === id;

                  const stockText = (() => {
                    if (p.fulfilment_type === 'fast_ship') {
                      const pVars = varsByProd.get(id) ?? [];
                      const avail = pVars.reduce((sum, v) => {
                        const ws = wsByItem.get(v.item_id);
                        return sum + Math.max(0, (ws?.on_hand_qty ?? 0) - (ws?.reserved_qty ?? 0));
                      }, 0);
                      return `3PL: ${avail} avail`;
                    }
                    return 'Extended';
                  })();

                  const reviewQuery = new URLSearchParams();
                  if (sp.q) reviewQuery.set('q', sp.q);
                  if (statusFilter) reviewQuery.set('status', statusFilter);
                  if (supplierFilter) reviewQuery.set('supplier', supplierFilter);
                  if (viewChip) reviewQuery.set('view', viewChip);
                  reviewQuery.set('review', id);

                  return (
                    <tr
                      key={id}
                      className={isSelected ? 'bg-[#F2F7FE]' : undefined}
                      data-testid="staff-product-row"
                    >
                      {staff.canEdit && (
                        <td>
                          <input
                            type="checkbox"
                            name="ids"
                            value={id}
                            aria-label={`Select ${p.title}`}
                            className="w-4 h-4 accent-[#1A174A]"
                          />
                        </td>
                      )}
                      <td>
                        <Link
                          href={`/office/dropship/${id}`}
                          className="font-bold text-[#1A174A] hover:text-[#2A6FD1] hover:underline"
                        >
                          {String(p.title)}
                        </Link>
                        <div className="text-[12px] text-[#5B6478] mt-0.5 flex flex-wrap items-center gap-1.5">
                          <span className="capitalize">{String(p.status)}</span>
                          <span>·</span>
                          <span className="mono font-medium">{String(p.model_no)}</span>
                          {p.visible_to_org_id && (
                            <span className="ds-badge ds-badge-info">1 merchant only</span>
                          )}
                          {p.is_test && (
                            <span className="ds-badge ds-badge-warn">TEST</span>
                          )}
                        </div>
                      </td>

                      {staff.canSeeCosts && (
                        <>
                          <td data-testid="staff-supplier">
                            {primaryLink?.supplier_code ? (
                              <div>
                                <div className="font-medium">
                                  {primaryLink.supplier_code} · {primaryLink.supplier_name}
                                </div>
                                {primaryLink.sourcing_sku && (
                                  <div className="text-[12px] text-[#5B6478] mono">
                                    Sourcing: {primaryLink.sourcing_sku}
                                  </div>
                                )}
                              </div>
                            ) : p.source_type === 'own_warehouse' ? (
                              <span>Own warehouse</span>
                            ) : (
                              <span className="text-[#5B6478]">Unlinked</span>
                            )}
                          </td>
                          <td
                            className="text-right tabular-nums font-semibold whitespace-nowrap"
                            data-testid="staff-unit-cost"
                          >
                            {primaryLink && primaryLink.unit_cost_cents != null
                              ? usd(Number(primaryLink.unit_cost_cents))
                              : 'Not linked'}
                          </td>
                        </>
                      )}

                      <td className="mono whitespace-nowrap">
                        {im?.hs_code || <span className="text-[#5B6478]">Missing</span>}
                      </td>
                      <td className="text-[13px] text-[#5B6478]">
                        {hsSourceLabel(im?.hs_code_source ?? null)}
                      </td>
                      <td>
                        {meta && meta.flags.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {meta.flags.map((fl) => (
                              <span key={fl} className="ds-badge ds-badge-warn">
                                <DsIcon name="alert" size={12} strokeWidth={2.2} />
                                {fl}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="ds-badge ds-badge-neutral">None</span>
                        )}
                      </td>
                      <td className="text-[13px] whitespace-nowrap">
                        <div>{stockText}</div>
                        <div className="text-[12px] text-[#5B6478]">
                          {rtInfo?.activeCount ? `${rtInfo.activeCount} (${countries})` : '0 routes'}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          {meta?.needsHsReview || meta?.needsData ? (
                            <span className="ds-badge ds-badge-warn">
                              <DsIcon name="alert" size={12} strokeWidth={2.2} />
                              Needs review
                            </span>
                          ) : p.status === 'active' ? (
                            <span className="ds-badge ds-badge-ok">
                              <DsIcon name="check" size={12} strokeWidth={2.2} />
                              Checked
                            </span>
                          ) : (
                            <span className="ds-badge ds-badge-neutral capitalize">
                              {String(p.status)}
                            </span>
                          )}
                          <Link
                            href={`/office/dropship?${reviewQuery.toString()}`}
                            className="text-[12.5px] font-semibold text-[#2A6FD1] hover:underline"
                          >
                            Inspect
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </form>

      {/* Split quick review drawer + 4-part routes split (keyed by product id so inputs reset cleanly) */}
      {reviewPayload && (
        <CatalogReviewDrawer
          key={reviewPayload.id}
          selected={reviewPayload}
          orgs={dropshipOrgs}
          canEdit={staff.canEdit}
          canSeeCosts={staff.canSeeCosts}
        />
      )}
    </div>
  );
}
