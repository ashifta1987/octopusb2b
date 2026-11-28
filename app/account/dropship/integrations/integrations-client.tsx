'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { DsBadge, DsButton, DsCard, DsLinkButton, DsNotice, DsPageHeader, DsTableCard } from '@/components/dropship-ui';
import { CAPABILITIES, CHANNELS, CONNECT_BLOCKED_REASON, CHANNEL_KEYS } from '@/lib/dropship-ds14-shared';
import { platformName } from '@/lib/connectors/platforms';
import type { ChannelsPage } from '@/lib/dropship-ds14';
import { channelWaitlistAction } from '../ds14-actions';
import { StoreLinkCard } from './store-link-card';
import { YourStoresCard } from './your-stores-card';
import type { C1Result } from './c1-actions';
import { ConnectStoreForm } from './connect-store-form';
import { ConnectKeyForm } from './connect-key-form';

const EXTRA_CARDS: { key: 'magento' | 'prestashop' | 'opencart'; name: string; letter: string; how: string; notes: string[]; mode: 'key' | 'csv' }[] = [
  {
    key: 'magento',
    name: 'Magento (Adobe Commerce)',
    letter: 'M',
    how: 'Store address and integration access token',
    notes: ['Orders pulled every hour', 'Tracking sent to your store', 'Product push later (use file export)'],
    mode: 'key',
  },
  {
    key: 'prestashop',
    name: 'PrestaShop',
    letter: 'P',
    how: 'Shop address and Webservice key',
    notes: ['Orders pulled every hour', 'Tracking sent to your store', 'Product push later (use file export)'],
    mode: 'key',
  },
  {
    key: 'opencart',
    name: 'OpenCart',
    letter: 'O',
    how: 'CSV file import and export',
    notes: ['Built-in API cannot list orders', 'Import orders with a CSV file', 'Download product and tracking CSVs'],
    mode: 'csv',
  },
];

export function IntegrationsClient({ data, ready = [], connectReturn = null }: { data: ChannelsPage; ready?: string[]; connectReturn?: { platform: string; approved: boolean } | null }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // CONN S1: held above the stores list, so a disconnect or connect result stays visible after the refreshed list
  const [storeMsg, setStoreMsg] = useState<C1Result | null>(null);
  // CONN S2 / S3: which channel card has its connect form open
  const [connecting, setConnecting] = useState<string | null>(null);
  const toggle = (key: string, join: boolean) => start(async () => {
    const r = await channelWaitlistAction(key, join);
    setMsg(r.ok ? (join ? 'You are on the waiting list.' : 'You left the waiting list.') : r.message);
    if (r.ok) router.refresh();
  });
  const shopifyOn = data.shopify.status === 'active';
  const readyLabel = ready.map((k) => platformName(k)).join(', ');

  return (
    <div className="flex flex-col gap-5" data-testid="integrations-page">
      <DsPageHeader title="Integrations" subtitle="Connect the places you sell. Products go out and orders come back." icon="link" />
      {connectReturn && (connectReturn.approved
        ? <DsNotice tone="ok" title="WooCommerce approved the connection" testId="connect-return">We are checking your store and setting up order updates. This takes a few seconds; the status below changes to Connected. Refresh the page if it still says Connecting.</DsNotice>
        : <DsNotice tone="bad" title="Not connected" testId="connect-return">The access was not approved in WooCommerce, so nothing was connected. You can try again.</DsNotice>)}
      {ready.length === 0
        ? <DsNotice tone="info" title="Store connections open soon" testId="integrations-notice">{CONNECT_BLOCKED_REASON} Nothing is connected or synced yet. You can already set how each channel should behave, so it is ready the day it opens.</DsNotice>
        : <DsNotice tone="info" title="Connect your store" testId="integrations-notice">{readyLabel} connect now: orders come in automatically and tracking goes back to your store. Other platforms open one by one, and any store can use File import (CSV).</DsNotice>}
      {msg && <DsNotice tone="ok" title="Saved" testId="integrations-msg">{msg}</DsNotice>}
      {storeMsg && <DsNotice tone={storeMsg.ok ? 'ok' : 'bad'} title={storeMsg.ok ? 'Done' : 'Not done'} testId="stores-msg">{storeMsg.message}</DsNotice>}
      <YourStoresCard connections={data.connections ?? []} onResult={setStoreMsg} />
      <div className="grid lg:grid-cols-[2fr_1fr] gap-4 items-start">
        <StoreLinkCard waitlist={data.waitlist} ready={ready} onConnected={setStoreMsg} />
        <DsCard title="File import (CSV)" subtitle="Works now, for any store." icon="file" testId="file-connector-card">
          <ul className="m-0 pl-4 text-[13px] text-muted">
            <li>Upload your orders as a CSV file</li>
            <li>Download a product file for your store</li>
            <li>Download tracking numbers for your store</li>
          </ul>
          <div className="mt-3"><DsLinkButton href="/account/dropship/integrations/file" variant="secondary" icon="upload">Open file import</DsLinkButton></div>
        </DsCard>
      </div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="channel-list">
        {CHANNELS.map((c) => {
          const live = (data.connections ?? []).find((x) => x.platform === c.key && x.status !== 'disconnected');
          const connected = (c.key === 'shopify' && shopifyOn) || live?.status === 'active';
          const canConnect = ready.includes(c.key);
          const waiting = data.waitlist.includes(c.key);
          return (
            <DsCard key={c.key} testId={`channel-${c.key}`}>
              <div className="flex items-start gap-3">
                <div aria-hidden className="w-10 h-10 rounded-[10px] bg-tint-2 text-coral-text font-bold flex items-center justify-center shrink-0">{c.letter}</div>
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 text-[17px] font-bold">{c.name}</h2>
                  <p className="m-0 text-[13px] text-muted">{c.how}</p>
                </div>
                <DsBadge tone={connected ? 'ok' : c.key === 'amazon' ? 'neutral' : 'info'}>{connected ? 'Connected' : c.key === 'amazon' ? 'Coming later' : 'Not connected yet'}</DsBadge>
              </div>
              {connected && (live?.shop ?? data.shopify.shop) && <p className="text-[13px] mt-2 mb-0">Store {live?.shop ?? data.shopify.shop}</p>}
              <ul className="m-0 mt-3 pl-4 text-[13px] text-muted">{c.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              <div className="mt-3 flex flex-wrap gap-2 items-center">
                {c.key === 'amazon' ? (
                  <DsButton variant="secondary" onClick={() => toggle('amazon', !waiting)} loading={pending} icon={waiting ? 'check' : 'bell'} testId="amazon-waitlist">{waiting ? 'On the waiting list. Leave' : 'Join the waiting list'}</DsButton>
                ) : (
                  <>
                    {canConnect
                      ? <DsButton icon="link" onClick={() => setConnecting(connecting === c.key ? null : c.key)} testId={`connect-${c.key}`}>{live ? 'Connect again' : 'Connect'}</DsButton>
                      : <DsButton disabled disabledReason={CONNECT_BLOCKED_REASON} icon="link" testId={`connect-${c.key}`}>{connected ? 'Manage' : 'Connect'}</DsButton>}
                    <DsLinkButton href={`/account/dropship/integrations/${c.key}`} variant="secondary" icon="gear">Channel settings</DsLinkButton>
                  </>
                )}
              </div>
              {canConnect && connecting === c.key && c.key === 'woocommerce' && (
                <div className="mt-3"><ConnectStoreForm platform="woocommerce" defaultUrl={live?.store_url ?? ''} testId="woo-connect" /></div>
              )}
            </DsCard>
          );
        })}
        {EXTRA_CARDS.map((c) => {
          const live = (data.connections ?? []).find((x) => x.platform === c.key && x.status !== 'disconnected');
          const connected = live?.status === 'active';
          const canConnect = c.mode === 'key' && ready.includes(c.key);
          return (
            <DsCard key={c.key} testId={`channel-${c.key}`}>
              <div className="flex items-start gap-3">
                <div aria-hidden className="w-10 h-10 rounded-[10px] bg-tint-2 text-coral-text font-bold flex items-center justify-center shrink-0">{c.letter}</div>
                <div className="min-w-0 flex-1">
                  <h2 className="m-0 text-[17px] font-bold">{c.name}</h2>
                  <p className="m-0 text-[13px] text-muted">{c.how}</p>
                </div>
                <DsBadge tone={c.mode === 'csv' || connected ? 'ok' : 'info'}>
                  {c.mode === 'csv' ? 'CSV file' : connected ? 'Connected' : 'Not connected yet'}
                </DsBadge>
              </div>
              {connected && live?.shop && <p className="text-[13px] mt-2 mb-0">Store {live.shop}</p>}
              <ul className="m-0 mt-3 pl-4 text-[13px] text-muted">{c.notes.map((n) => <li key={n}>{n}</li>)}</ul>
              <div className="mt-3 flex flex-wrap gap-2 items-center">
                {c.mode === 'csv' ? (
                  <DsLinkButton href="/account/dropship/integrations/file" variant="secondary" icon="upload" testId="opencart-file">Open file import</DsLinkButton>
                ) : canConnect ? (
                  <DsButton icon="link" onClick={() => setConnecting(connecting === c.key ? null : c.key)} testId={`connect-${c.key}`}>{live ? 'Connect again' : 'Connect'}</DsButton>
                ) : (
                  <DsButton disabled disabledReason={CONNECT_BLOCKED_REASON} icon="link" testId={`connect-${c.key}`}>{connected ? 'Manage' : 'Connect'}</DsButton>
                )}
              </div>
              {canConnect && connecting === c.key && (c.key === 'magento' || c.key === 'prestashop') && (
                <div className="mt-3">
                  <ConnectKeyForm
                    platform={c.key}
                    defaultUrl={live?.store_url ?? ''}
                    testId={`${c.key}-connect`}
                    onConnected={(r) => { setConnecting(null); setStoreMsg(r); }}
                  />
                </div>
              )}
            </DsCard>
          );
        })}
      </div>
      <DsTableCard title="What each channel can do" subtitle="Planned support. Each platform's API is confirmed before it is built, and support differs by platform and changes over time." headers={['Feature', ...CHANNELS.map((c) => c.name)]} minWidth={760}>
        {CAPABILITIES.map((row) => <tr key={row.feature}><td className="font-semibold">{row.feature}</td>{CHANNEL_KEYS.map((k) => <td key={k}>{row.values[k]}</td>)}</tr>)}
      </DsTableCard>
      <DsCard title="Your plan" icon="card" testId="integrations-plan">
        <dl className="grid sm:grid-cols-2 gap-3 m-0 text-[14px]">
          <div><dt className="text-[12px] text-muted">Connected stores</dt><dd className="m-0 font-semibold">{data.stores_used} of {data.stores_limit ?? (data.billing_enabled ? 'no limit' : 'no limit while plans are free')}</dd></div>
          <div><dt className="text-[12px] text-muted">Plan</dt><dd className="m-0 font-semibold">{data.plan_name ?? (data.billing_enabled ? 'No plan chosen' : 'Free for now')}</dd></div>
        </dl>
        <div className="mt-3"><DsLinkButton href="/account/dropship/billing" variant="secondary">Change plan</DsLinkButton></div>
      </DsCard>
    </div>
  );
}
