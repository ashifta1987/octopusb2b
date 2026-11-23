'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  saveDropshipProduct,
  uploadDropshipImage,
  estimateRouteFromRateCard,
  type ProductInput,
} from './actions';

type SupplierOption = {
  id: string;
  code: string;
  legal_name: string;
  verified: boolean;
};

type VariantRow = {
  id?: string | null;
  octopus_sku: string;
  optionsText: string; // "Colour: Black, Size: M"
  cost_cents: number;
  price_adjust_cents: number;
  stock_status: 'in_stock' | 'low' | 'out';
  stock_qty: string;
};

type RouteRow = {
  destination_country: string;
  shipping_method: 'express' | 'standard' | 'economy';
  landed_price_cents: number;
  est_shipping_cents: number;
  est_duties_cents: number;
  est_days_min: number;
  est_days_max: number;
  carrier: string;
  is_active: boolean;
};

export type InitialProductData = {
  id?: string | null;
  octopus_sku: string;
  title: string;
  description: string;
  category: string;
  images: string[];
  specsText: string; // "Key: Value" per line
  weight_g: number;
  dim_l: string;
  dim_w: string;
  dim_h: string;
  unit_cost_cents: number;
  min_order_qty: number;
  stock_status: 'in_stock' | 'low' | 'out';
  stock_qty: string;
  source_type: 'own_warehouse' | 'partner_supplier';
  supplier_id: string;
  supplier_sku: string;
  origin_country: string;
  status: 'draft' | 'active' | 'archived';
  variants: VariantRow[];
  routes: RouteRow[];
};

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
  suppliers,
  categories,
  supportedCountries,
  canEdit,
  canSeeCosts,
  minMarginBp,
  categoryMinMarginBp,
}: {
  initial: InitialProductData;
  suppliers: SupplierOption[];
  categories: string[];
  supportedCountries: string[];
  canEdit: boolean;
  canSeeCosts: boolean;
  minMarginBp: number;
  categoryMinMarginBp: Record<string, number>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [sku, setSku] = useState(initial.octopus_sku);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [category, setCategory] = useState(initial.category);
  const [images, setImages] = useState<string[]>(initial.images);
  const [specsText, setSpecsText] = useState(initial.specsText);
  const [weightG, setWeightG] = useState(initial.weight_g);
  const [dimL, setDimL] = useState(initial.dim_l);
  const [dimW, setDimW] = useState(initial.dim_w);
  const [dimH, setDimH] = useState(initial.dim_h);
  const [unitCostCents, setUnitCostCents] = useState(initial.unit_cost_cents);
  const [moq, setMoq] = useState(initial.min_order_qty);
  const [stockStatus, setStockStatus] = useState<'in_stock' | 'low' | 'out'>(initial.stock_status);
  const [stockQty, setStockQty] = useState(initial.stock_qty);
  const [sourceType, setSourceType] = useState<'own_warehouse' | 'partner_supplier'>(
    initial.source_type,
  );
  const [supplierId, setSupplierId] = useState(initial.supplier_id);
  const [supplierSku, setSupplierSku] = useState(initial.supplier_sku);
  const [originCountry, setOriginCountry] = useState(initial.origin_country);
  const [status, setStatus] = useState<'draft' | 'active' | 'archived'>(initial.status);
  const [variants, setVariants] = useState<VariantRow[]>(initial.variants);
  const [routes, setRoutes] = useState<RouteRow[]>(initial.routes);
  const [uploading, setUploading] = useState(false);

  // Effective minimum margin (in basis points): category override if present, otherwise company-wide default
  const effectiveMinMarginBp =
    category && categoryMinMarginBp[category] != null
      ? categoryMinMarginBp[category]
      : minMarginBp;

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
        setMsg({ ok: true, text: 'Image verified, EXIF stripped and uploaded.' });
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
      weight_g: weightG,
      unit_cost_cents: unitCostCents,
      country: r.destination_country,
      method: r.shipping_method,
    });
    if (!est) {
      setMsg({
        ok: false,
        text: `No rate-card entry for ${r.destination_country} (${r.shipping_method}). Enter shipping and landed price manually.`,
      });
      return;
    }
    // Pre-fill estimated shipping, duties, days and a suggested landed price that meets effectiveMinMarginBp
    const baseCost = unitCostCents + est.est_shipping_cents + est.est_duties_cents;
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
              est_duties_cents: est.est_duties_cents,
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
    setStatus(targetStatus);
    const dims =
      dimL || dimW || dimH
        ? {
            ...(dimL ? { l: Number(dimL) } : {}),
            ...(dimW ? { w: Number(dimW) } : {}),
            ...(dimH ? { h: Number(dimH) } : {}),
          }
        : null;

    const payload: ProductInput = {
      id: initial.id ?? null,
      octopus_sku: sku,
      title,
      description: description || null,
      category: category || null,
      images,
      specs: parseKeyValLines(specsText, '\n'),
      weight_g: Number(weightG) || 0,
      dimensions_cm: dims,
      unit_cost_cents: Number(unitCostCents) || 0,
      min_order_qty: Number(moq) || 1,
      stock_status: stockStatus,
      stock_qty: stockQty.trim() !== '' ? Number(stockQty) : null,
      source_type: sourceType,
      supplier_id: supplierId || null,
      supplier_sku: supplierSku || null,
      origin_country: originCountry || 'CN',
      status: targetStatus,
      variants: variants.map((v) => ({
        id: v.id ?? null,
        octopus_sku: v.octopus_sku,
        options: parseKeyValLines(v.optionsText, ','),
        cost_cents: Number(v.cost_cents) || 0,
        price_adjust_cents: Number(v.price_adjust_cents) || 0,
        stock_status: v.stock_status,
        stock_qty: v.stock_qty.trim() !== '' ? Number(v.stock_qty) : null,
      })),
      routes: routes.map((r) => ({
        destination_country: r.destination_country,
        shipping_method: r.shipping_method,
        landed_price_cents: Number(r.landed_price_cents) || 0,
        est_shipping_cents: Number(r.est_shipping_cents) || 0,
        est_duties_cents: Number(r.est_duties_cents) || 0,
        est_days_min: Number(r.est_days_min) || 1,
        est_days_max: Number(r.est_days_max) || 1,
        carrier: r.carrier || null,
        is_active: r.is_active,
      })),
    };

    startTransition(async () => {
      const res = await saveDropshipProduct(payload);
      if (res.ok) {
        setMsg({
          ok: true,
          text:
            targetStatus === 'active'
              ? 'Product published to the Dropshipping catalogue.'
              : 'Product saved.',
        });
        if (!initial.id) router.push(`/office/dropship/${res.id}`);
        else router.refresh();
      } else {
        setMsg({ ok: false, text: res.error });
      }
    });
  };

  return (
    <div className="space-y-6" data-testid="dropship-product-form">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/office/dropship" className="text-[13.5px] text-coral-text font-semibold">
            ← Back to Dropshipping catalogue
          </Link>
          <h1 className="text-[28px] font-extrabold mt-1">
            {initial.id ? `Edit ${initial.octopus_sku}` : 'Add Dropshipping product'}
          </h1>
        </div>
        {canEdit && (
          <div className="flex flex-wrap gap-2.5">
            <button
              type="button"
              disabled={pending}
              onClick={() => submitWithStatus('draft')}
              className="btn btn-ghost min-h-11"
              data-testid="save-draft-btn"
            >
              {pending ? 'Saving…' : 'Save as Draft'}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => submitWithStatus('active')}
              className="btn btn-primary min-h-11"
              data-testid="publish-btn"
            >
              {pending ? 'Publishing…' : 'Publish (Active)'}
            </button>
            {initial.id && status !== 'archived' && (
              <button
                type="button"
                disabled={pending}
                onClick={() => submitWithStatus('archived')}
                className="btn btn-ghost min-h-11 text-bad"
                data-testid="archive-btn"
              >
                Archive
              </button>
            )}
          </div>
        )}
      </div>

      {msg && (
        <div
          role={msg.ok ? 'status' : 'alert'}
          data-testid="form-message"
          className={`card p-4 text-[14px] font-medium ${
            msg.ok ? 'bg-ok-bg text-ok border-ok' : 'bg-bad-bg text-bad border-bad'
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* 1. Core white-label product details */}
      <section className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[18px] font-bold">Product details (shown to merchants)</h2>
          <span className="pill bg-pearl text-muted border border-line">
            Status: {status.toUpperCase()}
          </span>
        </div>
        <p className="text-[13px] text-muted">
          White-label rule: never include supplier names, factory names, supplier codes or manufacturer SKUs in any merchant-visible field.
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="f-sku" className="k block mb-1.5">
              Octopus SKU *
            </label>
            <input
              id="f-sku"
              disabled={!canEdit}
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="OCT-DS-1001"
              className="input mono"
              data-testid="input-octopus-sku"
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="f-title" className="k block mb-1.5">
              Title *
            </label>
            <input
              id="f-title"
              disabled={!canEdit}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Cordless LED Desk Lamp"
              className="input"
              data-testid="input-title"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="f-cat" className="k block mb-1.5">
              Category
            </label>
            <input
              id="f-cat"
              list="ds-cat-list"
              disabled={!canEdit}
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Lighting"
              className="input"
              data-testid="input-category"
            />
            <datalist id="ds-cat-list">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="f-moq" className="k block mb-1.5">
              Minimum order qty (MOQ)
            </label>
            <input
              id="f-moq"
              type="number"
              min={1}
              disabled={!canEdit}
              value={moq}
              onChange={(e) => setMoq(Number(e.target.value))}
              className="input"
            />
          </div>
          <div>
            <label htmlFor="f-origin" className="k block mb-1.5">
              Origin country (ISO-2)
            </label>
            <input
              id="f-origin"
              maxLength={2}
              disabled={!canEdit}
              value={originCountry}
              onChange={(e) => setOriginCountry(e.target.value.toUpperCase())}
              className="input mono"
            />
          </div>
        </div>

        <div>
          <label htmlFor="f-desc" className="k block mb-1.5">
            Description
          </label>
          <textarea
            id="f-desc"
            rows={3}
            disabled={!canEdit}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="input"
            data-testid="input-description"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="f-specs" className="k block mb-1.5">
              Specifications (one &ldquo;Key: Value&rdquo; per line)
            </label>
            <textarea
              id="f-specs"
              rows={4}
              disabled={!canEdit}
              value={specsText}
              onChange={(e) => setSpecsText(e.target.value)}
              placeholder={'Material: Anodised aluminium\nBattery: 4000 mAh'}
              className="input font-mono text-[13px]"
              data-testid="input-specs"
            />
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="f-weight" className="k block mb-1.5">
                  Weight (grams) *
                </label>
                <input
                  id="f-weight"
                  type="number"
                  min={1}
                  disabled={!canEdit}
                  value={weightG}
                  onChange={(e) => setWeightG(Number(e.target.value))}
                  className="input"
                  data-testid="input-weight"
                />
              </div>
              <div>
                <label htmlFor="f-stock" className="k block mb-1.5">
                  Stock status
                </label>
                <select
                  id="f-stock"
                  disabled={!canEdit}
                  value={stockStatus}
                  onChange={(e) =>
                    setStockStatus(e.target.value as 'in_stock' | 'low' | 'out')
                  }
                  className="input"
                >
                  <option value="in_stock">In stock</option>
                  <option value="low">Low stock</option>
                  <option value="out">Out of stock</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label htmlFor="f-l" className="k block mb-1">
                  L (cm)
                </label>
                <input
                  id="f-l"
                  disabled={!canEdit}
                  value={dimL}
                  onChange={(e) => setDimL(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label htmlFor="f-w" className="k block mb-1">
                  W (cm)
                </label>
                <input
                  id="f-w"
                  disabled={!canEdit}
                  value={dimW}
                  onChange={(e) => setDimW(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label htmlFor="f-h" className="k block mb-1">
                  H (cm)
                </label>
                <input
                  id="f-h"
                  disabled={!canEdit}
                  value={dimH}
                  onChange={(e) => setDimH(e.target.value)}
                  className="input"
                />
              </div>
              <div>
                <label htmlFor="f-qty" className="k block mb-1">
                  Exact qty (staff)
                </label>
                <input
                  id="f-qty"
                  type="number"
                  min={0}
                  disabled={!canEdit}
                  value={stockQty}
                  onChange={(e) => setStockQty(e.target.value)}
                  className="input"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Staff-only cost & supplier (hidden from Support) */}
      {canSeeCosts && (
        <section className="card p-5 space-y-4" data-testid="staff-cost-supplier-section">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-[18px] font-bold">
              Supplier &amp; unit cost (Staff only — never shown to merchants or Support)
            </h2>
            <span className="pill bg-warn-bg text-warn">Internal</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <label htmlFor="f-cost" className="k block mb-1.5">
                Unit cost (US$ cents) *
              </label>
              <input
                id="f-cost"
                type="number"
                min={0}
                disabled={!canEdit}
                value={unitCostCents}
                onChange={(e) => setUnitCostCents(Math.round(Number(e.target.value) || 0))}
                className="input mono"
                data-testid="input-unit-cost-cents"
              />
              <div className="text-[12px] text-muted mt-1">{usd(unitCostCents)}</div>
            </div>
            <div>
              <label htmlFor="f-source" className="k block mb-1.5">
                Source type
              </label>
              <select
                id="f-source"
                disabled={!canEdit}
                value={sourceType}
                onChange={(e) =>
                  setSourceType(e.target.value as 'own_warehouse' | 'partner_supplier')
                }
                className="input"
              >
                <option value="own_warehouse">Own warehouse</option>
                <option value="partner_supplier">Partner supplier</option>
              </select>
            </div>
            <div>
              <label htmlFor="f-supplier" className="k block mb-1.5">
                Verified supplier
              </label>
              <select
                id="f-supplier"
                disabled={!canEdit}
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="input"
                data-testid="input-supplier"
              >
                <option value="">— Select supplier —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.legal_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-supsku" className="k block mb-1.5">
                Supplier SKU (internal)
              </label>
              <input
                id="f-supsku"
                disabled={!canEdit}
                value={supplierSku}
                onChange={(e) => setSupplierSku(e.target.value)}
                placeholder="Factory model / SKU"
                className="input mono"
                data-testid="input-supplier-sku"
              />
            </div>
          </div>
        </section>
      )}

      {/* 3. Images (up to 10, 5 MB each, jpg/png/webp magic-byte checked, EXIF stripped, UUID filename) */}
      <section className="card p-5 space-y-4" data-testid="images-section">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[18px] font-bold">
              Product images ({images.length} / 10)
            </h2>
            <p className="text-[13px] text-muted">
              Up to 10 photos, max 5 MB each, JPG/PNG/WebP only. EXIF metadata is stripped server-side and files are renamed to a random UUID. Alt text is generated from the product title.
            </p>
          </div>
          {canEdit && images.length < 10 && (
            <label className="btn btn-ghost min-h-10 cursor-pointer">
              {uploading ? 'Processing…' : '+ Upload image'}
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
          <p className="text-[14px] text-muted">
            No photos uploaded yet. At least 1 photo is required before publishing.
          </p>
        ) : (
          <ul className="grid gap-3 grid-cols-2 sm:grid-cols-4 md:grid-cols-5">
            {images.map((url, idx) => (
              <li
                key={url}
                className="card p-2 flex flex-col gap-2"
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
                <div className="flex items-center justify-between text-[12px]">
                  <span className="text-muted">#{idx + 1}</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => setImages((prev) => prev.filter((_, i) => i !== idx))}
                      className="text-bad font-semibold hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 4. Variants */}
      <section className="card p-5 space-y-4" data-testid="variants-section">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[18px] font-bold">Variants ({variants.length})</h2>
            <p className="text-[13px] text-muted">
              Options (e.g. &ldquo;Colour: Matte Black, Size: Large&rdquo;), unique Octopus SKU, staff cost and merchant price adjustment.
            </p>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() =>
                setVariants((prev) => [
                  ...prev,
                  {
                    octopus_sku: `${sku || 'OCT-DS'}-V${prev.length + 1}`,
                    optionsText: 'Colour: Default',
                    cost_cents: unitCostCents,
                    price_adjust_cents: 0,
                    stock_status: 'in_stock',
                    stock_qty: '100',
                  },
                ])
              }
              className="btn btn-ghost min-h-10"
              data-testid="add-variant-btn"
            >
              + Add variant
            </button>
          )}
        </div>

        {variants.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="th">Variant Octopus SKU</th>
                  <th className="th">Options (Key: Value, …)</th>
                  {canSeeCosts && <th className="th">Cost (cents)</th>}
                  <th className="th">Price adjust (cents)</th>
                  <th className="th">Stock status</th>
                  <th className="th">Qty (staff)</th>
                  {canEdit && <th className="th" />}
                </tr>
              </thead>
              <tbody>
                {variants.map((v, idx) => (
                  <tr key={idx} className="border-b border-line">
                    <td className="td">
                      <input
                        disabled={!canEdit}
                        value={v.octopus_sku}
                        onChange={(e) =>
                          setVariants((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, octopus_sku: e.target.value } : row,
                            ),
                          )
                        }
                        className="input mono !min-h-9"
                      />
                    </td>
                    <td className="td">
                      <input
                        disabled={!canEdit}
                        value={v.optionsText}
                        onChange={(e) =>
                          setVariants((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, optionsText: e.target.value } : row,
                            ),
                          )
                        }
                        placeholder="Colour: Black, Size: M"
                        className="input !min-h-9"
                      />
                    </td>
                    {canSeeCosts && (
                      <td className="td">
                        <input
                          type="number"
                          min={0}
                          disabled={!canEdit}
                          value={v.cost_cents}
                          onChange={(e) =>
                            setVariants((prev) =>
                              prev.map((row, i) =>
                                i === idx
                                  ? { ...row, cost_cents: Math.round(Number(e.target.value) || 0) }
                                  : row,
                              ),
                            )
                          }
                          className="input mono !min-h-9 w-28"
                        />
                      </td>
                    )}
                    <td className="td">
                      <input
                        type="number"
                        disabled={!canEdit}
                        value={v.price_adjust_cents}
                        onChange={(e) =>
                          setVariants((prev) =>
                            prev.map((row, i) =>
                              i === idx
                                ? {
                                    ...row,
                                    price_adjust_cents: Math.round(Number(e.target.value) || 0),
                                  }
                                : row,
                            ),
                          )
                        }
                        className="input mono !min-h-9 w-28"
                      />
                    </td>
                    <td className="td">
                      <select
                        disabled={!canEdit}
                        value={v.stock_status}
                        onChange={(e) =>
                          setVariants((prev) =>
                            prev.map((row, i) =>
                              i === idx
                                ? {
                                    ...row,
                                    stock_status: e.target.value as 'in_stock' | 'low' | 'out',
                                  }
                                : row,
                            ),
                          )
                        }
                        className="input !min-h-9"
                      >
                        <option value="in_stock">In stock</option>
                        <option value="low">Low</option>
                        <option value="out">Out</option>
                      </select>
                    </td>
                    <td className="td">
                      <input
                        type="number"
                        min={0}
                        disabled={!canEdit}
                        value={v.stock_qty}
                        onChange={(e) =>
                          setVariants((prev) =>
                            prev.map((row, i) =>
                              i === idx ? { ...row, stock_qty: e.target.value } : row,
                            ),
                          )
                        }
                        className="input mono !min-h-9 w-24"
                      />
                    </td>
                    {canEdit && (
                      <td className="td">
                        <button
                          type="button"
                          onClick={() =>
                            setVariants((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-bad font-semibold hover:underline"
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

      {/* 5. Routes table (country × method → landed price, days, carrier, active, margin + minimum margin warning) */}
      <section className="card p-5 space-y-4" data-testid="routes-section">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[18px] font-bold">
              Shipping routes &amp; landed prices ({routes.length})
            </h2>
            <p className="text-[13px] text-muted">
              Landed price is the merchant&apos;s buying price for 1 unit delivered with duties paid.
              {canSeeCosts && (
                <>
                  {' '}
                  Minimum target margin:{' '}
                  <b>{(effectiveMinMarginBp / 100).toFixed(1)}%</b>
                  {category && categoryMinMarginBp[category] != null
                    ? ` (${category} override)`
                    : ' (company-wide default)'}
                  . Routes below this show a warning (non-blocking).
                </>
              )}
            </p>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={() =>
                setRoutes((prev) => [
                  ...prev,
                  {
                    destination_country: supportedCountries[0] ?? 'AE',
                    shipping_method: 'express',
                    landed_price_cents: Math.max(1500, unitCostCents * 2),
                    est_shipping_cents: 500,
                    est_duties_cents: 50,
                    est_days_min: 3,
                    est_days_max: 6,
                    carrier: 'YunExpress Priority',
                    is_active: true,
                  },
                ])
              }
              className="btn btn-ghost min-h-10"
              data-testid="add-route-btn"
            >
              + Add route
            </button>
          )}
        </div>

        {routes.length === 0 ? (
          <p className="text-[14px] text-muted">
            No routes configured. Add at least 1 active route before publishing.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="th">Country</th>
                  <th className="th">Method</th>
                  <th className="th">Landed price (cents)</th>
                  {canSeeCosts && (
                    <>
                      <th className="th">Est. ship (cents)</th>
                      <th className="th">Est. duties (cents)</th>
                      <th className="th">Margin (staff only)</th>
                      <th className="th">Carrier (staff only)</th>
                    </>
                  )}
                  <th className="th">Days (min–max)</th>
                  <th className="th">Active</th>
                  {canEdit && <th className="th" />}
                </tr>
              </thead>
              <tbody>
                {routes.map((r, idx) => {
                  const marginCents =
                    r.landed_price_cents -
                    unitCostCents -
                    r.est_shipping_cents -
                    r.est_duties_cents;
                  const marginBp =
                    r.landed_price_cents > 0
                      ? Math.round((marginCents * 10000) / r.landed_price_cents)
                      : 0;
                  const belowMin = marginBp < effectiveMinMarginBp;
                  return (
                    <tr
                      key={idx}
                      className="border-b border-line"
                      data-testid="staff-route-row"
                    >
                      <td className="td">
                        <select
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
                          className="input mono !min-h-9 w-24"
                          data-testid="route-country"
                        >
                          {supportedCountries.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="td">
                        <select
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
                          className="input !min-h-9"
                          data-testid="route-method"
                        >
                          <option value="express">Express</option>
                          <option value="standard">Standard</option>
                          <option value="economy">Economy</option>
                        </select>
                      </td>
                      <td className="td">
                        <input
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
                          className="input mono !min-h-9 w-28"
                          data-testid="route-landed-cents"
                        />
                        <div className="text-[11.5px] text-muted">
                          {usd(r.landed_price_cents)}
                        </div>
                      </td>
                      {canSeeCosts && (
                        <>
                          <td className="td">
                            <input
                              type="number"
                              min={0}
                              disabled={!canEdit}
                              value={r.est_shipping_cents}
                              onChange={(e) =>
                                setRoutes((prev) =>
                                  prev.map((row, i) =>
                                    i === idx
                                      ? {
                                          ...row,
                                          est_shipping_cents: Math.round(
                                            Number(e.target.value) || 0,
                                          ),
                                        }
                                      : row,
                                  ),
                                )
                              }
                              className="input mono !min-h-9 w-24"
                              data-testid="route-ship-cents"
                            />
                          </td>
                          <td className="td">
                            <input
                              type="number"
                              min={0}
                              disabled={!canEdit}
                              value={r.est_duties_cents}
                              onChange={(e) =>
                                setRoutes((prev) =>
                                  prev.map((row, i) =>
                                    i === idx
                                      ? {
                                          ...row,
                                          est_duties_cents: Math.round(
                                            Number(e.target.value) || 0,
                                          ),
                                        }
                                      : row,
                                  ),
                                )
                              }
                              className="input mono !min-h-9 w-24"
                              data-testid="route-duty-cents"
                            />
                          </td>
                          <td className="td whitespace-nowrap" data-testid="route-margin">
                            <div
                              className={`font-bold tabular-nums ${
                                belowMin ? 'text-warn' : 'text-ok'
                              }`}
                            >
                              {usd(marginCents)} ({(marginBp / 100).toFixed(1)}%)
                            </div>
                            {belowMin && (
                              <div
                                className="text-[11.5px] text-warn font-semibold"
                                data-testid="margin-warning"
                              >
                                ⚠ Below {(effectiveMinMarginBp / 100).toFixed(1)}% min
                              </div>
                            )}
                          </td>
                          <td className="td">
                            <input
                              disabled={!canEdit}
                              value={r.carrier}
                              onChange={(e) =>
                                setRoutes((prev) =>
                                  prev.map((row, i) =>
                                    i === idx ? { ...row, carrier: e.target.value } : row,
                                  ),
                                )
                              }
                              placeholder="Carrier name"
                              className="input !min-h-9 w-36"
                              data-testid="route-carrier"
                            />
                          </td>
                        </>
                      )}
                      <td className="td whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <input
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
                            className="input mono !min-h-9 w-16"
                          />
                          <span>–</span>
                          <input
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
                            className="input mono !min-h-9 w-16"
                          />
                        </div>
                      </td>
                      <td className="td">
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={r.is_active}
                          onChange={(e) =>
                            setRoutes((prev) =>
                              prev.map((row, i) =>
                                i === idx ? { ...row, is_active: e.target.checked } : row,
                              ),
                            )
                          }
                          className="accent-ink w-4 h-4"
                        />
                      </td>
                      {canEdit && (
                        <td className="td whitespace-nowrap space-x-2">
                          {canSeeCosts && (
                            <button
                              type="button"
                              onClick={() => prefillRouteFromRateCard(idx)}
                              className="text-coral-text font-semibold hover:underline text-[12px]"
                              title="Pre-fill shipping, duties and days from the staff rate card"
                            >
                              Rate card
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setRoutes((prev) => prev.filter((_, i) => i !== idx))
                            }
                            className="text-bad font-semibold hover:underline text-[12px]"
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
      </section>
    </div>
  );
}
