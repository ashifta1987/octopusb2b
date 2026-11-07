'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { joinSchema, startSchema, type JoinInput, type StartInput } from '@/components/store/pools/schema';
import { poolError, poolSettings } from '@/components/store/pools/shared';

/** Group buying server actions (SPEC §18). Every write goes through the pool RPCs; RLS/RPCs re-check everything. */

export type PoolResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string; login?: string };

function refresh(code?: string | null) {
  revalidateTag('pools', 'max');
  if (code) revalidateTag(`pool:${code}`, 'max');
  revalidatePath('/account/pools');
}

async function customer(next: string) {
  const s = await getSession();
  if (!s) return { error: { ok: false as const, error: 'Please sign in to continue.', login: `/login?next=${encodeURIComponent(next)}` } };
  if (!s.org) return { error: { ok: false as const, error: poolError('NO_ORG'), login: '/onboarding' } };
  return { s, org: s.org, sb: await createClient() };
}

async function resolveAddress(sb: Awaited<ReturnType<typeof createClient>>, orgId: string, addressId: string | undefined, na: JoinInput['newAddress']): Promise<{ id: string | null } | { error: string }> {
  if (addressId === 'new' && na) {
    const { data, error } = await sb.from('addresses')
      .insert({ org_id: orgId, label: na.label || null, line1: na.line1, city: na.city, postal_code: na.postal_code || null, country: na.country })
      .select('id').single();
    if (error) return { error: poolError(error.message) };
    return { id: data.id as string };
  }
  return { id: addressId && addressId !== 'new' ? addressId : null };
}

/** Join a pool: pledge + deposit (wallet → paid now; bank transfer → pending until finance confirms). */
export async function joinPool(input: JoinInput & { code: string }): Promise<PoolResult<{ pledgeId: string; status: string }>> {
  const c = await customer(`/pool/${input.code}`);
  if ('error' in c) return c.error!;
  const { data: pool } = await c.sb.from('pools').select('id, code, min_pledge').eq('id', input.poolId).maybeSingle();
  if (!pool) return { ok: false, error: poolError('NOT_FOUND') };
  const parsed = joinSchema(pool.min_pledge as number).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form' };
  const v = parsed.data;
  const addr = await resolveAddress(c.sb, c.org.id, v.addressId, v.newAddress);
  if ('error' in addr) return { ok: false, error: addr.error };
  const { data, error } = await c.sb.rpc('join_pool', { p_pool: v.poolId, p_qty: v.qty, p_address: addr.id, p_pay_source: v.paySource, p_terms: v.termsId ?? null });
  if (error) return { ok: false, error: poolError(error.message) };
  refresh(pool.code as string);
  return { ok: true, data: { pledgeId: data as string, status: v.paySource === 'wallet' ? 'paid' : 'pending' }, message: v.paySource === 'wallet' ? 'You joined the pool — deposit paid from your wallet.' : 'Pledge reserved — pay the deposit by bank transfer.' };
}

/** Withdraw before the pool fills — deposit refunded to the wallet. */
export async function withdrawPledge(pledgeId: string): Promise<PoolResult> {
  const c = await customer('/account/pools');
  if ('error' in c) return c.error!;
  if (!/^[0-9a-f-]{36}$/i.test(pledgeId)) return { ok: false, error: poolError('NOT_FOUND') };
  const { data: pl } = await c.sb.from('pool_pledge_mine_view').select('pool_code').eq('id', pledgeId).maybeSingle();
  const { error } = await c.sb.rpc('withdraw_pledge', { p_pledge: pledgeId });
  if (error) return { ok: false, error: poolError(error.message) };
  refresh(pl?.pool_code as string | undefined);
  return { ok: true, message: 'Pledge withdrawn. Any deposit paid is back in your wallet.' };
}

/** Start a pool on a product (the starter pledges in the same call) → returns the new pool code. */
export async function startPool(input: StartInput): Promise<PoolResult<{ code: string }>> {
  const c = await customer(`/pools/start?product=${input.productId}`);
  if ('error' in c) return c.error!;
  const [{ data: prod }, { data: settings }] = await Promise.all([
    c.sb.from('products').select('id, moq').eq('id', input.productId).eq('status', 'live').maybeSingle(),
    c.sb.from('site_settings').select('key, value').like('key', 'pool_%'),
  ]);
  if (!prod) return { ok: false, error: poolError('NOT_FOUND') };
  const rules = poolSettings(Object.fromEntries((settings ?? []).map((r) => [r.key as string, r.value])));
  const parsed = startSchema({ moq: Math.max(1, prod.moq as number), minDays: rules.minDays, maxDays: rules.maxDays }).safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form' };
  const v = parsed.data;
  const addr = await resolveAddress(c.sb, c.org.id, v.addressId, v.newAddress);
  if ('error' in addr) return { ok: false, error: addr.error };
  const deadline = new Date(Date.now() + v.days * 864e5).toISOString();
  const { data: id, error } = await c.sb.rpc('open_pool', {
    p_product: v.productId, p_target_qty: v.targetQty, p_deadline: deadline, p_min_pledge: v.minPledge,
    p_address: addr.id, p_qty: v.qty, p_pay_source: v.paySource,
  });
  if (error) return { ok: false, error: poolError(error.message) };
  const { data: pool } = await c.sb.from('pools').select('code').eq('id', id as string).maybeSingle();
  refresh(pool?.code as string | undefined);
  return { ok: true, data: { code: (pool?.code as string) ?? '' }, message: 'Pool opened' };
}
