'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DsBadge, DsButton, DsCard, DsLinkButton, DsNotice, DsPageHeader, DsTableCard } from '@/components/dropship-ui';
import { CAPABILITIES, CHANNELS, CONNECT_BLOCKED_REASON, CHANNEL_KEYS } from '@/lib/dropship-ds14-shared';
import type { ChannelsPage } from '@/lib/dropship-ds14';
import { channelWaitlistAction } from '../ds14-actions';

export function IntegrationsClient({ data }: { data: ChannelsPage }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toggle = (key: string, join: boolean) => start(async () => {
    const r = await channelWaitlistAction(key, join);
    setMsg(r.ok ? (join ? 'You are on the waiting list.' : 'You left the waiting list.') : r.message);
    if (r.ok) router.refresh();
  });
  const shopifyOn = data.shopify.status === 'active';
  return (
    <div className="flex flex-col gap-5" data-testid="integrations-page">
      <DsPageHeader title="Integrations" subtitle="Connect the places you sell. Products go out and orders come back." icon="link" />
      <DsNotice tone="info" title="Store connections open soon" testId="integrations-notice">{CONNECT_BLOCKED_REASON} Nothing is connected or synced yet. You can already set how each channel should behave, so it is ready the day it opens.</DsNotice>
      {msg && <DsNotice tone="ok" title="Saved" testId="integrations-msg">{msg}</DsNotice>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="channel-list">
        {CHANNELS.map((c) => {
          const connected = c.key === 'shopify' && shopifyOn;
          const waiting = data.waitlist.includes(c.key);
          return (
            <DsCard key={c.key} testId={`channel-${c.key}`}>
              <div className="flex items-start gap-3">
                <div aria-hidden className="w-10 h-10 rounded-[10px] bg-[#EAF1FB] text-[#1F5BB0] font-bold flex items-center justify-center shrink-0">{c.letter}</div>
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 text-[17px] font-bold">{c.name}</h2>
                  <p className="m-0 text-[13px] text-[#5B6478]">{c.how}</p>
                </div>
                <DsBadge tone={connected ? 'ok' : c.key === 'amazon' ? 'neutral' : 'info'}>{connected ? 'Connected' : c.key === 'amazon' ? 'Coming later' : 'Not connected yet'}</DsBadge>
              </div>
              {connected && data.shopify.shop && <p className="text-[13px] mt-2 mb-0">Store {data.shopify.shop}</p>}
              <ul className="m-0 mt-3 pl-4 text-[13px] text-[#5B6478]">{c.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              <div className="mt-3 flex flex-wrap gap-2 items-center">
                {c.key === 'amazon' ? (
                  <DsButton variant="secondary" onClick={() => toggle('amazon', !waiting)} loading={pending} icon={waiting ? 'check' : 'bell'} testId="amazon-waitlist">{waiting ? 'On the waiting list. Leave' : 'Join the waiting list'}</DsButton>
                ) : (
                  <>
                    <DsButton disabled disabledReason={CONNECT_BLOCKED_REASON} icon="link" testId={`connect-${c.key}`}>{connected ? 'Manage' : 'Connect'}</DsButton>
                    <DsLinkButton href={`/account/dropship/integrations/${c.key}`} variant="secondary" icon="gear">Channel settings</DsLinkButton>
                  </>
                )}
              </div>
            </DsCard>
          );
        })}
      </div>
      <DsTableCard title="What each channel can do" subtitle="Planned support. Each platform's API is confirmed before it is built, and support differs by platform and changes over time." headers={['Feature', ...CHANNELS.map((c) => c.name)]} minWidth={760}>
        {CAPABILITIES.map((row) => <tr key={row.feature}><td className="font-semibold">{row.feature}</td>{CHANNEL_KEYS.map((k) => <td key={k}>{row.values[k]}</td>)}</tr>)}
      </DsTableCard>
      <DsCard title="Your plan" icon="card" testId="integrations-plan">
        <dl className="grid sm:grid-cols-2 gap-3 m-0 text-[14px]">
          <div><dt className="text-[12px] text-[#5B6478]">Connected stores</dt><dd className="m-0 font-semibold">{data.stores_used} of {data.stores_limit ?? (data.billing_enabled ? 'no limit' : 'no limit while plans are free')}</dd></div>
          <div><dt className="text-[12px] text-[#5B6478]">Plan</dt><dd className="m-0 font-semibold">{data.plan_name ?? (data.billing_enabled ? 'No plan chosen' : 'Free for now')}</dd></div>
        </dl>
        <div className="mt-3"><DsLinkButton href="/account/dropship/billing" variant="secondary">Change plan</DsLinkButton></div>
      </DsCard>
    </div>
  );
}
