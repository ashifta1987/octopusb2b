import { Suspense } from 'react';
import { ServiceStart } from '@/components/account/service-start';
import {
  DsCard,
  DsLinkButton,
  DsNotice,
  DsPageHeader,
} from '@/components/dropship-ui';
import { requireCustomer } from '@/lib/auth';
import {
  dropshipEverEnabled,
  dropshipOn,
  dropshipPausedOrClosed,
  getAccountContext,
} from '@/lib/core/account';
import { getMyDropshipAccessState, isDropshipV2UiEnabled } from '@/lib/dropship';
import { ActivateClient } from './activate-client';

export const metadata = { title: 'Dropshipping' };

async function DropshipHome() {
  const s = await requireCustomer('/account/dropship');
  if (!s.org) {
    return <ServiceStart service="dropship" />;
  }

  const [ctx, v2On] = await Promise.all([
    getAccountContext(s.org.id),
    isDropshipV2UiEnabled(),
  ]);

  // Live safety: while dropship_v2_ui is OFF, customers see the existing "Coming soon" / ServiceStart view.
  if (!v2On) {
    return <ServiceStart service="dropship" />;
  }

  const dsState = ctx.services.dropship;

  // Never-enabled org with dropship_v2_ui ON -> Activate ("Start dropshipping")
  if (!dropshipEverEnabled(dsState)) {
    const accessState = await getMyDropshipAccessState();
    if (!accessState) {
      return <ServiceStart service="dropship" />;
    }
    return <ActivateClient state={accessState} />;
  }

  const isActive = dropshipOn(dsState);
  const isPausedOrClosed = dropshipPausedOrClosed(dsState);

  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader
        title="Dashboard"
        subtitle="Your store, orders and sync at a glance. Last 30 days, all stores."
        icon="grid"
        actions={
          <>
            {isActive && (
              <DsLinkButton href="/account/dropship/catalogue" variant="secondary" icon="search">
                Find products
              </DsLinkButton>
            )}
            <DsLinkButton href="/account/dropship/wallet" variant="primary" icon="wallet">
              {isActive ? 'Add funds' : 'Open wallet'}
            </DsLinkButton>
          </>
        }
      />

      {isPausedOrClosed && (
        <DsNotice
          tone="warn"
          title={
            dsState.status === 'paused'
              ? 'Dropshipping is paused'
              : 'Dropshipping account closed'
          }
          testId="dropship-paused-banner"
          action={
            dsState.status_reason === 'KYC no longer verified' ? (
              <DsLinkButton href="/account/kyc" variant="primary" icon="shield">
                Verify your company
              </DsLinkButton>
            ) : (
              <DsLinkButton href="/account/dropship/support" variant="secondary" icon="help">
                Contact support
              </DsLinkButton>
            )
          }
        >
          {dsState.status_reason ? <strong>{dsState.status_reason}. </strong> : null}
          New imports, store pushes, samples, product requests and new store order charges are
          blocked while {dsState.status === 'paused' ? 'paused' : 'closed'}. Paid orders in progress
          keep shipping, and your wallet, withdrawals, statements, invoices, support and data export
          remain available.
        </DsNotice>
      )}

      {isActive && (
        <DsNotice
          tone="info"
          title="Finish setting up Octopus Dropship"
          testId="dashboard-onboarding-banner"
          action={
            <DsLinkButton href="/account/dropship/onboarding" variant="primary" icon="check">
              Open onboarding
            </DsLinkButton>
          }
        >
          Confirm your selling countries, submit your brand &amp; return address for shipping-label
          approval, and check your wallet balance.
        </DsNotice>
      )}

      {isPausedOrClosed ? (
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          data-testid="paused-merchant-links"
        >
          <DsCard title="Orders in progress" icon="cart">
            <p className="ds-mut text-[13px] m-0 mb-3">
              Paid orders already in progress continue through packing, shipping and delivery.
            </p>
            <DsLinkButton href="/account/dropship/orders" variant="secondary" icon="cart">
              View orders
            </DsLinkButton>
          </DsCard>
          <DsCard title="Wallet & withdrawals" icon="wallet">
            <p className="ds-mut text-[13px] m-0 mb-3">
              View your USD wallet balance, ledger movements and withdrawal requests.
            </p>
            <DsLinkButton href="/account/dropship/wallet" variant="secondary" icon="wallet">
              Wallet &amp; withdrawals
            </DsLinkButton>
          </DsCard>
          <DsCard title="Statements, support & data" icon="file">
            <p className="ds-mut text-[13px] m-0 mb-3">
              Download STMT-DS statements and invoices, contact support, or export your data.
            </p>
            <div className="flex flex-wrap gap-2">
              <DsLinkButton href="/account/invoices" variant="secondary" icon="file">
                Statements &amp; invoices
              </DsLinkButton>
              <DsLinkButton href="/account/dropship/support" variant="secondary" icon="help">
                Support
              </DsLinkButton>
              <DsLinkButton href="/account/dropship/export" variant="secondary" icon="download">
                Data export
              </DsLinkButton>
            </div>
          </DsCard>
        </div>
      ) : (
        // Batch 3 (F-15): an active merchant gets real next steps, not the old "being set up" card
        <DsCard title="Next steps" icon="check" testId="dropship-active-start">
          <p className="ds-mut text-[13px] m-0 mb-3">
            Find products and order samples now. Connecting your Shopify store arrives with the Octopus Dropship
            Shopify app (Step 5).
          </p>
          <div className="flex flex-wrap gap-2">
            <DsLinkButton href="/account/dropship/catalogue" variant="primary" icon="search">
              Find products
            </DsLinkButton>
            <DsLinkButton href="/account/dropship/sample" variant="secondary" icon="package">
              Order a sample
            </DsLinkButton>
            <DsLinkButton href="/account/dropship/requests" variant="secondary" icon="file">
              Request a product
            </DsLinkButton>
          </div>
        </DsCard>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="card p-6">Loading…</div>}>
      <DropshipHome />
    </Suspense>
  );
}
