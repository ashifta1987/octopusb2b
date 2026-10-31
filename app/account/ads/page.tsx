import Link from 'next/link';
import { requireCustomer } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, EmptyState, Money, Notice, PageHeader, StatusBadge, Table } from '@/components/ui';
import { ActionButton } from '@/components/client';
import { COUNTRY_NAMES, fmtDate, usd } from '@/lib/format';
import { getSettings, getWalletBalance } from '@/components/account/data';
import { AdsCampaignForm } from '@/components/account/ads-form';
import { pauseCampaign } from './actions';

export const metadata = { title: 'Advertising' };

type Campaign = {
  id: string; name: string; placement: string; headline: string; status: string; rejection_reason: string | null;
  daily_budget_cents: number; max_cpc_cents: number; spent_today_cents: number; target_countries: string[] | null; created_at: string;
};

export default async function AdsPage() {
  const s = await requireCustomer('/account/ads');

  if (!s.org) {
    return (
      <>
        <PageHeader title="Advertise on Octopus B2B" subtitle="Show a small sponsored banner to buyers." />
        <Notice tone="amber">Complete your company profile first. <Link href="/account/kyc" className="underline font-semibold">Set up your company</Link></Notice>
      </>
    );
  }

  const sb = await createClient();
  const [settings, wallet, { data: plRaw }, { data: cRaw }] = await Promise.all([
    getSettings(),
    getWalletBalance(),
    sb.from('ad_placements').select('code, name, min_cpc_cents').order('min_cpc_cents'),
    sb.from('ad_campaigns').select('id, name, placement, headline, status, rejection_reason, daily_budget_cents, max_cpc_cents, spent_today_cents, target_countries, created_at')
      .eq('org_id', s.org.id).order('created_at', { ascending: false }),
  ]);
  const placements = (plRaw ?? []).map((p) => ({ code: p.code as string, name: p.name as string, min_cpc_cents: Number(p.min_cpc_cents) }));
  const plName = new Map(placements.map((p) => [p.code, p.name]));
  const campaigns = ((cRaw ?? []) as Campaign[]).map((c) => ({ ...c, daily_budget_cents: Number(c.daily_budget_cents), max_cpc_cents: Number(c.max_cpc_cents) }));
  const ids = campaigns.map((c) => c.id);

  const stats = new Map<string, { clicks: number; spent: number; impressions: number }>();
  ids.forEach((id) => stats.set(id, { clicks: 0, spent: 0, impressions: 0 }));
  if (ids.length) {
    const [{ data: clicks }, { data: impr }] = await Promise.all([
      sb.from('ad_clicks').select('campaign_id, charged_cents').in('campaign_id', ids).eq('valid', true),
      sb.from('ad_impressions').select('campaign_id, count').in('campaign_id', ids),
    ]);
    (clicks ?? []).forEach((r) => {
      const st = stats.get(r.campaign_id as string);
      if (st) { st.clicks += 1; st.spent += Number(r.charged_cents ?? 0); }
    });
    (impr ?? []).forEach((r) => {
      const st = stats.get(r.campaign_id as string);
      if (st) st.impressions += Number(r.count ?? 0);
    });
  }
  const totals = [...stats.values()].reduce((a, b) => ({ clicks: a.clicks + b.clicks, spent: a.spent + b.spent, impressions: a.impressions + b.impressions }), { clicks: 0, spent: 0, impressions: 0 });
  const nf = new Intl.NumberFormat('en-US');

  return (
    <>
      <PageHeader
        title="Advertise on Octopus B2B"
        subtitle="Show a small sponsored banner to buyers. You only pay when someone clicks, and never more than your daily budget."
        actions={
          <div className="flex items-center gap-3">
            <span className="text-[15px]">Wallet <Money cents={wallet} /></span>
            <Link href="/account/wallet" className="btn btn-ghost btn-sm">Top up</Link>
          </div>
        }
      />

      {!settings.ads_enabled && (
        <div className="mb-6" id="ads-off">
          <Notice tone="amber">Advertising is switched off right now. You can review your campaigns, but new campaigns can’t be submitted until it is switched back on.</Notice>
        </div>
      )}
      {!settings.wallet_enabled && (
        <div className="mb-6"><Notice tone="blue">The wallet is switched off — valid clicks will be added to your monthly invoice in Ledger &amp; invoices.</Notice></div>
      )}

      <AdsCampaignForm placements={placements} countries={COUNTRY_NAMES} disabled={!settings.ads_enabled} walletCents={wallet} />

      <Card title="My campaigns" className="mt-6"
        action={campaigns.length ? <span className="text-sm text-muted">{nf.format(totals.impressions)} impressions · {nf.format(totals.clicks)} clicks · {usd(totals.spent)} spent</span> : undefined}>
        <Table head={['Campaign', 'Status', 'Impressions', 'Clicks', 'CTR', 'Bid', 'Daily budget', 'Spent', '']}
          empty={<EmptyState title="No campaigns yet" body="Create your first sponsored banner above. It goes live after a quick review." />}>
          {campaigns.map((c) => {
            const st = stats.get(c.id)!;
            const ctr = st.impressions ? (st.clicks / st.impressions) * 100 : null;
            return (
              <tr key={c.id}>
                <td className="td">
                  <div className="font-semibold">{c.name}</div>
                  <div className="text-xs text-muted">{plName.get(c.placement) ?? c.placement} · {c.target_countries?.length ? c.target_countries.join(', ') : 'All countries'} · {fmtDate(c.created_at)}</div>
                  {c.status === 'rejected' && c.rejection_reason && <div className="text-xs text-bad mt-1">Reason: {c.rejection_reason}</div>}
                </td>
                <td className="td"><StatusBadge status={c.status} label={c.status === 'active' ? 'Live' : undefined} /></td>
                <td className="td mono text-sm">{nf.format(st.impressions)}</td>
                <td className="td mono text-sm">{nf.format(st.clicks)}</td>
                <td className="td mono text-sm">{ctr == null ? '—' : `${ctr.toFixed(1)}%`}</td>
                <td className="td"><Money cents={c.max_cpc_cents} className="text-sm font-normal" /></td>
                <td className="td"><Money cents={c.daily_budget_cents} className="text-sm font-normal" /></td>
                <td className="td"><Money cents={st.spent} className="text-sm" /></td>
                <td className="td text-right">
                  {c.status === 'active' && (
                    <ActionButton action={pauseCampaign.bind(null, c.id)} className="btn btn-ghost btn-sm"
                      confirm={`Pause “${c.name}”? It stops showing immediately. Resuming needs a new review by our team.`}>Pause</ActionButton>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </>
  );
}
