import { Suspense } from 'react';
import { DsLinkButton, DsNotice, DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getBillingPage, type BillingPageData } from '@/lib/dropship-ds12';
import { BillingClient } from './billing-client';

export const metadata = { title: 'Plan and billing · Octopus Dropship' };

/**
 * Release 5 · Steps 12 / 12b — Plan and billing (screens/Billing.html, mobile/M_Billing.html, states/States-Money.html).
 * Data: ds_billing_page() — plan-fee switch state (saas_billing_settings), the organisation's plan period, offered plans
 * (prices and limits from the owner; none while unset), usage, and every Octopus invoice / statement / credit note.
 * While plan fees are off: "Plans are free for now" and no billing call. Shopify stores: billed through Shopify (stub).
 */
async function Billing() {
  await requireDropshipV2Merchant('/account/dropship/billing');
  let data: BillingPageData | null = null;
  let error: string | null = null;
  try {
    data = await getBillingPage();
  } catch (e) {
    error = rpcMessage(e);
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="ds-billing-page">
        <h1 className="m-0 text-[26px] font-bold text-ink">Plan and billing</h1>
        <DsNotice tone="bad" title="Plan and billing could not be loaded" testId="billing-error"
          action={<DsLinkButton href="/account/dropship/billing" variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  return <BillingClient data={data} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card" data-testid="billing-loading"><DsSkeleton immediate /></div>}>
      <Billing />
    </Suspense>
  );
}
