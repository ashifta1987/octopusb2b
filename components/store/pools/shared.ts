/** Group buying (SPEC §18) — pure helpers shared by server pages and client forms (no server-only imports). */

export type PoolTier = { min_qty: number; unit_price_minor: number };

export type PoolSettings = {
  enabled: boolean; depositPct: number; minPledgeDefault: number; maxBuyers: number;
  minDays: number; maxDays: number; defaultDays: number; balanceHours: number;
};

const num = (v: unknown, d: number) => { const n = typeof v === 'number' ? v : Number(v); return Number.isFinite(n) ? n : d; };
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : typeof v === 'string' ? v === 'true' : d);

/** Pool rules from site_settings (SPEC §18.1). */
export function poolSettings(s: Record<string, unknown>): PoolSettings {
  return {
    enabled: bool(s.pool_enabled, false),
    depositPct: num(s.pool_deposit_pct, 10),
    minPledgeDefault: num(s.pool_min_pledge_default, 100),
    maxBuyers: num(s.pool_max_buyers, 25),
    minDays: num(s.pool_min_days, 3),
    maxDays: num(s.pool_max_days, 30),
    defaultDays: num(s.pool_default_days, 7),
    balanceHours: num(s.pool_balance_hours, 48),
  };
}

/** Mirror of SQL pool_unit_price(): the highest tier reached by `qty`, else the first tier. Tiers already in the pool currency. */
export function priceAt(tiers: PoolTier[], qty: number): number | null {
  if (!tiers.length) return null;
  const sorted = [...tiers].sort((a, b) => a.min_qty - b.min_qty);
  let pick = sorted[0];
  for (const t of sorted) if (Math.max(qty, 0) >= t.min_qty) pick = t;
  return pick.unit_price_minor;
}

/** Fill status badge (hot / warm / cool) — always text + colour. */
export function fillTone(filled: number, target: number): { key: 'hot' | 'warm' | 'cool'; label: string; cls: string } {
  const pct = target > 0 ? filled / target : 0;
  if (pct >= 0.75) return { key: 'hot', label: 'Almost full', cls: 'bg-ok-bg text-ok' };
  if (pct >= 0.3) return { key: 'warm', label: 'On track', cls: 'bg-warn-bg text-warn' };
  return { key: 'cool', label: 'Needs buyers', cls: 'bg-bad-bg text-bad' };
}

export function pct(filled: number, target: number) {
  return target > 0 ? Math.min(100, Math.round((filled / target) * 100)) : 0;
}

/** "2d 14h", "18h 05m", "12m" — or "Closed". */
export function timeLeft(deadline: string | number | Date, now: number, withMinutes = false): string {
  const ms = new Date(deadline).getTime() - now;
  if (ms <= 0) return 'Closed';
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return withMinutes ? `${d}d ${h}h ${String(mm).padStart(2, '0')}m` : h ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return `${h}h ${String(mm).padStart(2, '0')}m`;
  return `${Math.max(mm, 1)}m`;
}

export const POOL_ERRORS: Record<string, string> = {
  POOLS_DISABLED: 'Group buying is switched off right now.',
  NO_ORG: 'Please complete your company profile first.',
  POOL_NOT_OPEN: 'This pool is no longer open.',
  POOL_DEADLINE_PASSED: 'This pool has passed its deadline.',
  POOL_CURRENCY_MISMATCH: 'This pool was opened in a different currency than the one Octopus bills in now, so it cannot take new pledges.',
  PLEDGE_BELOW_MINIMUM: 'Your pledge is below the minimum for this pool.',
  INVALID_ADDRESS: 'Please choose one of your own shipping addresses.',
  ALREADY_PLEDGED: 'Your company already has a pledge in this pool.',
  POOL_FULL_BUYERS: 'This pool has reached its maximum number of buyers.',
  WALLET_DISABLED: 'The wallet is switched off. Choose bank transfer instead.',
  WALLET_INSUFFICIENT: 'Not enough available in your wallet (balance plus any credit limit) for the deposit. Top up your wallet or pay by bank transfer.',
  TARGET_BELOW_MOQ: 'The target quantity must be at least the product MOQ.',
  DEADLINE_OUT_OF_RANGE: 'The deadline is outside the allowed range.',
  POOL_ALREADY_FILLED: 'The pool has already filled — pledges can no longer be withdrawn.',
  REASON_REQUIRED: 'Please give a reason.',
  DEADLINE_MUST_BE_LATER: 'The new deadline must be later than the current one.',
  POOL_NOT_FILLED: 'The pool has not reached its target with paid pledges.',
  BALANCE_ALREADY_PAID: 'The balance has already been paid.',
  INVALID_TRANSITION: 'That change is not allowed in the current status.',
  FORBIDDEN: 'You do not have permission to do this.',
  NOT_FOUND: 'Not found.',
};

export function poolError(msg: string | null | undefined): string {
  const m = msg ?? 'Something went wrong';
  const code = m.split(':')[0].trim();
  if (POOL_ERRORS[code]) {
    const detail = m.includes(':') ? m.slice(m.indexOf(':') + 1).trim() : '';
    if (code === 'PLEDGE_BELOW_MINIMUM' && detail) return `The minimum pledge for this pool is ${Number(detail).toLocaleString('en-US')}.`;
    if (code === 'TARGET_BELOW_MOQ' && detail) return `The target quantity must be at least the MOQ (${Number(detail).toLocaleString('en-US')}).`;
    if (code === 'DEADLINE_OUT_OF_RANGE' && detail) return `The deadline must be ${detail} from today.`;
    if (code === 'POOL_FULL_BUYERS' && detail) return `This pool is capped at ${detail} buyers and is full.`;
    return POOL_ERRORS[code];
  }
  if (/row-level security|permission denied/i.test(m)) return POOL_ERRORS.FORBIDDEN;
  return m;
}

export const SAVED_KEY = 'octopus.pools.saved';
