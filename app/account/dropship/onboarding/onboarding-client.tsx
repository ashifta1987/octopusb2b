'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { COUNTRY_NAMES, money } from '@/lib/format';
import type { DropshipOnboardingState } from '@/lib/dropship';
import {
  DsBadge,
  DsButton,
  DsCard,
  DsLinkButton,
  DsNotice,
  DsPageHeader,
} from '@/components/dropship-ui';
import {
  saveDropshipSellerProfileAction,
  saveOnboardingMarketsAction,
} from '../actions';

const ALL_STEPS: [number, string][] = [
  [1, 'Selling countries'],
  [2, 'Return & brand'],
  [3, 'Plan & wallet'],
  [4, 'Connect store'],
];

// UI rule: money in the merchant's view is always US$ with two decimals
const usd = (cents: number) => money(cents, 'USD');

export function OnboardingClient({
  state,
  initialStep = 1,
  storeStep = true,
}: {
  state: DropshipOnboardingState;
  initialStep?: number;
  /** EA-2: while store connection is not released, onboarding has 3 steps (no "Connect store") */
  storeStep?: boolean;
}) {
  const router = useRouter();
  const STEPS = storeStep ? ALL_STEPS : ALL_STEPS.slice(0, 3);
  const [step, setStep] = useState<number>(
    initialStep >= 1 && initialStep <= STEPS.length ? initialStep : 1,
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isActive = state.dropship_status === 'on';
  const marketsLocked = state.markets.some((m) => m.locked_by_staff);
  const [selectedCountries, setSelectedCountries] = useState<string[]>(
    state.markets.length > 0
      ? state.markets.map((m) => m.country)
      : ['AE'].filter((c) => state.supported_countries.includes(c)),
  );

  const sp = state.seller_profile;
  const marketsDone = state.markets.length > 0;
  const profileDone = Boolean(sp);

  function toggleCountry(code: string) {
    setSelectedCountries((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  function handleSaveMarkets(formData: FormData) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await saveOnboardingMarketsAction(formData);
      if (!res.ok) {
        setError(res.error ?? 'Could not save selling countries.');
        return;
      }
      setNotice('Selling countries saved.');
      setStep(2);
      router.refresh();
    });
  }

  function handleSaveProfile(formData: FormData) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await saveDropshipSellerProfileAction(formData);
      if (!res.ok) {
        setError(res.error ?? 'Could not save brand and return profile.');
        return;
      }
      setNotice(
        'Brand and return address saved for staff review. Shipping labels stay locked until staff approve this address.',
      );
      setStep(3);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5" data-testid="dropship-onboarding">
      <DsPageHeader
        title="Set up Octopus Dropship"
        subtitle={`${STEPS.length} short steps. You can skip and come back any time.`}
        icon="list"
        actions={
          <DsLinkButton href="/account/dropship" variant="secondary" icon="arrow">
            Skip for now
          </DsLinkButton>
        }
      />

      {!isActive && (
        <DsNotice
          tone="warn"
          title={
            state.dropship_status === 'paused'
              ? 'Dropshipping is paused'
              : 'Dropshipping account closed'
          }
          testId="onboarding-paused-banner"
        >
          {state.status_reason ? <strong>{state.status_reason}. </strong> : null}
          Profile and market changes are paused until Dropshipping is active again.
        </DsNotice>
      )}

      {notice && (
        <DsNotice tone="ok" title="Saved" testId="onboarding-notice">
          {notice}
        </DsNotice>
      )}

      {error && (
        <DsNotice tone="bad" title="Could not save" testId="onboarding-error">
          {error}
        </DsNotice>
      )}

      <DsCard>
        <ol
          aria-label="Steps"
          className="list-none m-0 p-0 flex flex-wrap items-center gap-2"
        >
          {STEPS.map(([num, label], idx) => {
            const current = step === num;
            const done =
              (num === 1 && marketsDone) ||
              (num === 2 && profileDone) ||
              (num === 3 && state.wallet_balance_cents > 0);
            return (
              <li key={num} className="flex items-center gap-2">
                {idx > 0 && (
                  <span
                    aria-hidden="true"
                    className="hidden sm:inline-block w-6 h-[2px] bg-line"
                  />
                )}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    setStep(num);
                  }}
                  aria-current={current ? 'step' : undefined}
                  data-testid={`onboarding-step-btn-${num}`}
                  className={`inline-flex items-center gap-2 min-h-[44px] px-2.5 rounded-[8px] border-0 bg-transparent cursor-pointer text-[14px] ${
                    current
                      ? 'font-semibold text-ink'
                      : 'font-medium text-muted hover:text-ink'
                  }`}
                >
                  <span
                    className={`w-7 h-7 rounded-full inline-flex items-center justify-center text-[13px] font-bold shrink-0 ${
                      current
                        ? 'bg-coral text-white'
                        : done
                          ? 'bg-ok text-white'
                          : 'border-2 border-line-strong text-muted'
                    }`}
                  >
                    {num}
                  </span>
                  <span>{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </DsCard>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        <div className="lg:col-span-2 flex flex-col gap-4">
          {step === 1 && (
            <DsCard title="1. Selling countries & import duties" icon="globe">
              <form action={handleSaveMarkets} className="flex flex-col gap-4">
                {marketsLocked && (
                  <DsNotice tone="info" title="Locked by your account manager">
                    Your selling countries were locked by your account manager. Contact support if
                    you need to add or remove a destination.
                  </DsNotice>
                )}

                <fieldset className="border-0 m-0 p-0">
                  <legend className="ds-lbl">Choose where your buyers live</legend>
                  <div className="flex flex-wrap gap-x-5 gap-y-2 mt-1">
                    {state.supported_countries.map((code) => (
                      <label
                        key={code}
                        className="inline-flex items-center gap-2.5 min-h-[44px] text-[14px] cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          name="countries"
                          value={code}
                          checked={selectedCountries.includes(code)}
                          onChange={() => toggleCountry(code)}
                          disabled={!isActive || marketsLocked || pending}
                          className="w-4 h-4 accent-ink"
                        />
                        <span>{COUNTRY_NAMES[code] ?? code}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <div
                  className="rounded-[10px] border border-line bg-pearl p-3.5 text-[13px] leading-[1.55] text-ink"
                  data-testid="onboarding-duty-note"
                >
                  <strong className="block mb-1">How import duties work (DDP vs DAP)</strong>
                  <ul className="m-0 pl-4 space-y-1">
                    <li>
                      <strong>DDP (Delivered Duty Paid):</strong> Duties and import tax are
                      calculated and paid up front so your buyer pays nothing on delivery. Routes
                      without a verified duty rate cannot ship DDP.
                    </li>
                    <li>
                      <strong>DAP (Delivered at Place):</strong> Octopus charges US$0.00 duty (
                      <em>&ldquo;Duties paid by buyer&rdquo;</em> on delivery). Per-country DDP/DAP
                      preferences are managed in Packing and shipping.
                    </li>
                  </ul>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  {!marketsLocked && (
                    <DsButton
                      type="submit"
                      variant="primary"
                      icon="check"
                      disabled={!isActive || pending || selectedCountries.length === 0}
                      disabledReason={!isActive ? 'Dropshipping is paused' : undefined}
                      data-testid="onboarding-save-markets-btn"
                    >
                      {pending ? 'Saving…' : 'Save countries & continue'}
                    </DsButton>
                  )}
                  <DsButton
                    type="button"
                    variant="secondary"
                    icon="arrow"
                    onClick={() => setStep(2)}
                  >
                    Next: Return &amp; brand
                  </DsButton>
                </div>
              </form>
            </DsCard>
          )}

          {step === 2 && (
            <DsCard title="2. Return address & brand profile" icon="package">
              <div className="mb-4" data-testid="onboarding-profile-status">
                <DsNotice
                  tone={
                    sp?.status === 'approved'
                      ? 'ok'
                      : sp?.status === 'rejected'
                        ? 'bad'
                        : 'info'
                  }
                  title={
                    sp?.status === 'approved'
                      ? 'Approved for shipping labels'
                      : sp?.status === 'rejected'
                        ? 'Changes requested by staff'
                        : 'Staff approval required before any shipping label is printed'
                  }
                >
                  {sp?.status === 'rejected' && sp.customer_message ? (
                    <span>
                      <strong>Staff note:</strong> {sp.customer_message}{' '}
                    </span>
                  ) : null}
                  Parcels and packing slips show only your brand name and approved return address —
                  never supplier names or Octopus costs. Any edit to your brand or return address
                  resets approval to <strong>Pending</strong> until staff review it again.
                </DsNotice>
              </div>

              <form action={handleSaveProfile} className="flex flex-col gap-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="ds-lbl" htmlFor="sp-brand">
                      Brand name (printed on label &amp; slip)
                    </label>
                    <input
                      id="sp-brand"
                      name="brand_name"
                      required
                      maxLength={80}
                      defaultValue={sp?.brand_name ?? state.org_name}
                      disabled={!isActive || pending}
                      className="ds-inp w-full"
                    />
                  </div>
                  <div>
                    <label className="ds-lbl" htmlFor="sp-rname">
                      Return contact / department
                    </label>
                    <input
                      id="sp-rname"
                      name="return_name"
                      required
                      maxLength={120}
                      defaultValue={sp?.return_name ?? `${state.org_name} Returns`}
                      disabled={!isActive || pending}
                      className="ds-inp w-full"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="ds-lbl" htmlFor="sp-line1">
                      Return street address (line 1)
                    </label>
                    <input
                      id="sp-line1"
                      name="return_line1"
                      required
                      maxLength={200}
                      defaultValue={sp?.return_line1 ?? ''}
                      placeholder="Building, street"
                      disabled={!isActive || pending}
                      className="ds-inp w-full"
                    />
                  </div>
                  <div>
                    <label className="ds-lbl" htmlFor="sp-line2">
                      Line 2 (optional)
                    </label>
                    <input
                      id="sp-line2"
                      name="return_line2"
                      maxLength={200}
                      defaultValue={sp?.return_line2 ?? ''}
                      placeholder="Unit, suite, landmark"
                      disabled={!isActive || pending}
                      className="ds-inp w-full"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="ds-lbl" htmlFor="sp-city">
                      City
                    </label>
                    <input
                      id="sp-city"
                      name="return_city"
                      required
                      maxLength={120}
                      defaultValue={sp?.return_city ?? ''}
                      disabled={!isActive || pending}
                      className="ds-inp w-full"
                    />
                  </div>
                  <div>
                    <label className="ds-lbl" htmlFor="sp-region">
                      State / emirate (optional)
                    </label>
                    <input
                      id="sp-region"
                      name="return_region"
                      maxLength={120}
                      defaultValue={sp?.return_region ?? ''}
                      disabled={!isActive || pending}
                      className="ds-inp w-full"
                    />
                  </div>
                  <div>
                    <label className="ds-lbl" htmlFor="sp-postal">
                      Postal code (optional)
                    </label>
                    <input
                      id="sp-postal"
                      name="return_postal_code"
                      maxLength={20}
                      defaultValue={sp?.return_postal_code ?? ''}
                      disabled={!isActive || pending}
                      className="ds-inp w-full"
                    />
                  </div>
                  <div>
                    <label className="ds-lbl" htmlFor="sp-country">
                      Country
                    </label>
                    <input
                      id="sp-country"
                      name="return_country"
                      required
                      maxLength={60}
                      defaultValue={
                        sp?.return_country ??
                        (state.org_country
                          ? COUNTRY_NAMES[state.org_country] ?? state.org_country
                          : 'United Arab Emirates')
                      }
                      disabled={!isActive || pending}
                      className="ds-inp w-full"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <DsButton
                    type="button"
                    variant="secondary"
                    onClick={() => setStep(1)}
                  >
                    Back
                  </DsButton>
                  <DsButton
                    type="submit"
                    variant="primary"
                    icon="check"
                    disabled={!isActive || pending}
                    disabledReason={!isActive ? 'Dropshipping is paused' : undefined}
                    data-testid="onboarding-save-profile-btn"
                  >
                    {pending ? 'Saving…' : 'Save for staff approval'}
                  </DsButton>
                  <DsButton
                    type="button"
                    variant="secondary"
                    icon="arrow"
                    onClick={() => setStep(3)}
                  >
                    Skip to Plan &amp; wallet
                  </DsButton>
                </div>
              </form>
            </DsCard>
          )}

          {step === 3 && (
            <div className="flex flex-col gap-4">
              <DsCard title="3. SaaS plan & billing" icon="card">
                <div
                  className="rounded-[12px] border border-ok-line bg-ok-soft p-4 flex flex-wrap items-center justify-between gap-3"
                  data-testid="onboarding-plan-card"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <strong className="text-[15px] text-ink">
                        {state.saas_billing.enabled
                          ? `${state.saas_billing.trial_days}-day free trial`
                          : 'Free while plan fees are off'}
                      </strong>
                      <DsBadge tone="ok">
                        {state.saas_billing.enabled ? 'Trial' : 'US$ 0.00 / mo'}
                      </DsBadge>
                    </div>
                    <p className="m-0 mt-1 text-[13px] leading-[1.5] text-ink">
                      {state.saas_billing.enabled
                        ? `You get ${state.saas_billing.trial_days} days free before any plan charge.`
                        : 'Plan fees are currently switched off — US$ 0.00 is charged and no trial has started. Before charging ever starts, you will get a 30-day free trial and approve any plan first.'}
                    </p>
                  </div>
                </div>
              </DsCard>

              <DsCard title="Wallet cash for orders & samples" icon="wallet">
                <div
                  className="flex flex-col gap-3"
                  data-testid="onboarding-wallet-card"
                >
                  <div className="ds-row">
                    <span className="ds-mut">Available USD wallet cash</span>
                    <strong className="font-mono text-[16px]">
                      {usd(state.wallet_balance_cents)}
                    </strong>
                  </div>
                  <p className="ds-mut text-[13px] m-0">
                    Store orders and sample orders are paid from your Octopus USD wallet. Top up
                    your wallet now so orders can ship without waiting on balance holds.
                  </p>
                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <DsButton
                      type="button"
                      variant="secondary"
                      onClick={() => setStep(2)}
                    >
                      Back
                    </DsButton>
                    <DsLinkButton
                      href="/account/dropship/wallet"
                      variant="secondary"
                      icon="wallet"
                      testId="onboarding-topup-link"
                    >
                      Top up wallet
                    </DsLinkButton>
                    {storeStep ? (
                      <DsButton
                        type="button"
                        variant="primary"
                        icon="arrow"
                        onClick={() => setStep(4)}
                        data-testid="onboarding-to-step4-btn"
                      >
                        Continue to Connect store
                      </DsButton>
                    ) : (
                      <DsLinkButton href="/account/dropship" variant="primary" icon="grid" testId="onboarding-finish-btn">
                        Go to Dashboard
                      </DsLinkButton>
                    )}
                  </div>
                </div>
              </DsCard>
            </div>
          )}

          {storeStep && step === 4 && (
            <DsCard title="4. Connect your Shopify store" icon="store">
              <div
                className="flex flex-col gap-4"
                data-testid="onboarding-connect-store-placeholder"
              >
                <DsNotice tone="info" title="Coming in Step 5 — placeholder for now">
                  Direct Shopify OAuth store connection arrives in Step 5. You can skip this step
                  now and already browse products, compare landed costs, submit free product
                  requests, and order samples.
                </DsNotice>

                <div>
                  <label className="ds-lbl" htmlFor="onboarding-store-preview">
                    Store address
                  </label>
                  <input
                    id="onboarding-store-preview"
                    readOnly
                    disabled
                    value={state.store_address_hint ?? ''}
                    placeholder="your-store.myshopify.com (Step 5)"
                    className="ds-inp w-full opacity-75"
                  />
                  <p className="ds-mut mt-1.5 mb-0 text-[12px]">
                    Your .myshopify.com address, found in Shopify under Settings › Domains.
                  </p>
                </div>

                <div>
                  <h3 className="m-0 mb-2 text-[15px] font-semibold text-ink">
                    In Step 5, Shopify will ask you to allow Octopus Dropship to:
                  </h3>
                  <ul className="m-0 pl-5 text-[14px] leading-[1.8] text-ink">
                    <li>Create and edit the products you push</li>
                    <li>Update stock at an &ldquo;Octopus Dropship&rdquo; location</li>
                    <li>Read your orders and act only on Octopus items</li>
                    <li>Add tracking to those items</li>
                  </ul>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <DsButton
                    type="button"
                    variant="secondary"
                    onClick={() => setStep(3)}
                  >
                    Back
                  </DsButton>
                  <DsLinkButton
                    href="/account/dropship/catalogue"
                    variant="primary"
                    icon="search"
                  >
                    Browse products
                  </DsLinkButton>
                  <DsLinkButton href="/account/dropship" variant="secondary" icon="grid">
                    Go to Dashboard
                  </DsLinkButton>
                </div>
              </div>
            </DsCard>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <DsCard title="Setup checklist" icon="check">
            <ol className="list-none m-0 p-0 flex flex-col gap-3 text-[14px]">
              <li className="flex items-start justify-between gap-2">
                <div>
                  <strong className="font-semibold text-ink">Your business</strong>
                  <div className="ds-mut text-[13px]">
                    {state.org_name} · KYC {state.kyc_status}
                  </div>
                </div>
                <DsBadge tone={state.kyc_status === 'verified' ? 'ok' : 'warn'}>
                  {state.kyc_status === 'verified' ? 'Verified' : state.kyc_status}
                </DsBadge>
              </li>

              <li className="flex items-start justify-between gap-2">
                <div>
                  <strong className="font-semibold text-ink">1. Selling countries</strong>
                  <div className="ds-mut text-[13px]">
                    {marketsDone
                      ? state.markets.map((m) => m.country).join(', ')
                      : 'Choose at least 1 country'}
                  </div>
                </div>
                <DsBadge tone={marketsDone ? 'ok' : 'neutral'}>
                  {marketsDone ? 'Saved' : 'To do'}
                </DsBadge>
              </li>

              <li className="flex items-start justify-between gap-2">
                <div>
                  <strong className="font-semibold text-ink">2. Return &amp; brand</strong>
                  <div className="ds-mut text-[13px]">
                    {sp ? sp.brand_name : 'Required before labels print'}
                  </div>
                </div>
                <DsBadge
                  tone={
                    sp?.status === 'approved'
                      ? 'ok'
                      : sp?.status === 'rejected'
                        ? 'bad'
                        : sp
                          ? 'warn'
                          : 'neutral'
                  }
                >
                  {sp ? sp.status : 'To do'}
                </DsBadge>
              </li>

              <li className="flex items-start justify-between gap-2">
                <div>
                  <strong className="font-semibold text-ink">3. Plan &amp; wallet</strong>
                  <div className="ds-mut text-[13px]">
                    Free while plan fees off · Wallet {usd(state.wallet_balance_cents)}
                  </div>
                </div>
                <DsBadge tone="info">Free</DsBadge>
              </li>

              {storeStep && (
                <li className="flex items-start justify-between gap-2">
                  <div>
                    <strong className="font-semibold text-ink">4. Connect store</strong>
                    <div className="ds-mut text-[13px]">Shopify OAuth (Step 5)</div>
                  </div>
                  <DsBadge tone="neutral">Step 5</DsBadge>
                </li>
              )}
            </ol>
          </DsCard>
        </div>
      </div>
    </div>
  );
}
