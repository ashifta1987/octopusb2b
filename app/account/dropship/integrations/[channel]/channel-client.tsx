'use client';

import { useState, useTransition } from 'react';
import { DsBadge, DsButton, DsCard, DsLinkButton, DsNotice, DsPageHeader, DsStepper, DsSwitch } from '@/components/dropship-ui';
import { CONNECT_BLOCKED_REASON, DEFAULT_CHANNEL_SETTINGS, SETTING_LABELS, type ChannelInfo, type ChannelSettings } from '@/lib/dropship-ds14-shared';
import type { ChannelsPage } from '@/lib/dropship-ds14';
import { saveChannelSettingsAction } from '../../ds14-actions';

export function ChannelClient({ info, data }: { info: ChannelInfo; data: ChannelsPage }) {
  const saved = (data.settings[info.key] as ChannelSettings | undefined) ?? DEFAULT_CHANNEL_SETTINGS;
  const [s, setS] = useState<ChannelSettings>(saved);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const connected = info.key === 'shopify' && data.shopify.status === 'active';
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const save = () => start(async () => {
    const r = await saveChannelSettingsAction(info.key, s);
    setMsg(r.ok ? { ok: true, text: 'Channel settings saved.' } : { ok: false, text: r.message });
  });
  return (
    <div className="flex flex-col gap-5" data-testid="connect-channel-page">
      <DsPageHeader title={`Connect ${info.name}`} subtitle={info.how} icon="link" actions={<DsLinkButton href="/account/dropship/integrations" variant="secondary" icon="arrow">Back to integrations</DsLinkButton>} />
      <DsNotice tone="info" title="Connections are not open yet" testId="channel-blocked">{CONNECT_BLOCKED_REASON} You are not asked to sign in anywhere and nothing is connected. The steps below show what will happen.</DsNotice>
      <DsCard title="Steps" icon="list">
        <DsStepper ariaLabel={`${info.name} connection steps`} steps={info.steps.map((label) => ({ label, state: 'upcoming' as const }))} />
        <div className="mt-4"><DsButton disabled disabledReason={CONNECT_BLOCKED_REASON} icon="arrow" testId="channel-continue">Continue to {info.name}</DsButton></div>
        <p className="text-[12px] text-[#5B6478] mt-3 mb-0">You will be sent to your own {info.name} account to approve access. Octopus never sees your password.</p>
      </DsCard>
      <DsCard title="Channel settings" subtitle="Saved now, used when the channel is connected." icon="gear" testId="channel-settings">
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 m-0 mb-3 text-[14px]">
          <div><dt className="text-[12px] text-[#5B6478]">Status</dt><dd className="m-0"><DsBadge tone={connected ? 'ok' : 'info'}>{connected ? 'Connected' : 'Not connected yet'}</DsBadge></dd></div>
          <div><dt className="text-[12px] text-[#5B6478]">Last sync</dt><dd className="m-0">{connected ? 'Not reported yet' : 'Nothing synced yet'}</dd></div>
        </dl>
        <div className="flex flex-col divide-y divide-[#EEF0F4]">
          {SETTING_LABELS.map((x) => <DsSwitch key={x.key} label={x.label} hint={x.hint} checked={s[x.key]} onChange={(v) => { setS({ ...s, [x.key]: v }); setMsg(null); }} testId={`setting-${x.key}`} />)}
        </div>
        <div className="mt-3 flex flex-wrap gap-2 items-center">
          <DsButton onClick={save} loading={pending} disabled={!dirty} disabledReason={!dirty ? 'No changes to save' : undefined} testId="channel-save">Save settings</DsButton>
        </div>
        {msg && <div role={msg.ok ? 'status' : 'alert'} className={`text-[13px] mt-2 ${msg.ok ? 'text-[#0B6A65]' : 'text-[#B42318]'}`} data-testid="channel-msg">{msg.text}</div>}
      </DsCard>
      <DsCard title="Connection" icon="refresh">
        <div className="flex flex-wrap gap-2">
          <DsButton variant="secondary" disabled disabledReason={CONNECT_BLOCKED_REASON} testId="channel-test">Test connection</DsButton>
          <DsButton variant="secondary" disabled disabledReason={CONNECT_BLOCKED_REASON} testId="channel-reconnect">Reconnect</DsButton>
          <DsButton variant="danger" disabled disabledReason={CONNECT_BLOCKED_REASON} testId="channel-disconnect">Disconnect</DsButton>
        </div>
        <p className="text-[12px] text-[#5B6478] mt-3 mb-0">Disconnecting stops syncing. Products already in your store stay there.</p>
      </DsCard>
    </div>
  );
}
