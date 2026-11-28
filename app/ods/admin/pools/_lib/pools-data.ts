import 'server-only';
/**
 * ODS T9 · MOQ pools — server reads: today's Admin › Group buying reads, unchanged (session client + division scope;
 * supplier_id / po_document_id through today's withHiddenColumns after requireStaff; seed pools dropped from the counts
 * as today). Supplier codes: today's session read (RLS suppliers_staff limits it; empty → "—"). No writes: actions are today's app/admin/pools/actions.
 */
import { createClient } from '@/lib/supabase/server';
import { dropSeeds, seedIds, withHiddenColumns } from '@/components/backoffice/hidden-columns';
import { poolSettings, type PoolSettings } from '@/components/store/pools/shared';
import type { DivisionScope } from '@/lib/divisions/scope';
import { ACTIVE_PLEDGE, POOL_STATUSES, closingSoon48, fillPct, poolDeposits, poolStatus, sumByCurrency, type Minor, type PoolQuery } from './pools-core';

export type PledgeVM = {
  id: string; qty: number; status: string; depositMinor: number; balanceMinor: number | null; currency: string; paySource: string;
  joinedAt: string; orderId: string | null; buyerCode: string | null; company: string | null; country: string | null;
};

export type PoolRowVM = {
  id: string; code: string; statusRaw: string; status: string; statusDetail: string | null; currency: string;
  targetQty: number; filledQty: number; pct: number; maxBuyers: number; buyers: number; deadlineAt: string; balanceDueAt: string | null;
  createdAt: string; unitPriceMinor: number | null; product: string; unit: string; supplierCode: string | null;
  poDocumentId: string | null; deposits: Minor[]; pledges: PledgeVM[]; closingSoon: boolean;
};

export type PoolKpis = { open: number; soon: number; held: Minor[]; locked: number; expired: number; cancelled: number; counts: Record<string, number> };
export type PoolListResult = { ok: true; rows: PoolRowVM[]; kpis: PoolKpis; rules: PoolSettings } | { ok: false; error: string; rules: PoolSettings | null };

export async function loadPools(scope: DivisionScope, query: PoolQuery, perms: { readSuppliers: boolean }, now: number): Promise<PoolListResult> {
  const sb = await createClient();
  let q = sb.from('pools').select('id, code, status, currency, target_qty, filled_qty, min_pledge, max_buyers, deadline_at, created_at, pool_price_minor, final_price_minor, balance_due_at, product_id, products(title, slug, unit)')
    .order('deadline_at', { ascending: true }).limit(300);
  if (query.tab !== 'all' && query.tab !== 'closing') q = q.eq('status', query.tab);
  if (!scope.all) q = q.eq('division_id', scope.division.id);
  if (query.tab === 'closing') q = q.eq('status', 'open').lte('deadline_at', new Date(now + 48 * 3600e3).toISOString());
  const seedPools = await seedIds('pools');
  const [{ data: raw, error }, settingsRes, countsRaw] = await Promise.all([
    q,
    sb.from('site_settings').select('key, value').like('key', 'pool_%'),
    scope.all ? sb.from('pools').select('id, status') : sb.from('pools').select('id, status').eq('division_id', scope.division.id),
  ]);
  const rules = poolSettings(Object.fromEntries((settingsRes.data ?? []).map((r) => [r.key as string, r.value])));
  if (error) return { ok: false, error: 'We couldn’t load the pools. Try again.', rules };
  const rows = (await withHiddenColumns('pools', raw as Record<string, unknown>[] | null, 'supplier_id, po_document_id')) as unknown as {
    id: string; code: string; status: string; currency: string; target_qty: number; filled_qty: number; max_buyers: number; deadline_at: string;
    created_at: string; pool_price_minor: number | null; final_price_minor: number | null; balance_due_at: string | null; po_document_id: string | null;
    supplier_id: string; products: { title: string; slug: string; unit: string } | null;
  }[];
  const ids = rows.map((p) => p.id);
  const [{ data: pledgeRows }, sups] = await Promise.all([
    ids.length
      ? sb.from('pool_pledges').select('id, pool_id, qty, status, deposit_minor, balance_minor, currency, pay_source, joined_at, order_id, organizations(name, buyer_code, country)').in('pool_id', ids).order('joined_at')
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    perms.readSuppliers ? sb.from('suppliers').select('id, code').in('id', [...new Set(rows.map((p) => p.supplier_id).filter(Boolean))]) : Promise.resolve({ data: [] as { id: string; code: string }[] }),
  ]);
  const supCode = new Map(((sups.data ?? []) as { id: string; code: string }[]).map((x) => [x.id, x.code]));
  const byPool = new Map<string, PledgeVM[]>();
  for (const x of (pledgeRows ?? []) as Record<string, unknown>[]) {
    const o = x.organizations as { name: string | null; buyer_code: string | null; country: string | null } | null;
    const list = byPool.get(x.pool_id as string) ?? [];
    list.push({
      id: x.id as string, qty: Number(x.qty), status: x.status as string, depositMinor: Number(x.deposit_minor), balanceMinor: x.balance_minor == null ? null : Number(x.balance_minor),
      currency: x.currency as string, paySource: x.pay_source as string, joinedAt: x.joined_at as string, orderId: (x.order_id as string | null) ?? null,
      buyerCode: o?.buyer_code ?? null, company: o?.name ?? null, country: o?.country ?? null,
    });
    byPool.set(x.pool_id as string, list);
  }
  const counts = dropSeeds(countsRaw.data as { id: string; status: string }[] | null, seedPools).reduce<Record<string, number>>((a, r) => ((a[r.status] = (a[r.status] ?? 0) + 1), a), {});
  for (const st of POOL_STATUSES) counts[st] ??= 0;
  const vms: PoolRowVM[] = rows.map((p) => {
    const pledges = byPool.get(p.id) ?? [];
    const st = poolStatus({ status: p.status, filledQty: p.filled_qty, targetQty: p.target_qty, deadlineAt: p.deadline_at }, now);
    return {
      id: p.id, code: p.code, statusRaw: p.status, status: st.name, statusDetail: st.detail, currency: p.currency,
      targetQty: p.target_qty, filledQty: p.filled_qty, pct: fillPct(p.filled_qty, p.target_qty), maxBuyers: p.max_buyers,
      buyers: pledges.filter((x) => ACTIVE_PLEDGE.includes(x.status)).length, deadlineAt: p.deadline_at, balanceDueAt: p.balance_due_at, createdAt: p.created_at,
      unitPriceMinor: p.final_price_minor ?? p.pool_price_minor, product: p.products?.title ?? '—', unit: p.products?.unit ?? 'units',
      supplierCode: supCode.get(p.supplier_id) ?? null, poDocumentId: p.po_document_id ?? null,
      deposits: poolDeposits(pledges.map((x) => ({ status: x.status, qty: x.qty, deposit_minor: x.depositMinor, currency: x.currency }))), pledges,
      closingSoon: closingSoon48(p.status, p.deadline_at, now),
    };
  });
  // today's "Deposits held in escrow": paid pledges in OPEN pools among the pools listed
  const heldRows = vms.filter((p) => p.statusRaw === 'open').flatMap((p) => p.pledges.filter((x) => x.status === 'paid'));
  return {
    ok: true,
    rules,
    rows: vms,
    kpis: {
      open: counts.open ?? 0,
      soon: vms.filter((p) => p.closingSoon).length,
      held: sumByCurrency(heldRows, (x) => x.depositMinor, (x) => x.currency),
      locked: counts.locked ?? 0,
      expired: counts.expired ?? 0,
      cancelled: counts.cancelled ?? 0,
      counts,
    },
  };
}
