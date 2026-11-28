'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsInput, DsLinkButton, DsSelect } from '@/components/dropship-ui';
import { CONNECT_BLOCKED_REASON } from '@/lib/dropship-ds14-shared';
import { CONNECTION_STATUS, PLATFORMS, platformName } from '@/lib/connectors/platforms';
import type { DetectResult } from '@/lib/connectors/types';
import type { StoreLinkState } from '@/lib/dropship-c0';
import { detectStoreLinkAction, requestPlatformAction } from './c0-actions';
import type { C1Result } from './c1-actions';
import { ConnectStoreForm } from './connect-store-form';
import { ConnectKeyForm } from './connect-key-form';

/**
 * C0 · "Connect your store": paste a link → found / not recognised / connected / could not connect. The check runs on the server
 * (DNS-resolved SSRF guard, short timeout). A link alone gives no access: Connect stays disabled unless the platform is ready.
 * S2: WooCommerce approval form. S3: Magento 2 and PrestaShop key-paste form. OpenCart points to File import (CSV).
 */
const CHANNEL_PAGES = new Set(['shopify', 'woocommerce', 'wix', 'tiktok_shop', 'ebay']);

export function StoreLinkCard({ waitlist, ready = [], onConnected }: { waitlist: string[]; ready?: string[]; onConnected?: (r: C1Result) => void }) {
  const [url, setUrl] = useState('');
  const [res, setRes] = useState<{ detect: DetectResult; state: StoreLinkState | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [choice, setChoice] = useState('');
  const [other, setOther] = useState('');
  const [requested, setRequested] = useState<string[]>(waitlist);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const check = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null); setRes(null); setMsg(null); setChoice('');
    start(async () => {
      const r = await detectStoreLinkAction(url);
      if (!r.ok) { setErr(r.message); return; }
      setRes(r.data);
    });
  };
  const request = (platform: string) => start(async () => {
    const r = await requestPlatformAction(platform, other);
    if (r.ok) { setRequested((x) => [...new Set([...x, platform])]); setMsg({ ok: true, text: `Thanks. We count your request for ${platform === 'other' ? other.trim() : platformName(platform)} and tell you when it opens.` }); }
    else setMsg({ ok: false, text: r.message });
  });

  const d = res?.detect;
  const conn = res?.state?.connection ?? null;
  const found = d && (d.outcome === 'found' || d.outcome === 'marketplace') ? d.platform : null;
  const status = conn ? CONNECTION_STATUS[conn.status] : null;
  const foundReady = Boolean(found && d?.outcome === 'found' && ready.includes(found));

  return (
    <DsCard title="Connect your store" subtitle="Paste your store link. We check which platform it runs on. A link alone gives Octopus no access." icon="store" testId="store-link-card">
      <form onSubmit={check} className="flex flex-col sm:flex-row gap-3 sm:items-end">
        <DsInput label="Store address" placeholder="mystore.com" value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoComplete="url"
          containerClassName="flex-1" maxLength={300} data-testid="store-link-input" error={err ?? undefined} />
        <DsButton type="submit" icon="search" loading={pending} disabled={pending || url.trim() === ''} disabledReason={url.trim() === '' ? 'Paste your store address first' : undefined} testId="store-link-check">Check link</DsButton>
      </form>

      {d && (
        <div className="mt-4 flex flex-col gap-3" data-testid="store-link-result" aria-live="polite">
          {conn ? (
            <div className="flex flex-wrap items-center gap-2" data-testid={`store-link-${conn.status === 'active' ? 'connected' : conn.status === 'needs_reconnect' ? 'failed' : 'connecting'}`}>
              <DsBadge tone={status?.tone ?? 'info'}>{status?.label ?? conn.status}</DsBadge>
              <span className="text-[14px]">{platformName(conn.platform)} · {d.host}</span>
              {conn.status === 'needs_reconnect' && <p className="m-0 w-full text-[13px] text-bad">{conn.last_error ?? 'The store refused our access. Reconnect it.'}</p>}
            </div>
          ) : res?.state?.linked_elsewhere ? (
            <p className="m-0 text-[14px]" data-testid="store-link-elsewhere">This store is already linked to another Octopus account. Ask that account&rsquo;s owner, or contact support.</p>
          ) : found ? (
            <div className="flex flex-col gap-2" data-testid="store-link-found">
              <div className="flex flex-wrap items-center gap-2">
                <DsBadge tone="ok">Found</DsBadge>
                <span className="text-[14px]">{d.outcome === 'marketplace' ? `${platformName(found)} marketplace` : `This is a ${platformName(found)} store`} · {d.host}</span>
              </div>
              {d.outcome === 'marketplace' && <p className="m-0 text-[13px] text-muted">Marketplaces connect through your seller account (no store link). We will ask you to sign in there when it opens.</p>}
              {found === 'woocommerce' && foundReady && d.outcome === 'found' && <ConnectStoreForm platform="woocommerce" defaultUrl={d.url} testId="store-link-woo" />}
              {(found === 'magento' || found === 'prestashop') && foundReady && d.outcome === 'found' && (
                <ConnectKeyForm platform={found} defaultUrl={d.url} testId={`store-link-${found}`} onConnected={(r) => { onConnected?.(r); setMsg({ ok: true, text: r.message }); }} />
              )}
              <div className="flex flex-wrap gap-2 items-center">
                {foundReady
                  ? null
                  : <DsButton disabled disabledReason={CONNECT_BLOCKED_REASON} icon="link" testId="store-link-connect">Connect {platformName(found)}</DsButton>}
                {CHANNEL_PAGES.has(found) && <DsLinkButton href={`/account/dropship/integrations/${found}`} variant="secondary" icon="gear">Channel settings</DsLinkButton>}
                {!foundReady && (requested.includes(found)
                  ? <DsBadge tone="info">You asked to be told</DsBadge>
                  : <DsButton variant="secondary" icon="bell" onClick={() => request(found)} loading={pending} testId="store-link-notify">Tell me when it opens</DsButton>)}
              </div>
            </div>
          ) : d.outcome === 'unknown' ? (
            <div className="flex flex-col gap-3" data-testid="store-link-unknown">
              <p className="m-0 text-[14px]">We could not tell which platform <strong>{d.host}</strong> runs on. Choose it below, ask us to add it, or import orders from a file.</p>
              <div className="grid sm:grid-cols-2 gap-3 items-end">
                <DsSelect label="Your platform" value={choice} onChange={(e) => { setChoice(e.target.value); setMsg(null); }} data-testid="store-link-platform">
                  <option value="">Choose…</option>
                  {PLATFORMS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
                </DsSelect>
                {choice === 'other' && <DsInput label="Platform name" value={other} onChange={(e) => setOther(e.target.value)} maxLength={60} data-testid="store-link-other" />}
              </div>
              {choice === 'opencart' && (
                <p className="m-0 text-[13px] text-muted" data-testid="store-link-opencart-csv">OpenCart&rsquo;s built-in API cannot list orders, so OpenCart stores use CSV file import and export.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <DsButton variant="secondary" icon="bell" onClick={() => request(choice)} loading={pending}
                  disabled={!choice || (choice === 'other' && other.trim().length < 2) || requested.includes(choice)}
                  disabledReason={!choice ? 'Choose your platform first' : requested.includes(choice) ? 'Already requested' : choice === 'other' && other.trim().length < 2 ? 'Type the platform name' : undefined}
                  testId="store-link-request">Request this platform</DsButton>
                <DsLinkButton href="/account/dropship/integrations/file" variant="secondary" icon="upload">Import orders from a file</DsLinkButton>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2" data-testid="store-link-unreachable">
              <div className="flex flex-wrap items-center gap-2"><DsBadge tone="bad">Could not connect</DsBadge><span className="text-[14px]">{d.host ?? url}</span></div>
              <p className="m-0 text-[13px]">{'reason' in d ? d.reason : ''}</p>
              <p className="m-0 text-[13px] text-muted">You can still <Link href="/account/dropship/integrations/file" className="underline">import orders from a file</Link>.</p>
            </div>
          )}
          {msg && <div role={msg.ok ? 'status' : 'alert'} className={`text-[13px] ${msg.ok ? 'text-ok' : 'text-bad'}`} data-testid="store-link-msg">{msg.text}</div>}
        </div>
      )}
    </DsCard>
  );
}
