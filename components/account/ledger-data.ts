import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { asCurrency, CURRENCIES, type Currency } from '@/lib/format';

export type LedgerKind = 'wallet' | 'receivable' | 'other';
export type LedgerRow = {
  id: number; at: string; account: LedgerKind; accountName: string; journal: string; memo: string; refType: string | null;
  currency: Currency;
  debit: number; credit: number; balance: number; // running balance of that account (wallet: credit−debit, receivable: debit−credit), in `currency`
};
export type KindBalances = Record<LedgerKind, number>;
const zero = (): KindBalances => ({ wallet: 0, receivable: 0, other: 0 });

export function kindOf(code: string): LedgerKind {
  if (code.startsWith('wallet:')) return 'wallet';
  if (code.startsWith('ar:')) return 'receivable';
  return 'other';
}

/** Balances of one currency (zeros when the org has no account in it). */
export function balOf(map: Partial<Record<Currency, KindBalances>>, cur: Currency): KindBalances {
  return map[cur] ?? zero();
}

/**
 * All ledger entries for the customer's org (RLS: own org only) with running balances per account.
 * Accounts are per currency (SPEC §15.1: wallet:<org> = USD, wallet:<org>:CNY …), so running balances, opening/closing
 * balances and totals are all kept PER CURRENCY — amounts in different currencies are never added together.
 * `from`/`to` (YYYY-MM-DD) filter the returned rows; opening balances are computed from earlier entries.
 */
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
  const totals: Partial<Record<Currency, { debit: number; credit: number }>> = {};
  const seen = new Set<Currency>();
  const rows: LedgerRow[] = [];
  for (const e of data ?? []) {
    const acct = e.ledger_accounts as unknown as { code: string; name: string; currency: string | null } | null;
    const j = e.journals as unknown as { number: string; memo: string; ref_type: string | null } | null;
    const kind = kindOf(acct?.code ?? '');
    const cur = asCurrency((e.currency as string | null) ?? acct?.currency);
    if (opts.currency && opts.currency !== 'all' && opts.currency !== cur) continue;
    seen.add(cur);
    const run = (running[cur] ??= zero());
    const debit = Number(e.debit_cents), credit = Number(e.credit_cents);
    run[kind] += kind === 'receivable' ? debit - credit : credit - debit;
    const ts = new Date(e.created_at as string).getTime();
    opening[cur] ??= zero();
    closing[cur] ??= zero();
    if (ts > toTs) continue;
    closing[cur]![kind] = run[kind];
    if (ts < fromTs) { opening[cur]![kind] = run[kind]; continue; }
    if (opts.account && opts.account !== 'all' && opts.account !== kind) continue;
    const t = (totals[cur] ??= { debit: 0, credit: 0 });
    t.debit += debit; t.credit += credit;
    rows.push({
      id: Number(e.id), at: e.created_at as string, account: kind, accountName: acct?.name ?? '—', journal: j?.number ?? '—',
      memo: (e.memo as string | null) ?? j?.memo ?? '', refType: j?.ref_type ?? null, currency: cur, debit, credit, balance: run[kind],
    });
  }
  const currencies = CURRENCIES.filter((c) => seen.has(c));
  return { rows, currencies, opening, closing, totals };
}

export function parseRange(sp: { from?: string; to?: string; account?: string; currency?: string }) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  return {
    from: sp.from && iso.test(sp.from) ? sp.from : undefined,
    to: sp.to && iso.test(sp.to) ? sp.to : undefined,
    account: (['wallet', 'receivable', 'all'].includes(sp.account ?? '') ? sp.account : 'all') as LedgerKind | 'all',
    currency: ((CURRENCIES as string[]).includes(sp.currency ?? '') ? sp.currency : 'all') as Currency | 'all',
  };
}
