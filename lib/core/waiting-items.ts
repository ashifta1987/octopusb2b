import { formatDate, formatMoney } from '@octopus/ui/format';

/**
 * ODS T4 · "Waiting for you" items as a LIST (pure; server + tests). Same four rules and the same order as the
 * "Waiting for you" list on /account (ADDON-41 board 01) and countWaiting() in ./waiting.ts:
 *   1. quotes ready to review — one item per request (earliest expiry), quotes 'sent' | 'viewed' still valid;
 *   2. orders waiting for payment — status pi_issued | deposit_pending | balance_pending;
 *   3. bank transfers not confirmed (status failed with a reason) in the last 14 days;
 *   4. company verification that needs more information (latest kyc_submissions.status = 'more_info').
 * Sorted by `at` ascending (the soonest deadline / oldest item first = most urgent), exactly like /account.
 * Hrefs are My account URLs (open them with NamedTabLink tab="account").
 */
export type WaitingKind = 'quote' | 'payment' | 'transfer' | 'verification';
export type WaitingItem = { key: string; kind: WaitingKind; title: string; body: string; href: string; at: string };

export type WaitingRaw = {
  quotes: { rfq_id: string; valid_until: string; rfqs: { code: string; title: string } | null }[];
  orders: { id: string; code: string; title: string | null; status: string; updated_at: string }[];
  transfers: { id: string; amount_cents: number; status: string; reject_reason: string | null; confirmed_at: string | null }[];
  kyc: { status: string; customer_message: string | null; reviewed_at: string | null } | null;
};

const PAY_STATUSES = ['pi_issued', 'deposit_pending', 'balance_pending'];

export function buildWaitingItems(raw: WaitingRaw, nowIso: string, kycFallback = 'Please contact your account manager.'): WaitingItem[] {
  const now = new Date(nowIso);
  const items: WaitingItem[] = [];
  const byRfq = new Map<string, { code: string; title: string; n: number; until: string }>();
  for (const q of raw.quotes) {
    if (!q.rfqs || q.valid_until <= nowIso) continue;
    const cur = byRfq.get(q.rfq_id);
    const until = cur && cur.until < q.valid_until ? cur.until : q.valid_until;
    byRfq.set(q.rfq_id, { code: q.rfqs.code, title: q.rfqs.title, n: (cur?.n ?? 0) + 1, until });
  }
  byRfq.forEach((r, id) =>
    items.push({
      key: `q-${id}`,
      kind: 'quote',
      title: r.n === 1 ? '1 quote to review' : `${r.n} quotes to review`,
      body: `${r.title} · ${r.code} · valid until ${formatDate(r.until, { short: true, now })}`,
      href: `/account/sourcing/${r.code}`,
      at: r.until,
    }),
  );
  for (const o of raw.orders) {
    if (!PAY_STATUSES.includes(o.status)) continue;
    items.push({
      key: `o-${o.id}`,
      kind: 'payment',
      title: o.status === 'balance_pending' ? `Balance due · ${o.code}` : `Deposit due · ${o.code}`,
      body: `${o.title ? `${o.title} · ` : ''}It moves on as soon as it is paid.`,
      href: `/account/orders/${o.id}`,
      at: o.updated_at,
    });
  }
  const since = Date.parse(nowIso) - 14 * 864e5;
  for (const t of raw.transfers) {
    if (t.status !== 'failed' || !t.reject_reason || !t.confirmed_at || Date.parse(t.confirmed_at) < since) continue;
    items.push({
      key: `t-${t.id}`,
      kind: 'transfer',
      title: `Transfer of ${formatMoney(Number(t.amount_cents) / 100)} not confirmed`,
      body: `${t.reject_reason}. Check the slip and send it again.`,
      href: '/account/wallet#slip',
      at: t.confirmed_at,
    });
  }
  if (raw.kyc?.status === 'more_info') {
    items.push({
      key: 'kyc',
      kind: 'verification',
      title: 'Company verification needs more information',
      body: raw.kyc.customer_message?.trim() || kycFallback,
      href: '/account/kyc',
      at: raw.kyc.reviewed_at ?? nowIso,
    });
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}
