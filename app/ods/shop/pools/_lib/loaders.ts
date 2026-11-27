import 'server-only';
import { redirect } from 'next/navigation';
import { getPool, listOpenPools } from '@/components/store/data';
import { getStoreContent } from '@/components/store/currency';
import { poolSettings } from '@/components/store/pools/shared';
import { getCurrencyContext } from '@/lib/currency';
import { createClient, createPublicClient } from '@/lib/supabase/server';
import { shopCan, ROLE_REASON, type ShopRole } from '@/lib/shop/shared';
import { isFilledStatus, isJoinable, isUuid, normalisePoolCode, sortPools, toPoolView, type PoolSort, type PoolView } from './pool-logic';
import type { JoinState } from '../_components/pool-types';

/**
 * ODS T4 · MOQ pools data. Every read reuses today's queries:
 *  - open pools  → listOpenPools() (components/store/data.ts; public, cached 'pools'),
 *  - one pool    → getPool(code) (same; participants only from pool_public_view, buyer codes stripped from events),
 *  - filled      → pools.code where status in (locked, confirmed, shipped, completed) [public RLS pools_public] → getPool,
 *  - my pools    → pool_pledge_mine_view (session client, own company only) → getPool.
 * Everything is projected through toPoolView() before it reaches a component: buyer COUNT only, no factory/supplier.
 */

const ACTIVE_PLEDGE = ['pending', 'paid', 'confirmed', 'shipped', 'delivered'];
const FILLED = ['locked', 'confirmed', 'shipped', 'completed'];
const LIST_LIMIT = 96;

export async function loadOpenPools(sort: PoolSort): Promise<PoolView[]> {
  const list = await listOpenPools({ sort, limit: LIST_LIMIT });
  return list.items.map(toPoolView);
}

async function poolsByCodes(codes: string[]): Promise<PoolView[]> {
  const unique = [...new Set(codes.filter(Boolean))].slice(0, 48);
  const pools = await Promise.all(unique.map((c) => getPool(c)));
  return pools.filter((p): p is NonNullable<typeof p> => !!p).map(toPoolView);
}

export async function loadFilledPools(sort: PoolSort): Promise<PoolView[]> {
  const { data, error } = await createPublicClient()
    .from('pools')
    .select('code')
    .in('status', FILLED)
    .order('filled_at', { ascending: false, nullsFirst: false })
    .limit(24);
  if (error) throw new Error('filled pools');
  return sortPools(await poolsByCodes((data ?? []).map((r) => r.code as string)), sort);
}

export async function loadMyPools(orgId: string, sort: PoolSort): Promise<PoolView[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from('pool_pledge_mine_view')
    .select('pool_code, status')
    .eq('org_id', orgId)
    .in('status', ACTIVE_PLEDGE)
    .order('joined_at', { ascending: false })
    .limit(48);
  if (error) throw new Error('my pools');
  return sortPools(await poolsByCodes((data ?? []).map((r) => r.pool_code as string)), sort);
}

/** Accept today's identifier (POOL-0042). A pool UUID is redirected to its code URL; anything else → null (404). */
export async function resolvePoolCode(raw: string): Promise<string | null> {
  const code = normalisePoolCode(raw);
  if (code) return code;
  if (isUuid(raw)) {
    const { data } = await createPublicClient().from('pools').select('code').eq('id', raw).maybeSingle();
    if (data?.code) redirect(`/shop/pools/${encodeURIComponent(data.code as string)}`);
  }
  return null;
}

export async function loadPool(code: string): Promise<PoolView | null> {
  const p = await getPool(code);
  return p ? toPoolView(p) : null;
}

/**
 * What the join panel may offer this company — the same checks, in the same order, as today's JoinPanel on
 * /pool/[code] (own pledge first, then pool status, the pools switch, currency, buyer cap, then the member's role).
 */
export async function loadJoinState(pool: PoolView, viewer: { orgId: string; role: ShopRole }, now: number): Promise<JoinState> {
  const sb = await createClient();
  const [{ data: mine }, { settings }, ctx] = await Promise.all([
    sb
      .from('pool_pledge_mine_view')
      .select('qty, status')
      .eq('pool_id', pool.id)
      .eq('org_id', viewer.orgId)
      .in('status', ACTIVE_PLEDGE)
      .order('joined_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    getStoreContent(),
    getCurrencyContext(),
  ]);
  if (mine) return { kind: 'mine', qty: Number(mine.qty), status: String(mine.status) };
  if (isFilledStatus(pool.status)) return { kind: 'full' };
  if (!isJoinable(pool, now)) return { kind: 'closed' };
  if (!poolSettings(settings).enabled) return { kind: 'blocked', reason: 'Group buying is paused right now. Please check back later.' };
  if (ctx.currency !== pool.currency) {
    return { kind: 'blocked', reason: `This pool is priced in ${pool.currency}, but we now bill in ${ctx.currency}, so it can't take new buyers.` };
  }
  if (pool.buyers >= pool.maxBuyers) return { kind: 'full', reason: `This pool has reached its limit of ${pool.maxBuyers} buyers.` };
  if (!shopCan(viewer.role)) return { kind: 'blocked', reason: ROLE_REASON };
  return { kind: 'open' };
}
