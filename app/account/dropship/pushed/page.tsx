import { Suspense } from 'react';
import { DsNotice, DsSkeleton, DsLinkButton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { getPushedList, rpcMessage, type PushedData } from '@/lib/dropship-ds6';
import { PushedClient } from './pushed-client';

export const metadata = { title: 'Pushed products · Octopus Dropship' };

/**
 * Release 2 · Step 6 — Pushed products (screens/Pushed.html, mobile/M_Pushed.html). Data: ds_pushed_list().
 * Empty until a store is connected (Step 5). Re-push and unlink go through the push queue; unlink sets stock to 0 at the
 * Octopus location first. Automatic sync (Step 11) is not running yet.
 */
async function Pushed({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  await requireDropshipV2Merchant('/account/dropship/pushed');
  const sp = await searchParams;
  let data: PushedData | null = null;
  let error: string | null = null;
  try {
    data = await getPushedList();
  } catch (e) {
    error = rpcMessage(e);
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="ds6-pushed">
        <h1 className="m-0 text-[26px] font-bold text-[#1A174A]">Pushed products</h1>
        <DsNotice tone="bad" title="Pushed products could not be loaded" testId="pushed-error"
          action={<DsLinkButton href="/account/dropship/pushed" variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  return <PushedClient data={data} showFailed={sp.f === 'failed'} />;
}

export default function Page({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Pushed searchParams={searchParams} />
    </Suspense>
  );
}
