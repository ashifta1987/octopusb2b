import { formatDate, formatMoney } from '@octopus/ui/format';

/**
 * ODS T4 · "Waiting for you" items as a LIST (pure; server + tests). Same four rules and the same order as the
 * "Waiting for you" list on /account (ADDON-41 board 01) and countWaiting() in ./waiting.ts:
 *   1. quotes ready to review — one item per request (earliest expiry), quotes 'sent' | 'viewed' still valid;
 *   2. orders waiting for payment — status pi_issued | deposit_pending | balance_pending;
 *   3. bank transfers not confirmed (status failed with a reason) in the last 14 days;
 *   4. company verification that needs more information (latest kyc_submissions.status = 'more_info').
 * Sorted by `at` ascending (the soonest deadline / oldest item first = most urgent), exactly like /account.
 * `href` = today's My account URLs (the T4 Shop tiles use them; open with NamedTabLink tab="account").
 *
 * ODS T6 (additive, nothing above changed): every item also carries
 *   - `type`    the Action needed filter (Part 6.3): pay | approve | review | reply
 *                 quote → review · order payment → pay · transfer not confirmed → pay (send the slip again so the money
 *                 is credited) · verification needs more information → reply. Nothing produces `approve` yet (no
 *                 approval source among the four rules) — the pill shows an honest empty state.
 *   - `service` the service it belongs to (sourcing | wallet | account)
 *   - `ref`     the record code shown in bold (RFQ-…, OCT-…), when there is one
 *   - `what`    short "What" line for the tables (Quote for RFQ-1042 · title …)
 *   - `action`  the one button label (Review quote, Pay deposit, Pay balance, Upload slip, Add information)
 *   - `odsHref` the same destination on the ODS My account URLs (/account/requests/<RFQ>, /account/settings?tab=verification)
 *   - `dueAt`   a real deadline when the record has one (quote valid_until); null = no date in the data
 */
export type WaitingKind = 'quote' | 'payment' | 'transfer' | 'verification';
export type WaitingActionType = 'pay' | 'approve' | 'review' | 'reply';
export type WaitingService = 'sourcing' | 'wallet' | 'account';
export type WaitingItem = { key: string; kind: WaitingKind; title: string; body: string; href: string; at: string };
/** ODS T6: WaitingItem + the Action needed fields (assignable to WaitingItem, so T4 code is unchanged). */
export type WaitingActionItem = WaitingItem & {
  type: WaitingActionType;
  service: WaitingService;
  ref: string | null;
  what: string;
  action: string;
  odsHref: string;
  dueAt: string | null;
};

export type WaitingRaw = {
  quotes: { rfq_id: string; valid_until: string; rfqs: { code: string; title: string } | null }[];
  orders: { id: string; code: string; title: string | null; status: string; updated_at: string }[];
  transfers: { id: string; amount_cents: number; status: string; reject_reason: string | null; confirmed_at: string | null }[];
  kyc: { status: string; customer_message: string | null; reviewed_at: string | null } | null;
};

const PAY_STATUSES = ['pi_issued', 'deposit_pending', 'balance_pending'];

export function buildWaitingItems(raw: WaitingRaw, nowIso: string, kycFallback = 'Please contact your account manager.'): WaitingActionItem[] {
  const now = new Date(nowIso);
  const items: WaitingActionItem[] = [];
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
      type: 'review',
      service: 'sourcing',
      ref: r.code,
      what: `${r.n === 1 ? 'Quote' : `${r.n} quotes`} for ${r.code} · ${r.title}`,
      action: r.n === 1 ? 'Review quote' : 'Compare quotes',
      odsHref: `/account/requests/${r.code}`,
      dueAt: r.until,
    }),
  );
  for (const o of raw.orders) {
    if (!PAY_STATUSES.includes(o.status)) continue;
    const balance = o.status === 'balance_pending';
    items.push({
      key: `o-${o.id}`,
      kind: 'payment',
      title: balance ? `Balance due · ${o.code}` : `Deposit due · ${o.code}`,
      body: `${o.title ? `${o.title} · ` : ''}It moves on as soon as it is paid.`,
      href: `/account/orders/${o.id}`,
      at: o.updated_at,
      type: 'pay',
      service: 'sourcing',
      ref: o.code,
      what: `${balance ? 'Balance' : 'Deposit'} for order ${o.code}${o.title ? ` · ${o.title}` : ''}`,
      action: balance ? 'Pay balance' : 'Pay deposit',
      odsHref: `/account/orders/${o.id}`,
      dueAt: null,
    });
  }
  const since = Date.parse(nowIso) - 14 * 864e5;
  for (const t of raw.transfers) {
    if (t.status !== 'failed' || !t.reject_reason || !t.confirmed_at || Date.parse(t.confirmed_at) < since) continue;
    const amount = formatMoney(Number(t.amount_cents) / 100);
    items.push({
      key: `t-${t.id}`,
      kind: 'transfer',
      title: `Transfer of ${amount} not confirmed`,
      body: `${t.reject_reason}. Check the slip and send it again.`,
      href: '/account/wallet#slip',
      at: t.confirmed_at,
      type: 'pay',
      service: 'wallet',
      ref: null,
      what: `Bank transfer of ${amount} not confirmed · ${t.reject_reason}`,
      action: 'Upload slip',
      odsHref: '/account/wallet#slip',
      dueAt: null,
    });
  }
  if (raw.kyc?.status === 'more_info') {
    const msg = raw.kyc.customer_message?.trim() || kycFallback;
    items.push({
      key: 'kyc',
      kind: 'verification',
      title: 'Company verification needs more information',
      body: msg,
      href: '/account/kyc',
      at: raw.kyc.reviewed_at ?? nowIso,
      type: 'reply',
      service: 'account',
      ref: null,
      what: `Company verification needs more information · ${msg}`,
      action: 'Add information',
      odsHref: '/account/settings?tab=verification',
      dueAt: null,
    });
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}
