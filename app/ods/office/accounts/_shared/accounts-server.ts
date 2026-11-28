import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { seedIds } from '@/components/backoffice/hidden-columns';
import { accountLabel, safeSearch, type JournalView } from './accounts-core';

/**
 * ODS T9 · Accounts part C — server reads shared by Credit notes / Ledger / Payments. Session client only (RLS:
 * finance:view + in_division, as on today's Admin › Finance). Read-only.
 */
export type Sb = Awaited<ReturnType<typeof createClient>>;

/** One filter step on a PostgREST builder. */
export type Step =
  | { op: 'eq' | 'neq' | 'gte' | 'lt' | 'lte' | 'gt'; col: string; val: string | number }
  | { op: 'in'; col: string; vals: readonly (string | number)[] }
  | { op: 'notIn'; col: string; vals: readonly (string | number)[] }
  | { op: 'or'; expr: string }
  | { op: 'ilike'; col: string; val: string };

type Filterable = {
  eq(c: string, v: unknown): Filterable; neq(c: string, v: unknown): Filterable; gte(c: string, v: unknown): Filterable; gt(c: string, v: unknown): Filterable;
  lt(c: string, v: unknown): Filterable; lte(c: string, v: unknown): Filterable; in(c: string, v: readonly unknown[]): Filterable;
  not(c: string, op: string, v: unknown): Filterable; or(expr: string): Filterable; ilike(c: string, v: string): Filterable;
};

/** No generic constraint on purpose (checking the Postgrest builder against Filterable is TS2589). */
export function applySteps<T>(q: T, steps: Step[]): T {
  let r = q as unknown as Filterable;
  for (const s of steps) {
    if (s.op === 'or') r = r.or(s.expr);
    else if (s.op === 'in') r = r.in(s.col, s.vals);
    else if (s.op === 'notIn') r = r.not(s.col, 'in', `(${s.vals.join(',')})`);
    else if (s.op === 'ilike') r = r.ilike(s.col, s.val);
    else r = r[s.op](s.col, s.val);
  }
  return r as unknown as T;
}

/** Customer ids whose name contains the text (max 100). */
export async function orgIdsByName(sb: Sb, text: string): Promise<string[]> {
  const t = safeSearch(text);
  if (!t) return [];
  const { data } = await sb.from('organizations').select('id').ilike('name', `%${t}%`).limit(100);
  return (data ?? []).map((o) => o.id as string);
}

export async function orgNames(sb: Sb, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const u = [...new Set(ids.filter((x): x is string => !!x))];
  if (!u.length) return new Map();
  const { data } = await sb.from('organizations').select('id, name').in('id', u);
  return new Map((data ?? []).map((o) => [o.id as string, (o.name as string) ?? 'Customer']));
}

export async function profileNames(sb: Sb, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const u = [...new Set(ids.filter((x): x is string => !!x))];
  if (!u.length) return new Map();
  try {
    const { data } = await sb.from('profiles').select('id, full_name').in('id', u);
    return new Map((data ?? []).map((p) => [p.id as string, (p.full_name as string | null) ?? '']));
  } catch {
    return new Map();
  }
}

/**
 * Test (seed) rows stay hidden as on today's Finance page (seedIds via the service role after the page guard, migration
 * 195). Up to 1,000 ids are excluded in the query itself so counts and pages stay right; more → dropped from the page
 * (the note says so).
 */
export async function seedExclusion(table: 'payments' | 'ledger_entries' | 'journals'): Promise<{ step: Step | null; drop: Set<string>; note?: string }> {
  try {
    const ids = await seedIds(table);
    if (!ids.size) return { step: null, drop: ids };
    if (ids.size <= 1000) return { step: { op: 'notIn', col: 'id', vals: [...ids] }, drop: ids };
    return { step: null, drop: ids, note: 'Test rows are hidden; page counts may include them.' };
  } catch {
    return { step: null, drop: new Set() };
  }
}

type LineRow = { id: number; debit_cents: number; credit_cents: number; currency: string | null; memo: string | null; org_id: string | null; ledger_accounts: { code?: string; name?: string } | null };

/** A journal with all its lines (Ledger drawer, Payments drawer). */
export async function loadJournal(sb: Sb, by: { journalId: string } | { refType: string; refId: string }): Promise<JournalView | null> {
  let jq = sb.from('journals').select('id, number, memo, stream, ref_type, ref_id, created_at');
  jq = 'journalId' in by ? jq.eq('id', by.journalId) : jq.eq('ref_type', by.refType).eq('ref_id', by.refId);
  const { data: j } = await jq.order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!j) return null;
  const { data: lines } = await sb.from('ledger_entries').select('id, debit_cents, credit_cents, currency, memo, org_id, ledger_accounts(code, name)').eq('journal_id', j.id as string).order('id');
  const ls = (lines ?? []) as unknown as LineRow[];
  const names = await orgNames(sb, ls.map((l) => l.org_id));
  return {
    id: j.id as string,
    number: j.number as string,
    at: j.created_at as string,
    memo: (j.memo as string) ?? '',
    stream: (j.stream as string | null) ?? null,
    refType: (j.ref_type as string | null) ?? null,
    refId: (j.ref_id as string | null) ?? null,
    lines: ls.map((l) => ({
      id: String(l.id),
      account: accountLabel(l.ledger_accounts?.code ?? '—', l.ledger_accounts?.name, l.org_id ? names.get(l.org_id) : null),
      customer: l.org_id ? (names.get(l.org_id) ?? null) : null,
      debitMinor: Number(l.debit_cents ?? 0),
      creditMinor: Number(l.credit_cents ?? 0),
      currency: (l.currency ?? 'USD').trim(),
      memo: l.memo,
    })),
  };
}
