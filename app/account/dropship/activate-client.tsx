'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { COUNTRY_NAMES } from '@/lib/format';
import type { DropshipAccessState } from '@/lib/dropship';
import {
  DsBadge,
  DsButton,
  DsCard,
  DsIcon,
  DsLinkButton,
  DsNotice,
  DsPageHeader,
} from '@/components/dropship-ui';
import { submitDropshipAccessRequestAction } from './actions';

export function ActivateClient({ state }: { state: DropshipAccessState }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sentNotice, setSentNotice] = useState<string | null>(null);

  const isVerified = state.kyc_status === 'verified';
  const latest = state.latest_request;
  const defaultCountries =
    latest?.countries && latest.countries.length > 0
      ? latest.countries
      : ['AE', 'SA'].filter((c) => state.supported_countries.includes(c));

  const [selectedCountries, setSelectedCountries] = useState<string[]>(
    defaultCountries.length > 0 ? defaultCountries : state.supported_countries.slice(0, 1),
  );

  function toggleCountry(code: string) {
    setSelectedCountries((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  function handleSubmit(formData: FormData) {
    setError(null);
    setSentNotice(null);
    startTransition(async () => {
      const res = await submitDropshipAccessRequestAction(formData);
      if (!res.ok) {
        setError(res.error ?? 'Could not send request.');
        return;
      }
      setSentNotice(
        'Your request has been sent to your account manager. Nothing is auto-approved; we will notify you in your account once it is reviewed.',
      );
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5" data-testid="dropship-activate">
      <DsPageHeader
        title="Start dropshipping"
        subtitle="Sell Octopus products in your own online store. We pack and ship every order under your brand."
        icon="sparkle"
      />

      {!isVerified && (
        <DsNotice
          tone="warn"
          title="Verify your company first"
          testId="activate-kyc-gate"
          action={
            <DsLinkButton href="/account/kyc" variant="primary" icon="shield">
              Verify your company first
            </DsLinkButton>
          }
        >
          Only KYC-verified companies can request Octopus Dropship access (current status:{' '}
          <strong className="font-semibold">{state.kyc_status.replace(/_/g, ' ')}</strong>). Complete
          company verification first, then return here to send your request.
        </DsNotice>
      )}

      {latest?.status === 'pending' && (
        <DsNotice
          tone="info"
          title="Access request pending review"
          testId="activate-pending-banner"
        >
          Sent for <strong>{state.org_name}</strong> ({latest.countries.join(', ')} ·{' '}
          {latest.expected_orders_band} orders/mo). Your account manager checks your account and
          switches dropshipping on — usually within 1 working day.
        </DsNotice>
      )}

      {latest?.status === 'rejected' && (
        <DsNotice
          tone="warn"
          title="Previous access request declined"
          testId="activate-rejected-banner"
        >
          {latest.decision_reason ??
            'Your account manager declined the previous request. Review the note or talk to your account manager before sending a new request.'}
        </DsNotice>
      )}

      {sentNotice && (
        <DsNotice tone="ok" title="Request sent" testId="activate-sent-notice">
          {sentNotice}
        </DsNotice>
      )}

      {error && (
        <DsNotice tone="bad" title="Could not send request" testId="activate-error">
          {error}
        </DsNotice>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DsCard title="How it works" icon="clock">
          <ol className="list-none m-0 p-0 flex flex-col gap-3 text-[14px]">
            <li className="flex gap-3">
              <span
                aria-hidden="true"
                className="w-3 h-3 rounded-full bg-[#2A6FD1] mt-1.5 shrink-0"
              />
              <div>
                <strong className="font-semibold text-[#1A174A]">Request access</strong>
                <div className="ds-mut text-[13px]">Takes 2 minutes</div>
              </div>
            </li>
            <li className="flex gap-3">
              <span
                aria-hidden="true"
                className="w-3 h-3 rounded-full border-2 border-[#C9D0DD] mt-1.5 shrink-0 box-border"
              />
              <div>
                <strong className="font-medium text-[#1A174A]">
                  Account manager checks your account
                </strong>
                <div className="ds-mut text-[13px]">Usually within 1 working day</div>
              </div>
            </li>
            <li className="flex gap-3">
              <span
                aria-hidden="true"
                className="w-3 h-3 rounded-full border-2 border-[#C9D0DD] mt-1.5 shrink-0 box-border"
              />
              <div>
                <strong className="font-medium text-[#1A174A]">Connect your Shopify store</strong>
                <div className="ds-mut text-[13px]">Inside Shopify admin (Step 5)</div>
              </div>
            </li>
            <li className="flex gap-3">
              <span
                aria-hidden="true"
                className="w-3 h-3 rounded-full border-2 border-[#C9D0DD] mt-1.5 shrink-0 box-border"
              />
              <div>
                <strong className="font-medium text-[#1A174A]">
                  Import products and start selling
                </strong>
                <div className="ds-mut text-[13px]">We pack and ship each order</div>
              </div>
            </li>
          </ol>
        </DsCard>

        <DsCard title="What you need" icon="check">
          <ul className="m-0 pl-5 text-[14px] leading-[1.85] text-[#1A174A]">
            <li className="flex flex-wrap items-center gap-2">
              <span>A verified Octopus account (KYC done)</span>
              {isVerified ? (
                <DsBadge tone="ok">Verified</DsBadge>
              ) : (
                <Link href="/account/kyc" className="no-underline">
                  <DsBadge tone="warn">Verify first</DsBadge>
                </Link>
              )}
            </li>
            <li>A Shopify store (others later)</li>
            <li>Money in your Octopus wallet to pay for orders</li>
          </ul>
          <p className="ds-mut mt-3 mb-0 text-[13px]" data-testid="activate-plan-fee-note">
            {state.saas_billing.enabled
              ? `${state.saas_billing.trial_days}-day free trial before plan billing starts.`
              : 'Free while plan fees are off — no plan charge and no trial clock started.'}
          </p>
        </DsCard>
      </div>

      <DsCard title="Request access" icon="send">
        <form action={handleSubmit} className="flex flex-col gap-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="ds-lbl" htmlFor="ds-req-platform">
                Store platform
              </label>
              <select
                id="ds-req-platform"
                name="store_platform"
                defaultValue={latest?.store_platform ?? 'shopify'}
                disabled={!isVerified || pending}
                className="ds-inp w-full"
              >
                <option value="shopify">Shopify</option>
                <option value="woocommerce">WooCommerce (later)</option>
                <option value="wix">Wix (later)</option>
              </select>
            </div>

            <div>
              <label className="ds-lbl" htmlFor="ds-req-store-address">
                Store address
              </label>
              <input
                id="ds-req-store-address"
                name="store_address"
                defaultValue={latest?.store_address ?? ''}
                placeholder="your-store.myshopify.com"
                disabled={!isVerified || pending}
                className="ds-inp w-full"
              />
            </div>

            <div>
              <label className="ds-lbl" htmlFor="ds-req-orders">
                Orders you expect per month
              </label>
              <select
                id="ds-req-orders"
                name="expected_orders_band"
                defaultValue={latest?.expected_orders_band ?? 'Under 100'}
                disabled={!isVerified || pending}
                className="ds-inp w-full"
              >
                <option value="Under 100">Under 100</option>
                <option value="100 to 500">100 to 500</option>
                <option value="500 to 2,000">500 to 2,000</option>
                <option value="More than 2,000">More than 2,000</option>
              </select>
            </div>
          </div>

          <fieldset className="border-0 m-0 p-0">
            <legend className="ds-lbl">Where your buyers are</legend>
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
                    disabled={!isVerified || pending}
                    className="w-4 h-4 accent-[#1A174A]"
                  />
                  <span>{COUNTRY_NAMES[code] ?? code}</span>
                </label>
              ))}
            </div>
            <p className="ds-mut mt-1 mb-0 text-[12px]">
              You can change these later. Only countries Octopus ships to are listed.
            </p>
          </fieldset>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <DsButton
              type="submit"
              variant="primary"
              icon="send"
              disabled={!isVerified || pending || selectedCountries.length === 0}
              disabledReason={!isVerified ? 'Verify your company first' : undefined}
              data-testid="send-access-request-btn"
            >
              {pending ? 'Sending…' : latest?.status === 'pending' ? 'Update request' : 'Send request'}
            </DsButton>
            <DsLinkButton
              href="/account/support?topic=dropship"
              variant="secondary"
              icon="help"
            >
              Talk to my account manager
            </DsLinkButton>
          </div>
        </form>
      </DsCard>

      <div
        role="status"
        className="flex flex-wrap items-center justify-between gap-3.5 bg-[#F2F7FE] border border-[#C7DAF5] rounded-[12px] px-4 py-3.5"
      >
        <div className="min-w-0 flex-1">
          <strong className="text-[14px] text-[#1A174A] inline-flex items-center gap-1.5">
            <DsIcon name="info" size={16} />
            After you send it
          </strong>
          <p className="m-0 mt-1 text-[13px] leading-[1.5] text-[#1A174A]">
            Your account manager reviews your request and switches dropshipping on. You&apos;ll get
            an in-app notification in your account; nothing is charged while plan fees are off.
          </p>
        </div>
      </div>
    </div>
  );
}
