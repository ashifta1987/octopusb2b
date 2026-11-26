import { Suspense } from 'react';
import { DsLinkButton, DsNotice, DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getSupportPage, type SupportPageData } from '@/lib/dropship-problems';
import { createClient } from '@/lib/supabase/server';
import { SupportClient, type NotificationItem } from './support-client';

export const metadata = { title: 'Support · Octopus Dropship' };

/**
 * Release 4 · Step 10 — Support (screens/Support.html, mobile/M_Support.html). One shared support desk: the company's
 * tickets (any Octopus team) with what each is linked to (store order, RFQ, B2B order), a new ticket by category and order
 * number (linked to the store order), the thread (/account/dropship/support/[id]) and the latest notifications. Works while
 * Dropshipping is paused or closed and in early access (Support is always on); order links appear when Orders is on.
 */
async function Support() {
  const { session } = await requireDropshipV2Merchant('/account/dropship/support');
  let data: SupportPageData | null = null;
  let error: string | null = null;
  try {
    data = await getSupportPage();
  } catch (e) {
    error = rpcMessage(e);
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="dropship-support-page">
        <h1 className="m-0 text-[26px] font-bold text-ink">Support</h1>
        <DsNotice tone="bad" title="Support could not be loaded" testId="support-error"
          action={<DsLinkButton href="/account/dropship/support" variant="secondary" icon="refresh">Try again</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  const sb = await createClient();
  const { data: notes } = await sb.rpc('my_notifications').select('id, title, body, link, read_at, created_at').order('created_at', { ascending: false }).limit(5);
  return <SupportClient data={data} orgId={session.org!.id} notifications={(notes ?? []) as NotificationItem[]} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="ds-card" data-testid="support-loading"><DsSkeleton /></div>}>
      <Support />
    </Suspense>
  );
}
