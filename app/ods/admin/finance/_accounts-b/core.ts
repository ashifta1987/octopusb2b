/**
 * ODS T9 batch 3 (Accounts, part B) — pure logic shared by Held payments, Credit terms, Bank transfers, SaaS billing
 * and Wallets (server + client + unit tests). No I/O. Every rule here mirrors today's page or server action; the
 * database keeps enforcing everything (two-person rules, permissions, amounts).
 */

export type Tone = 'success' | 'info' | 'warning' | 'danger' | 'neutral' | 'indigo';
export const human = (s: string | null | undefined) => (s ? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '—');

/** Pill: an Appendix C name (status) or a plain label with a tone. */
export type Pill = { status?: string; label?: string; tone?: Tone; step?: string; attention?: boolean };

/** Sums minor units per currency (KPI tiles; currencies are never added together). */
export function totalsByCurrency<T>(rows: readonly T[], amount: (r: T) => number | null | undefined, currency: (r: T) => string | null | undefined): [string, number][] {
  const m = new Map<string, number>();
  for (const r of rows) {
    const c = (currency(r) ?? 'USD').trim() || 'USD';
    m.set(c, (m.get(c) ?? 0) + Number(amount(r) ?? 0));
  }
  return [...m].sort(([a], [b]) => (a === 'USD' ? -1 : b === 'USD' ? 1 : a.localeCompare(b)));
}
export const currencyPrefix = (c: string | null | undefined) => (({ USD: 'US$', CNY: 'CN¥', HKD: 'HK$' }) as Record<string, string>)[(c ?? 'USD').trim()] ?? (c ?? 'USD');
export function fmtMinor(minor: number, currency = 'USD'): string {
  const v = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(minor) / 100);
  return `${minor < 0 ? '\u2212' : ''}${currencyPrefix(currency)} ${v}`;
}
export const totalsText = (t: [string, number][]) => (t.length ? t.map(([c, m]) => fmtMinor(m, c)).join(' + ') : fmtMinor(0));

/** "1,000.50" → 100050 (2 decimals); null when empty / invalid. Same parsing as today's `dollars()` / toCents. */
export function toMinor(raw: string | null | undefined): number | null {
  const s = String(raw ?? '').replace(/,/g, '').trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/* ───────── Held payments (escrow_holds) ───────── */

export const OPEN_HOLD_STATUSES = ['held', 'partially_released', 'disputed'] as const;
/** Appendix C payment names: held / partly released / disputed = Held (with the step), released = Released, refunded = Refunded. */
export function holdPill(raw: string): Pill {
  if (raw === 'held') return { status: 'Held' };
  if (raw === 'partially_released') return { status: 'Held', step: 'Partly released' };
  if (raw === 'disputed') return { status: 'Held', step: 'Disputed', attention: true };
  if (raw === 'released') return { status: 'Released' };
  if (raw === 'refunded') return { status: 'Refunded' };
  return { label: human(raw), tone: 'neutral' };
}
export type HoldTab = 'open' | 'held' | 'partially_released' | 'disputed' | 'released' | 'refunded' | 'all';
export const HOLD_TABS: readonly [HoldTab, string][] = [
  ['open', 'Open'],
  ['held', 'Held'],
  ['partially_released', 'Partly released'],
  ['disputed', 'Disputed'],
  ['released', 'Released'],
  ['refunded', 'Refunded'],
  ['all', 'All'],
];
export const matchesHoldTab = (raw: string, tab: HoldTab) => (tab === 'all' ? true : tab === 'open' ? (OPEN_HOLD_STATUSES as readonly string[]).includes(raw) : raw === tab);
/** Today's service filter options. */
export const HOLD_SERVICES: readonly [string, string][] = [
  ['sourcing', 'Sourcing'],
  ['brand', 'Make My Brand'],
  ['pools', 'MOQ Pools'],
  ['turnkey', 'Turnkey'],
  ['warehouse', '3PL Warehouse'],
  ['dropship', 'Dropshipping'],
];
export const holdServiceLabel = (s: string) => HOLD_SERVICES.find(([v]) => v === s)?.[1] ?? human(s);
/** remaining = amount − released − refunded (today's sum); actions only while remaining > 0 and the hold is open. */
export function holdRemaining(h: { amount_cents: number; released_cents: number; refunded_cents: number }) {
  return h.amount_cents - h.released_cents - h.refunded_cents;
}
export const holdIsOpen = (h: { status: string; amount_cents: number; released_cents: number; refunded_cents: number }) => holdRemaining(h) > 0 && (OPEN_HOLD_STATUSES as readonly string[]).includes(h.status);
export const HOLD_ACTIONS: readonly [string, string][] = [
  ['release', 'Release in full'],
  ['partial_release', 'Partial release'],
  ['refund', 'Refund to customer'],
];
/** Today's default reason text. */
export const defaultHoldReason = (status: string) => (status === 'disputed' ? 'Dispute resolved & milestone confirmed' : 'Milestone confirmed');
/** Informational only (the database decides): above today's payments.approval_threshold_cents a second Finance approver is needed. */
export const holdNeedsSecond = (amountCents: number, thresholdCents: number) => amountCents > thresholdCents;
/** Today's fallback when the setting is missing or 0. */
export const holdThreshold = (raw: unknown) => Number(raw ?? 100000) || 100000;

/* ───────── Credit terms (customer_credit_terms) ───────── */

export const NET_DAYS = [7, 15, 30, 45, 60] as const;
export function creditPill(raw: string): Pill {
  if (raw === 'pending_approval') return { status: 'Waiting', step: 'Second approver needed' };
  if (raw === 'active') return { label: 'Active', tone: 'success' };
  if (raw === 'rejected') return { status: 'Rejected' };
  return { label: human(raw), tone: 'neutral' };
}
export type CreditTab = 'all' | 'waiting' | 'active' | 'other';
export const CREDIT_TABS: readonly [CreditTab, string][] = [
  ['all', 'All'],
  ['waiting', 'Waiting for approval'],
  ['active', 'Active'],
  ['other', 'Other'],
];
export const matchesCreditTab = (raw: string, tab: CreditTab) => tab === 'all' || (tab === 'waiting' ? raw === 'pending_approval' : tab === 'active' ? raw === 'active' : raw !== 'pending_approval' && raw !== 'active');
/** Today's available = max(0, limit − unpaid invoices − reserved orders). */
export const creditAvailable = (t: { credit_limit_cents: number; unpaid_invoices_cents: number; reserved_cents: number }) => Math.max(0, t.credit_limit_cents - t.unpaid_invoices_cents - t.reserved_cents);
/** Today's usage sums for one credit line (division-scoped when the line has a division). */
export function creditUsage(orgId: string, divisionId: string | null, unpaid: readonly { org_id: string; division_id: string | null; amount_cents: number | null; paid_cents: number | null }[], reservations: readonly { org_id: string; division_id: string | null; amount_cents: number | null }[]) {
  const inScope = (r: { org_id: string; division_id: string | null }) => r.org_id === orgId && (!divisionId || r.division_id === divisionId);
  return {
    unpaid: unpaid.filter(inScope).reduce((a, d) => a + Math.max(0, Number(d.amount_cents ?? 0) - Number(d.paid_cents ?? 0)), 0),
    reserved: reservations.filter(inScope).reduce((a, r) => a + Number(r.amount_cents ?? 0), 0),
  };
}

/* ───────── Bank transfers (wallet_topups, method bank_transfer) ───────── */

export const TRANSFER_TABS: readonly ['pending' | 'decided', string][] = [
  ['pending', 'To confirm'],
  ['decided', 'Recently decided'],
];
/** credited = Paid, failed (rejected) = Failed, pending = Pending (Appendix C payments). */
export function topupPill(raw: string): Pill {
  if (raw === 'pending') return { status: 'Pending' };
  if (raw === 'credited') return { status: 'Paid' };
  if (raw === 'failed') return { status: 'Failed' };
  return { label: human(raw), tone: 'neutral' };
}
/** Today's confirmTransfer checks, run before the two-person gate (today's action checks again). */
export function validateTransferConfirm(input: { received: string; bankRef: string; reason: string; reasonText: string }, claimedCents: number, reasons: readonly string[], otherMax: number): string | null {
  const received = toMinor(input.received);
  if (received == null || received <= 0) return 'Enter the amount that actually arrived, in US dollars.';
  if (!input.bankRef.trim()) return 'Enter the bank reference from the statement.';
  if (received !== claimedCents) {
    if (!reasons.includes(input.reason)) return 'The amount received differs from the claim: choose the reason shown to the customer.';
    if (input.reason === 'other' && !input.reasonText.trim()) return 'For "Other", type the short text the customer sees.';
    if (input.reason === 'other' && input.reasonText.trim().length > otherMax) return `Keep the text for the customer to ${otherMax} characters.`;
  }
  return null;
}
/** Today's recordProformaTransfer checks (number PF-/PI-, reference, amount > 0). */
export function validateProformaTransfer(input: { number: string; amount: string; bankRef: string }): string | null {
  if (!/^(PF|PI)-[\w-]+$/.test(input.number.trim().toUpperCase())) return 'Enter the proforma number, e.g. PF-2026-000012.';
  if (!input.bankRef.trim()) return 'Enter the bank statement reference.';
  const a = Math.round(Number(input.amount.replace(/,/g, '')) * 100);
  if (!(a > 0)) return 'Enter the amount that arrived.';
  return null;
}

/* ───────── Two-person gate refs (T8-DATA staff_approvals) ───────── */
/** Money IN to a wallet (bank transfer confirm, top-up match): kind 'payment', ref ('wallet_topup', topup id). */
export const TOPUP_REF = 'wallet_topup';
/** Service proforma paid by transfer: same ref as the Invoices drawer ('document', document id) so one approval covers both. */
export const PROFORMA_REF = 'document';

/* ───────── SaaS billing ───────── */

export const PLAN_STATUS_LABEL: Record<string, string> = { free: 'Free (billing off)', none: 'Not started', trial: 'Free trial', active: 'Paying', grace: 'Grace', paused: 'Pushes paused', free_forever: 'Free forever', cancelled: 'Closed' };
export const SAAS_ACTION_LABEL: Record<string, string> = {
  'saas_billing.proposed': 'Proposed', 'saas_billing.approved': 'Approved', 'saas_billing.rejected': 'Rejected', 'saas_billing.withdrawn': 'Withdrawn',
  'saas_billing.override_set': 'Override set', 'saas_billing.override_removed': 'Override removed', 'saas_billing.started_on_date': 'Started on the date',
  'ds_plan.proposed': 'Plan proposed', 'ds_plan.approved': 'Plan approved', 'ds_plan.rejected': 'Plan rejected',
};
export const SAAS_TABS: readonly ['overview' | 'merchants' | 'plans' | 'history', string][] = [
  ['overview', 'Plan fees'],
  ['merchants', 'Merchants'],
  ['plans', 'Plans'],
  ['history', 'History'],
];
export function saasStatusLine(s: { enabled: boolean; enabled_at: string | null; scheduled_start: string | null; approved_at: string | null }, fmt: (d: string | null) => string): string {
  return s.enabled ? `On since ${fmt(s.enabled_at)}` : s.scheduled_start ? `Off · starts on ${fmt(s.scheduled_start)}` : s.approved_at ? `Off since ${fmt(s.approved_at)}` : 'Off since launch';
}
/** Today's rules: decide needs can_decide and not the proposer; reject needs a note (3+). */
export function saasDecision(canDecide: boolean, iProposed: boolean, note: string) {
  const blocked = !canDecide ? 'Only company-wide Finance approvers and admins can change plan fees.' : iProposed ? 'You proposed this change; a second person must approve.' : null;
  return { approve: blocked, reject: blocked ?? (note.trim().length < 3 ? 'Write a note first.' : null) };
}
export const overrideText = (m: { override: string | null; extra_trial_days: number | null }) => (m.override === 'free_forever' ? 'Free forever' : m.override === 'extra_trial' ? `Trial +${m.extra_trial_days} days` : 'Default');

/* ───────── Wallets ───────── */

export type WalletPerms = { isAdmin: boolean; canApproveTopups: boolean; canSeeRevenue: boolean };
/** Today's checks on Admin › Wallets: admin switches the wallet / edits credit and settings; wallet:approve confirms top-ups; revenue with finance:view or dashboard:view. */
export function walletPerms(s: { isAdmin: boolean; can: (area: string, action: string) => boolean }): WalletPerms {
  return { isAdmin: s.isAdmin, canApproveTopups: s.can('wallet', 'approve'), canSeeRevenue: s.can('finance', 'view') || s.can('dashboard', 'view') };
}
export const WALLET_TABS: readonly ['wallets' | 'credit' | 'topups' | 'prices' | 'settings', string][] = [
  ['wallets', 'Customer wallets'],
  ['credit', 'Credit facility'],
  ['topups', 'Top-ups'],
  ['prices', 'Service price list'],
  ['settings', 'Platform settings'],
];
export const PLATFORM_SETTINGS: { key: string; label: string; hint: string }[] = [
  { key: 'finance_approval_limit_cents', label: 'Finance approval limit (cents)', hint: 'In USD cents. Approvals above this (converted to USD) need an Admin (e.g. 100000 = US$ 1,000.00)' },
  { key: 'deposit_pct', label: 'Deposit % on proforma invoices', hint: 'Applied to new proforma invoices' },
  { key: 'quote_validity_days', label: 'Quote validity (days)', hint: 'New quotes only' },
  { key: 'claim_visible_days', label: 'Claim window — visible defects (days)', hint: 'From delivery' },
  { key: 'claim_hidden_days', label: 'Claim window — hidden defects (days)', hint: 'From delivery' },
];
/** Today's credit source text. */
export function creditSource(r: { override_minor: number | null; override_currency: string | null; currency: string; note: string | null; kyc_status: string }, verifiedOnly: boolean): string {
  if (r.override_minor != null) {
    return `Own limit ${fmtMinor(Number(r.override_minor), r.override_currency ?? r.currency)}${r.override_currency && r.override_currency !== r.currency ? ' (other currency — not applied)' : ''}${r.note ? ` · ${r.note}` : ''}`;
  }
  return `Default${verifiedOnly && r.kyc_status !== 'verified' ? ' · not verified → no credit' : ''}`;
}
/** Today's price-list rule: own currency price, else the USD price converted (flagged). */
export function priceFor(code: string, cur: string, current: ReadonlyMap<string, number>, convert: (usdMinor: number) => number | null): { amount: number; converted: boolean } | null {
  const own = current.get(`${code}|${cur}`);
  if (own != null) return { amount: own, converted: false };
  const usdP = current.get(`${code}|USD`);
  if (usdP == null) return null;
  return { amount: convert(usdP) ?? usdP, converted: cur !== 'USD' };
}
/** Today's current / scheduled split of service_prices (rows newest first). */
export function splitPrices(rows: readonly { service_code: string; amount_minor: number; currency: string; effective_from: string }[], nowIso: string) {
  const current = new Map<string, number>();
  const scheduled = new Map<string, { amount: number; from: string }>();
  for (const p of rows) {
    const k = `${p.service_code}|${p.currency}`;
    if (p.effective_from <= nowIso) {
      if (!current.has(k)) current.set(k, Number(p.amount_minor));
    } else scheduled.set(k, { amount: Number(p.amount_minor), from: p.effective_from });
  }
  return { current, scheduled };
}
