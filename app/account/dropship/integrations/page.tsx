import { Suspense } from 'react';
import { DsLinkButton, DsNotice, DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getChannelsPage, type ChannelsPage } from '@/lib/dropship-ds14';
import { getConnector } from '@/lib/connectors/registry';
import { IntegrationsClient } from './integrations-client';

export const metadata = { title: 'Integrations · Octopus Dropship' };

/** Integrations.html: the places you sell. Channel settings are saved; switched-on platforms connect live (never fake). */
type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

async function Guarded({ searchParams }: { searchParams: Search }) {
  await requireDropshipV2Merchant('/account/dropship/integrations');
  // CONN S2 / S3: platforms whose connection flow is switched on here (names only; never a key), and WooCommerce's return flag
  const ready = (['woocommerce', 'magento', 'prestashop'] as const).filter((k) => getConnector(k).status() === 'ready');
  const sp = await searchParams;
  const back = one(sp.connect) === 'woocommerce' ? { platform: 'woocommerce', approved: one(sp.success) === '1' } : null;
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
  return <IntegrationsClient data={data} ready={ready} connectReturn={back} />;
}

export default function Page({ searchParams }: { searchParams: Search }) {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Guarded searchParams={searchParams} />
    </Suspense>
  );
}
