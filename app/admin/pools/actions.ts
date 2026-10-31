'use server';
import { revalidatePath, revalidateTag } from 'next/cache';
import { guard, fail, failAt, ok, str, type Result } from '@/components/admin/server';
import { poolError } from '@/components/store/pools/shared';

/** Admin › Group buying (SPEC §18.4). RPCs re-check permissions; every change refreshes the public pool caches. */
const PATH = '/admin/pools';
const isId = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

function done(message: string, settings = false): Result {
  revalidateTag('pools', 'max');
  if (settings) revalidateTag('site-content', 'max');
  revalidatePath(PATH);
  return ok(message);
}
const dbFail = (e: { message?: string }) => {
  const r = failAt(e, PATH);
  if (!r.ok && r.error !== 'STEP_UP_REQUIRED') return { ok: false as const, error: poolError(e.message) };
  return r;
};

/** Global "Group buy" ON/OFF switch (Admin only — set_setting checks is_admin and audits). */
export async function togglePools(on: boolean): Promise<Result> {
  const g = await guard('orders', 'view');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('FORBIDDEN');
  const { error } = await g.sb.rpc('set_setting', { p_key: 'pool_enabled', p_value: on });
  if (error) return dbFail(error);
  return done(on ? 'Group buying is ON' : 'Group buying is OFF', true);
}

const RULES: { key: string; min: number; max: number; label: string }[] = [
  { key: 'pool_deposit_pct', min: 1, max: 100, label: 'Deposit %' },
  { key: 'pool_min_pledge_default', min: 1, max: 10_000_000, label: 'Default minimum pledge' },
  { key: 'pool_max_buyers', min: 2, max: 500, label: 'Max buyers per pool' },
  { key: 'pool_min_days', min: 1, max: 365, label: 'Shortest deadline' },
  { key: 'pool_max_days', min: 1, max: 365, label: 'Longest deadline' },
  { key: 'pool_default_days', min: 1, max: 365, label: 'Default deadline' },
  { key: 'pool_balance_hours', min: 1, max: 720, label: 'Balance window' },
];

/** Pool rules (SPEC §18.1) as site_settings — Admin only. Applies to new pools / pledges. */
export async function savePoolRules(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('orders', 'view');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('FORBIDDEN');
  const vals: Record<string, number> = {};
  for (const r of RULES) {
    const n = Number(str(fd, r.key));
    if (!Number.isInteger(n) || n < r.min || n > r.max) return fail(`${r.label} must be a whole number between ${r.min} and ${r.max}.`);
    vals[r.key] = n;
  }
  if (vals.pool_min_days > vals.pool_max_days) return fail('The shortest deadline cannot be longer than the longest.');
  if (vals.pool_default_days < vals.pool_min_days || vals.pool_default_days > vals.pool_max_days) return fail('The default deadline must be within the min–max range.');
  for (const [k, v] of Object.entries(vals)) {
    const { error } = await g.sb.rpc('set_setting', { p_key: k, p_value: v });
    if (error) return dbFail(error);
  }
  return done('Pool rules saved', true);
}

/** Cancel with refund: every deposit (and any balance paid) goes back to the buyers' wallets. Reason required. */
export async function cancelPool(id: string, reason?: string): Promise<Result> {
  const g = await guard('orders', 'view');
  if ('error' in g) return g.error;
  if (!isId(id)) return fail('NOT_FOUND');
  if (!reason?.trim()) return fail('REASON_REQUIRED');
  const { data, error } = await g.sb.rpc('cancel_pool', { p_pool: id, p_reason: reason.trim() });
  if (error) return dbFail(error);
  return done(`Pool cancelled · ${Number(data ?? 0)} pledges refunded`);
}

/** Extend an open pool's deadline by N days. */
export async function extendPool(_prev: Result | null, fd: FormData): Promise<Result> {
  const g = await guard('orders', 'view');
  if ('error' in g) return g.error;
  const id = str(fd, 'pool_id');
  const days = Number(str(fd, 'days'));
  if (!isId(id)) return fail('NOT_FOUND');
  if (!Number.isInteger(days) || days < 1 || days > 60) return fail('Extend by 1–60 days.');
  const { data: p } = await g.sb.from('pools').select('deadline_at').eq('id', id).maybeSingle();
  if (!p) return fail('NOT_FOUND');
  const base = Math.max(new Date(p.deadline_at as string).getTime(), Date.now());
  const { error } = await g.sb.rpc('extend_pool_deadline', { p_pool: id, p_deadline: new Date(base + days * 864e5).toISOString() });
  if (error) return dbFail(error);
  return done(`Deadline extended by ${days} day${days === 1 ? '' : 's'}`);
}

/** Force-settle (Admin): settles with the paid quantity; Octopus covers any shortfall to the target. */
export async function forceSettlePool(id: string): Promise<Result> {
  const g = await guard('orders', 'view');
  if ('error' in g) return g.error;
  if (!g.s.isAdmin) return fail('FORBIDDEN');
  if (!isId(id)) return fail('NOT_FOUND');
  const { data, error } = await g.sb.rpc('force_settle_pool', { p_pool: id });
  if (error) return dbFail(error);
  const r = (data ?? {}) as { orders?: number; idempotent?: boolean; status?: string };
  return done(r.idempotent ? `Already settled (${r.status})` : `Pool settled · ${r.orders ?? 0} proforma invoices issued`);
}

/** Balance unpaid after the window: pledge defaulted, deposit forfeited to cover the shortfall. */
export async function defaultPledge(pledgeId: string): Promise<Result> {
  const g = await guard('orders', 'edit');
  if ('error' in g) return g.error;
  if (!isId(pledgeId)) return fail('NOT_FOUND');
  const { error } = await g.sb.rpc('default_pledge', { p_pledge: pledgeId });
  if (error) return dbFail(error);
  return done('Pledge marked defaulted — deposit forfeited');
}

/** Card / bank-transfer deposit received (Finance). */
export async function confirmDeposit(pledgeId: string): Promise<Result> {
  const g = await guard('wallet', 'approve');
  if ('error' in g) return g.error;
  if (!isId(pledgeId)) return fail('NOT_FOUND');
  const { error } = await g.sb.rpc('confirm_pool_deposit', { p_pledge: pledgeId, p_provider_event: null });
  if (error) return dbFail(error);
  return done('Deposit confirmed — pledge is paid');
}
