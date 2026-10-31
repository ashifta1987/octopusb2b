import 'server-only';
import { createClient } from '@/lib/supabase/server';

export type LedgerKind = 'wallet' | 'receivable' | 'other';
export type LedgerRow = {
  id: number; at: string; account: LedgerKind; accountName: string; journal: string; memo: string; refType: string | null;
  debit: number; credit: number; balance: number; // running balance of that account (wallet: credit−debit, receivable: debit−credit)
};

export function kindOf(code: string): LedgerKind {
  if (code.startsWith('wallet:')) return 'wallet';
  if (code.startsWith('ar:')) return 'receivable';
  return 'other';
}

/**
 * All ledger entries for the customer's org (RLS: own org only) with running balances per account.
 * `from`/`to` (YYYY-MM-DD) filter the returned rows; opening balances are computed from earlier entries.
 */
export async function getOrgLedger(orgId: string, opts: { from?: string; to?: string; account?: LedgerKind | 'all' } = {}) {
  const sb = await createClient();
  const { data } = await sb
    .from('ledger_entries')
    .select('id, debit_cents, credit_cents, memo, created_at, ledger_accounts(code, name), journals(number, memo, ref_type, created_at)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(5000);
  const fromTs = opts.from ? new Date(opts.from + 'T00:00:00Z').getTime() : -Infinity;
  const toTs = opts.to ? new Date(opts.to + 'T23:59:59.999Z').getTime() : Infinity;
  const running: Record<LedgerKind, number> = { wallet: 0, receivable: 0, other: 0 };
  const opening: Record<LedgerKind, number> = { wallet: 0, receivable: 0, other: 0 };
  const closing: Record<LedgerKind, number> = { wallet: 0, receivable: 0, other: 0 };
  const rows: LedgerRow[] = [];
  for (const e of data ?? []) {
    const acct = e.ledger_accounts as unknown as { code: string; name: string } | null;
    const j = e.journals as unknown as { number: string; memo: string; ref_type: string | null } | null;
    const kind = kindOf(acct?.code ?? '');
    const debit = Number(e.debit_cents), credit = Number(e.credit_cents);
    running[kind] += kind === 'receivable' ? debit - credit : credit - debit;
    const ts = new Date(e.created_at as string).getTime();
    if (ts > toTs) continue;
    closing[kind] = running[kind];
    if (ts < fromTs) { opening[kind] = running[kind]; continue; }
    if (opts.account && opts.account !== 'all' && opts.account !== kind) continue;
    rows.push({
      id: Number(e.id), at: e.created_at as string, account: kind, accountName: acct?.name ?? '—', journal: j?.number ?? '—',
      memo: (e.memo as string | null) ?? j?.memo ?? '', refType: j?.ref_type ?? null, debit, credit, balance: running[kind],
    });
  }
  return { rows, opening, closing, totals: { debit: rows.reduce((a, r) => a + r.debit, 0), credit: rows.reduce((a, r) => a + r.credit, 0) } };
}

export function parseRange(sp: { from?: string; to?: string; account?: string }) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  return {
    from: sp.from && iso.test(sp.from) ? sp.from : undefined,
    to: sp.to && iso.test(sp.to) ? sp.to : undefined,
    account: (['wallet', 'receivable', 'all'].includes(sp.account ?? '') ? sp.account : 'all') as LedgerKind | 'all',
  };
}
