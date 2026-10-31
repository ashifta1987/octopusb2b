/** Money is stored as integer cents in USD (SPEC §6). */
export function usd(cents: number | null | undefined, opts: { compact?: boolean } = {}) {
  if (cents == null) return '—';
  const v = cents / 100;
  if (opts.compact && Math.abs(v) >= 10000)
    return '$' + new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v);
  const digits = Math.abs(v) < 1 && v !== 0 ? 2 : 2;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: Math.abs(v) < 1 ? 3 : 2 }).format(v);
}

export function toCents(input: string | number) {
  const n = typeof input === 'number' ? input : parseFloat(String(input).replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}

export function fmtDate(d: string | Date | null | undefined, withTime = false) {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: withTime ? undefined : 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
}

export function humanize(s: string | null | undefined) {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

/** Price tier selection: the highest min_qty tier that the quantity reaches. */
export function tierFor<T extends { min_qty: number; unit_price_cents: number }>(tiers: T[], qty: number): T | undefined {
  const sorted = [...tiers].sort((a, b) => a.min_qty - b.min_qty);
  let pick: T | undefined;
  for (const t of sorted) if (qty >= t.min_qty) pick = t;
  return pick;
}

/** Maps DB error codes raised by RPCs to user-facing messages (CMS-overridable later). */
export function mapDbError(e: { message?: string } | null | undefined): string {
  const m = e?.message ?? 'Something went wrong';
  const code = m.split(':')[0].trim();
  const map: Record<string, string> = {
    WALLET_INSUFFICIENT: 'Your wallet balance is too low. Top up your wallet and try again.',
    WALLET_DISABLED: 'The wallet is switched off. This will be invoiced instead.',
    FORBIDDEN: 'You do not have permission to do this.',
    NO_ORG: 'Please complete your company profile first.',
    QUOTE_EXPIRED: 'This quote has expired.',
    MAKER_CANNOT_APPROVE: 'You cannot approve a request you created (maker–checker).',
    OVER_LIMIT_NEEDS_ADMIN: 'This amount is over your approval limit and needs an Admin.',
    SUPPLIER_LISTINGS_OFF: 'This supplier’s “listings live” switch is off.',
    SUPPLIER_RFQ_REPLIES_OFF: 'This supplier’s “RFQ replies” switch is off.',
    INVALID_TRANSITION: 'That status change is not allowed from the current status.',
    DEPOSIT_NOT_PAID: 'The deposit has not been paid yet.',
    BALANCE_NOT_PAID: 'The balance has not been paid yet.',
    INVALID_AMOUNT: 'Invalid amount.',
    KYC_INVALID_TRANSITION: 'KYC cannot be changed from its current status.',
    USE_TRANSITION_PRODUCT: 'Publishing must go through moderation.',
  };
  return map[code] ?? m;
}

export const COUNTRY_NAMES: Record<string, string> = {
  CN: 'China', DE: 'Germany', VN: 'Vietnam', LK: 'Sri Lanka', MY: 'Malaysia', TR: 'Türkiye', NL: 'Netherlands', AE: 'United Arab Emirates',
  US: 'United States', GB: 'United Kingdom', IN: 'India', SA: 'Saudi Arabia', FR: 'France', ES: 'Spain', IT: 'Italy', BR: 'Brazil',
  AU: 'Australia', CA: 'Canada', JP: 'Japan', KR: 'South Korea', SG: 'Singapore', ZA: 'South Africa', NG: 'Nigeria', EG: 'Egypt',
  QA: 'Qatar', KW: 'Kuwait', OM: 'Oman', BH: 'Bahrain', PK: 'Pakistan', BD: 'Bangladesh', ID: 'Indonesia', TH: 'Thailand', PH: 'Philippines', MX: 'Mexico', PL: 'Poland',
};
