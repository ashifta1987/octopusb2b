import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { KYC_CONTACT_FALLBACK } from '@/lib/kyc-message';
import { buildWaitingItems, type WaitingActionItem, type WaitingRaw } from './waiting-items';

export type { WaitingItem, WaitingKind, WaitingActionItem, WaitingActionType, WaitingService } from './waiting-items';

/**
 * CH-1 "N things are waiting for you" — the same rules as the "Waiting for you" list on /account (ADDON-41 board 01):
 * quotes ready to review (one per request), orders waiting for payment, bank transfers not confirmed in the last 14 days,
 * company verification that needs more information. Head counts / narrow selects under RLS (the company's own rows only).
 * CH-2 moves the /account list onto this helper so the Shop strip and the panel always show the same number.
 */
export async function countWaiting(orgId: string, nowIso: string): Promise<number> {
  const sb = await createClient();
  const since = new Date(Date.parse(nowIso) - 14 * 864e5).toISOString();
  const [quotes, orders, transfers, kyc] = await Promise.all([
    sb.from('quotes').select('rfq_id, rfqs!inner(org_id)').in('status', ['sent', 'viewed']).eq('rfqs.org_id', orgId).gt('valid_until', nowIso).limit(500),
    sb.from('orders').select('id', { count: 'exact', head: true }).eq('org_id', orgId).in('status', ['pi_issued', 'deposit_pending', 'balance_pending']),
    sb.from('wallet_topups').select('id', { count: 'exact', head: true }).eq('org_id', orgId).eq('status', 'failed')
      .not('reject_reason', 'is', null).gte('confirmed_at', since),
    sb.from('kyc_submissions').select('status').eq('org_id', orgId).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  const rfqsWithQuotes = new Set((quotes.data ?? []).map((q) => q.rfq_id as string)).size;
  return rfqsWithQuotes + (orders.count ?? 0) + (transfers.count ?? 0) + (kyc.data?.status === 'more_info' ? 1 : 0);
}

/**
 * ODS T4: the same items as a list (welcome-bar tiles on /shop; My account › Action needed can use it too), most urgent
 * first. Same queries and rules as countWaiting(); shaping is the pure buildWaitingItems() in ./waiting-items.ts.
 * ODS T6: returns WaitingActionItem (WaitingItem + type/service/ref/what/action/odsHref/dueAt for My account › Action needed).
 * Columns read: quotes.rfq_id, valid_until, rfqs.code/title · orders.id, code, title, status, updated_at ·
 * wallet_topups.id, amount_cents, status, reject_reason, confirmed_at · kyc_submissions.status, customer_message, reviewed_at.
 */
export async function listWaiting(orgId: string, nowIso: string, limit = 50): Promise<WaitingActionItem[]> {
  const sb = await createClient();
  const since = new Date(Date.parse(nowIso) - 14 * 864e5).toISOString();
  const [quotes, orders, transfers, kyc] = await Promise.all([
    sb.from('quotes').select('rfq_id, valid_until, rfqs!inner(code, title, org_id)').in('status', ['sent', 'viewed']).eq('rfqs.org_id', orgId).gt('valid_until', nowIso).limit(500),
    sb.from('orders').select('id, code, title, status, updated_at').eq('org_id', orgId).in('status', ['pi_issued', 'deposit_pending', 'balance_pending']).limit(100),
    sb.from('wallet_topups').select('id, amount_cents, status, reject_reason, confirmed_at').eq('org_id', orgId).eq('status', 'failed')
      .not('reject_reason', 'is', null).gte('confirmed_at', since).limit(50),
    sb.from('kyc_submissions').select('status, customer_message, reviewed_at').eq('org_id', orgId).order('submitted_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (quotes.error || orders.error || transfers.error) throw new Error('Could not load the waiting items.');
  const raw: WaitingRaw = {
    quotes: ((quotes.data ?? []) as unknown as { rfq_id: string; valid_until: string; rfqs: { code: string; title: string } | { code: string; title: string }[] | null }[])
      .map((q) => ({ rfq_id: q.rfq_id, valid_until: q.valid_until, rfqs: Array.isArray(q.rfqs) ? (q.rfqs[0] ?? null) : q.rfqs })),
    orders: (orders.data ?? []) as WaitingRaw['orders'],
    transfers: (transfers.data ?? []) as WaitingRaw['transfers'],
    kyc: (kyc.data ?? null) as WaitingRaw['kyc'],
  };
  return buildWaitingItems(raw, nowIso, KYC_CONTACT_FALLBACK).slice(0, limit);
}
