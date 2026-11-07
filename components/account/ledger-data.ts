import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { asCurrency, CURRENCIES, type Currency } from '@/lib/format';

/**
 * Customer ledger (RLS: own org only). Every account keeps its OWN running balance, opening and closing balance, per
 * currency (SPEC §15.1 — currencies are never added together):
 *   receivable "Orders"  = invoices issued − payments (debit − credit)
 *   wallet     "Wallet"  = top-ups + refunds − holds/charges (credit − debit)
 *   hold       "Customer funds on hold" = money held for work in progress (credit − debit)
 * The page, the CSV and the printable statement all build their rows with ledgerGroups(), so they always match.
 */
export type LedgerKind = 'receivable' | 'wallet' | 'hold' | 'other';
export const KIND_ORDER: LedgerKind[] = ['receivable', 'wallet', 'hold', 'other'];
export const KIND_LABEL: Record<LedgerKind, string> = { receivable: 'Orders', wallet: 'Wallet', hold: 'Customer funds on hold', other: 'Other' };
export const CLOSING_LABEL: Record<LedgerKind, string> = { receivable: 'Orders due', wallet: 'Wallet available', hold: 'On hold', other: 'Other' };

export type LedgerRow = {
  id: number; at: string; account: LedgerKind; accountName: string; journal: string; memo: string; refType: string | null;
  currency: Currency;
  debit: number; credit: number; balance: number; // running balance of THIS account, in `currency`
};
export type KindBalances = Record<LedgerKind, number>;
const zero = (): KindBalances => ({ receivable: 0, wallet: 0, hold: 0, other: 0 });
type Sums = { debit: number; credit: number };

export function kindOf(code: string): LedgerKind {
  if (code.startsWith('wallet:')) return 'wallet';
  if (code.startsWith('ar:')) return 'receivable';
  if (code.startsWith('hold:')) return 'hold';
  return 'other';
}

/** Balances of one currency (zeros when the org has no account in it). */
export function balOf(map: Partial<Record<Currency, KindBalances>>, cur: Currency): KindBalances {
  return map[cur] ?? zero();
}

export async function getOrgLedger(orgId: string, opts: { from?: string; to?: string; account?: LedgerKind | 'all'; currency?: Currency | 'all' } = {}) {
  const sb = await createClient();
  const { data } = await sb
    .from('ledger_entries')
    .select('id, debit_cents, credit_cents, currency, memo, created_at, ledger_accounts(code, name, currency), journals(number, memo, ref_type, created_at)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(5000);
  const fromTs = opts.from ? new Date(opts.from + 'T00:00:00Z').getTime() : -Infinity;
  const toTs = opts.to ? new Date(opts.to + 'T23:59:59.999Z').getTime() : Infinity;
  const running: Partial<Record<Currency, KindBalances>> = {};
  const opening: Partial<Record<Currency, KindBalances>> = {};
  const closing: Partial<Record<Currency, KindBalances>> = {};
  const totals: Partial<Record<Currency, Sums>> = {};
  const kindTotals: Partial<Record<Currency, Record<LedgerKind, Sums>>> = {};
  const kinds: Partial<Record<Currency, Set<LedgerKind>>> = {};
  const seen = new Set<Currency>();
  const any = new Set<Currency>(); // every currency this company has entries in (drives the currency filter options)
  const rows: LedgerRow[] = [];
  for (const e of data ?? []) {
    const acct = e.ledger_accounts as unknown as { code: string; name: string; currency: string | null } | null;
    const j = e.journals as unknown as { number: string; memo: string; ref_type: string | null } | null;
    const kind = kindOf(acct?.code ?? '');
    const cur = asCurrency((e.currency as string | null) ?? acct?.currency);
    any.add(cur);
    if (opts.currency && opts.currency !== 'all' && opts.currency !== cur) continue;
    if (opts.account && opts.account !== 'all' && opts.account !== kind) continue;
    seen.add(cur);
    (kinds[cur] ??= new Set()).add(kind);
    const run = (running[cur] ??= zero());
    const debit = Number(e.debit_cents), credit = Number(e.credit_cents);
    run[kind] += kind === 'receivable' ? debit - credit : credit - debit;
    const ts = new Date(e.created_at as string).getTime();
    opening[cur] ??= zero();
    closing[cur] ??= zero();
    if (ts > toTs) continue;
    closing[cur]![kind] = run[kind];
    if (ts < fromTs) { opening[cur]![kind] = run[kind]; continue; }
    const t = (totals[cur] ??= { debit: 0, credit: 0 });
    t.debit += debit; t.credit += credit;
    const kt = ((kindTotals[cur] ??= { receivable: { debit: 0, credit: 0 }, wallet: { debit: 0, credit: 0 }, hold: { debit: 0, credit: 0 }, other: { debit: 0, credit: 0 } })[kind]);
    kt.debit += debit; kt.credit += credit;
    rows.push({
      id: Number(e.id), at: e.created_at as string, account: kind, accountName: acct?.name ?? '—', journal: j?.number ?? '—',
      memo: (e.memo as string | null) ?? j?.memo ?? '', refType: j?.ref_type ?? null, currency: cur, debit, credit, balance: run[kind],
    });
  }
  const currencies = CURRENCIES.filter((c) => seen.has(c));
  const available = CURRENCIES.filter((c) => any.has(c));
  return { rows, currencies, available, opening, closing, totals, kindTotals, kinds };
}

export type Ledger = Awaited<ReturnType<typeof getOrgLedger>>;
export type LedgerGroup = { kind: LedgerKind; label: string; opening: number; closing: number; rows: LedgerRow[]; totals: Sums };

/** The account groups of one currency, in a fixed order (Orders, Wallet, On hold), each with its own balances. */
export function ledgerGroups(l: Ledger, cur: Currency): LedgerGroup[] {
  const present = l.kinds[cur] ?? new Set<LedgerKind>();
  return KIND_ORDER.filter((k) => present.has(k)).map((kind) => ({
    kind, label: KIND_LABEL[kind],
    opening: balOf(l.opening, cur)[kind], closing: balOf(l.closing, cur)[kind],
    rows: l.rows.filter((r) => r.currency === cur && r.account === kind),
    totals: l.kindTotals[cur]?.[kind] ?? { debit: 0, credit: 0 },
  }));
}

export const DEFAULT_PERIOD_DAYS = 90;

/**
 * Ledger filters shared by the page, the CSV and the printable statement, so all three always show the same rows.
 * No dates given → the last 90 days (both dates filled in).
 */
export function parseRange(sp: { from?: string; to?: string; account?: string; currency?: string }) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const today = new Date();
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const to = sp.to && iso.test(sp.to) ? sp.to : day(today);
  const from = sp.from && iso.test(sp.from) ? sp.from : day(new Date(Date.parse(to + 'T00:00:00Z') - (DEFAULT_PERIOD_DAYS - 1) * 864e5));
  return {
    from: from <= to ? from : to,
    to,
    account: (['wallet', 'receivable', 'hold', 'all'].includes(sp.account ?? '') ? sp.account : 'all') as LedgerKind | 'all',
    currency: ((CURRENCIES as string[]).includes(sp.currency ?? '') ? sp.currency : 'all') as Currency | 'all',
  };
}
