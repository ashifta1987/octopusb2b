import { Suspense } from 'react';
import { DsLinkButton, DsNotice, DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Staff } from '@/lib/dropship-staff';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getPartnersPage, type PartnersPage } from '@/lib/dropship-ds14';
import { PartnersClient } from './partners-client';

export const metadata = { title: 'Sales partners · Back office' };

/** AdminPartners.html: invite partners, track the merchants they bring and the commission earned, set commission rules. No partner login or payouts (not designed). */
async function Guarded() {
  await requireDropshipV2Staff(false, '/office/dropship/partners');
  let data: PartnersPage | null = null;
  let error: string | null = null;
  try { data = await getPartnersPage(); } catch (e) { error = rpcMessage(e); }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="staff-partners-page">
        <DsPageHeader title="Sales partners" icon="users" />
        <DsNotice tone="bad" title="Sales partners could not be loaded" testId="partners-error" action={<DsLinkButton href="/office/dropship/partners" variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  return <PartnersClient data={data} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Guarded />
    </Suspense>
  );
}
