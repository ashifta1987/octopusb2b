'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { COUNTRY_NAMES, fmtDate } from '@/lib/format';
import {
  DsBadge,
  DsButton,
  DsCard,
  DsEmptyState,
  DsNotice,
  DsPageHeader,
} from '@/components/dropship-ui';
import {
  decideDropshipAccessRequestAction,
  proposeMerchantWalletAdjustmentAction,
  reviewDropshipMerchantProfileAction,
  setDropshipMerchantStatusAction,
  updateDropshipMerchantMarketsAction,
  type StaffActionResult,
} from './actions';

export type StaffAccessRequestItem = {
  id: string;
  org_id: string;
  org_name: string;
  org_country: string | null;
  kyc_status: string;
  store_platform: string;
  store_address: string | null;
  expected_orders_band: string;
  countries: string[];
  status: 'pending' | 'approved' | 'rejected';
  decision_reason: string | null;
  created_at: string;
  decided_at: string | null;
};

export type StaffMerchantSellerProfile = {
  brand_name: string;
  return_name: string;
  return_line1: string;
  return_line2: string | null;
  return_city: string;
  return_region: string | null;
  return_postal_code: string | null;
  return_country: string;
  status: 'pending' | 'approved' | 'rejected';
  customer_message: string | null;
  review_note: string | null;
  reviewed_at: string | null;
};

export type StaffMerchantItem = {
  org_id: string;
  org_name: string;
  org_country: string | null;
  kyc_status: string;
  credit_eligible: boolean;
  dropship_status: 'on' | 'paused' | 'off';
  status_reason: string | null;
  started_at: string | null;
  plan_label: string;
  stores_count: number;
  wallet_cash_cents: number;
  held_cents: number;
  orders_30d: number;
  hold_orders_count: number;
  open_tickets_count: number;
  account_manager_name: string | null;
  markets: string[];
  markets_locked: boolean;
  seller_profile: StaffMerchantSellerProfile | null;
};

const usd = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export function StaffMerchantsClient({
  requests,
  merchants,
  canEdit,
  canProposeWalletAdjustment,
}: {
  requests: StaffAccessRequestItem[];
  merchants: StaffMerchantItem[];
  canEdit: boolean;
  canProposeWalletAdjustment: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedOrgId, setSelectedOrgId] = useState<string | null>(
    merchants[0]?.org_id ?? null,
  );

  const selectedMerchant =
    merchants.find((m) => m.org_id === selectedOrgId) ?? merchants[0] ?? null;

  const pendingRequests = requests.filter((r) => r.status === 'pending');

  function runAction(fn: () => Promise<StaffActionResult>) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? 'Action failed.');
        return;
      }
      setNotice(res.message ?? 'Saved.');
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5" data-testid="staff-merchants-page">
      <DsPageHeader
        title="Merchants"
        subtitle="Dropship merchants, their stores, wallets, plans and access requests."
        icon="users"
      />

      {notice && (
        <DsNotice tone="ok" title="Updated" testId="staff-merchants-notice">
          {notice}
        </DsNotice>
      )}

      {error && (
        <DsNotice tone="bad" title="Could not update" testId="staff-merchants-error">
          {error}
        </DsNotice>
      )}

      {/* 1. Access Requests Queue */}
      <DsCard
        title={`Access requests (${pendingRequests.length})`}
        icon="users"
        noPadding
      >
        {pendingRequests.length === 0 ? (
          <div className="p-5" data-testid="staff-access-requests-empty">
            <DsEmptyState
              title="No pending access requests"
              description="Requests submitted from Start dropshipping arrive here for review."
            />
          </div>
        ) : (
          <div className="ds-scroll" data-testid="staff-access-requests">
            <table className="ds-tbl min-w-[860px]">
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">KYC</th>
                  <th scope="col">Platform &amp; store</th>
                  <th scope="col">Countries</th>
                  <th scope="col">Expected orders</th>
                  <th scope="col">Decision (reason required)</th>
                </tr>
              </thead>
              <tbody>
                {pendingRequests.map((req) => {
                  const kycOk = req.kyc_status === 'verified';
                  return (
                    <tr key={req.id} data-testid={`access-request-row-${req.org_id}`}>
                      <td>
                        <strong className="font-semibold text-[#1A174A]">
                          {req.org_name}
                        </strong>
                        <div className="ds-mut text-[12px]">
                          Requested {fmtDate(req.created_at)}
                        </div>
                      </td>
                      <td>
                        <DsBadge tone={kycOk ? 'ok' : 'bad'}>
                          {kycOk ? 'Verified' : 'Not verified'}
                        </DsBadge>
                      </td>
                      <td>
                        <span className="capitalize">{req.store_platform}</span>
                        {req.store_address ? (
                          <div className="ds-mut font-mono text-[12px]">
                            {req.store_address}
                          </div>
                        ) : null}
                      </td>
                      <td>
                        {req.countries
                          .map((c) => COUNTRY_NAMES[c] ?? c)
                          .join(', ')}
                      </td>
                      <td>{req.expected_orders_band}</td>
                      <td>
                        {!kycOk ? (
                          <DsButton
                            type="button"
                            variant="primary"
                            disabled
                            disabledReason="Verify KYC before approving"
                            data-testid={`request-kyc-needed-${req.org_id}`}
                          >
                            KYC needed first
                          </DsButton>
                        ) : canEdit ? (
                          <form
                            action={(fd) =>
                              runAction(() => decideDropshipAccessRequestAction(fd))
                            }
                            className="flex flex-wrap items-center gap-2"
                          >
                            <input type="hidden" name="request_id" value={req.id} />
                            <input
                              name="reason"
                              required
                              aria-label={`Reason for ${req.org_name}`}
                              placeholder="Reason (required)"
                              disabled={pending}
                              data-testid={`request-reason-${req.org_id}`}
                              className="ds-inp min-w-[180px] text-[13px]"
                            />
                            <button
                              type="submit"
                              name="decision"
                              value="approve"
                              disabled={pending}
                              data-testid={`approve-request-${req.org_id}`}
                              className="ds-btn text-[13px]"
                            >
                              Approve
                            </button>
                            <button
                              type="submit"
                              name="decision"
                              value="reject"
                              disabled={pending}
                              data-testid={`reject-request-${req.org_id}`}
                              className="ds-btn2 text-[13px]"
                            >
                              Reject
                            </button>
                          </form>
                        ) : (
                          <span className="ds-mut text-[12px]">Read-only</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DsCard>

      {/* 2. Merchants Table */}
      <DsCard title={`Merchants (${merchants.length})`} icon="users" noPadding>
        {merchants.length === 0 ? (
          <div className="p-5">
            <DsEmptyState
              title="No dropship merchants yet"
              description="Approved merchants appear here with their wallet, return profile and order counts."
            />
          </div>
        ) : (
          <div className="ds-scroll" data-testid="staff-merchants-table">
            <table className="ds-tbl min-w-[840px]">
              <thead>
                <tr>
                  <th scope="col">Merchant</th>
                  <th scope="col">Plan</th>
                  <th scope="col">Stores</th>
                  <th scope="col">Wallet</th>
                  <th scope="col">Held</th>
                  <th scope="col">Orders 30 days</th>
                  <th scope="col">Return profile</th>
                  <th scope="col">Status</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {merchants.map((m) => {
                  const isLowWallet =
                    m.dropship_status === 'on' && m.wallet_cash_cents < 2000;
                  const selected = selectedMerchant?.org_id === m.org_id;
                  return (
                    <tr
                      key={m.org_id}
                      data-testid={`merchant-row-${m.org_id}`}
                      className={selected ? 'bg-[#F2F7FE]' : undefined}
                    >
                      <td>
                        <strong className="font-semibold text-[#1A174A]">
                          {m.org_name}
                        </strong>
                        <div className="ds-mut text-[12px]">
                          KYC: {m.kyc_status}
                          {m.markets.length > 0 ? ` · ${m.markets.join(', ')}` : ''}
                        </div>
                      </td>
                      <td>{m.plan_label}</td>
                      <td className="font-mono">{m.stores_count}</td>
                      <td className="font-mono">{usd(m.wallet_cash_cents)}</td>
                      <td className="font-mono">{usd(m.held_cents)}</td>
                      <td className="font-mono">{m.orders_30d}</td>
                      <td>
                        {m.seller_profile ? (
                          <DsBadge
                            tone={
                              m.seller_profile.status === 'approved'
                                ? 'ok'
                                : m.seller_profile.status === 'rejected'
                                  ? 'bad'
                                  : 'warn'
                            }
                          >
                            {m.seller_profile.status}
                          </DsBadge>
                        ) : (
                          <DsBadge tone="neutral">Not submitted</DsBadge>
                        )}
                      </td>
                      <td>
                        {m.dropship_status === 'paused' ? (
                          <DsBadge tone="warn">Paused</DsBadge>
                        ) : m.dropship_status === 'off' ? (
                          <DsBadge tone="bad">Closed</DsBadge>
                        ) : isLowWallet ? (
                          <DsBadge tone="warn">Low wallet</DsBadge>
                        ) : (
                          <DsBadge tone="ok">Active</DsBadge>
                        )}
                      </td>
                      <td className="text-right">
                        <DsButton
                          type="button"
                          variant="secondary"
                          onClick={() => setSelectedOrgId(m.org_id)}
                          data-testid={`select-merchant-${m.org_id}`}
                        >
                          {selected ? 'Selected' : 'Manage'}
                        </DsButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DsCard>

      {/* 3. Selected Merchant Detail + Status/Profile Controls + Wallet Adjustment */}
      {selectedMerchant && (
        <div
          className="grid grid-cols-1 lg:grid-cols-5 gap-4 items-start"
          data-testid="selected-merchant-panel"
        >
          <div className="lg:col-span-3 flex flex-col gap-4">
            <DsCard title={selectedMerchant.org_name} icon="users">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                <div className="ds-row">
                  <span className="ds-mut">Dropshipping</span>
                  <DsBadge
                    tone={
                      selectedMerchant.dropship_status === 'on'
                        ? 'ok'
                        : selectedMerchant.dropship_status === 'paused'
                          ? 'warn'
                          : 'bad'
                    }
                  >
                    {selectedMerchant.dropship_status === 'on'
                      ? 'On'
                      : selectedMerchant.dropship_status === 'paused'
                        ? 'Paused'
                        : 'Closed (Off)'}
                  </DsBadge>
                </div>

                <div className="ds-row">
                  <span className="ds-mut">KYC</span>
                  <DsBadge
                    tone={
                      selectedMerchant.kyc_status === 'verified' ? 'ok' : 'bad'
                    }
                  >
                    {selectedMerchant.kyc_status}
                  </DsBadge>
                </div>

                <div className="ds-row">
                  <span className="ds-mut">Selling countries</span>
                  <span>
                    {selectedMerchant.markets.length > 0
                      ? selectedMerchant.markets.join(', ')
                      : 'None'}
                    {selectedMerchant.markets_locked ? ' · Locked' : ''}
                  </span>
                </div>

                <div className="ds-row">
                  <span className="ds-mut">Plan</span>
                  <span>{selectedMerchant.plan_label}</span>
                </div>

                <div className="ds-row">
                  <span className="ds-mut">Pay later</span>
                  <DsBadge
                    tone={selectedMerchant.credit_eligible ? 'info' : 'neutral'}
                  >
                    {selectedMerchant.credit_eligible
                      ? 'Eligible (internal/test)'
                      : 'Not available: customer'}
                  </DsBadge>
                </div>

                <div className="ds-row">
                  <span className="ds-mut">Account manager</span>
                  <span>{selectedMerchant.account_manager_name ?? 'Unassigned'}</span>
                </div>

                <div className="ds-row">
                  <span className="ds-mut">Open tickets</span>
                  <span className="font-mono">{selectedMerchant.open_tickets_count}</span>
                </div>

                <div className="ds-row">
                  <span className="ds-mut">Orders on hold</span>
                  <span className="font-mono">
                    {selectedMerchant.hold_orders_count} orders
                  </span>
                </div>
              </div>

              {selectedMerchant.status_reason && (
                <p className="ds-mut mt-3 mb-0 text-[12px]">
                  <strong>Last status reason:</strong> {selectedMerchant.status_reason}
                </p>
              )}
              <p className="ds-mut mt-2 mb-0 text-[12px]">
                Pay later is only for Octopus group companies and test accounts (credit_eligible).
              </p>

              {canEdit && (
                <div className="mt-4 pt-4 border-t border-[#E3E7EF] flex flex-col gap-4">
                  {/* Selling countries + lock */}
                  <form
                    key={`markets-${selectedMerchant.org_id}-${selectedMerchant.markets.join(',')}-${selectedMerchant.markets_locked}`}
                    action={(fd) =>
                      runAction(() => updateDropshipMerchantMarketsAction(fd))
                    }
                    className="flex flex-wrap items-end gap-3"
                  >
                    <input
                      type="hidden"
                      name="org_id"
                      value={selectedMerchant.org_id}
                    />
                    <div className="flex-1 min-w-[200px]">
                      <label
                        className="ds-lbl"
                        htmlFor={`staff-mkts-${selectedMerchant.org_id}`}
                      >
                        Selling countries (ISO-2)
                      </label>
                      <input
                        id={`staff-mkts-${selectedMerchant.org_id}`}
                        name="countries"
                        defaultValue={selectedMerchant.markets.join(', ')}
                        placeholder="AE, SA, GB"
                        disabled={pending}
                        className="ds-inp w-full font-mono text-[13px]"
                      />
                    </div>
                    <label className="inline-flex items-center gap-2 min-h-[44px] text-[13px] cursor-pointer">
                      <input
                        type="checkbox"
                        name="locked_by_staff"
                        defaultChecked={selectedMerchant.markets_locked}
                        disabled={pending}
                        className="w-4 h-4 accent-[#1A174A]"
                      />
                      <span>Lock by account manager</span>
                    </label>
                    <DsButton type="submit" variant="secondary" disabled={pending}>
                      Save countries
                    </DsButton>
                  </form>

                  {/* Pause / Reactivate / Close with required reason */}
                  <form
                    key={`status-${selectedMerchant.org_id}-${selectedMerchant.dropship_status}`}
                    action={(fd) =>
                      runAction(() => setDropshipMerchantStatusAction(fd))
                    }
                    className="flex flex-col gap-2"
                    data-testid="merchant-status-form"
                  >
                    <input
                      type="hidden"
                      name="org_id"
                      value={selectedMerchant.org_id}
                    />
                    <label
                      className="ds-lbl"
                      htmlFor={`status-reason-${selectedMerchant.org_id}`}
                    >
                      Change service status (reason required, audit-logged)
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        id={`status-reason-${selectedMerchant.org_id}`}
                        name="reason"
                        required
                        placeholder="Reason shown to merchant"
                        disabled={pending}
                        data-testid="merchant-status-reason"
                        className="ds-inp flex-1 min-w-[220px] text-[13px]"
                      />
                      {selectedMerchant.dropship_status !== 'on' && (
                        <DsButton
                          type="submit"
                          name="status"
                          value="on"
                          variant="primary"
                          disabled={
                            pending || selectedMerchant.kyc_status !== 'verified'
                          }
                          disabledReason={
                            selectedMerchant.kyc_status !== 'verified'
                              ? 'KYC verification required before reactivating'
                              : undefined
                          }
                          data-testid="reactivate-merchant-btn"
                        >
                          Reactivate
                        </DsButton>
                      )}
                      {selectedMerchant.dropship_status !== 'paused' && (
                        <button
                          type="submit"
                          name="status"
                          value="paused"
                          disabled={pending}
                          data-testid="pause-merchant-btn"
                          className="ds-btn2 text-[13px]"
                        >
                          Pause
                        </button>
                      )}
                      {selectedMerchant.dropship_status !== 'off' && (
                        <button
                          type="submit"
                          name="status"
                          value="off"
                          disabled={pending}
                          data-testid="close-merchant-btn"
                          className="ds-btn2 text-[13px]"
                        >
                          Close
                        </button>
                      )}
                    </div>
                    <p className="ds-mut m-0 text-[12px]">
                      Pause or close blocks only new imports, store pushes, samples, product
                      requests and new order charges (<code>DROPSHIP_PAUSED</code>); paid orders in
                      progress keep shipping.
                    </p>
                  </form>
                </div>
              )}
            </DsCard>

            {/* Seller Return & Brand Profile Review */}
            <DsCard title="Return & brand profile (shipping label gate)" icon="package">
              {!selectedMerchant.seller_profile ? (
                <p className="ds-mut text-[14px] m-0">
                  This merchant has not submitted a brand and return address yet. Shipping labels
                  cannot be created until an approved profile is on file.
                </p>
              ) : (
                <div className="flex flex-col gap-3" data-testid="staff-seller-profile-card">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-[15px] text-[#1A174A]">
                      {selectedMerchant.seller_profile.brand_name}
                    </strong>
                    <DsBadge
                      tone={
                        selectedMerchant.seller_profile.status === 'approved'
                          ? 'ok'
                          : selectedMerchant.seller_profile.status === 'rejected'
                            ? 'bad'
                            : 'warn'
                      }
                    >
                      {selectedMerchant.seller_profile.status}
                    </DsBadge>
                  </div>
                  <div className="rounded-[10px] border border-[#E3E7EF] bg-[#F8FAFC] p-3 text-[13px] leading-[1.55]">
                    <div>
                      <strong>{selectedMerchant.seller_profile.return_name}</strong>
                    </div>
                    <div>{selectedMerchant.seller_profile.return_line1}</div>
                    {selectedMerchant.seller_profile.return_line2 && (
                      <div>{selectedMerchant.seller_profile.return_line2}</div>
                    )}
                    <div>
                      {[
                        selectedMerchant.seller_profile.return_city,
                        selectedMerchant.seller_profile.return_region,
                        selectedMerchant.seller_profile.return_postal_code,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </div>
                    <div>{selectedMerchant.seller_profile.return_country}</div>
                  </div>

                  {canEdit && (
                    <form
                      key={`prof-${selectedMerchant.org_id}-${selectedMerchant.seller_profile.status}`}
                      action={(fd) =>
                        runAction(() => reviewDropshipMerchantProfileAction(fd))
                      }
                      className="flex flex-col gap-2.5 pt-1"
                    >
                      <input
                        type="hidden"
                        name="org_id"
                        value={selectedMerchant.org_id}
                      />
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <label
                            className="ds-lbl"
                            htmlFor={`prof-reason-${selectedMerchant.org_id}`}
                          >
                            Message / reason (shown to merchant)
                          </label>
                          <input
                            id={`prof-reason-${selectedMerchant.org_id}`}
                            name="reason"
                            required
                            defaultValue={
                              selectedMerchant.seller_profile.customer_message ?? ''
                            }
                            placeholder="e.g. Verified return address"
                            disabled={pending}
                            data-testid="profile-review-reason"
                            className="ds-inp w-full text-[13px]"
                          />
                        </div>
                        <div>
                          <label
                            className="ds-lbl"
                            htmlFor={`prof-note-${selectedMerchant.org_id}`}
                          >
                            Internal note (staff only)
                          </label>
                          <input
                            id={`prof-note-${selectedMerchant.org_id}`}
                            name="internal_note"
                            defaultValue={
                              selectedMerchant.seller_profile.review_note ?? ''
                            }
                            placeholder="Optional internal note"
                            disabled={pending}
                            className="ds-inp w-full text-[13px]"
                          />
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="submit"
                          name="status"
                          value="approved"
                          disabled={pending}
                          data-testid="approve-seller-profile-btn"
                          className="ds-btn text-[13px]"
                        >
                          Approve profile
                        </button>
                        <button
                          type="submit"
                          name="status"
                          value="rejected"
                          disabled={pending}
                          data-testid="reject-seller-profile-btn"
                          className="ds-btn2 text-[13px]"
                        >
                          Reject profile
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </DsCard>
          </div>

          <div className="lg:col-span-2 flex flex-col gap-4">
            {canProposeWalletAdjustment && (
              <DsCard title="Wallet adjustment" icon="wallet">
                <form
                  action={(fd) =>
                    runAction(() => proposeMerchantWalletAdjustmentAction(fd))
                  }
                  className="flex flex-col gap-3"
                  data-testid="staff-wallet-adjustment-form"
                >
                  <input
                    type="hidden"
                    name="org_id"
                    value={selectedMerchant.org_id}
                  />
                  <div>
                    <label
                      className="ds-lbl"
                      htmlFor={`wa-amt-${selectedMerchant.org_id}`}
                    >
                      Credit adjustment amount (USD)
                    </label>
                    <input
                      id={`wa-amt-${selectedMerchant.org_id}`}
                      name="amount"
                      type="number"
                      min="0.01"
                      step="0.01"
                      required
                      placeholder="25.00"
                      disabled={pending}
                      className="ds-inp w-full font-mono"
                    />
                  </div>
                  <div>
                    <label
                      className="ds-lbl"
                      htmlFor={`wa-rsn-${selectedMerchant.org_id}`}
                    >
                      Reason (required, shown to merchant)
                    </label>
                    <input
                      id={`wa-rsn-${selectedMerchant.org_id}`}
                      name="reason"
                      required
                      minLength={5}
                      placeholder="Goodwill / carrier delay adjustment"
                      disabled={pending}
                      className="ds-inp w-full"
                    />
                  </div>
                  <p className="ds-mut m-0 text-[12px]">
                    Every adjustment requires a second Finance approver; above US$1,000 requires an
                    Admin approver.
                  </p>
                  <DsButton
                    type="submit"
                    variant="primary"
                    icon="send"
                    disabled={pending}
                  >
                    {pending ? 'Proposing…' : 'Propose adjustment'}
                  </DsButton>
                </form>
              </DsCard>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
