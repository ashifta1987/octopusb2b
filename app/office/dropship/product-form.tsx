'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { DsIcon } from '@/components/dropship-ui';
import {
  saveDropshipProduct,
  uploadDropshipImage,
  estimateRouteFromRateCard,
  type ProductInput,
  type PublishChecklistResult,
  type SourcingSupplierProductOption,
} from './actions';

export type VariantRow = {
  id?: string | null;
  model_no?: string | null;
  optionsText: string; // "Colour: Black, Size: M"
  supplier_product_id: string;
  price_adjust_cents: number;
  on_hand_qty?: number;
  reserved_qty?: number;
  available_qty?: number;
};

export type RouteRow = {
  destination_country: string;
  shipping_method: 'express' | 'standard' | 'economy';
  incoterm: 'DDP' | 'DAP';
  landed_price_cents: number;
  est_shipping_cents: number;
  est_duties_cents: number;
  est_days_min: number;
  est_days_max: number;
  carrier: string;
  is_active: boolean;
};

export type PriceTierRow = {
  min_qty: number;
  unit_price_cents: number;
};

export type RateCardHint = {
  country: string;
  method: string;
  base_cents: number;
  per_100g_cents: number;
  step_g: number;
  volumetric_divisor: number;
  max_weight_g: number;
  allows_battery: boolean;
  allows_liquid: boolean;
  allows_magnet: boolean;
  allows_powder: boolean;
};

export type DutyEntryHint = {
  country: string;
  hs_prefix: string | null;
  duty_bp: number;
  tax_bp: number;
  de_minimis_cents: number;
  de_minimis_applies_to: string;
};

export type ProductHistoryItem = {
  id: string;
  action: string;
  created_at: string;
  actor_label: string;
  summary: string;
};

export type InitialProductData = {
  id?: string | null;
  model_no?: string | null;
  title: string;
  description: string;
  category: string;
  images: string[];
  flagged_images: string[];
  specsText: string;
  weight_g: number | null;
  dim_l: string;
  dim_w: string;
  dim_h: string;
  min_order_qty: number;
  product_price_cents: number | null;
  source_type: 'own_warehouse' | 'partner_supplier';
  fulfilment_type: 'fast_ship' | 'extended_catalog';
  default_supplier_product_id: string;
  visible_to_org_id: string;
  origin_country: string;
  hs_code: string;
  hs_verified: boolean;
  has_battery: boolean;
  has_liquid: boolean;
  has_magnet: boolean;
  has_powder: boolean;
  is_fragile: boolean;
  status: 'draft' | 'active' | 'archived';
  needs_review: boolean;
  needs_review_reason: string | null;
  import_job_code: string | null;
  created_at_label: string | null;
  variants: VariantRow[];
  routes: RouteRow[];
  price_tiers: PriceTierRow[];
  checklist?: PublishChecklistResult;
  history: ProductHistoryItem[];
};

const ORIGIN_OPTIONS: [string, string][] = [
  ['', 'Select country of origin…'],
  ['CN', 'China (CN)'],
  ['VN', 'Vietnam (VN)'],
  ['IN', 'India (IN)'],
  ['TR', 'Turkey (TR)'],
  ['MY', 'Malaysia (MY)'],
  ['TH', 'Thailand (TH)'],
  ['ID', 'Indonesia (ID)'],
  ['KR', 'South Korea (KR)'],
  ['TW', 'Taiwan (TW)'],
  ['DE', 'Germany (DE)'],
  ['GB', 'United Kingdom (GB)'],
  ['US', 'United States (US)'],
  ['AE', 'United Arab Emirates (AE)'],
];

const usd = (c: number) =>
  `US$ ${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function parseKeyValLines(text: string, sep = '\n'): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(sep)) {
    const idx = part.indexOf(':');
    if (idx <= 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k && v) out[k] = v;
  }
  return out;
}

export function DropshipProductForm({
  initial,
  supplierProducts,
  categories,
  supportedCountries,
  dropshipOrgs,
  rateCards,
  dutyEntries,
  processingFeeCents,
  canEdit,
  canSeeCosts,
  minMarginBp,
  categoryMinMarginBp,
}: {
  initial: InitialProductData;
  supplierProducts: SourcingSupplierProductOption[];
  categories: string[];
  supportedCountries: string[];
  dropshipOrgs: { id: string; name: string }[];
  rateCards: RateCardHint[];
  dutyEntries: DutyEntryHint[];
  processingFeeCents: number | null;
  canEdit: boolean;
  canSeeCosts: boolean;
  minMarginBp: number;
  categoryMinMarginBp: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [category, setCategory] = useState(initial.category);
  const [images, setImages] = useState<string[]>(initial.images);
  const [flaggedImages, setFlaggedImages] = useState<string[]>(initial.flagged_images);
  const [specsText, setSpecsText] = useState(initial.specsText);
  const [weightGStr, setWeightGStr] = useState(
    initial.weight_g && initial.weight_g > 0 ? String(initial.weight_g) : '',
  );
  const [dimL, setDimL] = useState(initial.dim_l);
  const [dimW, setDimW] = useState(initial.dim_w);
  const [dimH, setDimH] = useState(initial.dim_h);
  const [moq, setMoq] = useState(initial.min_order_qty);
  const [productPriceCentsStr, setProductPriceCentsStr] = useState(
    initial.product_price_cents != null ? String(initial.product_price_cents) : '',
  );
  const [sourceType, setSourceType] = useState<'own_warehouse' | 'partner_supplier'>(
    initial.source_type,
  );
  const [fulfilmentType, setFulfilmentType] = useState<'fast_ship' | 'extended_catalog'>(
    initial.fulfilment_type,
  );
  const [defaultSpId, setDefaultSpId] = useState(initial.default_supplier_product_id);
  const [visibleToOrgId, setVisibleToOrgId] = useState(initial.visible_to_org_id);
  const [originCountry, setOriginCountry] = useState(initial.origin_country);
  const [hsCode, setHsCode] = useState(initial.hs_code);
  const [hsVerified, setHsVerified] = useState(initial.hs_verified);
  const [hasBattery, setHasBattery] = useState(initial.has_battery);
  const [hasLiquid, setHasLiquid] = useState(initial.has_liquid);
  const [hasMagnet, setHasMagnet] = useState(initial.has_magnet);
  const [hasPowder, setHasPowder] = useState(initial.has_powder);
  const [isFragile, setIsFragile] = useState(initial.is_fragile);
  const [status, setStatus] = useState<'draft' | 'active' | 'archived'>(initial.status);
  const [variants, setVariants] = useState<VariantRow[]>(initial.variants);
  const [routes, setRoutes] = useState<RouteRow[]>(initial.routes);
  const [priceTiers, setPriceTiers] = useState<PriceTierRow[]>(initial.price_tiers);
  const [uploading, setUploading] = useState(false);

  const spById = useMemo(
    () => new Map(supplierProducts.map((sp) => [sp.supplier_product_id, sp])),
    [supplierProducts],
  );

  const primarySp = useMemo(() => {
    if (!canSeeCosts) return undefined;
    const firstVarSp = variants.find((v) => v.supplier_product_id)?.supplier_product_id;
    return spById.get(firstVarSp || defaultSpId);
  }, [canSeeCosts, variants, defaultSpId, spById]);

  const effectiveUnitCostCents = canSeeCosts ? Number(primarySp?.unit_cost_cents ?? 0) : 0;

  const effectiveMinMarginBp =
    category && categoryMinMarginBp[category] != null
      ? categoryMinMarginBp[category]
      : minMarginBp;

  const weightGNum = Number(weightGStr) > 0 ? Math.round(Number(weightGStr)) : 0;
  const dimLNum = Number(dimL) > 0 ? Number(dimL) : 0;
  const dimWNum = Number(dimW) > 0 ? Number(dimW) : 0;
  const dimHNum = Number(dimH) > 0 ? Number(dimH) : 0;

  // Live billed weight preview (divisor 5000, step 100 g)
  const billedWeightInfo = useMemo(() => {
    if (weightGNum <= 0 || dimLNum <= 0 || dimWNum <= 0 || dimHNum <= 0) {
      return { billedG: null as number | null, label: 'Weight/size missing' };
    }
    const volG = Math.ceil(((dimLNum * dimWNum * dimHNum) / 5000) * 1000);
    const rawG = Math.max(weightGNum, volG);
    const billedG = Math.ceil(rawG / 100) * 100;
    const basis = volG > weightGNum ? 'box size, divisor 5,000' : 'actual weight';
    return {
      billedG,
      label: `${(billedG / 1000).toFixed(2)} kg (${billedG.toLocaleString('en-US')} g · ${basis})`,
    };
  }, [weightGNum, dimLNum, dimWNum, dimHNum]);

  const rcByKey = useMemo(() => {
    const m = new Map<string, RateCardHint>();
    for (const rc of rateCards) {
      const k = `${rc.country}:${rc.method}`;
      if (!m.has(k)) m.set(k, rc);
    }
    return m;
  }, [rateCards]);

  const lookupDuty = (country: string, hsRaw: string) => {
    const digits = hsRaw.replace(/[^0-9]/g, '');
    const cands = dutyEntries.filter((e) => {
      if (e.country !== country) return false;
      if (!e.hs_prefix) return true;
      const pref = e.hs_prefix.replace(/[^0-9]/g, '');
      return digits.length > 0 && digits.startsWith(pref);
    });
    if (cands.length === 0) return null;
    cands.sort(
      (a, b) =>
        (b.hs_prefix ?? '').replace(/[^0-9]/g, '').length -
        (a.hs_prefix ?? '').replace(/[^0-9]/g, '').length,
    );
    return cands[0];
  };

  // Live client-side publish checklist (mirrors get_dropship_publish_checklist)
  const liveChecklist = useMemo(() => {
    const blockers: string[] = [];
    const checks: { key: string; ok: boolean; label: string }[] = [];

    const contentOk =
      title.trim().length >= 3 && description.trim().length > 0 && images.length >= 1;
    if (!title.trim()) blockers.push('Title is empty');
    if (!description.trim()) blockers.push('Description is empty');
    if (images.length < 1) blockers.push('Add at least 1 product image');
    checks.push({
      key: 'content_images',
      ok: contentOk,
      label: contentOk
        ? `Title, description, ${images.length} ${images.length === 1 ? 'image' : 'images'}`
        : images.length < 1
          ? 'Title, description, at least 1 image required'
          : 'Title and description required',
    });

    const hasLinkedSp =
      sourceType === 'own_warehouse' ||
      Boolean(defaultSpId) ||
      variants.some((v) => Boolean(v.supplier_product_id));
    if (!hasLinkedSp) blockers.push('Supplier missing in Sourcing');
    checks.push({
      key: 'supplier_verified',
      ok: hasLinkedSp,
      label: hasLinkedSp ? 'Supplier verified in Sourcing' : 'Supplier missing in Sourcing',
    });

    const physOk =
      Boolean(originCountry.trim()) &&
      weightGNum > 0 &&
      dimLNum > 0 &&
      dimWNum > 0 &&
      dimHNum > 0;
    if (!physOk) blockers.push('Weight, box size, or country of origin missing');
    checks.push({
      key: 'physical_data',
      ok: physOk,
      label: physOk ? 'Weight, box size, origin' : 'Weight, box size, or origin missing',
    });

    const hsOk = Boolean(hsCode.trim()) && hsVerified;
    if (!hsOk) blockers.push('HS code not checked');
    checks.push({
      key: 'hs_verified',
      ok: hsOk,
      label: hsOk ? 'HS code checked' : 'HS code not checked',
    });

    const activeRoutes = routes.filter((r) => r.is_active);
    const routeIssues: string[] = [];
    if (activeRoutes.length === 0) {
      routeIssues.push('Add at least 1 active shipping route');
    } else if (processingFeeCents == null) {
      routeIssues.push('No active processing fee schedule');
    } else {
      for (const rt of activeRoutes) {
        const rc = rcByKey.get(`${rt.destination_country}:${rt.shipping_method}`);
        if (!rc) {
          routeIssues.push(`${rt.destination_country} (${rt.shipping_method}): no shipping rate set`);
        } else if (
          (hasBattery && !rc.allows_battery) ||
          (hasLiquid && !rc.allows_liquid) ||
          (hasMagnet && !rc.allows_magnet) ||
          (hasPowder && !rc.allows_powder)
        ) {
          routeIssues.push(
            `${rt.destination_country} (${rt.shipping_method}): restricted goods not supported`,
          );
        }
        // Correction 7: Missing duty blocks ONLY DDP routes; DAP routes show "Duties paid by buyer"
        if (rt.incoterm === 'DDP' && !lookupDuty(rt.destination_country, hsCode)) {
          routeIssues.push(`${rt.destination_country} route (${rt.shipping_method}): duty not set`);
        }
      }
    }
    blockers.push(...routeIssues);
    checks.push({
      key: 'routes_ready',
      ok: routeIssues.length === 0,
      label:
        routeIssues.length === 0
          ? `${activeRoutes.length} active ${activeRoutes.length === 1 ? 'route' : 'routes'}`
          : routeIssues[0],
    });

    return {
      ready: blockers.length === 0,
      blockers,
      checks,
      warnings:
        flaggedImages.length > 0
          ? [`${flaggedImages.length} ${flaggedImages.length === 1 ? 'image' : 'images'} flagged`]
          : [],
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    title,
    description,
    images,
    sourceType,
    defaultSpId,
    variants,
    originCountry,
    weightGNum,
    dimLNum,
    dimWNum,
    dimHNum,
    hsCode,
    hsVerified,
    routes,
    processingFeeCents,
    rcByKey,
    hasBattery,
    hasLiquid,
    hasMagnet,
    hasPowder,
    flaggedImages,
  ]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (images.length >= 10) {
      setMsg({ ok: false, text: 'Maximum 10 images per product.' });
      return;
    }
    setUploading(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.set('file', file);
      fd.set('title', title || 'Product image');
      fd.set('product_id', initial.id ?? 'draft');
      const res = await uploadDropshipImage(fd);
      if (res.ok) {
        setImages((prev) => [...prev, res.url]);
        setMsg({ ok: true, text: 'Image verified, EXIF stripped and uploaded with random file name.' });
      } else {
        setMsg({ ok: false, text: res.error });
      }
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const prefillRouteFromRateCard = async (idx: number) => {
    const r = routes[idx];
    if (!r) return;
    const est = await estimateRouteFromRateCard({
      weight_g: billedWeightInfo.billedG ?? (weightGNum || 250),
      unit_cost_cents: effectiveUnitCostCents,
      country: r.destination_country,
      method: r.shipping_method,
    });
    if (!est) {
      setMsg({
        ok: false,
        text: `No rate-card entry for ${r.destination_country} (${r.shipping_method}).`,
      });
      return;
    }
    const dutyPart = r.incoterm === 'DAP' ? 0 : est.est_duties_cents;
    const baseCost = effectiveUnitCostCents + est.est_shipping_cents + dutyPart;
    const suggestedLanded = Math.max(
      baseCost + 100,
      Math.ceil((baseCost * 10000) / Math.max(1000, 10000 - effectiveMinMarginBp)),
    );
    setRoutes((prev) =>
      prev.map((row, i) =>
        i === idx
          ? {
              ...row,
              est_shipping_cents: est.est_shipping_cents,
              est_duties_cents: dutyPart,
              est_days_min: est.est_days_min,
              est_days_max: est.est_days_max,
              landed_price_cents: row.landed_price_cents > 0 ? row.landed_price_cents : suggestedLanded,
            }
          : row,
      ),
    );
  };

  const submitWithStatus = (targetStatus: 'draft' | 'active' | 'archived') => {
    setMsg(null);
    const dims =
      dimLNum > 0 || dimWNum > 0 || dimHNum > 0
        ? {
            ...(dimLNum > 0 ? { l: dimLNum } : {}),
            ...(dimWNum > 0 ? { w: dimWNum } : {}),
            ...(dimHNum > 0 ? { h: dimHNum } : {}),
          }
        : null;

    const payload: ProductInput = {
      id: initial.id ?? null,
      title,
      description: description || null,
      category: category || null,
      images,
      flagged_images: flaggedImages,
      specs: parseKeyValLines(specsText, '\n'),
      weight_g: weightGNum,
      dimensions_cm: dims,
      min_order_qty: Number(moq) || 1,
      product_price_cents:
        productPriceCentsStr.trim() !== '' ? Math.max(0, Math.round(Number(productPriceCentsStr))) : null,
      source_type: sourceType,
      fulfilment_type: fulfilmentType,
      default_supplier_product_id: defaultSpId || null,
      visible_to_org_id: visibleToOrgId || null,
      origin_country: originCountry.trim() ? originCountry.trim().toUpperCase() : null,
      hs_code: hsCode.trim() || null,
      hs_verified: hsVerified,
      has_battery: hasBattery,
      has_liquid: hasLiquid,
      has_magnet: hasMagnet,
      has_powder: hasPowder,
      is_fragile: isFragile,
      status: targetStatus,
      variants: variants.map((v) => ({
        id: v.id ?? null,
        options: parseKeyValLines(v.optionsText, ','),
        supplier_product_id: v.supplier_product_id || defaultSpId || null,
        price_adjust_cents: Number(v.price_adjust_cents) || 0,
      })),
      routes: routes.map((r) => ({
        destination_country: r.destination_country,
        shipping_method: r.shipping_method,
        incoterm: r.incoterm,
        landed_price_cents: Number(r.landed_price_cents) || 0,
        est_shipping_cents: Number(r.est_shipping_cents) || 0,
        est_duties_cents: r.incoterm === 'DAP' ? 0 : Number(r.est_duties_cents) || 0,
        est_days_min: Number(r.est_days_min) || 1,
        est_days_max: Number(r.est_days_max) || 1,
        carrier: r.carrier || null,
        is_active: r.is_active,
      })),
      price_tiers: priceTiers.map((t) => ({
        min_qty: Math.max(1, Math.round(Number(t.min_qty) || 1)),
        unit_price_cents: Math.max(0, Math.round(Number(t.unit_price_cents) || 0)),
      })),
    };

    startTransition(async () => {
      const res = await saveDropshipProduct(payload);
      if (res.ok) {
        setStatus(targetStatus);
        setMsg({
          ok: true,
          text:
            targetStatus === 'active'
              ? `Product ${res.model_no} published to the Dropshipping catalogue.`
              : `Product ${res.model_no} saved.`,
        });
        if (!initial.id) router.push(`/office/dropship/${res.id}`);
        else router.refresh();
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  };

  return (
    <div className="space-y-5" data-testid="dropship-product-form">
      <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
        <Link href="/office/dropship" className="text-coral-text hover:underline font-medium">
          Products
        </Link>{' '}
        / <span>{title || initial.model_no || 'New product'}</span>
      </nav>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="m-0 text-[26px] font-bold flex items-center gap-3 flex-wrap text-ink">
            <span
              data-page-icon=""
              aria-hidden="true"
              className="w-10 h-10 rounded-[10px] bg-tint text-coral-text inline-flex items-center justify-center shrink-0"
            >
              <DsIcon name="pencil" size={20} strokeWidth={2} />
            </span>
            <span>{initial.id ? title || initial.model_no : 'Add Dropshipping product'}</span>
            <span
              className={`ds-badge ${
                status === 'active' ? 'ds-badge-ok' : 'ds-badge-neutral'
              } capitalize`}
            >
              {status}
            </span>
            {initial.needs_review && (
              <span className="ds-badge ds-badge-warn" data-testid="editor-needs-review-badge">
                <DsIcon name="alert" size={12} strokeWidth={2.2} />
                Needs review
              </span>
            )}
          </h1>
          {initial.import_job_code ? (
            <p className="m-0 mt-1.5 text-[14px] text-muted">
              Created by import <span className="mono">{initial.import_job_code}</span>
              {initial.created_at_label ? ` on ${initial.created_at_label}` : ''}
            </p>
          ) : initial.created_at_label ? (
            <p className="m-0 mt-1.5 text-[14px] text-muted">
              Created on {initial.created_at_label}
            </p>
          ) : null}
        </div>

        {canEdit && (
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              disabled={pending}
              onClick={() => submitWithStatus('draft')}
              className="ds-btn ds-btn-secondary"
              data-testid="save-draft-btn"
            >
              <DsIcon name="check" size={16} />
              {pending ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="button"
              disabled={pending || !liveChecklist.ready}
              onClick={() => submitWithStatus('active')}
              className="ds-btn ds-btn-primary"
              data-testid="publish-btn"
            >
              {pending ? 'Publishing…' : 'Publish'}
            </button>
            {initial.id && status !== 'archived' && (
              <button
                type="button"
                disabled={pending}
                onClick={() => submitWithStatus('archived')}
                className="ds-btn ds-btn-danger"
                data-testid="archive-btn"
              >
                Archive
              </button>
            )}
          </div>
        )}
      </header>

      {msg && (
        <div
          role={msg.ok ? 'status' : 'alert'}
          data-testid="form-message"
          className={`rounded-[12px] px-4 py-3.5 text-[14px] font-medium border ${
            msg.ok
              ? 'bg-ok-soft border-ok-line text-ok'
              : 'bg-bad-bg border-bad/30 text-bad'
          }`}
        >
          {msg.text}
        </div>
      )}

      {initial.needs_review && initial.needs_review_reason && (
        <div
          role="status"
          className="rounded-[12px] border border-warn-line bg-warn-bg px-4 py-3 text-[13.5px] text-warn"
          data-testid="editor-needs-review-alert"
        >
          <strong>Needs review:</strong> {initial.needs_review_reason}
        </div>
      )}

      <div className="flex flex-wrap gap-4 items-start">
        {/* Main left column */}
        <div className="flex-[3_1_640px] min-w-0 flex flex-col gap-4">
          {/* 1. Identity (Cost, Supplier & Sourcing model no. strictly gated by canSeeCosts — Correction 5) */}
          <section className="card p-5 space-y-4" data-testid="identity-section">
            <h2 className="m-0 text-[18px] font-bold flex items-center gap-2 text-ink">
              <DsIcon name="file" size={18} className="text-coral-text" />
              <span>Identity</span>
            </h2>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <span className="ds-label !mb-0.5">Dropship model no.</span>
                <strong className="mono text-[15px]" data-testid="input-model-no">
                  {initial.model_no ?? 'Auto-assigned on save (DS-XXXXXX)'}
                </strong>
                <div className="text-[12px] text-muted">Locked</div>
              </div>

              {canSeeCosts && (
                <>
                  <div data-testid="editor-sourcing-model">
                    <span className="ds-label !mb-0.5">Sourcing model no. (staff only)</span>
                    <strong className="mono text-[15px]">
                      {primarySp?.sourcing_sku ?? 'Not linked'}
                    </strong>
                    <div className="text-[12px] text-muted">Link to the Sourcing item</div>
                  </div>
                  <div data-testid="editor-supplier">
                    <span className="ds-label !mb-0.5">Supplier (staff only)</span>
                    <strong className="text-[14px] flex items-center gap-1.5 flex-wrap">
                      {primarySp ? (
                        <>
                          <span>
                            {primarySp.supplier_code} · {primarySp.supplier_name}
                          </span>
                          <span className="ds-badge ds-badge-ok">
                            <DsIcon name="check" size={12} strokeWidth={2.2} />
                            Verified
                          </span>
                        </>
                      ) : (
                        <span className="text-muted">Unlinked</span>
                      )}
                    </strong>
                    <div className="text-[12px] text-muted">Owned by Sourcing</div>
                  </div>
                </>
              )}

              <div>
                <label htmlFor="f-fulfilment" className="ds-label">
                  Source &amp; stock mode
                </label>
                <select
                  id="f-fulfilment"
                  disabled={!canEdit}
                  value={fulfilmentType}
                  onChange={(e) => {
                    const ft = e.target.value as 'fast_ship' | 'extended_catalog';
                    setFulfilmentType(ft);
                    setSourceType(ft === 'fast_ship' ? 'own_warehouse' : 'partner_supplier');
                  }}
                  className="ds-input w-full"
                >
                  <option value="fast_ship">Own warehouse (Fast-ship stock)</option>
                  <option value="extended_catalog">Partner supplier (Extended catalogue)</option>
                </select>
                <div className="text-[12px] text-muted mt-1">
                  Merchants see:{' '}
                  {fulfilmentType === 'fast_ship' ? 'Fast-ship stock' : 'Extended catalogue'}
                </div>
              </div>

              {canSeeCosts && (
                <>
                  <div>
                    <label htmlFor="f-sp" className="ds-label">
                      Linked Sourcing item
                    </label>
                    <select
                      id="f-sp"
                      disabled={!canEdit}
                      value={defaultSpId}
                      onChange={(e) => setDefaultSpId(e.target.value)}
                      className="ds-input w-full"
                      data-testid="input-supplier-product"
                    >
                      <option value="">— Not linked —</option>
                      {supplierProducts.map((sp) => (
                        <option key={sp.supplier_product_id} value={sp.supplier_product_id}>
                          {sp.supplier_code} · {sp.sourcing_sku ?? sp.sourcing_title} (
                          {usd(sp.unit_cost_cents)})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div data-testid="staff-cost-supplier-section">
                    <span className="ds-label !mb-0.5">Purchase cost</span>
                    <strong
                      className="mono text-[15px] block py-2"
                      data-testid="readonly-sourcing-cost"
                    >
                      {effectiveUnitCostCents > 0 ? usd(effectiveUnitCostCents) : 'Not linked'}
                    </strong>
                    <div className="text-[12px] text-muted">From Sourcing (read-only)</div>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* 2. Details for merchants */}
          <section className="card p-5 space-y-4" data-testid="merchant-details-section">
            <h2 className="m-0 text-[18px] font-bold flex items-center gap-2 text-ink">
              <DsIcon name="users" size={18} className="text-coral-text" />
              <span>Details for merchants</span>
            </h2>

            <div>
              <label htmlFor="f-title" className="ds-label">
                Title *
              </label>
              <input
                id="f-title"
                disabled={!canEdit}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ceramic pet bowl set, 2 bowls"
                className="ds-input w-full"
                data-testid="input-title"
              />
            </div>

            <div>
              <label htmlFor="f-desc" className="ds-label">
                Description *
              </label>
              <textarea
                id="f-desc"
                rows={3}
                disabled={!canEdit}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="ds-input w-full !py-2.5"
                data-testid="input-description"
              />
              <p className="m-0 mt-1.5 text-[12px] text-muted">
                White-label rule: never include supplier or factory names, supplier codes, or
                manufacturer SKUs.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label htmlFor="f-cat" className="ds-label">
                  Category
                </label>
                <input
                  id="f-cat"
                  list="ds-cat-list"
                  disabled={!canEdit}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="Home"
                  className="ds-input w-full"
                  data-testid="input-category"
                />
                <datalist id="ds-cat-list">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>

              <div>
                <label htmlFor="f-vis" className="ds-label">
                  Visible to
                </label>
                <select
                  id="f-vis"
                  disabled={!canEdit}
                  value={visibleToOrgId}
                  onChange={(e) => setVisibleToOrgId(e.target.value)}
                  className="ds-input w-full"
                  data-testid="input-visible-to"
                >
                  <option value="">All merchants with dropshipping</option>
                  {dropshipOrgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      Only {o.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="f-moq" className="ds-label">
                  Minimum order qty
                </label>
                <input
                  id="f-moq"
                  type="number"
                  min={1}
                  disabled={!canEdit}
                  value={moq}
                  onChange={(e) => setMoq(Number(e.target.value))}
                  className="ds-input w-full mono"
                />
              </div>

              <div>
                <label htmlFor="f-prod-price" className="ds-label">
                  Product price (cents)
                </label>
                <input
                  id="f-prod-price"
                  type="number"
                  min={0}
                  disabled={!canEdit}
                  value={productPriceCentsStr}
                  onChange={(e) => setProductPriceCentsStr(e.target.value)}
                  placeholder="e.g. 980"
                  className="ds-input w-full mono"
                  data-testid="input-product-price-cents"
                />
              </div>
            </div>

            <div>
              <label htmlFor="f-specs" className="ds-label">
                Specifications (one &ldquo;Key: Value&rdquo; per line)
              </label>
              <textarea
                id="f-specs"
                rows={3}
                disabled={!canEdit}
                value={specsText}
                onChange={(e) => setSpecsText(e.target.value)}
                placeholder={'Material: Anodised aluminium\nCapacity: 450 ml'}
                className="ds-input w-full font-mono text-[13px] !py-2"
                data-testid="input-specs"
              />
            </div>
          </section>

          {/* 3. Images (random UUID filename, EXIF stripped via sharp) */}
          <section className="card p-5 space-y-4" data-testid="images-section">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="m-0 text-[18px] font-bold flex items-center gap-2 text-ink">
                  <DsIcon name="image" size={18} className="text-coral-text" />
                  <span>Images ({images.length} / 10)</span>
                </h2>
                <p className="m-0 mt-1 text-[12.5px] text-muted">
                  JPG, PNG or WebP up to 5 MB · re-encoded, location data removed, stored under a
                  random UUID file name.
                </p>
              </div>
              {canEdit && images.length < 10 && (
                <label className="ds-btn ds-btn-secondary cursor-pointer">
                  <DsIcon name="upload" size={16} />
                  {uploading ? 'Processing…' : 'Upload image'}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleImageUpload}
                    disabled={uploading}
                    className="sr-only"
                    data-testid="image-file-input"
                  />
                </label>
              )}
            </div>

            {images.length === 0 ? (
              <p className="m-0 text-[14px] text-muted">
                No photos uploaded yet. At least 1 photo is required before publishing.
              </p>
            ) : (
              <ul className="list-none m-0 p-0 grid gap-3 grid-cols-2 sm:grid-cols-4 md:grid-cols-5">
                {images.map((url, idx) => {
                  const isFlagged = flaggedImages.includes(url);
                  return (
                    <li
                      key={url}
                      className={`rounded-[10px] border p-2 flex flex-col gap-2 ${
                        isFlagged ? 'border-warn-line bg-warn-bg' : 'border-line bg-white'
                      }`}
                      data-testid="uploaded-image-item"
                    >
                      <div className="relative aspect-square rounded overflow-hidden bg-pearl">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={title || 'Product photo'}
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-1 text-[11.5px]">
                        <span className="text-muted">#{idx + 1}</span>
                        {canEdit && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() =>
                                setFlaggedImages((prev) =>
                                  prev.includes(url)
                                    ? prev.filter((u) => u !== url)
                                    : [...prev, url],
                                )
                              }
                              className="text-warn font-semibold hover:underline"
                            >
                              {isFlagged ? 'Unflag' : 'Flag'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setImages((prev) => prev.filter((_, i) => i !== idx));
                                setFlaggedImages((prev) => prev.filter((u) => u !== url));
                              }}
                              className="text-bad font-semibold hover:underline"
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* 4. Shipping and customs data (shared item master) */}
          <section className="card p-5 space-y-4" data-testid="item-master-section">
            <h2 className="m-0 text-[18px] font-bold flex items-center gap-2 text-ink">
              <DsIcon name="globe" size={18} className="text-coral-text" />
              <span>Shipping and customs data (shared item master)</span>
            </h2>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label htmlFor="f-hs" className="ds-label">
                  HS code *
                </label>
                <input
                  id="f-hs"
                  disabled={!canEdit}
                  value={hsCode}
                  onChange={(e) => {
                    setHsCode(e.target.value);
                    if (e.target.value.trim() !== initial.hs_code) {
                      setHsVerified(false);
                    }
                  }}
                  placeholder="e.g. 6912.00"
                  className="ds-input w-full mono"
                  data-testid="input-hs-code"
                />
              </div>

              <div>
                <label htmlFor="f-origin" className="ds-label">
                  Country of origin *
                </label>
                <select
                  id="f-origin"
                  disabled={!canEdit}
                  value={originCountry}
                  onChange={(e) => setOriginCountry(e.target.value)}
                  className="ds-input w-full"
                  data-testid="input-origin-country"
                >
                  {ORIGIN_OPTIONS.map(([code, label]) => (
                    <option key={code} value={code}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label htmlFor="f-weight" className="ds-label">
                  Weight (g) *
                </label>
                <input
                  id="f-weight"
                  type="number"
                  min={1}
                  disabled={!canEdit}
                  value={weightGStr}
                  onChange={(e) => setWeightGStr(e.target.value)}
                  placeholder="e.g. 1450"
                  className="ds-input w-full mono"
                  data-testid="input-weight"
                />
              </div>

              <div>
                <span className="ds-label">Box size L × W × H (cm) *</span>
                <div className="grid grid-cols-3 gap-1.5">
                  <input
                    aria-label="Box length cm"
                    disabled={!canEdit}
                    value={dimL}
                    onChange={(e) => setDimL(e.target.value)}
                    placeholder="L"
                    className="ds-input w-full mono !px-2"
                    data-testid="input-box-l"
                  />
                  <input
                    aria-label="Box width cm"
                    disabled={!canEdit}
                    value={dimW}
                    onChange={(e) => setDimW(e.target.value)}
                    placeholder="W"
                    className="ds-input w-full mono !px-2"
                    data-testid="input-box-w"
                  />
                  <input
                    aria-label="Box height cm"
                    disabled={!canEdit}
                    value={dimH}
                    onChange={(e) => setDimH(e.target.value)}
                    placeholder="H"
                    className="ds-input w-full mono !px-2"
                    data-testid="input-box-h"
                  />
                </div>
              </div>
            </div>

            <div className="rounded-[10px] bg-pearl px-3.5 py-2.5 text-[13px] space-y-1">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-muted">Billed weight</span>
                <span className="font-semibold" data-testid="billed-weight-preview">
                  {billedWeightInfo.label}
                </span>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-muted">Used by</span>
                <span>Dropship, Shipping, 3PL</span>
              </div>
            </div>

            <label className="flex items-center gap-2.5 min-h-[44px] text-[14px] cursor-pointer">
              <input
                type="checkbox"
                disabled={!canEdit || !hsCode.trim()}
                checked={hsVerified}
                onChange={(e) => setHsVerified(e.target.checked)}
                className="w-4 h-4 accent-ink"
                data-testid="input-hs-verified"
              />
              <span>I checked this HS code against the tariff</span>
            </label>

            <fieldset className="border-0 m-0 p-0">
              <legend className="ds-label">Restricted goods &amp; packaging</legend>
              <div className="flex flex-wrap gap-4 text-[14px]">
                {[
                  ['Battery', hasBattery, setHasBattery, 'flag-battery'],
                  ['Liquid', hasLiquid, setHasLiquid, 'flag-liquid'],
                  ['Magnet', hasMagnet, setHasMagnet, 'flag-magnet'],
                  ['Powder', hasPowder, setHasPowder, 'flag-powder'],
                  ['Fragile: protective packaging', isFragile, setIsFragile, 'flag-fragile'],
                ].map(([label, checked, setter, tid]) => (
                  <label
                    key={tid as string}
                    className="flex items-center gap-2 min-h-[44px] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      disabled={!canEdit}
                      checked={checked as boolean}
                      onChange={(e) => (setter as (v: boolean) => void)(e.target.checked)}
                      className="w-4 h-4 accent-ink"
                      data-testid={tid as string}
                    />
                    <span>{label as string}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </section>

          {/* 5. Variants (reads 3PL stock; hides Sourcing link when !canSeeCosts) */}
          <section className="card p-0 overflow-hidden" data-testid="variants-section">
            <div className="px-5 py-4 border-b border-line flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="m-0 text-[18px] font-bold flex items-center gap-2 text-ink">
                  <DsIcon name="layers" size={18} className="text-coral-text" />
                  <span>Variants ({variants.length})</span>
                </h2>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() =>
                    setVariants((prev) => [
                      ...prev,
                      {
                        id: null,
                        model_no: null,
                        optionsText: 'Colour: Default',
                        supplier_product_id: defaultSpId,
                        price_adjust_cents: 0,
                        on_hand_qty: 0,
                        reserved_qty: 0,
                        available_qty: 0,
                      },
                    ])
                  }
                  className="ds-btn ds-btn-secondary !min-h-[38px]"
                  data-testid="add-variant-btn"
                >
                  <DsIcon name="plus" size={16} />
                  Add variant
                </button>
              )}
            </div>

            {variants.length === 0 ? (
              <p className="p-5 m-0 text-[14px] text-muted">
                A default variant (<span className="mono">-01</span>) is created automatically on
                save.
              </p>
            ) : (
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Variants">
                <table className="ds-tbl min-w-[680px]">
                  <thead>
                    <tr>
                      <th scope="col">Model no.</th>
                      <th scope="col">Options</th>
                      {canSeeCosts && <th scope="col">Sourcing item</th>}
                      <th scope="col">Price adjust (¢)</th>
                      <th scope="col">3PL stock</th>
                      <th scope="col">Reserved</th>
                      <th scope="col">Available</th>
                      <th scope="col">Status</th>
                      {canEdit && <th scope="col" />}
                    </tr>
                  </thead>
                  <tbody>
                    {variants.map((v, idx) => {
                      const avail = v.available_qty ?? 0;
                      return (
                        <tr key={v.id ?? `new-${idx}`}>
                          <td className="mono whitespace-nowrap">
                            {v.model_no ?? 'Auto (-NN)'}
                          </td>
                          <td>
                            <input
                              aria-label={`Variant ${idx + 1} options`}
                              disabled={!canEdit}
                              value={v.optionsText}
                              onChange={(e) =>
                                setVariants((prev) =>
                                  prev.map((row, i) =>
                                    i === idx ? { ...row, optionsText: e.target.value } : row,
                                  ),
                                )
                              }
                              placeholder="Colour: Cream"
                              className="ds-input !min-h-[36px] min-w-[140px]"
                            />
                          </td>
                          {canSeeCosts && (
                            <td>
                              <select
                                aria-label={`Variant ${idx + 1} Sourcing item`}
                                disabled={!canEdit}
                                value={v.supplier_product_id}
                                onChange={(e) =>
                                  setVariants((prev) =>
                                    prev.map((row, i) =>
                                      i === idx
                                        ? { ...row, supplier_product_id: e.target.value }
                                        : row,
                                    ),
                                  )
                                }
                                className="ds-input !min-h-[36px] min-w-[190px]"
                              >
                                <option value="">— Use default —</option>
                                {supplierProducts.map((sp) => (
                                  <option
                                    key={sp.supplier_product_id}
                                    value={sp.supplier_product_id}
                                  >
                                    {sp.supplier_code} · {sp.sourcing_sku ?? sp.sourcing_title}
                                  </option>
                                ))}
                              </select>
                            </td>
                          )}
                          <td>
                            <input
                              aria-label={`Variant ${idx + 1} price adjustment in cents`}
                              type="number"
                              disabled={!canEdit}
                              value={v.price_adjust_cents}
                              onChange={(e) =>
                                setVariants((prev) =>
                                  prev.map((row, i) =>
                                    i === idx
                                      ? {
                                          ...row,
                                          price_adjust_cents: Math.round(
                                            Number(e.target.value) || 0,
                                          ),
                                        }
                                      : row,
                                  ),
                                )
                              }
                              className="ds-input mono !min-h-[36px] w-24"
                            />
                          </td>
                          <td className="tabular-nums">
                            {fulfilmentType === 'fast_ship' ? v.on_hand_qty ?? 0 : '—'}
                          </td>
                          <td className="tabular-nums">
                            {fulfilmentType === 'fast_ship' ? v.reserved_qty ?? 0 : '—'}
                          </td>
                          <td className="tabular-nums font-semibold">
                            {fulfilmentType === 'fast_ship' ? avail : 'Supplier'}
                          </td>
                          <td>
                            {fulfilmentType === 'fast_ship' ? (
                              <span
                                className={`ds-badge ${
                                  avail <= 0
                                    ? 'ds-badge-bad'
                                    : avail <= 10
                                      ? 'ds-badge-warn'
                                      : 'ds-badge-ok'
                                }`}
                              >
                                {avail <= 0 ? 'Out' : avail <= 10 ? 'Low' : 'OK'}
                              </span>
                            ) : (
                              <span className="ds-badge ds-badge-neutral">Extended</span>
                            )}
                          </td>
                          {canEdit && (
                            <td>
                              <button
                                type="button"
                                onClick={() =>
                                  setVariants((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="text-bad text-[12.5px] font-semibold hover:underline"
                              >
                                Remove
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-5 py-3 border-t border-line text-[12.5px] text-muted">
              Stock is owned by 3PL (<span className="mono">warehouse_stock</span>); this table
              reads it.
            </div>
          </section>

          {/* 6. Routes and price split (DDP vs DAP; Our cost & Margin hidden when !canSeeCosts) */}
          <section className="card p-0 overflow-hidden" data-testid="routes-section">
            <div className="px-5 py-4 border-b border-line flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="m-0 text-[18px] font-bold flex items-center gap-2 text-ink">
                  <DsIcon name="truck" size={18} className="text-coral-text" />
                  <span>Routes and price split ({routes.length})</span>
                </h2>
              </div>
              {canEdit && (
                <button
                  type="button"
                  onClick={() =>
                    setRoutes((prev) => [
                      ...prev,
                      {
                        destination_country: supportedCountries[0] ?? 'AE',
                        shipping_method: 'standard',
                        incoterm: 'DDP',
                        landed_price_cents: Math.max(1500, effectiveUnitCostCents * 2),
                        est_shipping_cents: 500,
                        est_duties_cents: 50,
                        est_days_min: 5,
                        est_days_max: 9,
                        carrier: '',
                        is_active: true,
                      },
                    ])
                  }
                  className="ds-btn ds-btn-secondary !min-h-[38px]"
                  data-testid="add-route-btn"
                >
                  <DsIcon name="plus" size={16} />
                  Add route
                </button>
              )}
            </div>

            {routes.length === 0 ? (
              <p className="p-5 m-0 text-[14px] text-muted">
                No routes configured. Add at least 1 active route before publishing.
              </p>
            ) : (
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Routes and price split">
                <table className="ds-tbl min-w-[980px]">
                  <thead>
                    <tr>
                      <th scope="col">Country</th>
                      <th scope="col">Method</th>
                      <th scope="col">Terms</th>
                      <th scope="col">Product</th>
                      <th scope="col">Processing</th>
                      <th scope="col">Shipping</th>
                      <th scope="col">Duties and tax</th>
                      <th scope="col">Landed (¢)</th>
                      {canSeeCosts && (
                        <>
                          <th scope="col">Our cost</th>
                          <th scope="col">Margin</th>
                        </>
                      )}
                      <th scope="col">Days</th>
                      <th scope="col">Active</th>
                      {canEdit && <th scope="col" />}
                    </tr>
                  </thead>
                  <tbody>
                    {routes.map((r, idx) => {
                      const rc = rcByKey.get(`${r.destination_country}:${r.shipping_method}`);
                      const shipCardCents =
                        rc && billedWeightInfo.billedG != null
                          ? rc.base_cents +
                            Math.round(billedWeightInfo.billedG / rc.step_g) * rc.per_100g_cents
                          : null;

                      const prodBaseCents =
                        productPriceCentsStr.trim() !== ''
                          ? Math.max(0, Math.round(Number(productPriceCentsStr)))
                          : Math.max(
                              0,
                              r.landed_price_cents - r.est_shipping_cents - r.est_duties_cents,
                            );

                      const de =
                        r.incoterm === 'DDP'
                          ? lookupDuty(r.destination_country, hsCode)
                          : null;
                      const dutyTableCents =
                        r.incoterm === 'DAP'
                          ? 0
                          : de
                            ? prodBaseCents <= de.de_minimis_cents
                              ? de.de_minimis_applies_to === 'duty_and_tax'
                                ? 0
                                : Math.round((prodBaseCents * de.tax_bp) / 10000)
                              : Math.round((prodBaseCents * (de.duty_bp + de.tax_bp)) / 10000)
                            : null;

                      const effShip = shipCardCents ?? r.est_shipping_cents;
                      const effFee = processingFeeCents ?? 0;
                      const effDuty = dutyTableCents ?? 0;
                      const ourCost = effectiveUnitCostCents + effFee + effShip + effDuty;
                      const marginCents = r.landed_price_cents - ourCost;
                      const marginBp =
                        r.landed_price_cents > 0
                          ? Math.round((marginCents * 10000) / r.landed_price_cents)
                          : 0;
                      const belowMin = marginBp < effectiveMinMarginBp;
                      const ddpDutyMissing = r.incoterm === 'DDP' && !de;

                      return (
                        <tr key={idx} data-testid="staff-route-row">
                          <td>
                            <select
                              aria-label={`Route ${idx + 1} destination country`}
                              disabled={!canEdit}
                              value={r.destination_country}
                              onChange={(e) =>
                                setRoutes((prev) =>
                                  prev.map((row, i) =>
                                    i === idx
                                      ? { ...row, destination_country: e.target.value }
                                      : row,
                                  ),
                                )
                              }
                              className="ds-input mono !min-h-[36px] w-20"
                              data-testid="route-country"
                            >
                              {supportedCountries.map((c) => (
                                <option key={c} value={c}>
                                  {c}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              aria-label={`Route ${idx + 1} shipping method`}
                              disabled={!canEdit}
                              value={r.shipping_method}
                              onChange={(e) =>
                                setRoutes((prev) =>
                                  prev.map((row, i) =>
                                    i === idx
                                      ? {
                                          ...row,
                                          shipping_method: e.target.value as
                                            | 'express'
                                            | 'standard'
                                            | 'economy',
                                        }
                                      : row,
                                  ),
                                )
                              }
                              className="ds-input !min-h-[36px]"
                              data-testid="route-method"
                            >
                              <option value="economy">Economy</option>
                              <option value="standard">Standard</option>
                              <option value="express">Express</option>
                            </select>
                          </td>
                          <td>
                            <select
                              aria-label={`Route ${idx + 1} incoterm`}
                              disabled={!canEdit}
                              value={r.incoterm}
                              onChange={(e) =>
                                setRoutes((prev) =>
                                  prev.map((row, i) =>
                                    i === idx
                                      ? { ...row, incoterm: e.target.value as 'DDP' | 'DAP' }
                                      : row,
                                  ),
                                )
                              }
                              className="ds-input mono !min-h-[36px] w-20"
                              data-testid="route-incoterm"
                            >
                              <option value="DDP">DDP</option>
                              <option value="DAP">DAP</option>
                            </select>
                          </td>
                          <td className="tabular-nums whitespace-nowrap">
                            {usd(prodBaseCents)}
                          </td>
                          <td className="tabular-nums whitespace-nowrap">
                            {processingFeeCents != null ? usd(processingFeeCents) : '—'}
                          </td>
                          <td className="tabular-nums whitespace-nowrap">
                            {shipCardCents != null ? (
                              <span>{usd(shipCardCents)} · rate card</span>
                            ) : (
                              <span className="ds-badge ds-badge-warn">No rate set</span>
                            )}
                          </td>
                          <td className="tabular-nums whitespace-nowrap" data-testid="route-duty-display">
                            {r.incoterm === 'DAP' ? (
                              <span className="text-[12.5px] text-muted">
                                Duties paid by buyer
                              </span>
                            ) : dutyTableCents != null ? (
                              <span>{usd(dutyTableCents)} · table</span>
                            ) : (
                              <span className="ds-badge ds-badge-warn">Duty missing</span>
                            )}
                          </td>
                          <td>
                            <input
                              aria-label={`Route ${idx + 1} landed price in cents`}
                              type="number"
                              min={1}
                              disabled={!canEdit}
                              value={r.landed_price_cents}
                              onChange={(e) =>
                                setRoutes((prev) =>
                                  prev.map((row, i) =>
                                    i === idx
                                      ? {
                                          ...row,
                                          landed_price_cents: Math.round(
                                            Number(e.target.value) || 0,
                                          ),
                                        }
                                      : row,
                                  ),
                                )
                              }
                              className="ds-input mono !min-h-[36px] w-24"
                              data-testid="route-landed-cents"
                            />
                            <div className="text-[11px] text-muted">
                              {usd(r.landed_price_cents)}
                            </div>
                          </td>
                          {canSeeCosts && (
                            <>
                              <td
                                className="tabular-nums whitespace-nowrap"
                                data-testid="route-our-cost"
                              >
                                {shipCardCents != null && !ddpDutyMissing ? usd(ourCost) : '—'}
                              </td>
                              <td className="whitespace-nowrap" data-testid="route-margin">
                                {ddpDutyMissing ? (
                                  <span className="ds-badge ds-badge-warn">
                                    <DsIcon name="alert" size={12} strokeWidth={2.2} />
                                    Can&apos;t calculate: duty missing
                                  </span>
                                ) : shipCardCents == null ? (
                                  <span className="ds-badge ds-badge-warn">No rate set</span>
                                ) : (
                                  <span
                                    className={`ds-badge ${
                                      belowMin ? 'ds-badge-warn' : 'ds-badge-ok'
                                    }`}
                                  >
                                    <DsIcon
                                      name={belowMin ? 'alert' : 'check'}
                                      size={12}
                                      strokeWidth={2.2}
                                    />
                                    {(marginBp / 100).toFixed(0)}%
                                  </span>
                                )}
                              </td>
                            </>
                          )}
                          <td className="whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              <input
                                aria-label={`Route ${idx + 1} minimum delivery days`}
                                type="number"
                                min={1}
                                disabled={!canEdit}
                                value={r.est_days_min}
                                onChange={(e) =>
                                  setRoutes((prev) =>
                                    prev.map((row, i) =>
                                      i === idx
                                        ? { ...row, est_days_min: Number(e.target.value) || 1 }
                                        : row,
                                    ),
                                  )
                                }
                                className="ds-input mono !min-h-[36px] w-14 !px-1.5"
                              />
                              <span>–</span>
                              <input
                                aria-label={`Route ${idx + 1} maximum delivery days`}
                                type="number"
                                min={1}
                                disabled={!canEdit}
                                value={r.est_days_max}
                                onChange={(e) =>
                                  setRoutes((prev) =>
                                    prev.map((row, i) =>
                                      i === idx
                                        ? { ...row, est_days_max: Number(e.target.value) || 1 }
                                        : row,
                                    ),
                                  )
                                }
                                className="ds-input mono !min-h-[36px] w-14 !px-1.5"
                              />
                            </div>
                          </td>
                          <td>
                            <input
                              type="checkbox"
                              disabled={!canEdit}
                              checked={r.is_active}
                              aria-label={`${r.destination_country} ${r.shipping_method} active`}
                              onChange={(e) =>
                                setRoutes((prev) =>
                                  prev.map((row, i) =>
                                    i === idx ? { ...row, is_active: e.target.checked } : row,
                                  ),
                                )
                              }
                              className="w-4 h-4 accent-ink"
                            />
                          </td>
                          {canEdit && (
                            <td className="whitespace-nowrap space-x-2">
                              {canSeeCosts && (
                                <button
                                  type="button"
                                  onClick={() => prefillRouteFromRateCard(idx)}
                                  className="text-coral-text text-[12px] font-semibold hover:underline"
                                >
                                  Pre-fill
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  setRoutes((prev) => prev.filter((_, i) => i !== idx))
                                }
                                className="text-bad text-[12px] font-semibold hover:underline"
                              >
                                Remove
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-5 py-3 border-t border-line text-[12.5px] text-muted">
              Shipping comes from Shipping&apos;s rate card on billed weight; DDP duties come from
              the versioned rate table (DAP routes show &ldquo;Duties paid by buyer&rdquo;).
            </div>
          </section>

          {/* 7. Volume tiers (dropship_price_tiers — Correction 2) */}
          <section className="card p-0 overflow-hidden" data-testid="price-tiers-section">
            <div className="px-5 py-4 border-b border-line flex flex-wrap items-center justify-between gap-2">
              <h2 className="m-0 text-[18px] font-bold flex items-center gap-2 text-ink">
                <DsIcon name="layers" size={18} className="text-coral-text" />
                <span>Volume tiers</span>
              </h2>
              {canEdit && (
                <button
                  type="button"
                  onClick={() =>
                    setPriceTiers((prev) => [
                      ...prev,
                      {
                        min_qty: prev.length === 0 ? 1 : (prev[prev.length - 1]?.min_qty ?? 1) * 5,
                        unit_price_cents:
                          Number(productPriceCentsStr) > 0 ? Number(productPriceCentsStr) : 980,
                      },
                    ])
                  }
                  className="ds-btn ds-btn-secondary !min-h-[38px]"
                  data-testid="add-price-tier-btn"
                >
                  <DsIcon name="plus" size={16} />
                  Add tier
                </button>
              )}
            </div>

            {priceTiers.length === 0 ? (
              <p className="p-5 m-0 text-[14px] text-muted">
                No volume tiers set. Single product price applies to all quantities.
              </p>
            ) : (
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Volume tiers">
                <table className="ds-tbl min-w-[380px]">
                  <thead>
                    <tr>
                      <th scope="col">Quantity in one order (min qty)</th>
                      <th scope="col">Product price (cents)</th>
                      <th scope="col">Display</th>
                      {canEdit && <th scope="col" />}
                    </tr>
                  </thead>
                  <tbody>
                    {priceTiers.map((t, idx) => (
                      <tr key={idx} data-testid="price-tier-row">
                        <td>
                          <input
                            aria-label={`Volume tier ${idx + 1} minimum quantity`}
                            type="number"
                            min={1}
                            disabled={!canEdit}
                            value={t.min_qty}
                            onChange={(e) =>
                              setPriceTiers((prev) =>
                                prev.map((row, i) =>
                                  i === idx
                                    ? { ...row, min_qty: Math.max(1, Number(e.target.value) || 1) }
                                    : row,
                                ),
                              )
                            }
                            className="ds-input mono !min-h-[36px] w-28"
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`Volume tier ${idx + 1} unit price in cents`}
                            type="number"
                            min={0}
                            disabled={!canEdit}
                            value={t.unit_price_cents}
                            onChange={(e) =>
                              setPriceTiers((prev) =>
                                prev.map((row, i) =>
                                  i === idx
                                    ? {
                                        ...row,
                                        unit_price_cents: Math.max(
                                          0,
                                          Math.round(Number(e.target.value) || 0),
                                        ),
                                      }
                                    : row,
                                ),
                              )
                            }
                            className="ds-input mono !min-h-[36px] w-32"
                          />
                        </td>
                        <td className="tabular-nums font-semibold">{usd(t.unit_price_cents)}</td>
                        {canEdit && (
                          <td>
                            <button
                              type="button"
                              onClick={() =>
                                setPriceTiers((prev) => prev.filter((_, i) => i !== idx))
                              }
                              className="text-bad text-[12.5px] font-semibold hover:underline"
                            >
                              Remove
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        {/* Right sticky column: Publish checklist + Audit history */}
        <div className="flex-[1_1_280px] min-w-0 flex flex-col gap-4">
          <section className="card p-5 space-y-3" data-testid="publish-checklist-card">
            <h2 className="m-0 text-[18px] font-bold flex items-center gap-2 text-ink">
              <DsIcon name="check" size={18} className="text-coral-text" />
              <span>Publish checklist</span>
            </h2>
            <ul className="list-none m-0 p-0 text-[14px] space-y-2">
              {liveChecklist.checks.map((c) => (
                <li key={c.key} className="flex items-center gap-2 flex-wrap">
                  <span className={`ds-badge ${c.ok ? 'ds-badge-ok' : 'ds-badge-bad'}`}>
                    <DsIcon name={c.ok ? 'check' : 'stop'} size={12} strokeWidth={2.2} />
                    {c.ok ? 'Done' : 'Missing'}
                  </span>
                  <span>{c.label}</span>
                </li>
              ))}
              {liveChecklist.warnings.map((w, i) => (
                <li key={i} className="flex items-center gap-2 flex-wrap">
                  <span className="ds-badge ds-badge-warn">
                    <DsIcon name="alert" size={12} strokeWidth={2.2} />
                    Review
                  </span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
            <p className="m-0 text-[12px] text-muted">
              {liveChecklist.ready
                ? 'Everything required to publish is complete.'
                : 'Publish stays disabled until everything is done.'}
            </p>
          </section>

          <section className="card p-5 space-y-3" data-testid="product-history-card">
            <h2 className="m-0 text-[18px] font-bold flex items-center gap-2 text-ink">
              <DsIcon name="clock" size={18} className="text-coral-text" />
              <span>History</span>
            </h2>
            {initial.history.length === 0 ? (
              <p className="m-0 text-[13px] text-muted">
                Changes are recorded in the audit log as soon as you save.
              </p>
            ) : (
              <ol className="list-none m-0 p-0 space-y-3 text-[13.5px]">
                {initial.history.map((h) => (
                  <li key={h.id} className="flex gap-2.5 items-start">
                    <span
                      aria-hidden="true"
                      className="w-2.5 h-2.5 rounded-full bg-ok mt-1.5 shrink-0"
                    />
                    <div>
                      <strong className="font-semibold text-ink">{h.summary}</strong>
                      <div className="text-[12px] text-muted">
                        {h.created_at} · {h.actor_label}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
