import { Suspense } from 'react';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { DsLinkButton, DsNotice, DsSkeleton } from '@/components/dropship-ui';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getHealthPage, type HealthPageData } from '@/lib/dropship-ds12';
import { HealthClient } from './health-client';
import { ConnectorHealthCard } from './connectors-card';

export const metadata = { title: 'System health · Back office' };

/**
 * Release 5 · Step 13 — Staff › System health (staff/StaffHealth.html). Data: ds_health_page() — events between divisions
 * (domain_events: pending / retry / dead) and the outbox, failed jobs with plain reasons (events, outbox, product pushes),
 * webhook failures, store token refresh failures (empty until the Shopify connection), sync errors (DS6 sync log, failed
 * product links) and scheduled jobs from pg_cron (last run, result). Shopify parts say honestly that no store is connected.
 */
async function Guarded() {
  await requireDropshipV2Staff(false, '/office/dropship/health');
  let data: HealthPageData | null = null;
  let error: string | null = null;
  try {
    data = await getHealthPage();
  } catch (e) {
    error = rpcMessage(e);
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="ds-health-page">
        <h1 className="m-0 text-[26px] font-bold text-ink">System health</h1>
        <DsNotice tone="bad" title="System health could not be loaded" testId="health-error"
          action={<DsLinkButton href="/office/dropship/health" variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <HealthClient data={data} />
      {/* C0: store connectors, requested platforms, tracking company names, carrier poll */}
      <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
        <ConnectorHealthCard />
      </Suspense>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Guarded />
    </Suspense>
  );
}
