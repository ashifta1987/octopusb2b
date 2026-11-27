import 'server-only';
import { createClient } from '@/lib/supabase/server';

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
