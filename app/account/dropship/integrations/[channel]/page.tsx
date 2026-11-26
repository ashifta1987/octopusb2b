import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import { DsLinkButton, DsNotice, DsPageHeader, DsSkeleton } from '@/components/dropship-ui';
import { requireDropshipV2Merchant } from '@/lib/dropship';
import { rpcMessage } from '@/lib/dropship-ds6';
import { getChannelsPage, type ChannelsPage } from '@/lib/dropship-ds14';
import { CHANNELS, isChannel } from '@/lib/dropship-ds14-shared';
import { ChannelClient } from './channel-client';

export const metadata = { title: 'Connect a channel · Octopus Dropship' };

/** ConnectChannel.html: the connection steps of one channel (shown, not runnable yet) and its channel settings (saved). */
async function Guarded({ params }: { params: Promise<{ channel: string }> }) {
  const { channel } = await params;
  if (!isChannel(channel) || channel === 'amazon') notFound();
  await requireDropshipV2Merchant('/account/dropship/integrations');
  let data: ChannelsPage | null = null;
  let error: string | null = null;
  try { data = await getChannelsPage(); } catch (e) { error = rpcMessage(e); }
  const info = CHANNELS.find((c) => c.key === channel)!;
  if (!data) {
    return (
      <div className="flex flex-col gap-5" data-testid="connect-channel-page">
        <DsPageHeader title={`Connect ${info.name}`} icon="link" />
        <DsNotice tone="bad" title="This channel could not be loaded" testId="channel-error" action={<DsLinkButton href="/account/dropship/integrations" variant="secondary" icon="arrow">Back to integrations</DsLinkButton>}>{error}</DsNotice>
      </div>
    );
  }
  return <ChannelClient info={info} data={data} />;
}

export default function Page(props: { params: Promise<{ channel: string }> }) {
  return (
    <Suspense fallback={<div className="ds-card"><DsSkeleton immediate /></div>}>
      <Guarded {...props} />
    </Suspense>
  );
}
