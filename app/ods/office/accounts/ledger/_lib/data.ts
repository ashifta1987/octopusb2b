import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { applySteps, orgIdsByName, orgNames, seedExclusion, type Sb, type Step } from '../../_shared/accounts-server';
import { LEDGER_SPEC, accountLabel, dateBounds, runningBalances, safeSearch, type LedgerRow, type ListQuery, type ListResult } from '../../_shared/accounts-core';

/**
 * Ledger — today's double-entry ledger, read-only: ledger_entries + ledger_accounts + journals (RLS le_read / la_read /
 * j_read: finance:view within the division). Test (seed) entries hidden as on today's Finance page. Running balance per
 * account when one account is chosen (from the account's first entry, sorted by date).
 */
const COLS: string = 'id, journal_id, account_id, org_id, debit_cents, credit_cents, currency, memo, created_at, ledger_accounts!inner(code, name, kind, org_id), journals!inner(number, memo, ref_type, ref_id)';
const BALANCE_LIMIT = 20000;

type EntryRow = {
  id: number; journal_id: string; account_id: string; org_id: string | null; debit_cents: number; credit_cents: number; currency: string | null; memo: string | null; created_at: string;
  ledger_accounts: { code?: string; name?: string; kind?: string; org_id?: string | null } | null;
  journals: { number?: string; memo?: string; ref_type?: string | null; ref_id?: string | null } | null;
};

export type LedgerAccountOption = { id: string; label: string; kind: string };

function toRow(e: EntryRow, names: Map<string, string>, balances: Map<string, number> | null): LedgerRow {
  const acc = e.ledger_accounts ?? {};
  const accOrg = acc.org_id ? names.get(acc.org_id) : null;
  return {
    id: String(e.id),
    at: e.created_at,
    journalId: e.journal_id,
    journalNumber: e.journals?.number ?? '—',
    accountId: e.account_id,
    accountCode: acc.code ?? '—',
    accountLabel: accountLabel(acc.code ?? '—', acc.name, accOrg),
    accountKind: acc.kind ?? '',
    customer: e.org_id ? (names.get(e.org_id) ?? null) : null,
    memo: e.memo || e.journals?.memo || '',
    debitMinor: Number(e.debit_cents ?? 0),
    creditMinor: Number(e.credit_cents ?? 0),
    currency: (e.currency ?? 'USD').trim() || 'USD',
    balanceMinor: balances ? (balances.get(String(e.id)) ?? null) : null,
    refType: e.journals?.ref_type ?? null,
    refId: e.journals?.ref_id ?? null,
  };
}

async function shared(sb: Sb, q: ListQuery, seed: Step | null): Promise<{ steps: Step[]; empty: boolean }> {
  const steps: Step[] = seed ? [seed] : [];
  if (q.f.account) steps.push({ op: 'eq', col: 'account_id', val: q.f.account });
  if (q.f.customer) {
    const ids = await orgIdsByName(sb, q.f.customer);
    if (!ids.length) return { steps, empty: true };
    steps.push({ op: 'in', col: 'org_id', vals: ids });
  }
  const b = dateBounds(q.f.from, q.f.to);
  if (b.gte) steps.push({ op: 'gte', col: 'created_at', val: b.gte });
  if (b.lt) steps.push({ op: 'lt', col: 'created_at', val: b.lt });
  const t = safeSearch(q.q);
  if (t) {
    const { data: js } = await sb.from('journals').select('id').ilike('number', `%${t}%`).limit(200);
    const ids = (js ?? []).map((j) => j.id as string);
    steps.push({ op: 'or', expr: [`memo.ilike.*${t}*`, ...(ids.length ? [`journal_id.in.(${ids.join(',')})`] : [])].join(',') });
  }
  return { steps, empty: false };
}

/** Account balance after each line of ONE account (null when the account has more lines than we read). */
async function accountBalances(sb: Sb, accountId: string, seed: Step | null): Promise<{ map: Map<string, number> | null; kind: string | null }> {
  const { data: acc } = await sb.from('ledger_accounts').select('kind').eq('id', accountId).maybeSingle();
  if (!acc) return { map: null, kind: null };
  const { data, error } = await applySteps(sb.from('ledger_entries').select('id, debit_cents, credit_cents').eq('account_id', accountId), seed ? [seed] : [])
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(BALANCE_LIMIT + 1);
  if (error || !data || data.length > BALANCE_LIMIT) return { map: null, kind: acc.kind as string };
  return { map: runningBalances(acc.kind as string, data.map((d) => ({ id: d.id as number, debit: Number(d.debit_cents ?? 0), credit: Number(d.credit_cents ?? 0) }))), kind: acc.kind as string };
}

export async function loadLedger(q: ListQuery, nowMs: number): Promise<ListResult<LedgerRow>> {
  const sb = await createClient();
  const updatedAt = new Date(nowMs).toISOString();
  const seeds = await seedExclusion('ledger_entries');
  const f = await shared(sb, q, seeds.step);
  const tabs = LEDGER_SPEC.tabs;
  if (f.empty) return { kind: 'ok', rows: [], total: 0, counts: Object.fromEntries(tabs.map((t) => [t, 0])), updatedAt };
  const base = (cols: string, tab: string, head = false) => {
    let b = applySteps(sb.from('ledger_entries').select(cols, { count: 'exact', head }), f.steps);
    if (tab !== 'all') b = b.eq('ledger_accounts.kind', tab);
    return b;
  };
  const from = q.page * q.size;
  const col = LEDGER_SPEC.sortable[q.sort.id] ?? 'created_at';
  const [list, bal, ...counts] = await Promise.all([
    base(COLS, q.tab).order(col, { ascending: !q.sort.desc }).order('id', { ascending: !q.sort.desc }).range(from, from + q.size - 1),
    q.f.account ? accountBalances(sb, q.f.account, seeds.step) : Promise.resolve({ map: null, kind: null }),
    ...tabs.map((t) => base('id, ledger_accounts!inner(kind)', t, true)),
  ]);
  if (list.error) return { kind: 'error', error: 'We couldn’t load the ledger.' };
  const entries = ((list.data ?? []) as unknown as EntryRow[]).filter((e) => !seeds.drop.has(String(e.id)));
  const names = await orgNames(sb, entries.flatMap((e) => [e.org_id, e.ledger_accounts?.org_id ?? null]));
  const note = q.f.account && !bal.map ? 'This account has too many lines to show a running balance here.' : seeds.note;
  return {
    kind: 'ok',
    rows: entries.map((e) => toRow(e, names, bal.map)),
    total: list.count ?? entries.length,
    counts: Object.fromEntries(tabs.flatMap((t, i) => (counts[i].error ? [] : [[t, counts[i].count ?? 0]]))),
    updatedAt,
    note,
  };
}

/** Account filter options (non-customer accounts first, then customer accounts with the customer's name). */
export async function loadLedgerAccounts(): Promise<LedgerAccountOption[]> {
  const sb = await createClient();
  const { data } = await sb.from('ledger_accounts').select('id, code, name, kind, org_id').order('code').limit(500);
  const rows = data ?? [];
  const names = await orgNames(sb, rows.map((r) => r.org_id as string | null));
  return rows
    .map((r) => ({ id: r.id as string, label: accountLabel(r.code as string, r.name as string, r.org_id ? names.get(r.org_id as string) : null), kind: r.kind as string, org: !!r.org_id }))
    .sort((a, b) => Number(a.org) - Number(b.org) || a.label.localeCompare(b.label))
    .map(({ id, label, kind }) => ({ id, label, kind }));
}

/** ?open=<entry id> not on this page, or ?open=j-<journal id> (links from Credit notes / Payments). */
export async function loadLedgerOpen(open: string): Promise<LedgerRow | null> {
  const sb = await createClient();
  const journal = open.startsWith('j-') ? open.slice(2) : null;
  if (journal && !/^[0-9a-f-]{36}$/i.test(journal)) return null;
  if (!journal && !/^\d{1,18}$/.test(open)) return null;
  let qb = sb.from('ledger_entries').select(COLS);
  qb = journal ? qb.eq('journal_id', journal) : qb.eq('id', open);
  const { data } = await qb.order('id').limit(1).maybeSingle();
  if (!data) return null;
  const e = data as unknown as EntryRow;
  const row = toRow(e, await orgNames(sb, [e.org_id, e.ledger_accounts?.org_id ?? null]), null);
  return journal ? { ...row, id: open } : row;
}
