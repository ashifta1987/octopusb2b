'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { DsIcon } from '@/components/dropship-ui';
import { quickSaveDropshipReview, type PublishChecklistResult } from './actions';

export type ReviewProductPayload = {
  id: string;
  model_no: string;
  title: string;
  status: 'draft' | 'active' | 'archived';
  needs_review: boolean;
  needs_review_reason: string | null;
  sourcing_sku: string | null; // null when !canSeeCosts
  hs_code: string;
  origin_country: string;
  hs_verified: boolean;
  has_battery: boolean;
  has_liquid: boolean;
  has_magnet: boolean;
  has_powder: boolean;
  visible_to_org_id: string | null;
  checklist: PublishChecklistResult;
  routesSplit: {
    country: string;
    method: string;
    incoterm: 'DDP' | 'DAP';
    product_cents: number;
    processing_cents: number | null;
    shipping_cents: number | null;
    duties_cents: number | null;
    duties_status: 'known' | 'missing' | 'dap';
    landed_cents: number | null;
    our_cost_cents: number | null; // null when !canSeeCosts
    margin_pct: number | null;     // null when !canSeeCosts
    margin_below_min: boolean;
  }[];
};

export type DropshipOrgOption = {
  id: string;
  name: string;
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

export function CatalogReviewDrawer({
  selected,
  orgs,
  canEdit,
  canSeeCosts,
}: {
  selected: ReviewProductPayload;
  orgs: DropshipOrgOption[];
  canEdit: boolean;
  canSeeCosts: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hsCode, setHsCode] = useState(selected.hs_code);
  const [originCountry, setOriginCountry] = useState(selected.origin_country);
  const [hsVerified, setHsVerified] = useState(selected.hs_verified);
  const [hasBattery, setHasBattery] = useState(selected.has_battery);
  const [hasLiquid, setHasLiquid] = useState(selected.has_liquid);
  const [hasMagnet, setHasMagnet] = useState(selected.has_magnet);
  const [hasPowder, setHasPowder] = useState(selected.has_powder);
  const [visibleToOrgId, setVisibleToOrgId] = useState(selected.visible_to_org_id ?? '');
  const [checklist, setChecklist] = useState<PublishChecklistResult>(selected.checklist);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const handleSave = (publish: boolean) => {
    setFeedback(null);
    startTransition(async () => {
      const res = await quickSaveDropshipReview({
        productId: selected.id,
        hsCode,
        originCountry,
        hsVerified,
        hasBattery,
        hasLiquid,
        hasMagnet,
        hasPowder,
        visibleToOrgId: visibleToOrgId || null,
        publish,
      });
      if (res.ok) {
        setChecklist(res.checklist);
        setFeedback({
          ok: true,
          text: res.published
            ? `${selected.model_no} published.`
            : `Review saved for ${selected.model_no}.`,
        });
        router.refresh();
      } else {
        if (res.checklist) setChecklist(res.checklist);
        setFeedback({ ok: false, text: res.error });
      }
    });
  };

  return (
    <div
      className="flex flex-wrap gap-4 items-start mt-5"
      data-testid="staff-review-split"
    >
      {/* Left: Quick HS, restricted flags, visibility & publish checklist */}
      <section
        className="card p-5 flex-[1_1_380px] flex flex-col gap-3.5"
        data-testid="staff-review-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="m-0 text-[18px] font-bold text-ink flex items-center gap-2 flex-wrap">
            <span>{selected.title}</span>
            <span
              className={`ds-badge ${
                selected.status === 'active' ? 'ds-badge-ok' : 'ds-badge-neutral'
              }`}
            >
              {selected.status === 'active'
                ? 'Active'
                : selected.status === 'archived'
                  ? 'Archived'
                  : 'Draft'}
            </span>
          </h2>
          <Link
            href={`/office/dropship/${selected.id}`}
            className="text-[13px] font-semibold text-coral-text hover:underline"
            data-testid="open-editor-link"
          >
            Open full editor →
          </Link>
        </div>

        {selected.needs_review && selected.needs_review_reason && (
          <div
            role="status"
            className="rounded-[10px] border border-warn-line bg-warn-bg px-3.5 py-2.5 text-[13px] text-warn"
            data-testid="needs-review-banner"
          >
            <strong>Needs review:</strong> {selected.needs_review_reason}
          </div>
        )}

        {feedback && (
          <div
            role={feedback.ok ? 'status' : 'alert'}
            className={`rounded-[10px] px-3.5 py-2.5 text-[13px] font-medium border ${
              feedback.ok
                ? 'bg-ok-soft border-ok-line text-ok'
                : 'bg-bad-bg border-bad/30 text-bad'
            }`}
            data-testid="quick-review-feedback"
          >
            {feedback.text}
          </div>
        )}

        <div
          className={`grid gap-3 rounded-[10px] bg-pearl p-3 ${
            canSeeCosts ? 'sm:grid-cols-2' : 'grid-cols-1'
          }`}
        >
          <div>
            <span className="ds-label !mb-0.5">Dropship model no.</span>
            <strong className="mono text-[14px]">{selected.model_no}</strong>
            <div className="text-[12px] text-muted">
              Generated on creation. Can&apos;t be edited or reused.
            </div>
          </div>
          {canSeeCosts && (
            <div data-testid="drawer-sourcing-model">
              <span className="ds-label !mb-0.5">Sourcing model no. (staff only)</span>
              <strong className="mono text-[14px]">
                {selected.sourcing_sku || 'Own warehouse'}
              </strong>
              <div className="text-[12px] text-muted">
                The link to Sourcing. Never shown to merchants or pushed to stores.
              </div>
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="ds-label" htmlFor={`hs-${selected.id}`}>
              Customs code (HS)
            </label>
            <input
              id={`hs-${selected.id}`}
              disabled={!canEdit}
              value={hsCode}
              onChange={(e) => {
                setHsCode(e.target.value);
                if (e.target.value.trim() !== selected.hs_code) {
                  setHsVerified(false);
                }
              }}
              placeholder="e.g. 6912.00"
              className="ds-input w-full mono"
              data-testid="drawer-hs-input"
            />
          </div>
          <div>
            <label className="ds-label" htmlFor={`org-${selected.id}`}>
              Country of origin
            </label>
            <select
              id={`org-${selected.id}`}
              disabled={!canEdit}
              value={originCountry}
              onChange={(e) => setOriginCountry(e.target.value)}
              className="ds-input w-full"
              data-testid="drawer-origin-select"
            >
              {ORIGIN_OPTIONS.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2.5 min-h-[44px] text-[14px] cursor-pointer">
          <input
            type="checkbox"
            disabled={!canEdit || !hsCode.trim()}
            checked={hsVerified}
            onChange={(e) => setHsVerified(e.target.checked)}
            className="w-4 h-4 accent-ink"
            data-testid="drawer-hs-verified-checkbox"
          />
          <span>I checked this HS code against the tariff for this product</span>
        </label>

        <fieldset className="border-0 m-0 p-0">
          <legend className="ds-label">Restricted goods</legend>
          <div className="flex flex-wrap gap-4 text-[14px]">
            {[
              ['Battery', hasBattery, setHasBattery],
              ['Liquid', hasLiquid, setHasLiquid],
              ['Magnet', hasMagnet, setHasMagnet],
              ['Powder', hasPowder, setHasPowder],
            ].map(([label, checked, setter]) => (
              <label
                key={label as string}
                className="flex items-center gap-2 min-h-[44px] cursor-pointer"
              >
                <input
                  type="checkbox"
                  disabled={!canEdit}
                  checked={checked as boolean}
                  onChange={(e) => (setter as (v: boolean) => void)(e.target.checked)}
                  className="w-4 h-4 accent-ink"
                />
                <span>{label as string}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <label className="ds-label" htmlFor={`vis-${selected.id}`}>
            Who can see it
          </label>
          <select
            id={`vis-${selected.id}`}
            disabled={!canEdit}
            value={visibleToOrgId}
            onChange={(e) => setVisibleToOrgId(e.target.value)}
            className="ds-input w-full"
            data-testid="drawer-visible-to-select"
          >
            <option value="">All merchants with dropshipping</option>
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                Only {o.name} (sourced on request)
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-[10px] bg-pearl p-3.5" data-testid="drawer-publish-checklist">
          <strong className="text-[14px]">Ready to publish?</strong>
          <ul className="list-none m-0 mt-2 p-0 text-[14px] space-y-1.5">
            {checklist.checks.map((c) => (
              <li key={c.key} className="flex items-center gap-2 flex-wrap">
                <span className={`ds-badge ${c.ok ? 'ds-badge-ok' : 'ds-badge-bad'}`}>
                  <DsIcon name={c.ok ? 'check' : 'stop'} size={12} strokeWidth={2.2} />
                  {c.ok ? 'Done' : 'Missing'}
                </span>
                <span>{c.label}</span>
              </li>
            ))}
          </ul>

          {canEdit && (
            <div className="flex flex-wrap gap-2.5 mt-3.5 items-center">
              <button
                type="button"
                disabled={pending}
                onClick={() => handleSave(false)}
                className="ds-btn ds-btn-secondary"
                data-testid="drawer-save-btn"
              >
                {pending ? 'Saving…' : 'Save review'}
              </button>
              <button
                type="button"
                disabled={pending || !checklist.ready}
                onClick={() => handleSave(true)}
                className="ds-btn ds-btn-primary"
                data-testid="drawer-publish-btn"
              >
                Publish
              </button>
              {!checklist.ready && checklist.blockers.length > 0 && (
                <p className="w-full m-0 text-[12px] text-muted" data-testid="drawer-publish-reason">
                  Missing: {checklist.blockers.join(' · ')}
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Right: Routes and 4-part price split (cost & margin strictly hidden when !canSeeCosts) */}
      <section
        className="card p-0 flex-[2_1_520px] min-w-0 overflow-hidden"
        data-testid="staff-routes-split-card"
      >
        <div className="px-5 py-4 border-b border-line">
          <h2 className="m-0 text-[18px] font-bold flex items-center gap-2 text-ink">
            <DsIcon name="truck" size={18} className="text-coral-text" />
            <span>Routes and price split</span>
          </h2>
          <p className="m-0 mt-1 text-[13px] text-muted">
            Merchants see product, processing, shipping, duties and landed cost.
            {canSeeCosts ? ' Cost and margin stay here.' : ''}
          </p>
        </div>

        {selected.routesSplit.length === 0 ? (
          <p className="p-5 text-[14px] text-muted m-0">
            No routes configured on this product yet.
          </p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Routes and price split">
            <table className="ds-tbl min-w-[740px]">
              <thead>
                <tr>
                  <th scope="col">Country</th>
                  <th scope="col">Method</th>
                  <th scope="col">Product</th>
                  <th scope="col">Processing</th>
                  <th scope="col">Shipping</th>
                  <th scope="col">Duties and tax</th>
                  <th scope="col">Landed</th>
                  {canSeeCosts && (
                    <>
                      <th scope="col">Our cost</th>
                      <th scope="col">Margin</th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {selected.routesSplit.map((rt, idx) => (
                  <tr key={`${rt.country}-${rt.method}-${idx}`}>
                    <td className="font-medium">{rt.country}</td>
                    <td className="capitalize">
                      {rt.method}
                      {rt.incoterm === 'DAP' && (
                        <span className="ml-1.5 ds-badge ds-badge-neutral">DAP</span>
                      )}
                    </td>
                    <td className="tabular-nums">{usd(rt.product_cents)}</td>
                    <td className="tabular-nums">
                      {rt.processing_cents != null ? usd(rt.processing_cents) : 'No fee set'}
                    </td>
                    <td className="tabular-nums">
                      {rt.shipping_cents != null ? (
                        usd(rt.shipping_cents)
                      ) : (
                        <span className="ds-badge ds-badge-warn">No rate set</span>
                      )}
                    </td>
                    <td className="tabular-nums">
                      {rt.duties_status === 'dap' ? (
                        <span className="text-[12.5px] text-muted">Duties paid by buyer</span>
                      ) : rt.duties_cents != null ? (
                        usd(rt.duties_cents)
                      ) : (
                        <span className="ds-badge ds-badge-warn">Not known yet</span>
                      )}
                    </td>
                    <td className="tabular-nums font-bold">
                      {rt.landed_cents != null ? usd(rt.landed_cents) : '—'}
                    </td>
                    {canSeeCosts && (
                      <>
                        <td className="tabular-nums" data-testid="drawer-our-cost">
                          {rt.our_cost_cents != null ? usd(rt.our_cost_cents) : '—'}
                        </td>
                        <td data-testid="drawer-margin">
                          {rt.duties_status === 'missing' ? (
                            <span className="ds-badge ds-badge-warn">
                              <DsIcon name="alert" size={12} strokeWidth={2.2} />
                              Can&apos;t calculate: duty missing
                            </span>
                          ) : rt.shipping_cents == null ? (
                            <span className="ds-badge ds-badge-warn">
                              <DsIcon name="alert" size={12} strokeWidth={2.2} />
                              No rate set
                            </span>
                          ) : rt.margin_pct != null ? (
                            <span
                              className={`ds-badge ${
                                rt.margin_below_min ? 'ds-badge-warn' : 'ds-badge-ok'
                              }`}
                            >
                              <DsIcon
                                name={rt.margin_below_min ? 'alert' : 'check'}
                                size={12}
                                strokeWidth={2.2}
                              />
                              {rt.margin_pct.toFixed(0)}%
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canSeeCosts && (
          <p className="m-0 px-5 py-3 text-[12px] text-muted border-t border-line">
            Our cost includes the Sourcing purchase cost, internal pick-and-pack charge from 3PL, and
            carrier cost from the Shipping rate card. Duty and tax values come from the versioned rate
            table; unknown DDP values stay empty until staff fill them in.
          </p>
        )}
      </section>
    </div>
  );
}
