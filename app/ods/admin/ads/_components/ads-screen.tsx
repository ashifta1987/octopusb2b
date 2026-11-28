'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, DataTable, EmptyState, KpiStrip, Modal, StatusPill, Switch, cx } from '@octopus/ui';
import { goStepUp } from '@/components/admin/client';
import { setSetting } from '@/app/admin/actions';
import { moderateCampaign, savePlacement } from '@/app/admin/ads/actions';
import { Note, OdsForm, ResultLine, RunAction, WebsiteHead, fieldCls, type R } from '../../_website/ods-form';
import { CAMPAIGN_LABEL, campaignActions, campaignTone } from '../../_website/website-core';
import type { AdsCampaign, AdsData } from '../_lib/data';

/** TODAY's actions: setSetting('ads_enabled') (Admin only, set_setting RPC), savePlacement, moderateCampaign (transition_campaign). */
export const ADS_ACTIONS = { setSetting, savePlacement, moderateCampaign };
export type AdsActions = typeof ADS_ACTIONS;

export type AdsScreenProps = { data: AdsData | null; perms: { isAdmin: boolean; edit: boolean }; actions?: AdsActions; loading?: boolean };

function AdsToggle({ on, isAdmin, actions }: { on: boolean; isAdmin: boolean; actions: AdsActions }) {
  const router = useRouter();
  const [value, setValue] = useState(on);
  const [ask, setAsk] = useState<boolean | null>(null);
  const [state, setState] = useState<R | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <Switch label="Advertising" checked={value} onCheckedChange={(v) => setAsk(v)} disabled={!isAdmin} disabledReason={!isAdmin ? 'Admin only' : undefined} loading={pending} data-testid="ads-switch" />
      <ResultLine state={state} />
      <Modal
        open={ask !== null}
        onClose={() => setAsk(null)}
        title={ask ? 'Turn ON advertising?' : 'Turn OFF advertising?'}
        description={ask ? 'Ads are shown and valid clicks are charged to advertisers’ wallets.' : 'No ads are shown and no clicks are charged.'}
        destructive={ask === false}
        confirmLabel={ask ? 'Turn on' : 'Turn off'}
        onConfirm={() => {
          const v = !!ask;
          setAsk(null);
          start(async () => {
            const r = await actions.setSetting('ads_enabled', v);
            if (goStepUp(r)) return;
            setState(r);
            if (r.ok) {
              setValue(v);
              router.refresh();
            }
          });
        }}
      />
    </span>
  );
}

/** ODS T9 · Website › Advertising (today's figures, slots, campaigns and moderation). */
export function AdsScreen({ data, perms, actions = ADS_ACTIONS, loading }: AdsScreenProps) {
  const { isAdmin, edit } = perms;
  const k = data?.kpis;
  const campaignCols = [
    {
      id: 'campaign',
      header: 'Campaign',
      primary: true,
      cell: (c: AdsCampaign) => (
        // spans: DataTable puts the primary cell inside a <p> on phones
        <span className="block min-w-[180px]">
          <span className="block font-semibold text-ods-navy">{c.name}</span>
          {c.headline ? <span className="block text-ods-small font-normal text-ods-slate">{c.headline}</span> : null}
          {c.rejection ? <span className="block text-ods-small font-normal text-ods-danger">Rejected: {c.rejection}</span> : null}
        </span>
      ),
    },
    { id: 'advertiser', header: 'Advertiser', cell: (c: AdsCampaign) => c.advertiser },
    { id: 'slot', header: 'Slot', cell: (c: AdsCampaign) => c.slot, hideOnPhone: true },
    { id: 'bid', header: 'Bid', numeric: true, cell: (c: AdsCampaign) => c.bid },
    { id: 'budget', header: 'Daily budget', numeric: true, cell: (c: AdsCampaign) => (<span>{c.budget}<span className="block text-ods-small text-ods-slate">{c.today}</span></span>), hideOnPhone: true },
    { id: 'clicks', header: 'Clicks (30d)', numeric: true, cell: (c: AdsCampaign) => c.clicks.toLocaleString('en-US') },
    { id: 'spent', header: 'Spent (30d)', numeric: true, cell: (c: AdsCampaign) => <b className="font-semibold">{c.spent}</b> },
    { id: 'status', header: 'Status', cell: (c: AdsCampaign) => <StatusPill tone={campaignTone(c.status)}>{CAMPAIGN_LABEL[c.status] ?? c.statusLabel}</StatusPill> },
    ...(edit
      ? [
          {
            id: 'actions',
            header: 'Actions',
            cell: (c: AdsCampaign) => (
              <span className="flex flex-wrap gap-2">
                {campaignActions(c.status).map((a) =>
                  a === 'approve' ? (
                    <RunAction key={a} variant="primary" action={() => actions.moderateCampaign(c.id, 'active')} confirm={{ title: `Approve “${c.name}”?`, body: 'It goes live now.', confirmLabel: 'Approve' }}>
                      Approve
                    </RunAction>
                  ) : a === 'reject' ? (
                    <RunAction key={a} action={(reason) => actions.moderateCampaign(c.id, 'rejected', reason)} prompt={{ title: `Reject “${c.name}”`, label: 'Reason for rejection (shown to the advertiser)', confirmLabel: 'Reject', required: true }}>
                      Reject
                    </RunAction>
                  ) : a === 'pause' ? (
                    <RunAction key={a} action={() => actions.moderateCampaign(c.id, 'paused')} confirm={{ title: `Pause “${c.name}”?`, confirmLabel: 'Pause' }}>
                      Pause
                    </RunAction>
                  ) : a === 'resume' ? (
                    <RunAction key={a} action={() => actions.moderateCampaign(c.id, 'active')} confirm={{ title: `Resume “${c.name}”?`, confirmLabel: 'Resume' }}>
                      Resume
                    </RunAction>
                  ) : (
                    <RunAction key={a} variant="danger" action={() => actions.moderateCampaign(c.id, 'ended')} confirm={{ title: `End “${c.name}”?`, body: 'This cannot be undone.', confirmLabel: 'End campaign', destructive: true }}>
                      End
                    </RunAction>
                  ),
                )}
              </span>
            ),
          },
        ]
      : []),
  ];
  return (
    <div data-testid="ads-page" className="flex min-w-0 flex-col gap-4">
      <WebsiteHead
        title="Advertising"
        subtitle="Pay-per-click ads on the storefront and customer portal. Advertisers pay from their wallet for each valid click; revenue goes to Finance as “Advertising (CPC)”."
        actions={data ? <AdsToggle on={data.adsOn} isAdmin={isAdmin} actions={actions} /> : undefined}
      />
      {data && !data.adsOn ? <Note tone="warning" testId="ads-off">Advertising is OFF — no ads are shown and no clicks are charged.</Note> : null}
      <KpiStrip
        data-testid="ads-kpis"
        label="Advertising figures"
        variant="strip"
        loading={loading || !k}
        items={
          k
            ? [
                { label: 'Ad revenue · this month', value: k.revenue, hint: k.revenueHint },
                { label: 'Paid clicks', value: k.paidClicks.toLocaleString('en-US'), hint: k.avgHint },
                { label: 'Impressions', value: k.impressions.toLocaleString('en-US'), hint: k.ctrHint },
                { label: 'Invalid clicks filtered', value: k.invalid.toLocaleString('en-US'), hint: 'not charged' },
                { label: 'Active campaigns', value: String(k.active), hint: k.waiting ? `${k.waiting} waiting for approval` : undefined },
              ]
            : []
        }
      />
      <Card headingLevel={2} title="Ad slots" description={data?.slotNote} loading={loading || !data} empty={data && !data.slots.length ? <EmptyState title="No ad slots" /> : undefined}>
        <ul className="m-0 list-none divide-y divide-ods-line p-0" data-testid="ad-slots">
          {data?.slots.map((p) => (
            <li key={p.code} className="grid gap-3 py-3 ods-desktop:grid-cols-[minmax(0,1fr)_260px] ods-desktop:items-center">
              <OdsForm action={actions.savePlacement} hideSubmit={!edit} label={`Slot ${p.name}`}>
                <input type="hidden" name="code" value={p.code} />
                <div className="grid items-end gap-3 ods-tablet:grid-cols-[minmax(0,1fr)_120px_150px]">
                  <label className="flex min-w-0 flex-col gap-1 text-ods-label font-semibold text-ods-navy">
                    Slot name
                    <input name="name" className={cx(fieldCls, 'font-semibold')} defaultValue={p.name} disabled={!edit} />
                  </label>
                  <span className="pb-2 font-mono text-ods-small text-ods-slate">{p.code}</span>
                  <label className="flex min-w-0 flex-col gap-1 text-ods-label font-semibold text-ods-navy">
                    Minimum CPC (US$)
                    <input name="min_cpc" inputMode="decimal" className={cx(fieldCls, 'text-end font-mono')} defaultValue={p.minCpc} disabled={!edit} />
                  </label>
                </div>
              </OdsForm>
              <dl className="m-0 grid grid-cols-3 gap-2 text-ods-small">
                <div>
                  <dt className="text-ods-slate">Clicks · month</dt>
                  <dd className="m-0 tabular-nums">{p.clicks.toLocaleString('en-US')}</dd>
                </div>
                <div>
                  <dt className="text-ods-slate">Revenue · month</dt>
                  <dd className="m-0 font-semibold tabular-nums">{p.revenue}</dd>
                </div>
                <div>
                  <dt className="text-ods-slate">Share</dt>
                  <dd className="m-0">
                    <span className="block h-2 rounded-full bg-ods-line" role="img" aria-label={`${p.share}% of the top slot`}>
                      <span className="block h-2 rounded-full bg-ods-blue" style={{ width: `${p.share}%` }} />
                    </span>
                  </dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </Card>
      <Card headingLevel={2} title="Campaigns" loading={loading || !data}>
        {data ? <DataTable caption="Campaigns" captionHidden columns={campaignCols} rows={data.campaigns} getRowId={(c) => c.id} emptyTitle="No campaigns yet" data-testid="campaigns" /> : null}
      </Card>
      <div className="grid gap-4 ods-desktop:grid-cols-2">
        <Card headingLevel={2} title="Clicks per day · last 14 days" loading={loading || !data} empty={data && !data.anyClicks ? <EmptyState title="No clicks yet" /> : undefined}>
          {data ? (
            <DataTable
              caption="Clicks per day"
              captionHidden
              rows={data.days}
              getRowId={(d) => d.day}
              columns={[
                { id: 'day', header: 'Day', primary: true, cell: (d) => <span className="font-mono">{d.day}</span> },
                { id: 'paid', header: 'Paid clicks', numeric: true, cell: (d) => d.clicks },
                { id: 'invalid', header: 'Invalid', numeric: true, cell: (d) => <span className="text-ods-slate">{d.invalid}</span> },
                {
                  id: 'charged',
                  header: data.chargedHeader,
                  cell: (d) => (
                    <span className="flex items-center gap-2">
                      <span className="w-24 shrink-0 tabular-nums">{d.charged}</span>
                      <span aria-hidden className="h-2 flex-1 rounded-full bg-ods-line">
                        <span className="block h-2 rounded-full bg-ods-blue" style={{ width: `${d.share}%` }} />
                      </span>
                    </span>
                  ),
                },
              ]}
            />
          ) : null}
        </Card>
        <Card headingLevel={2} title="How the money flows">
          <ol className="m-0 flex list-decimal flex-col gap-2 ps-5 text-ods-body">
            <li>Advertiser tops up their wallet and sets a bid and daily budget.</li>
            <li>Each valid click deducts the bid from their wallet (never more than the daily budget).</li>
            <li>The amount is booked as revenue in Finance &amp; revenue under the “ads” stream.</li>
            <li>Duplicate clicks (same visitor within 24 h) are filtered and never charged. Campaigns pause automatically when the budget or wallet runs out.</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
