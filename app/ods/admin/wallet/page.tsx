// ODS T9 · Admin › Wallets & payments. Replaces the T8 re-export of app/admin/wallet/page.tsx inside the ODS Back Office
// frame. Same guard (requireStaff('wallet','view')), the same reads as today (session client; seeds dropped as today),
// today's actions unchanged: setSetting('wallet_enabled') / saveSettings / saveCreditDefault / saveCustomerCredit (admin),
// confirmTopup (wallet:approve) behind the T8 two-person gate (skipped before migration 255).
import { Suspense } from 'react';
import { requireStaff, can } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { dropSeeds, seedIds } from '@/components/backoffice/hidden-columns';
import { CURRENCIES } from '@/lib/format';
import { getCurrencyContext, toPlatform } from '@/lib/currency';
import { rateLabel } from '@/components/admin/currency';
import { setSetting, saveSettings } from '@/app/admin/actions';
import { saveCreditDefault, saveCustomerCredit } from '@/app/admin/wallet/credit-actions';
import { approvalReadiness } from '@/lib/office/approvals';
import { nowMs as getNowMs } from '@/components/account/order-utils';
import { confirmTopupGated } from '../finance/_accounts-b/gated-actions';
import { PLATFORM_SETTINGS, priceFor, splitPrices, totalsByCurrency, walletPerms } from '../finance/_accounts-b/core';
import { WalletScreen, type CreditRow, type PriceRow, type TopupRow, type WalletData, type WalletRow } from './_components/wallet-screen';

export const metadata = { title: 'Wallets & payments' };

const ACTIONS = { setWallet: setSetting, saveCreditDefault, saveCustomerCredit, saveSettings, confirmTopup: confirmTopupGated };
const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));

async function WalletContent() {
  const s = await requireStaff('wallet', 'view', '/admin/wallet');
  const perms = walletPerms({ isAdmin: s.isAdmin, can: (a, x) => can(s, a, x) });
  const sb = await createClient();
  const monthStart = new Date(getNowMs());
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const seedTop = await seedIds('wallet_topups');
  const [settings, wallets, topupsRaw, services, prices, rev, ctx, credit, readiness] = await Promise.all([
    sb.from('site_settings').select('key, value').in('key', ['wallet_enabled', 'wallet_credit_default', ...PLATFORM_SETTINGS.map((p) => p.key)]),
    sb.rpc('admin_wallet_balances'),
    sb.from('wallet_topups').select('id, org_id, amount_cents, currency, method, reference, status, created_at, organizations(name, country)').order('created_at', { ascending: false }).limit(40 + seedTop.size),
    sb.from('services').select('code, name, unit, active, sort').order('sort'),
    sb.from('service_prices').select('service_code, amount_minor, currency, effective_from').order('effective_from', { ascending: false }),
    perms.canSeeRevenue ? sb.rpc('admin_revenue_by_stream', { p_from: monthStart.toISOString() }) : Promise.resolve(null),
    getCurrencyContext(),
    sb.rpc('admin_wallet_credit_overview'),
    perms.canApproveTopups ? approvalReadiness() : Promise.resolve(null),
  ]);
  const set = new Map((settings.data ?? []).map((r) => [r.key as string, r.value as unknown]));
  const ws = wallets.error ? null : ((wallets.data ?? []) as WalletRow[]);
  const walletTotals = totalsByCurrency(ws ?? [], (w) => Number(w.balance_cents), (w) => w.currency);
  const cur = ctx.currency;
  const topupRows = topupsRaw.error ? null : (dropSeeds(topupsRaw.data, seedTop, 40) ?? []);
  const credited = (topupRows ?? []).filter((t) => t.status === 'credited' && (t.created_at as string) >= monthStart.toISOString());
  const creditRows = credit.error ? null : ((credit.data ?? []) as CreditRow[]);
  const nowIso = new Date(getNowMs()).toISOString();
  const { current, scheduled } = splitPrices(((prices.data ?? []) as { service_code: string; amount_minor: number; currency: string; effective_from: string }[]), nowIso);
  const data: WalletData = {
    walletOn: set.get('wallet_enabled') === true || set.get('wallet_enabled') === 'true',
    wallets: ws,
    walletTotals,
    convertedTotal: walletTotals.length > 1 || (walletTotals[0] && walletTotals[0][0] !== cur) ? { minor: walletTotals.reduce((a, [c, v]) => a + (toPlatform(ctx, v, c) ?? 0), 0), currency: cur, rateLabel: rateLabel(ctx) } : null,
    topups: topupRows
      ? topupRows.map((t) => {
          const org = one(t.organizations as unknown as { name: string; country: string | null } | null);
          return { id: t.id as string, org_name: org?.name ?? '—', country: org?.country ?? null, amount_cents: Number(t.amount_cents), currency: (t.currency as string) ?? 'USD', method: t.method as string, reference: (t.reference as string | null) ?? null, status: t.status as string, created_at: t.created_at as string } satisfies TopupRow;
        })
      : null,
    topupsThisMonth: { totals: totalsByCurrency(credited, (t) => Number(t.amount_cents), (t) => t.currency as string), count: credited.length },
    spent: rev === null ? null : rev.error ? null : totalsByCurrency(((rev.data ?? []) as { stream: string; net_cents: number; currency: string }[]).filter((r) => ['service_fees', 'rfq_fees', 'ads'].includes(r.stream)), (r) => r.net_cents, (r) => r.currency),
    credit: creditRows,
    creditDefault: (set.get('wallet_credit_default') ?? {}) as WalletData['creditDefault'],
    creditUsedMinor: (creditRows ?? []).reduce((a, r) => a + Math.max(-Number(r.balance_minor), 0), 0),
    prices: services.error
      ? null
      : (services.data ?? []).map((sv) => ({
          code: sv.code as string, name: sv.name as string, unit: sv.unit as string, active: !!sv.active,
          price: priceFor(sv.code as string, cur, current, (usd) => toPlatform(ctx, usd, 'USD')),
          scheduled: scheduled.get(`${sv.code}|${cur}`) ?? null,
        }) satisfies PriceRow),
    settings: Object.fromEntries(PLATFORM_SETTINGS.map((p) => [p.key, String(set.get(p.key) ?? '')])),
    platformCurrency: cur,
    currencies: [...CURRENCIES],
  };
  return <WalletScreen state="ok" data={data} perms={perms} approvalLimitMinor={readiness && readiness.ok ? readiness.data.limitMinor : null} actions={ACTIONS} />;
}

export default function WalletAdminPage() {
  return (
    <Suspense fallback={<WalletScreen state="loading" data={null} perms={{ isAdmin: false, canApproveTopups: false, canSeeRevenue: false }} approvalLimitMinor={null} actions={ACTIONS} />}>
      <WalletContent />
    </Suspense>
  );
}
