import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { Card, Stat, PageHeader, EmptyState, StatusBadge, Table, Notice } from '@/components/ui';
import { Bar } from '@/components/admin/ui';
import { ActionForm, RunButton, ToggleSetting } from '@/components/admin/client';
import { money, humanize } from '@/lib/format';
import { getCurrencyContext, toPlatform } from '@/lib/currency';
import { CurrencyTotals, sumByCurrency, rateLabel } from '@/components/admin/currency';
import { setSetting } from '../actions';
import { moderateCampaign, savePlacement } from './actions';
import { nowMs } from '@/components/admin/server';

export const metadata = { title: 'Advertising' };

/** Admin → Advertising (AdsAdmin.png). */
export default async function AdsAdminPage() {
  const s = await requireStaff('ads', 'view', '/admin/ads');
  const sb = await createClient();
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const since30 = new Date(nowMs() - 30 * 864e5);
  const since = monthStart < since30 ? monthStart : since30;

  const [setting, placements, campaigns, clicks, impressions, suppliers, ctx] = await Promise.all([
    sb.from('site_settings').select('value').eq('key', 'ads_enabled').maybeSingle(),
    sb.from('ad_placements').select('code, name, min_cpc_cents').order('code'),
    sb.from('ad_campaigns').select('id, name, placement, headline, daily_budget_cents, max_cpc_cents, spent_today_cents, currency, status, rejection_reason, created_at, org_id, supplier_id, organizations(name, country)').order('created_at', { ascending: false }),
    sb.from('ad_clicks').select('campaign_id, charged_cents, currency, valid, created_at').gte('created_at', since.toISOString()).limit(50000),
    sb.from('ad_impressions').select('campaign_id, day, count').gte('day', monthStart.toISOString().slice(0, 10)),
    sb.from('suppliers').select('id, code'),
    getCurrencyContext(),
  ]);

  const adsOn = setting.data?.value === true || setting.data?.value === 'true';
  const camps = campaigns.data ?? [];
  const campPlacement = new Map(camps.map((c) => [c.id, c.placement]));
  const allClicks = clicks.data ?? [];
  const monthClicks = allClicks.filter((c) => c.created_at >= monthStart.toISOString());
  const paid = monthClicks.filter((c) => c.valid && Number(c.charged_cents) > 0);
  const invalid = monthClicks.filter((c) => !c.valid).length;
  // clicks are charged in the campaign's locked currency; aggregates are converted into the platform currency (SPEC §15.1)
  const conv = (c: { charged_cents: number; currency: string | null }) => toPlatform(ctx, Number(c.charged_cents), c.currency) ?? 0;
  const revenueBy = sumByCurrency(paid, (c) => c.charged_cents, (c) => c.currency);
  const revenue = paid.reduce((a, c) => a + conv(c), 0);
  const mixed = allClicks.some((c) => c.currency !== ctx.currency);
  const impr = (impressions.data ?? []).reduce((a, i) => a + Number(i.count), 0);
  const supCode = new Map((suppliers.data ?? []).map((x) => [x.id, x.code]));

  const perPlacement = new Map<string, { clicks: number; rev: number }>();
  paid.forEach((c) => { const p = campPlacement.get(c.campaign_id); if (!p) return; const a = perPlacement.get(p) ?? { clicks: 0, rev: 0 }; a.clicks++; a.rev += conv(c); perPlacement.set(p, a); });
  const maxPlacementRev = Math.max(1, ...[...perPlacement.values()].map((v) => v.rev));

  const perCampaign = new Map<string, { clicks: number; spent: number }>();
  allClicks.filter((c) => c.valid && Number(c.charged_cents) > 0).forEach((c) => { const a = perCampaign.get(c.campaign_id) ?? { clicks: 0, spent: 0 }; a.clicks++; a.spent += Number(c.charged_cents); perCampaign.set(c.campaign_id, a); });

  // per day (last 14 days)
  const days: string[] = [];
  for (let i = 13; i >= 0; i--) days.push(new Date(nowMs() - i * 864e5).toISOString().slice(0, 10));
  const perDay = new Map(days.map((d) => [d, { clicks: 0, charged: 0, invalid: 0 }]));
  allClicks.forEach((c) => { const d = perDay.get(c.created_at.slice(0, 10)); if (!d) return; if (c.valid && Number(c.charged_cents) > 0) { d.clicks++; d.charged += conv(c); } else d.invalid++; });
  const maxDay = Math.max(1, ...[...perDay.values()].map((d) => d.charged));
  const edit = can(s, 'ads', 'edit');
  const waiting = camps.filter((c) => c.status === 'in_review').length;

  return (
    <>
      <PageHeader
        title="Advertising"
        subtitle='Pay-per-click ads on the storefront and customer portal. Advertisers pay from their wallet for each valid click; revenue goes to Finance as "Advertising (CPC)".'
        actions={<span className="inline-flex items-center gap-2"><span className="font-semibold">Ads</span><ToggleSetting checked={adsOn} label="Advertising" disabled={!s.isAdmin} showText onToggle={setSetting.bind(null, 'ads_enabled')} /></span>}
      />
      {!adsOn && <div className="mb-6"><Notice tone="amber">Advertising is OFF — no ads are shown and no clicks are charged.</Notice></div>}

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-5 mb-6">
        <Stat label="Ad revenue · this month" value={<CurrencyTotals totals={revenueBy} ctx={ctx} />} />
        <Stat label="Paid clicks" value={paid.length.toLocaleString()} hint={paid.length ? `avg ${money(Math.round(revenue / paid.length), ctx.currency)} per click${mixed ? ' (converted)' : ''}` : undefined} />
        <Stat label="Impressions" value={impr.toLocaleString()} hint={impr ? `CTR ${((paid.length / impr) * 100).toFixed(1)}%` : undefined} />
        <Stat label="Invalid clicks filtered" value={invalid.toLocaleString()} hint="not charged" />
        <Stat label="Active campaigns" value={camps.filter((c) => c.status === 'active').length} hint={waiting ? `${waiting} waiting for approval` : undefined} hintTone={waiting ? 'warn' : undefined} />
      </div>

      <Card title="Ad slots" className="mb-6" action={<span className="text-sm text-muted">Minimum cost per click (CPC) in USD; campaigns in CNY compare at the approved rate. Revenue in {ctx.currency}{mixed ? ` (converted at ${rateLabel(ctx)})` : ''}.</span>}>
        <Table head={['Slot', 'Code', 'Min CPC', 'Clicks · month', 'Revenue · month', 'Share']} empty={<EmptyState title="No ad slots" />}>
          {(placements.data ?? []).map((p) => {
            const st = perPlacement.get(p.code) ?? { clicks: 0, rev: 0 };
            return (
              <tr key={p.code}>
                <td className="td" colSpan={3}>
                  <ActionForm action={savePlacement} className="grid gap-3 sm:grid-cols-[1fr_140px_140px] items-center" submitLabel="Save" submitClass="btn btn-ghost btn-sm" hideSubmit={!edit} inline>
                    <input type="hidden" name="code" value={p.code} />
                    <label className="sr-only" htmlFor={`pl-name-${p.code}`}>Slot name</label>
                    <input id={`pl-name-${p.code}`} name="name" className="input font-semibold" defaultValue={p.name} disabled={!edit} />
                    <span className="mono text-xs text-muted">{p.code}</span>
                    <span className="flex items-center gap-1">
                      <span className="text-muted mono" aria-hidden>US$</span>
                      <label className="sr-only" htmlFor={`pl-cpc-${p.code}`}>Minimum CPC (USD)</label>
                      <input id={`pl-cpc-${p.code}`} name="min_cpc" inputMode="decimal" className="input mono" defaultValue={(Number(p.min_cpc_cents) / 100).toFixed(2)} disabled={!edit} />
                    </span>
                  </ActionForm>
                </td>
                <td className="td mono">{st.clicks.toLocaleString()}</td>
                <td className="td mono font-semibold">{money(st.rev, ctx.currency)}</td>
                <td className="td w-[140px]"><div className="h-2 rounded-full bg-line" role="img" aria-label={`${Math.round((st.rev / maxPlacementRev) * 100)}% of top slot`}><div className="h-2 rounded-full bg-coral" style={{ width: `${(st.rev / maxPlacementRev) * 100}%` }} /></div></td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <Card title="Campaigns" className="mb-6">
        <Table head={['Campaign', 'Advertiser', 'Slot', 'Bid', 'Daily budget', 'Clicks (30d)', 'Spent (30d)', 'Status', '']} empty={<EmptyState title="No campaigns yet" />}>
          {camps.map((c) => {
            const org = c.organizations as unknown as { name: string; country: string | null } | null;
            const st = perCampaign.get(c.id) ?? { clicks: 0, spent: 0 };
            return (
              <tr key={c.id}>
                <td className="td"><div className="font-semibold">{c.name}</div><div className="text-xs text-muted">{c.headline}</div>{c.rejection_reason && <div className="text-xs text-bad">Rejected: {c.rejection_reason}</div>}</td>
                <td className="td text-sm">{c.supplier_id ? `Supplier ${supCode.get(c.supplier_id) ?? ''}` : org?.name ?? '—'}</td>
                <td className="td text-sm">{(placements.data ?? []).find((p) => p.code === c.placement)?.name ?? c.placement}</td>
                <td className="td mono">{money(Number(c.max_cpc_cents), c.currency)}</td>
                <td className="td mono">{money(Number(c.daily_budget_cents), c.currency)}/day<div className="text-xs text-muted">today {money(Number(c.spent_today_cents), c.currency)}</div></td>
                <td className="td mono">{st.clicks.toLocaleString()}</td>
                <td className="td mono font-semibold">{money(st.spent, c.currency)}</td>
                <td className="td"><StatusBadge status={c.status} label={c.status === 'in_review' ? 'Pending approval' : c.status === 'active' ? 'Live' : humanize(c.status)} /></td>
                <td className="td">
                  {edit && (
                    <span className="flex flex-wrap gap-2">
                      {c.status === 'in_review' && <>
                        <RunButton className="btn btn-primary btn-sm" confirm={`Approve “${c.name}” and make it live?`} action={moderateCampaign.bind(null, c.id, 'active')}>Approve</RunButton>
                        <RunButton prompt="Reason for rejection (shown to the advertiser):" action={moderateCampaign.bind(null, c.id, 'rejected')}>Reject</RunButton>
                      </>}
                      {c.status === 'active' && <RunButton confirm={`Pause “${c.name}”?`} action={moderateCampaign.bind(null, c.id, 'paused')}>Pause</RunButton>}
                      {c.status === 'paused' && <RunButton confirm={`Resume “${c.name}”?`} action={moderateCampaign.bind(null, c.id, 'active')}>Resume</RunButton>}
                      {(c.status === 'active' || c.status === 'paused') && <RunButton confirm={`End “${c.name}”? This cannot be undone.`} action={moderateCampaign.bind(null, c.id, 'ended')}>End</RunButton>}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Clicks per day · last 14 days">
          <div className="px-6 pb-6">
            {allClicks.length === 0 ? <EmptyState title="No clicks yet" /> : (
              <Table head={['Day', 'Paid clicks', 'Invalid', `Charged (${ctx.currency}${mixed ? ', converted' : ''})`]}>
                {days.slice().reverse().map((d) => {
                  const v = perDay.get(d)!;
                  return (
                    <tr key={d}>
                      <td className="td mono text-sm">{d}</td>
                      <td className="td mono">{v.clicks}</td>
                      <td className="td mono text-muted">{v.invalid}</td>
                      <td className="td"><span className="flex items-center gap-2"><span className="mono text-sm w-20">{money(v.charged, ctx.currency)}</span><span className="h-2 flex-1 rounded-full bg-line" aria-hidden><span className="block h-2 rounded-full bg-coral" style={{ width: `${(v.charged / maxDay) * 100}%` }} /></span></span></td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </div>
        </Card>
        <Card title="How the money flows">
          <ol className="px-6 pb-6 list-decimal list-inside space-y-2 text-[15px]">
            <li>Advertiser tops up their wallet and sets a bid and daily budget.</li>
            <li>Each valid click deducts the bid from their wallet (never more than the daily budget).</li>
            <li>The amount is booked as revenue in Finance & revenue under the “ads” stream.</li>
            <li>Duplicate clicks (same visitor within 24 h) are filtered and never charged. Campaigns pause automatically when the budget or wallet runs out.</li>
          </ol>
          <div className="px-6 pb-6">
            <h3 className="font-semibold mb-1">Revenue share by slot</h3>
            {[...perPlacement.entries()].length === 0 ? <p className="text-sm text-muted">No paid clicks this month.</p> :
              [...perPlacement.entries()].map(([k, v]) => <Bar key={k} label={(placements.data ?? []).find((p) => p.code === k)?.name ?? k} value={v.rev} max={maxPlacementRev} display={money(v.rev, ctx.currency)} />)}
          </div>
        </Card>
      </div>
    </>
  );
}
