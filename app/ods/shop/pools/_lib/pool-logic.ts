/**
 * ODS T4 · MOQ pools (Part 5.5) — pure helpers shared by the server pages, the client join form, the fixtures and the
 * unit tests. No React, no Supabase: safe on the server and the client.
 *
 * Money: every amount here is in MINOR units of the pool's own locked currency (pools.currency), exactly like today's
 * join form (components/store/pools/join-form.tsx). The maths mirrors that form and SQL pool_unit_price() via priceAt().
 */
import { formatTime } from '@octopus/ui/format';
import { poolStatus, type PoolRow } from '../../_lib/cards';

/** A price tier already converted to the pool currency (components/store/data.ts shapePools). */
export type PoolTierView = { min_qty: number; unit_price_minor: number };

/** One public pool event (pool_public_events, buyer codes already removed by getPool → publicEventBody). */
export type PoolEventView = { kind: string; title: string; qty: number | null; created_at: string };

/**
 * What a customer may see about a pool. Built ONLY by toPoolView(): no participants list, no buyer codes or company
 * names (buyer COUNT only), no factory / supplier, no HS code, no starter. White-label (Part 1 rule 7).
 */
export type PoolView = {
  id: string;
  code: string;
  /** pools.status: open | locked | confirmed | shipped | completed | expired | cancelled */
  status: string;
  currency: string;
  title: string;
  productSlug: string;
  unit: string;
  image: string | null;
  targetQty: number;
  filledQty: number;
  minPledge: number;
  /** Deposit % locked on the pool when it opened (from site_settings pool_deposit_pct). Never hard-coded. */
  depositPct: number;
  maxBuyers: number;
  deadlineAt: string;
  createdAt: string;
  filledAt: string | null;
  /** Unit price now (at the filled quantity), if the pool fills (at the target) and the normal (first-tier) price. */
  poolPriceMinor: number | null;
  targetPriceMinor: number | null;
  basePriceMinor: number | null;
  savingPct: number;
  /** Number of buyers. Never names. */
  buyers: number;
  tiers: PoolTierView[];
  events: PoolEventView[];
};

/** Fields we read from today's PoolCard / PoolDetail (components/store/data.ts). Kept structural so tests need no DB. */
export type PoolSource = {
  id: string;
  code: string;
  status: string;
  currency: string;
  product: { slug: string; title: string; unit: string; image_url: string | null };
  target_qty: number;
  filled_qty: number;
  min_pledge: number;
  max_buyers: number;
  deposit_pct: number;
  deadline_at: string;
  created_at: string;
  filled_at?: string | null;
  pool_price_minor: number | null;
  target_price_minor: number | null;
  base_price_minor: number | null;
  saving_pct: number;
  buyers: number;
  tiers: PoolTierView[];
  events?: { kind: string; title: string; qty: number | null; created_at: string; body?: string | null }[];
};

/**
 * Customer-safe projection of a pool. Picks fields one by one (never spreads), so participants (country, qty,
 * buyer_code), factory, starter and anything added to PoolDetail later can't leak into a page or the RSC payload.
 */
export function toPoolView(p: PoolSource): PoolView {
  return {
    id: p.id,
    code: p.code,
    status: p.status,
    currency: p.currency,
    title: p.product.title,
    productSlug: p.product.slug,
    unit: p.product.unit,
    image: p.product.image_url,
    targetQty: Number(p.target_qty),
    filledQty: Number(p.filled_qty),
    minPledge: Math.max(1, Number(p.min_pledge)),
    depositPct: Number(p.deposit_pct),
    maxBuyers: Number(p.max_buyers),
    deadlineAt: p.deadline_at,
    createdAt: p.created_at,
    filledAt: p.filled_at ?? null,
    poolPriceMinor: p.pool_price_minor,
    targetPriceMinor: p.target_price_minor,
    basePriceMinor: p.base_price_minor,
    savingPct: p.saving_pct,
    buyers: Number(p.buyers),
    tiers: p.tiers.map((t) => ({ min_qty: t.min_qty, unit_price_minor: t.unit_price_minor })),
    events: (p.events ?? []).map((e) => ({ kind: e.kind, title: e.title, qty: e.qty, created_at: e.created_at })),
  };
}

/* ───────── Status (Appendix C pool names) ───────── */

/** "Closing soon" = an open pool that closes within this many hours (same window as the /pools "3 days" filter). */
export const CLOSING_SOON_HOURS = 72;
/** "Almost full" = an open pool at 75 % of its target or more (same threshold as today's fillTone 'hot'). */
export const ALMOST_FULL_RATIO = 0.75;

const FILLED_STATUSES = ['locked', 'confirmed', 'shipped', 'completed'];

export type PoolStatusName = 'Open' | 'Closing soon' | 'Almost full' | 'Filled' | 'Closed (not filled)';

type StatusInput = Pick<PoolView, 'status' | 'filledQty' | 'targetQty' | 'deadlineAt'>;

export const isFilledStatus = (status: string) => FILLED_STATUSES.includes(status);

/** Open and still before its deadline. */
export function isJoinable(p: StatusInput, now: number): boolean {
  return p.status === 'open' && new Date(p.deadlineAt).getTime() > now;
}

export function isClosingSoon(p: StatusInput, now: number): boolean {
  if (!isJoinable(p, now)) return false;
  return new Date(p.deadlineAt).getTime() - now <= CLOSING_SOON_HOURS * 3600e3;
}

export function isAlmostFull(p: StatusInput, now: number): boolean {
  if (!isJoinable(p, now) || p.targetQty <= 0) return false;
  return p.filledQty / p.targetQty >= ALMOST_FULL_RATIO;
}

/**
 * One Appendix C name per pool. Open pools use the Shop-wide rule (app/ods/shop/_lib/cards.ts poolStatus: Closing soon
 * ≤ 72 h, then Almost full ≥ 75 %, else Open) so the pool page matches the cards; filled statuses are Filled, and an
 * open pool past its deadline (or expired / cancelled) is "Closed (not filled)".
 */
export function poolStatusName(p: StatusInput, now: number): PoolStatusName {
  if (isFilledStatus(p.status)) return 'Filled';
  if (!isJoinable(p, now)) return 'Closed (not filled)';
  return poolStatus({ status: p.status, filled_qty: p.filledQty, target_qty: p.targetQty, deadline_at: p.deadlineAt }, now);
}

/* ───────── List filters (?status=) and sort (?sort=) ───────── */

export const POOL_FILTERS = [
  { id: 'open', label: 'Open' },
  { id: 'closing-soon', label: 'Closing soon' },
  { id: 'almost-full', label: 'Almost full' },
  { id: 'filled', label: 'Filled' },
  { id: 'mine', label: 'My pools' },
] as const;
export type PoolFilter = (typeof POOL_FILTERS)[number]['id'];

export const POOL_SORTS = [
  { id: 'closing', label: 'Closing soonest' },
  { id: 'saving', label: 'Biggest saving' },
  { id: 'filled', label: 'Most filled' },
  { id: 'newest', label: 'Newest' },
  { id: 'buyers', label: 'Most buyers' },
] as const;
export type PoolSort = (typeof POOL_SORTS)[number]['id'];

export const parsePoolFilter = (v: unknown): PoolFilter =>
  (POOL_FILTERS.find((f) => f.id === v)?.id ?? 'open') as PoolFilter;
export const parsePoolSort = (v: unknown): PoolSort => (POOL_SORTS.find((s) => s.id === v)?.id ?? 'closing') as PoolSort;

const fill = (p: PoolView) => (p.targetQty > 0 ? p.filledQty / p.targetQty : 0);
const SORTERS: Record<PoolSort, (a: PoolView, b: PoolView) => number> = {
  closing: (a, b) => a.deadlineAt.localeCompare(b.deadlineAt),
  saving: (a, b) => b.savingPct - a.savingPct,
  filled: (a, b) => fill(b) - fill(a),
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  buyers: (a, b) => b.buyers - a.buyers,
};

export function sortPools<T extends PoolView>(list: T[], sort: PoolSort): T[] {
  return [...list].sort((a, b) => SORTERS[sort](a, b) || a.code.localeCompare(b.code));
}

/** Split the loaded lists into the five pill groups (open pools feed Open / Closing soon / Almost full). */
export function groupPools<T extends PoolView>(open: T[], filled: T[], mine: T[], now: number): Record<PoolFilter, T[]> {
  const live = open.filter((p) => isJoinable(p, now));
  return {
    open: live,
    'closing-soon': live.filter((p) => isClosingSoon(p, now)),
    'almost-full': live.filter((p) => isAlmostFull(p, now)),
    filled,
    mine,
  };
}

/* ───────── Join maths ───────── */

/** Mirror of SQL pool_unit_price(): the highest tier reached by `qty`, else the first tier. */
export function unitPriceAt(tiers: PoolTierView[], qty: number): number | null {
  if (!tiers.length) return null;
  const sorted = [...tiers].sort((a, b) => a.min_qty - b.min_qty);
  let pick = sorted[0];
  for (const t of sorted) if (Math.max(qty, 0) >= t.min_qty) pick = t;
  return pick.unit_price_minor;
}

/** Units step. Pools have no step column today (whole units from the minimum pledge), so this is 1 unless given. */
export function poolStep(step?: number | null): number {
  return step && Number.isInteger(step) && step > 0 ? step : 1;
}

/**
 * Snap a typed quantity to the allowed values: at least `min`, then `min + k × step`, at most `max` (rounded down to a
 * step). Non-numbers become `min`.
 */
export function snapUnits(qty: number, opts: { min: number; step?: number; max?: number }): number {
  const min = Math.max(1, Math.floor(opts.min));
  const step = poolStep(opts.step);
  if (!Number.isFinite(qty) || qty <= min) return min;
  let n = min + Math.round((Math.floor(qty) - min) / step) * step;
  if (opts.max !== undefined && n > opts.max) n = min + Math.floor((opts.max - min) / step) * step;
  return Math.max(min, n);
}

export type JoinTotals = {
  /** Unit price at the pool's quantity after this pledge. */
  unitMinor: number;
  /** Units × unit price ("Product total"). */
  productTotalMinor: number;
  /** "Pay now ([deposit %] deposit, held)". Same rounding as today's form and SQL. */
  depositMinor: number;
  /** Estimated balance when the pool fills, at the target price. */
  balanceEstimateMinor: number;
};

/** Same maths as today's JoinPoolForm (components/store/pools/join-form.tsx). */
export function joinTotals(p: Pick<PoolView, 'tiers' | 'filledQty' | 'targetQty' | 'depositPct'>, qty: number): JoinTotals | null {
  const units = Math.max(0, Math.floor(qty));
  const now = unitPriceAt(p.tiers, p.filledQty + units);
  if (now == null) return null;
  const productTotalMinor = now * units;
  const depositMinor = Math.round((productTotalMinor * p.depositPct) / 100);
  const final = unitPriceAt(p.tiers, Math.max(p.targetQty, p.filledQty + units)) ?? now;
  return { unitMinor: now, productTotalMinor, depositMinor, balanceEstimateMinor: Math.max(0, final * units - depositMinor) };
}

/** Today's default pledge: the units still needed, between the minimum and 5 × the minimum. */
export function defaultUnits(p: Pick<PoolView, 'minPledge' | 'targetQty' | 'filledQty'>): number {
  return Math.max(p.minPledge, Math.min(Math.max(p.targetQty - p.filledQty, p.minPledge), p.minPledge * 5));
}

/* ───────── Display helpers ───────── */

/** Money prefix for a pool currency: US$ for USD (Part 2.7), else the ISO code (e.g. "AED"). */
export const currencyPrefix = (c: string) => (c === 'USD' ? 'US$' : c);
/** Minor → major units for <Money>. */
export const major = (minor: number) => minor / 100;

/** "1 buyer" / "14 buyers" — the only thing other buyers ever learn about each other. */
export const buyerCount = (n: number) => `${n} ${n === 1 ? 'buyer' : 'buyers'}`;

export const unitWord = (unit: string, n: number) => {
  const u = unit || 'unit';
  if (n === 1) return u.replace(/s$/, '');
  return /s$/.test(u) ? u : `${u}s`;
};

/** Accept today's pool identifier: a pool code (POOL-0042) — returns it upper-cased — or null. UUIDs are handled by the page. */
export function normalisePoolCode(raw: string): string | null {
  const v = decodeURIComponent(raw).trim();
  return /^POOL-\d{1,10}$/i.test(v) ? v.toUpperCase() : null;
}
export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** PoolView → the row shape of the shared Shop card mapper (app/ods/shop/_lib/cards.ts toPoolCard). */
export function toPoolRow(v: PoolView): PoolRow {
  return {
    id: v.id,
    code: v.code,
    status: v.status,
    product: { slug: v.productSlug, title: v.title, unit: v.unit, image_url: v.image },
    target_qty: v.targetQty,
    filled_qty: v.filledQty,
    min_pledge: v.minPledge,
    max_buyers: v.maxBuyers,
    buyers: v.buyers,
    deadline_at: v.deadlineAt,
    pool_price_minor: v.poolPriceMinor,
    base_price_minor: v.basePriceMinor,
  };
}

/** /shop/pools URL for a filter + sort (+ the Shop-wide ?category=). Defaults are left out so links stay short. */
export function poolsListHref(o: { status?: PoolFilter; sort?: PoolSort; category?: string | null }): string {
  const q = new URLSearchParams();
  if (o.category) q.set('category', o.category);
  if (o.status && o.status !== 'open') q.set('status', o.status);
  if (o.sort && o.sort !== 'closing') q.set('sort', o.sort);
  const s = q.toString();
  return s ? `/shop/pools?${s}` : '/shop/pools';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2 Dec, 18:00 (Dubai time)" in `timeZone` (Part 2.7: "27 Nov" inside the current year, else "27 Nov 2026"). */
export function formatClosing(iso: string, timeZone: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone, day: 'numeric', month: 'numeric', year: 'numeric' }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  const yearNow = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric' }).format(now);
  const date = `${Number(parts.day)} ${MONTHS[Number(parts.month) - 1]}${parts.year === yearNow ? '' : ` ${parts.year}`}`;
  const time = timeZone === 'UTC' || timeZone === 'Etc/UTC' ? formatTime(d, 'UTC').replace('(UTC time)', '(UTC)') : formatTime(d, timeZone);
  return `${date}, ${time}`;
}

