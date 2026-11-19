import 'server-only';
import { createAdminClient, type createClient } from '@/lib/supabase/server';

type SessionClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Staff/supplier/distributor screens: read customer-hidden columns (migration 195, scripts/hidden-columns.mjs) with the
 * service role — ONLY for row ids the caller's own session client already returned, and ONLY after the caller's
 * permission check. Row scoping (RLS, divisions, distributor assignment) stays with the session read; this only adds
 * the revoked columns. Returns a map id → row.
 */
export async function hiddenColumnsByIds<T extends Record<string, unknown>>(
  table: string, ids: readonly (string | null | undefined)[], columns: string, key = 'id',
): Promise<Map<string, T>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, T>();
  if (!uniq.length) return out;
  const admin = createAdminClient();
  for (let i = 0; i < uniq.length; i += 200) {
    const chunk = uniq.slice(i, i + 200);
    const { data, error } = await admin.from(table).select(`${key}, ${columns}`).in(key, chunk);
    if (error) throw new Error(`hiddenColumnsByIds(${table}): ${error.message}`);
    for (const r of (data ?? []) as unknown as T[]) out.set(String(r[key]), r);
  }
  return out;
}

/**
 * Ids of demo/seed rows (`is_seed = true`, hidden from session reads) — service role, paged. Staff screens that hide seed
 * data keep their session read (RLS + division scoping) and drop these ids: over-fetch by `seeds.size`, then `dropSeeds`.
 */
export async function seedIds(table: string): Promise<Set<string>> {
  const admin = createAdminClient();
  const out = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from(table).select('id').eq('is_seed', true).order('id').range(from, from + 999);
    if (error) throw new Error(`seedIds(${table}): ${error.message}`);
    for (const r of (data ?? []) as { id: string }[]) out.add(String(r.id));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** Rows without the seed ids, cut back to `limit` (the session read asked for `limit + seeds.size`). */
export function dropSeeds<R extends { id?: unknown }>(rows: R[] | null | undefined, seeds: ReadonlySet<string>, limit?: number): R[] {
  const kept = (rows ?? []).filter((r) => !seeds.has(String(r.id)));
  return limit == null ? kept : kept.slice(0, limit);
}

/**
 * Head count without seed rows: `total` (session count, RLS-scoped) minus the seed rows the same session query can see.
 * `countIn(ids)` must run the same session query with `.in('id', ids)` and `{ count: 'exact', head: true }`.
 */
export async function countWithoutSeeds(total: number | null | undefined, seeds: ReadonlySet<string>,
  countIn: (ids: string[]) => PromiseLike<{ count: number | null }>): Promise<number> {
  let seen = 0;
  const all = [...seeds];
  for (let i = 0; i < all.length; i += 200) seen += (await countIn(all.slice(i, i + 200))).count ?? 0;
  return Math.max(0, (total ?? 0) - seen);
}

/**
 * Replaces a `suppliers(...)` embed on a table whose supplier_id is hidden (orders, quotes, pools…): an embed through a
 * hidden FK column fails ("permission denied for table …"). supplier_id comes from the service role for the rows the
 * session already returned; the supplier rows themselves are still read with the caller's session (same RLS as the embed).
 */
export async function withSuppliers<R extends Record<string, unknown>, S extends Record<string, unknown> = Record<string, unknown>>(
  sb: SessionClient, table: string, rows: R[] | null | undefined, supplierColumns: string,
): Promise<(R & { supplier_id: string | null; suppliers: S | null })[]> {
  const list = await withHiddenColumns<R, { supplier_id: string | null }>(table, rows, 'supplier_id');
  const ids = [...new Set(list.map((r) => r.supplier_id).filter((x): x is string => !!x))];
  const { data } = ids.length ? await sb.from('suppliers').select(`id, ${supplierColumns}`).in('id', ids) : { data: [] };
  const byId = new Map(((data ?? []) as unknown as (S & { id: string })[]).map((x) => [x.id, x]));
  return list.map((r) => ({ ...r, supplier_id: r.supplier_id ?? null, suppliers: (r.supplier_id && byId.get(r.supplier_id)) || null }));
}

/**
 * `products` rows INCLUDING the customer-hidden columns, but only the rows the products_staff policy gives the caller
 * (staff with products:view, the caller's own / assigned suppliers; customers get none) — security-definer
 * portal_products() (migration 195), called with the caller's SESSION client so the database keeps enforcing scope.
 * Use like `sb.from('products')` for reads only: `.select(cols)`, filters, order, range. Pass `count` HERE, not to select().
 */
export function portalProducts(sb: SessionClient, opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
  return sb.rpc('portal_products', undefined, opts) as unknown as Pick<ReturnType<SessionClient['from']>, 'select'>;
}

/** Merge hidden columns into rows returned by a session read (rows keep their RLS scoping). */
export async function withHiddenColumns<R extends Record<string, unknown>, H extends Record<string, unknown>>(
  table: string, rows: R[] | null | undefined, columns: string, key = 'id',
): Promise<(R & H)[]> {
  const list = rows ?? [];
  const map = await hiddenColumnsByIds<H>(table, list.map((r) => r[key] as string | null | undefined), columns, key);
  // a row the service role did not return (deleted meanwhile) gets null for every requested column
  const blank = Object.fromEntries(columns.split(',').map((c) => [c.trim(), null]));
  return list.map((r) => ({ ...r, ...blank, ...(map.get(String(r[key])) ?? {}) }) as R & H);
}
