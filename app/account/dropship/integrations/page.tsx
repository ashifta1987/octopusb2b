import { Suspense } from 'react';
import { DsLinkButton, DsNotice, DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getChannelsPage, type ChannelsPage } from '@/lib/dropship-ds14';
import { IntegrationsClient } from './integrations-client';

export const metadata = { title: 'Integrations · Octopus Dropship' };

/** Integrations.html: the places you sell. Channel settings are saved; connecting opens in the store-connection release (no fake connections). */
async function Guarded() {
  await requireDropshipV2Merchant('/account/dropship/integrations');
  let data: ChannelsPage | null = null;
  let error: string | null = null;
  try { data = await getChannelsPage(); } catch (e) { error = rpcMessage(e); }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="integrations-page">
        <DsPageHeader title="Integrations" icon="link" />
        <DsNotice tone="bad" title="Integrations could not be loaded" testId="integrations-error" action={<DsLinkButton href="/account/dropship/integrations" variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  return <IntegrationsClient data={data} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Guarded />
    </Suspense>
  );
}
