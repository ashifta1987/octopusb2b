import { Suspense } from 'react';
import { DsPageHeader, DsNotice, DsLinkButton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';

export const metadata = { title: 'Reports · Octopus Dropship' };

async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/reports');
  return (
    <div className="flex flex-col gap-5">
      <DsPageHeader
        title="Reports"
        subtitle="Store sales, Octopus landed costs, profit before ads and weekly statements."
        icon="chart"
      />
      <DsNotice
        tone="info"
        title="Coming soon"
        testId="planned-notice"
        action={
          <DsLinkButton href="/account/invoices" variant="secondary">
            Statements &amp; invoices
          </DsLinkButton>
        }
      >
        Sales and profit reports are coming soon. Your weekly statements and invoices are already available.
      </DsNotice>
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
