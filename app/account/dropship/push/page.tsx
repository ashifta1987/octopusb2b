import { Suspense } from 'react';
import { DsNotice, DsSkeleton, DsLinkButton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { getPushPage, rpcMessage, type PushPageData } from '@/lib/dropship-ds6';
import { PushClient } from './push-client';

export const metadata = { title: 'Push to store · Octopus Dropship' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Release 2 · Step 6 — Push to Shopify (screens/PushStore.html, mobile/M_PushStore.html, states/States-Import.html).
 * Durable queue: one job per product (ds_push_enqueue). The executor that calls Shopify runs only for an ACTIVE store
 * connection — until Step 5 ships there is none, so this page says "Connect a store first" and pushes nothing.
 */
async function Push({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  await requireDropshipV2Merchant('/account/dropship/push');
  const sp = await searchParams;
  const ids = (sp.ids ?? '').split(',').map((x) => x.trim()).filter((x) => UUID.test(x)).slice(0, 100);
  let data: PushPageData | null = null;
  let error: string | null = null;
  try {
    data = await getPushPage(ids);
  } catch (e) {
    error = rpcMessage(e);
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="ds6-push">
        <h1 className="m-0 text-[26px] font-bold text-ink">Push to Shopify</h1>
        <DsNotice tone="bad" title="This page could not be loaded" testId="push-error"
          action={<DsLinkButton href="/account/dropship/catalogue?list=1" variant="secondary">Back to import list</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  return <PushClient data={data} ids={ids} />;
}

export default function Page({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Push searchParams={searchParams} />
    </Suspense>
  );
}
