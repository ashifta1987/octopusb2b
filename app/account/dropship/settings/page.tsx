import { Suspense } from 'react';
import { DsCard, DsLinkButton, DsPageHeader } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Settings · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/settings');
  return (
    <div className="flex flex-col gap-5" data-testid="dropship-settings-page">
      <DsPageHeader
        title="Settings"
        subtitle="Selling countries, brand & return profile, statements and account data export."
        icon="gear"
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DsCard title="Onboarding & return profile" icon="package">
          <p className="ds-mut text-[13px] m-0 mb-3">
            Update your selling countries, brand name and return address.
          </p>
          <DsLinkButton href="/account/dropship/onboarding" variant="secondary" icon="pencil">
            Open setup
          </DsLinkButton>
        </DsCard>
        <DsCard title="Statements & invoices" icon="file">
          <p className="ds-mut text-[13px] m-0 mb-3">
            Download weekly STMT-DS statements, OCT-DS shipment invoices and receipts.
          </p>
          <DsLinkButton href="/account/invoices" variant="secondary" icon="file">
            View statements &amp; invoices
          </DsLinkButton>
        </DsCard>
        <DsCard title="Privacy & data export" icon="download">
          <p className="ds-mut text-[13px] m-0 mb-3">
            Export a full copy of your company account and order data at any time.
          </p>
          <DsLinkButton
            href="/account/dropship/export"
            variant="secondary"
            icon="download"
            testId="dropship-data-export-link"
          >
            Export my data
          </DsLinkButton>
        </DsCard>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card">Loading…</div>}>
      <Guarded />
    </Suspense>
  );
}
