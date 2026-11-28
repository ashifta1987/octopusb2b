import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { money, humanize } from '@/lib/format';
import { getCurrencyContext, toPlatform } from '@/lib/currency';
import { sumByCurrency, perCurrencyText, rateLabel } from '@/components/admin/currency';
import { adsOn, clicksPerDay, last14Days, pct } from '../../_website/website-core';

/**
 * Advertising — TODAY's reads and figures (app/admin/ads/page.tsx), unchanged: placements, campaigns, clicks (30 days /
 * this month), impressions, supplier codes, currency context; aggregates converted into the platform currency.
 * Returned as display strings so the client screen formats nothing money-related itself.
 */
export type AdsSlot = { code: string; name: string; minCpc: string; clicks: number; revenue: string; share: number };
export type AdsCampaign = {
  id: string; name: string; headline: string | null; rejection: string | null; advertiser: string; slot: string; bid: string; budget: string; today: string;
  clicks: number; spent: string; status: string; statusLabel: string;
};
export type AdsDay = { day: string; clicks: number; invalid: number; charged: string; share: number };
export type AdsData = {
  adsOn: boolean;
  kpis: { revenue: string; revenueHint?: string; paidClicks: number; avgHint?: string; impressions: number; ctrHint?: string; invalid: number; active: number; waiting: number };
  slots: AdsSlot[];
  slotNote: string;
  campaigns: AdsCampaign[];
  days: AdsDay[];
  chargedHeader: string;
  anyClicks: boolean;
};

export async function loadAds(nowMs: number): Promise<AdsData> {
  const sb = await createClient();
  const monthStart = new Date(nowMs);
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const since30 = new Date(nowMs - 30 * 864e5);
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
  const camps = campaigns.data ?? [];
  const campPlacement = new Map(camps.map((c) => [c.id as string, c.placement as string]));
  const allClicks = (clicks.data ?? []) as { campaign_id: string; charged_cents: number; currency: string | null; valid: boolean; created_at: string }[];
  const monthIso = monthStart.toISOString();
  const monthClicks = allClicks.filter((c) => c.created_at >= monthIso);
  const paid = monthClicks.filter((c) => c.valid && Number(c.charged_cents) > 0);
  const invalid = monthClicks.filter((c) => !c.valid).length;
  const conv = (c: { charged_cents: number; currency: string | null }) => toPlatform(ctx, Number(c.charged_cents), c.currency) ?? 0;
  const revenueBy = sumByCurrency(paid, (c) => c.charged_cents, (c) => c.currency);
  const revenue = paid.reduce((a, c) => a + conv(c), 0);
  const mixed = allClicks.some((c) => c.currency !== ctx.currency);
  const impr = (impressions.data ?? []).reduce((a, i) => a + Number(i.count), 0);
  const supCode = new Map((suppliers.data ?? []).map((x) => [x.id as string, x.code as string]));
  const perPlacement = new Map<string, { clicks: number; rev: number }>();
  paid.forEach((c) => {
    const p = campPlacement.get(c.campaign_id);
    if (!p) return;
    const a = perPlacement.get(p) ?? { clicks: 0, rev: 0 };
    a.clicks++;
    a.rev += conv(c);
    perPlacement.set(p, a);
  });
  const maxPlacementRev = Math.max(1, ...[...perPlacement.values()].map((v) => v.rev));
  const perCampaign = new Map<string, { clicks: number; spent: number }>();
  allClicks.filter((c) => c.valid && Number(c.charged_cents) > 0).forEach((c) => {
    const a = perCampaign.get(c.campaign_id) ?? { clicks: 0, spent: 0 };
    a.clicks++;
    a.spent += Number(c.charged_cents);
    perCampaign.set(c.campaign_id, a);
  });
  const days = clicksPerDay(allClicks, last14Days(nowMs), conv);
  const maxDay = Math.max(1, ...days.map((d) => d.charged));
  const placementName = (code: string) => (placements.data ?? []).find((p) => p.code === code)?.name ?? code;
  const waiting = camps.filter((c) => c.status === 'in_review').length;
  return {
    adsOn: adsOn(setting.data?.value),
    kpis: {
      revenue: perCurrencyText(revenueBy, ctx.currency),
      revenueHint: [...revenueBy.keys()].some((c) => c !== ctx.currency) ? `Total ${money(revenue, ctx.currency)} · converted at ${rateLabel(ctx)}` : undefined,
      paidClicks: paid.length,
      avgHint: paid.length ? `avg ${money(Math.round(revenue / paid.length), ctx.currency)} per click${mixed ? ' (converted)' : ''}` : undefined,
      impressions: impr,
      ctrHint: impr ? `CTR ${((paid.length / impr) * 100).toFixed(1)}%` : undefined,
      invalid,
      active: camps.filter((c) => c.status === 'active').length,
      waiting,
    },
    slots: (placements.data ?? []).map((p) => {
      const st = perPlacement.get(p.code as string) ?? { clicks: 0, rev: 0 };
      return { code: p.code as string, name: p.name as string, minCpc: (Number(p.min_cpc_cents) / 100).toFixed(2), clicks: st.clicks, revenue: money(st.rev, ctx.currency), share: pct(st.rev, maxPlacementRev) };
    }),
    slotNote: `Minimum cost per click (CPC) in USD; campaigns in CNY compare at the approved rate. Revenue in ${ctx.currency}${mixed ? ` (converted at ${rateLabel(ctx)})` : ''}.`,
    campaigns: camps.map((c) => {
      const org = c.organizations as unknown as { name: string } | null;
      const st = perCampaign.get(c.id as string) ?? { clicks: 0, spent: 0 };
      const status = c.status as string;
      return {
        id: c.id as string,
        name: c.name as string,
        headline: (c.headline as string | null) ?? null,
        rejection: (c.rejection_reason as string | null) ?? null,
        advertiser: c.supplier_id ? `Supplier ${supCode.get(c.supplier_id as string) ?? ''}` : (org?.name ?? '—'),
        slot: placementName(c.placement as string),
        bid: money(Number(c.max_cpc_cents), c.currency as string),
        budget: `${money(Number(c.daily_budget_cents), c.currency as string)}/day`,
        today: `today ${money(Number(c.spent_today_cents), c.currency as string)}`,
        clicks: st.clicks,
        spent: money(st.spent, c.currency as string),
        status,
        statusLabel: status === 'in_review' ? 'Pending approval' : status === 'active' ? 'Live' : humanize(status),
      };
    }),
    days: days.slice().reverse().map((d) => ({ day: d.day, clicks: d.clicks, invalid: d.invalid, charged: money(d.charged, ctx.currency), share: pct(d.charged, maxDay) })),
    chargedHeader: `Charged (${ctx.currency}${mixed ? ', converted' : ''})`,
    anyClicks: allClicks.length > 0,
  };
}
