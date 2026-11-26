'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import {
  DsBadge,
  DsButton,
  DsCard,
  DsIcon,
  DsNotice,
  DsTableCard,
  type DsBadgeTone,
} from '@/components/dropship-ui';
import type { DropshipRequestRow } from '@/lib/dropship';
import {
  respondToDropshipRequestQuoteAction,
  submitDropshipProductRequestAction,
  uploadDropshipRequestImageAction,
} from '../actions';
import { money } from '@/lib/format';

const CATEGORIES = [
  'Home and kitchen',
  'Pets',
  'Electronics',
  'Fitness',
  'Car',
  'Lighting',
  'Other',
];

const VOLUME_BANDS = ['Under 50', '50 to 200', '200 to 1,000', 'More than 1,000'];

// Batch 3 (F-16): same US$ format as the rest of the platform (money() → \"US$ 18.00\")
const usdShort = (c: number) => money(c, 'USD');

function statusToneForRequest(
  merchantStatus: string,
  dropshipProductStatus: string | null,
): { tone: DsBadgeTone; label: string } {
  if (dropshipProductStatus === 'active') {
    return { tone: 'ok', label: 'Added' };
  }
  switch (merchantStatus) {
    case 'quoted':
      return { tone: 'warn', label: 'Quoted' };
    case 'accepted':
    case 'ordered':
      return { tone: 'ok', label: 'Added' };
    case 'cancelled':
    case 'expired':
      return { tone: 'neutral', label: 'Closed' };
    case 'in_review':
      return { tone: 'info', label: 'In review' };
    default:
      return { tone: 'info', label: 'In review' };
  }
}

export function DropshipRequestsClient({
  initialRequests,
  countryOptions,
  defaultCountries,
  requestFeeCents,
  replyHours,
  countryNames,
}: {
  initialRequests: DropshipRequestRow[];
  countryOptions: [string, string][];
  defaultCountries: string[];
  requestFeeCents: number;
  replyHours: number;
  countryNames: Record<string, string>;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isSubmitting, startSubmit] = useTransition();
  const [isResponding, startRespond] = useTransition();

  const [productLink, setProductLink] = useState('');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [targetUsd, setTargetUsd] = useState('');
  const [volumeBand, setVolumeBand] = useState(VOLUME_BANDS[0]);
  const [shipTo, setShipTo] = useState<string[]>(defaultCountries);
  const [wantsBrand, setWantsBrand] = useState(false);
  const [notes, setNotes] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [uploadingImg, setUploadingImg] = useState(false);

  const [formErr, setFormErr] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  function toggleCountry(code: string) {
    setShipTo((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  async function handleFileSelect(files: FileList | null) {
    if (!files || files.length === 0) return;
    setFormErr(null);
    setUploadingImg(true);
    try {
      for (const f of Array.from(files).slice(0, 6 - images.length)) {
        const fd = new FormData();
        fd.set('file', f);
        const res = await uploadDropshipRequestImageAction(fd);
        if (!res.ok) {
          setFormErr(res.error);
          break;
        }
        setImages((prev) => [...prev, res.url].slice(0, 6));
      }
    } finally {
      setUploadingImg(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormErr(null);
    setSuccessMsg(null);
    const idem = `ds_req_${crypto.randomUUID()}`;

    startSubmit(async () => {
      const res = await submitDropshipProductRequestAction({
        title,
        productLink,
        category,
        targetLandedUsd: targetUsd,
        monthlyVolumeBand: volumeBand,
        shipToCountries: shipTo,
        wantsBrand,
        notes,
        images,
        idempotencyKey: idem,
      });
      if (!res.ok) {
        setFormErr(res.error);
        return;
      }
      setSuccessMsg(
        `Request ${res.rfqCode} submitted${
          res.feeCents > 0 ? ` (${usdShort(res.feeCents)})` : ' (free)'
        }. Sourcing will quote the landed cost to your markets.`,
      );
      setProductLink('');
      setTitle('');
      setTargetUsd('');
      setNotes('');
      setWantsBrand(false);
      setImages([]);
      router.refresh();
    });
  }

  function handleRespond(rfqId: string, action: 'accept' | 'decline') {
    setActionErr(null);
    startRespond(async () => {
      const res = await respondToDropshipRequestQuoteAction({ rfqId, action });
      if (!res.ok) {
        setActionErr(res.error);
        return;
      }
      setSuccessMsg(
        res.action === 'accepted'
          ? `Accepted quote on ${res.rfqCode}${
              res.dropshipModelNo ? ` — created ${res.dropshipModelNo} (only for you)` : ''
            }.`
          : `Declined quote on ${res.rfqCode}.`,
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      {successMsg && (
        <DsNotice tone="ok" title="Request updated" testId="request-success-notice">
          {successMsg}
        </DsNotice>
      )}
      {actionErr && (
        <DsNotice tone="bad" title="Could not update request">
          {actionErr}
        </DsNotice>
      )}

      <div className="flex gap-4 flex-wrap items-start">
        {/* Left: Request Form */}
        <div className="flex-[2_1_520px] min-w-0">
          <DsCard
            title="Tell us what you want"
            actions={
              <DsBadge tone="ok" testId="dropship-request-fee-badge">
                {requestFeeCents === 0 ? 'Free request' : `${usdShort(requestFeeCents)} per request`}
              </DsBadge>
            }
            testId="request-product-form-card"
          >
            <form onSubmit={onSubmit} className="flex flex-col gap-4">
              {formErr && (
                <DsNotice tone="bad" title="Check your request" testId="request-form-error">
                  {formErr}
                </DsNotice>
              )}

              <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
                <div>
                  <label className="ds-label" htmlFor="req-link">
                    Product link (optional)
                  </label>
                  <input
                    id="req-link"
                    type="url"
                    className="ds-input w-full"
                    value={productLink}
                    onChange={(e) => setProductLink(e.target.value)}
                    placeholder="https://"
                  />
                </div>

                <div>
                  <label className="ds-label" htmlFor="req-title">
                    Product name
                  </label>
                  <input
                    id="req-title"
                    required
                    data-testid="req-title-input"
                    className="ds-input w-full"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Silicone baking mats"
                  />
                </div>

                <div>
                  <label className="ds-label" htmlFor="req-cat">
                    Category
                  </label>
                  <select
                    id="req-cat"
                    className="ds-input w-full"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="ds-label" htmlFor="req-target">
                    Target landed cost each
                  </label>
                  <input
                    id="req-target"
                    data-testid="req-target-input"
                    className="ds-input w-full mono"
                    value={targetUsd}
                    onChange={(e) => setTargetUsd(e.target.value)}
                    placeholder="$6.00"
                  />
                  <p className="ds-mut mt-1.5 mb-0 text-[12px]">
                    Product, processing, shipping and duties to your main market
                  </p>
                </div>

                <div>
                  <label className="ds-label" htmlFor="req-volume">
                    Orders you expect per month
                  </label>
                  <select
                    id="req-volume"
                    className="ds-input w-full"
                    value={volumeBand}
                    onChange={(e) => setVolumeBand(e.target.value)}
                  >
                    {VOLUME_BANDS.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <fieldset className="border-0 m-0 p-0">
                <legend className="ds-label">Ship to</legend>
                <div className="flex gap-4 flex-wrap">
                  {countryOptions.map(([code, name]) => (
                    <label
                      key={code}
                      className="flex gap-2.5 items-center min-h-[44px] text-[14px] cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={shipTo.includes(code)}
                        onChange={() => toggleCountry(code)}
                        className="accent-ink w-4 h-4"
                      />
                      <span>{name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <label className="flex gap-2.5 items-center min-h-[44px] text-[14px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={wantsBrand}
                  onChange={(e) => setWantsBrand(e.target.checked)}
                  className="accent-ink w-4 h-4"
                />
                <span>I want it with my brand (Make My Brand quotes packaging and logo too)</span>
              </label>

              <div>
                <label className="ds-label" htmlFor="req-notes">
                  Notes
                </label>
                <textarea
                  id="req-notes"
                  data-testid="req-notes-input"
                  className="ds-input w-full min-h-[84px] py-2.5"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Size, materials, pack count or specifications"
                />
              </div>

              {images.length > 0 && (
                <div className="flex gap-2.5 flex-wrap">
                  {images.map((src, idx) => (
                    <div
                      key={src}
                      className="relative w-16 h-16 rounded-[8px] overflow-hidden border border-line bg-fill"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={src} alt={`Reference ${idx + 1}`} className="w-full h-full object-cover" />
                      <button
                        type="button"
                        aria-label={`Remove image ${idx + 1}`}
                        onClick={() => setImages((prev) => prev.filter((_, i) => i !== idx))}
                        className="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-ink/80 text-white border-0 cursor-pointer flex items-center justify-center text-[11px]"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2.5 flex-wrap items-center pt-1">
                <input
                  ref={fileInputRef}
                  type="file"
                  aria-label="Upload reference images"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="sr-only"
                  onChange={(e) => void handleFileSelect(e.target.files)}
                />
                <DsButton
                  type="button"
                  variant="secondary"
                  icon="plus"
                  loading={uploadingImg}
                  disabled={uploadingImg || images.length >= 6}
                  onClick={() => fileInputRef.current?.click()}
                >
                  Add images
                </DsButton>

                <DsButton
                  type="submit"
                  variant="primary"
                  icon="send"
                  loading={isSubmitting}
                  disabled={isSubmitting || uploadingImg}
                  testId="send-request-btn"
                >
                  Send request
                </DsButton>
              </div>
            </form>
          </DsCard>
        </div>

        {/* Right: What happens next */}
        <div className="flex-[1_1_300px] min-w-0">
          <DsCard title="What happens next" icon="clock">
            <ol className="list-none m-0 p-0 flex flex-col gap-3 text-[14px]">
              <li className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="w-3 h-3 rounded-full border-2 border-line-strong mt-1.5 shrink-0 box-border"
                />
                <div>
                  <strong className="font-semibold text-ink">
                    Sourcing reviews your request
                  </strong>
                  <div className="ds-mut text-[13px]">Within {replyHours} working hours</div>
                </div>
              </li>
              <li className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="w-3 h-3 rounded-full border-2 border-line-strong mt-1.5 shrink-0 box-border"
                />
                <div>
                  <strong className="font-semibold text-ink">You get a quote</strong>
                  <div className="ds-mut text-[13px]">Landed cost to your countries</div>
                </div>
              </li>
              <li className="flex gap-3">
                <span
                  aria-hidden="true"
                  className="w-3 h-3 rounded-full border-2 border-line-strong mt-1.5 shrink-0 box-border"
                />
                <div>
                  <strong className="font-semibold text-ink">You accept</strong>
                  <div className="ds-mut text-[13px]">
                    The product is added for you only, with a DS model number
                  </div>
                </div>
              </li>
            </ol>
          </DsCard>
        </div>
      </div>

      {/* Bottom: Your requests table — REAL RFQ codes only */}
      <DsTableCard
        title="Your requests"
        icon="send"
        minWidth={680}
        testId="requests-table"
        headers={['Request', 'Product', 'Status', 'Next step']}
      >
        {initialRequests.length === 0 ? (
          <tr>
            <td colSpan={4} className="ds-mut text-center py-6">
              You have not requested any products yet. Submit the form above to ask Octopus to source a product for your store.
            </td>
          </tr>
        ) : (
          initialRequests.map((req) => {
            const st = statusToneForRequest(req.merchant_status, req.dropship_product_status);
            const quotedCountryName = req.quoted_country
              ? countryNames[req.quoted_country] ?? req.quoted_country
              : req.ship_to_countries[0]
                ? countryNames[req.ship_to_countries[0]] ?? req.ship_to_countries[0]
                : '';

            return (
              <tr key={req.rfq_id} data-testid="request-row">
                <td className="mono font-semibold" data-testid="request-rfq-code">
                  {req.rfq_code}
                </td>
                <td>{req.title}</td>
                <td>
                  <DsBadge tone={st.tone}>{req.merchant_label || st.label}</DsBadge>
                </td>
                <td>
                  {req.merchant_status === 'quoted' ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      {req.quoted_landed_cents != null && (
                        <span className="text-[13.5px]">
                          Landed <strong className="mono">{usdShort(req.quoted_landed_cents)}</strong>
                          {quotedCountryName ? ` to ${quotedCountryName}` : ''}
                        </span>
                      )}
                      <DsButton
                        variant="primary"
                        icon="check"
                        disabled={isResponding}
                        onClick={() => handleRespond(req.rfq_id, 'accept')}
                        testId="accept-request-quote"
                      >
                        Accept
                      </DsButton>
                      <DsButton
                        variant="secondary"
                        icon="x"
                        disabled={isResponding}
                        onClick={() => handleRespond(req.rfq_id, 'decline')}
                        testId="decline-request-quote"
                      >
                        Decline
                      </DsButton>
                    </div>
                  ) : req.dropship_model_no ? (
                    req.dropship_product_status === 'active' && req.dropship_product_id ? (
                      <Link
                        href={`/account/dropship/catalogue/${req.dropship_product_id}`}
                        className="text-coral-text hover:underline font-medium inline-flex items-center gap-1"
                        data-testid="request-added-link"
                      >
                        <span className="mono">{req.dropship_model_no}</span>
                        <span>· only for you</span>
                        <DsIcon name="arrow" size={14} />
                      </Link>
                    ) : (
                      <span className="ds-mut text-[13px]" data-testid="request-draft-model">
                        <span className="mono font-semibold text-ink">
                          {req.dropship_model_no}
                        </span>{' '}
                        · only for you (preparing routes)
                      </span>
                    )
                  ) : (
                    <span className="ds-mut">—</span>
                  )}
                </td>
              </tr>
            );
          })
        )}
      </DsTableCard>
    </div>
  );
}
