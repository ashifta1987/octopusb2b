'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { DsBadge, DsChip, DsIcon } from '@/components/dropship-ui';
import type { CatalogueVariant, PriceTier, ShipType, StockStatus } from '@/lib/dropship';
import { money } from '@/lib/format';

// Batch 3 (F-16): same US$ format as the rest of the platform (money() → \"US$ 18.00\")
const usdShort = (cents: number) => money(cents, 'USD');

export function DsImportSubmitButton({ added }: { added: boolean }) {
  const { pending } = useFormStatus();
  if (added) {
    return (
      <button
        type="submit"
        disabled={pending}
        data-testid="import-added"
        aria-label="Added to import list. Select to remove."
        className="ds-btn ds-btn-secondary w-full justify-center"
      >
        <DsIcon name="check" size={16} />
        <span>{pending ? 'Removing…' : 'Added'}</span>
      </button>
    );
  }
  return (
    <button
      type="submit"
      disabled={pending}
      data-testid="import-add"
      className="ds-btn ds-btn-primary w-full justify-center"
    >
      <DsIcon name="plus" size={16} />
      <span>{pending ? 'Adding…' : 'Add to import list'}</span>
    </button>
  );
}

export function DsQuerySelect({
  id,
  name,
  label,
  value,
  options,
  testId,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  options: [string, string][];
  testId?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  return (
    <div>
      <label className="ds-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        name={name}
        value={value}
        data-testid={testId}
        className="ds-input w-full"
        onChange={(e) => {
          const p = new URLSearchParams(sp?.toString());
          if (e.target.value) p.set(name, e.target.value);
          else p.delete(name);
          p.delete('page');
          router.push(`${pathname}?${p.toString()}`);
        }}
      >
        {options.map(([val, text]) => (
          <option key={val || '__all'} value={val}>
            {text}
          </option>
        ))}
      </select>
    </div>
  );
}

const STOCK_BADGE_MAP: Record<StockStatus, { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' }> = {
  in_stock: { label: 'In stock', tone: 'ok' },
  low: { label: 'Low stock', tone: 'warn' },
  out: { label: 'Out of stock', tone: 'bad' },
  extended: { label: 'Extended', tone: 'info' },
};

function formatVariantOptionLabel(v: CatalogueVariant): string {
  const vals = Object.values(v.options ?? {}).filter(Boolean);
  return vals.length > 0 ? vals.join(' / ') : v.model_no;
}

export function ProductDetailHeroClient({
  productId,
  modelNo,
  title,
  images,
  fulfilmentType,
  onlyForYou,
  sourcedRfqCode,
  hsVerified,
  productStockStatus,
  variants,
  priceTiers,
  baseProductCents,
  defaultService,
  suggestedPriceCents,
  country,
  added,
  addAction,
  removeAction,
}: {
  productId: string;
  modelNo: string;
  title: string;
  images: string[];
  fulfilmentType: 'fast_ship' | 'extended_catalog';
  onlyForYou: boolean;
  sourcedRfqCode: string | null;
  hsVerified: boolean;
  productStockStatus: StockStatus;
  variants: CatalogueVariant[];
  priceTiers: PriceTier[];
  baseProductCents: number | null;
  defaultService: ShipType | null;
  suggestedPriceCents: number | null;
  country: string;
  added: boolean;
  addAction: (fd: FormData) => Promise<void>;
  removeAction: (fd: FormData) => Promise<void>;
}) {
  const firstInStock = variants.find((v) => v.stock_status !== 'out') ?? variants[0] ?? null;
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(firstInStock?.id ?? null);
  const [activeImageIdx, setActiveImageIdx] = useState(0);

  const selectedVariant = variants.find((v) => v.id === selectedVariantId) ?? firstInStock;
  const stockStatus: StockStatus = selectedVariant?.stock_status ?? productStockStatus;
  const stockCfg = STOCK_BADGE_MAP[stockStatus];
  const activeModelNo = selectedVariant?.model_no || modelNo;
  const variantText = selectedVariant ? formatVariantOptionLabel(selectedVariant) : null;

  const optionKeyName = (() => {
    const firstOpts = variants[0]?.options;
    if (!firstOpts) return 'Option';
    const keys = Object.keys(firstOpts);
    return keys[0] || 'Variant';
  })();

  const tierRows = (() => {
    if (!priceTiers.length) return [];
    return priceTiers.map((t, idx) => {
      const next = priceTiers[idx + 1];
      const rangeLabel = next
        ? next.min_qty - 1 === t.min_qty
          ? `${t.min_qty}`
          : `${t.min_qty}–${next.min_qty - 1}`
        : `${t.min_qty} or more`;
      const adj = selectedVariant?.price_adjust_cents ?? 0;
      return {
        rangeLabel,
        unitCents: Math.max(0, t.unit_price_cents + adj),
      };
    });
  })();

  const brandHref = `/request/brand?model=${encodeURIComponent(activeModelNo)}&title=${encodeURIComponent(title)}`;
  const sampleHref = `/account/dropship/sample?product=${encodeURIComponent(productId)}${
    selectedVariant ? `&variant=${encodeURIComponent(selectedVariant.id)}` : ''
  }&country=${encodeURIComponent(country)}`;

  return (
    <div className="flex gap-5 flex-wrap items-start">
      {/* Left Gallery */}
      <div className="flex-1 basis-[340px] min-w-0 flex flex-col gap-2.5">
        <div className="h-[340px] bg-[#E9EDF5] rounded-[12px] overflow-hidden flex items-center justify-center text-[#5B6478] relative border border-[#E3E7EF]">
          {images[activeImageIdx] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={images[activeImageIdx]}
              alt={title}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-[13px]">Product image</span>
          )}
        </div>
        {images.length > 1 && (
          <div className="grid grid-cols-4 gap-2">
            {images.slice(0, 4).map((src, idx) => (
              <button
                key={`${src}-${idx}`}
                type="button"
                onClick={() => setActiveImageIdx(idx)}
                aria-label={`Show image ${idx + 1}`}
                className={`h-[72px] rounded-[8px] overflow-hidden bg-[#E9EDF5] border p-0 cursor-pointer ${
                  activeImageIdx === idx ? 'border-[#2A6FD1] ring-2 ring-[#2A6FD1]/30' : 'border-[#E3E7EF]'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Right Summary & Actions Card */}
      <div className="ds-card flex-1 basis-[420px] min-w-0 flex flex-col gap-3.5">
        <div className="flex gap-1.5 flex-wrap">
          {onlyForYou ? (
            <DsBadge tone="ok">Only for you</DsBadge>
          ) : fulfilmentType === 'extended_catalog' ? (
            <DsBadge tone="info">Extended catalog</DsBadge>
          ) : (
            <DsBadge tone="ok">Fast-ship stock</DsBadge>
          )}
          {/* Correction 5: Stock label ONLY, never a number */}
          <DsBadge tone={stockCfg.tone} testId="product-stock-status">
            {stockCfg.label}
          </DsBadge>
          {hsVerified && (
            <DsBadge tone="info" testId="hs-verified-badge">
              HS code checked
            </DsBadge>
          )}
        </div>

        <h1 className="m-0 text-[26px] font-bold flex items-center gap-3 flex-wrap text-[#1A174A]">
          <span
            data-page-icon=""
            aria-hidden="true"
            className="w-10 h-10 rounded-[10px] bg-[#E6EFFB] text-[#2A6FD1] inline-flex items-center justify-center shrink-0"
          >
            <DsIcon name="package" size={20} strokeWidth={2} />
          </span>
          <span>{title}</span>
        </h1>

        <p className="ds-mut m-0 text-[13px]">
          Model no. <span className="mono font-semibold text-[#1A174A]">{modelNo}</span>
          {selectedVariant && selectedVariant.model_no !== modelNo && (
            <>
              {' '}
              · {variantText ? `${variantText} variant ` : 'Variant '}
              <span className="mono font-semibold text-[#1A174A]">{selectedVariant.model_no}</span>
            </>
          )}{' '}
          · pushed to your store as SKU <span className="mono">{activeModelNo}</span>, which you can change
        </p>

        {sourcedRfqCode && (
          <p className="ds-mut m-0 text-[12.5px]" data-testid="detail-sourced-rfq">
            Sourced from your request <span className="mono font-semibold text-[#1A174A]">{sourcedRfqCode}</span>
          </p>
        )}

        {variants.length > 0 && (
          <div>
            <span className="ds-label">{optionKeyName}</span>
            <div className="flex gap-2 flex-wrap" role="group" aria-label={optionKeyName}>
              {variants.map((v) => {
                const isOut = v.stock_status === 'out';
                const label = formatVariantOptionLabel(v);
                if (isOut) {
                  return (
                    <button
                      key={v.id}
                      type="button"
                      disabled
                      className="ds-chip opacity-55 cursor-not-allowed"
                    >
                      {label} (out of stock)
                    </button>
                  );
                }
                return (
                  <DsChip
                    key={v.id}
                    pressed={selectedVariant?.id === v.id}
                    onClick={() => setSelectedVariantId(v.id)}
                  >
                    {label}
                  </DsChip>
                );
              })}
            </div>
          </div>
        )}

        {tierRows.length > 0 ? (
          <div data-testid="volume-tiers-section">
            <span className="ds-label">Your product cost by quantity in one order</span>
            <div className="overflow-x-auto border border-[#E3E7EF] rounded-[10px]">
              <table className="ds-tbl">
                <thead>
                  <tr>
                    <th scope="col">Quantity per order</th>
                    <th scope="col">Product cost</th>
                  </tr>
                </thead>
                <tbody>
                  {tierRows.map((tr) => (
                    <tr key={tr.rangeLabel}>
                      <td>{tr.rangeLabel}</td>
                      <td className="mono">{usdShort(tr.unitCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="ds-mut mt-1.5 mb-0 text-[12px]">
              Most dropship orders are 1 unit, so tiers mainly help multi-unit orders.
            </p>
          </div>
        ) : (
          baseProductCents != null && (
            <div className="flex items-center justify-between py-2 border-y border-[#EEF0F4] text-[14px]">
              <span className="ds-mut">Unit product cost</span>
              <strong className="mono text-[#1A174A]">
                {usdShort(Math.max(0, baseProductCents + (selectedVariant?.price_adjust_cents ?? 0)))}
              </strong>
            </div>
          )
        )}

        <div className="flex gap-2.5 flex-wrap items-center pt-1">
          <form action={added ? removeAction : addAction} className="inline-flex">
            <input type="hidden" name="product_id" value={productId} />
            {selectedVariant && <input type="hidden" name="variant_id" value={selectedVariant.id} />}
            {defaultService && <input type="hidden" name="service" value={defaultService} />}
            {suggestedPriceCents != null && (
              <input type="hidden" name="price_cents" value={suggestedPriceCents} />
            )}
            <DsImportSubmitButton added={added} />
          </form>

          <Link
            href={sampleHref}
            data-testid="order-sample-link"
            className="ds-btn ds-btn-secondary no-underline"
          >
            <DsIcon name="package" size={16} />
            <span>Order a sample</span>
          </Link>

          <span data-testid="make-it-your-brand" className="inline-flex">
            <Link
              href={brandHref}
              className="ds-btn ds-btn-secondary no-underline"
            >
              <DsIcon name="sparkle" size={16} />
              <span>Make it your brand</span>
            </Link>
          </span>
        </div>

        <p className="ds-mut m-0 text-[12px]">
          Make it your brand: your logo on the product and packaging, made by Octopus.
        </p>
      </div>
    </div>
  );
}
