import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { getSiteContent, type Company } from '@/lib/content';

/**
 * ODS 1.0 introduction site (T3): every settings value the public pages show, read once from getSiteContent()
 * (site_settings + company_profile). No number, price, fee or percentage is hard-coded: when a key is missing the page
 * shows an honest placeholder instead (Part 1 rule 9, CONVENTIONS "Content rules").
 *
 * site_settings keys read (owner fills them in Admin › Settings; ✱ = new key, absent until the owner adds it):
 *  - deposit_pct               number   Sourcing deposit % (existing, used by the quote → order RPC)
 *  - pool_deposit_pct          number   MOQ pool deposit % (existing)
 *  - pool_min_pledge_default   number   default smallest pool pledge, units (existing)
 *  - site_delivery_countries ✱ string[] ISO-2 delivery countries for the public site; falls back to
 *  - dropship_launch_countries string[] ISO-2 (existing)
 *  - site_fee_text ✱           string   one sentence on fees (FAQ "What does it cost to join?")
 *  - site_reply_time ✱         string   e.g. "within one business day" (FAQ intro; hidden when empty)
 *  - site_service_facts ✱      object   per service { minimum, holds_stock, typical_time, you_pay, you_pay_short, best_for }
 *                                       — overrides the texts below field by field. Keys: sourcing, pools, dropship, warehouse,
 *                                       turnkey, brand.
 */

export type SiteServiceSlug = 'sourcing' | 'pools' | 'dropship' | 'warehouse' | 'turnkey' | 'brand';
export const SITE_SERVICE_SLUGS: readonly SiteServiceSlug[] = ['sourcing', 'pools', 'dropship', 'warehouse', 'turnkey', 'brand'];

export type ServiceFacts = {
  /** "Minimum order" (Warehouse: "Minimum") */
  minimum: string;
  holds_stock: string;
  typical_time: string;
  /** long form for cards and service pages */
  you_pay: string;
  /** short form for the comparison table */
  you_pay_short: string;
  best_for: string;
};

export type SiteSettings = {
  depositPct: number | null;
  poolDepositPct: number | null;
  poolMinUnits: number | null;
  /** English country names, sorted as stored */
  deliveryCountries: string[];
  feeText: string;
  replyTime: string | null;
  facts: Record<SiteServiceSlug, ServiceFacts>;
};

/* ───────── pure helpers (unit-testable) ───────── */

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(typeof v === 'string' ? v : String(v));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
/** ISO-2 list → English names; anything that isn't a 2-letter code is dropped. */
export function countryNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((c): c is string => typeof c === 'string' && /^[A-Z]{2}$/.test(c))
    .map((c) => {
      try {
        return regionNames.of(c) ?? c;
      } catch {
        return c;
      }
    });
}

export const formatUnits = (n: number) => new Intl.NumberFormat('en-US').format(n);

/** Honest defaults: facts about how each service works, never invented numbers. */
export function defaultFacts(s: { depositPct: number | null; poolDepositPct: number | null; poolMinUnits: number | null }): Record<SiteServiceSlug, ServiceFacts> {
  return {
    sourcing: {
      minimum: 'Set by the factory, shown on each product',
      holds_stock: 'You',
      typical_time: 'Shown on each product',
      you_pay: s.depositPct ? `${s.depositPct}% deposit, balance after quality check` : 'A deposit, balance after quality check',
      you_pay_short: 'Deposit + balance',
      best_for: 'Your own stock, repeat orders',
    },
    pools: {
      minimum: s.poolMinUnits ? `From ${formatUnits(s.poolMinUnits)} units` : 'Set per pool',
      holds_stock: 'You',
      typical_time: 'Pool closing date + production',
      you_pay: s.poolDepositPct
        ? `A held ${s.poolDepositPct}% deposit; refunded if the pool doesn’t fill`
        : 'A held deposit; refunded if the pool doesn’t fill',
      you_pay_short: 'Held deposit + balance',
      best_for: 'Testing a product, smaller budgets',
    },
    dropship: {
      minimum: 'No minimum',
      holds_stock: 'We do',
      typical_time: 'Shown on each product',
      you_pay: 'Per order, from your wallet',
      you_pay_short: 'Per order',
      best_for: 'Online stores, new products',
    },
    warehouse: {
      minimum: 'Agreed with our team',
      holds_stock: 'We do, for you',
      typical_time: 'Ongoing',
      you_pay: 'Monthly storage + per order',
      you_pay_short: 'Monthly + per order',
      best_for: 'Bulk stock, many small shipments',
    },
    turnkey: {
      minimum: 'Agreed per project',
      holds_stock: 'You',
      typical_time: 'Agreed per project',
      you_pay: 'A deposit, balance before shipping (set per project)',
      you_pay_short: 'Deposit + balance',
      best_for: 'Launching a new brand or range',
    },
    brand: {
      minimum: 'Shown on each branding option',
      holds_stock: 'You',
      typical_time: 'Added to the order',
      you_pay: 'Added to your order',
      you_pay_short: 'With your order',
      best_for: 'Turning products into your brand',
    },
  };
}

/** Pure: raw site_settings → what the pages show. */
export function siteSettingsFrom(raw: Record<string, unknown>): SiteSettings {
  const depositPct = num(raw.deposit_pct);
  const poolDepositPct = num(raw.pool_deposit_pct);
  const poolMinUnits = num(raw.pool_min_pledge_default);
  const facts = defaultFacts({ depositPct, poolDepositPct, poolMinUnits });
  const override = raw.site_service_facts && typeof raw.site_service_facts === 'object' ? (raw.site_service_facts as Record<string, Record<string, unknown>>) : {};
  for (const slug of SITE_SERVICE_SLUGS) {
    const o = override[slug];
    if (!o || typeof o !== 'object') continue;
    for (const k of Object.keys(facts[slug]) as (keyof ServiceFacts)[]) {
      const v = text(o[k]);
      if (v) facts[slug][k] = v;
    }
  }
  const own = countryNames(raw.site_delivery_countries);
  return {
    depositPct,
    poolDepositPct,
    poolMinUnits,
    deliveryCountries: own.length ? own : countryNames(raw.dropship_launch_countries),
    feeText: text(raw.site_fee_text) ?? 'Any service fee, such as the dropshipping fee per order, is shown before you confirm.',
    replyTime: text(raw.site_reply_time),
    facts,
  };
}

/* ───────── reader ───────── */

export type SiteData = { settings: SiteSettings; company: Company | null };

/** One read per request (getSiteContent is cached for 5 minutes, tag site-content). */
export async function getSiteData(): Promise<SiteData> {
  const { settings, company } = await getSiteContent();
  return { settings: siteSettingsFrom(settings), company };
}

/** Footer © year without breaking prerendering (Cache Components forbid new Date() in an uncached render). */
export async function currentYear(): Promise<number> {
  'use cache';
  cacheLife('days');
  cacheTag('site-content');
  return new Date().getFullYear();
}

/** Brand name shown in text; never a supplier name (white-label). */
export const brandName = (c: Company | null) => c?.brand?.trim() || 'Octopus B2B';
