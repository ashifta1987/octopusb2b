/** Supported platform currencies (SPEC §15.1). Amounts are integer minor units (cents / fen) + a currency code. */
export type Currency = 'USD' | 'CNY';
export const CURRENCIES: Currency[] = ['USD', 'CNY'];
/** Code-style symbols avoid confusing CNY with JPY: "US$ 190.00", "CN¥ 1,368.00". */
export const CURRENCY_PREFIX: Record<Currency, string> = { USD: 'US$', CNY: 'CN¥' };

export function asCurrency(c: string | null | undefined): Currency {
  return c === 'CNY' ? 'CNY' : 'USD';
}

/** Format minor units in the record's currency, e.g. money(19000, 'USD') → "US$ 190.00". */
export function money(minor: number | null | undefined, currency: string | null | undefined = 'USD', opts: { compact?: boolean } = {}) {
  if (minor == null) return '—';
  const cur = asCurrency(currency);
  const v = Number(minor) / 100;
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  const num = opts.compact && abs >= 10000
    ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(abs)
    : new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: abs < 1 && abs !== 0 ? 3 : 2 }).format(abs);
  return `${sign}${CURRENCY_PREFIX[cur]} ${num}`;
}

/** @deprecated use money(minor, currency). Kept for USD-only call sites. */
export function usd(cents: number | null | undefined, opts: { compact?: boolean } = {}) {
  return money(cents, 'USD', opts);
}

/** Mirror of SQL convert_amount(): rate = CNY per 1 USD; rounds to the target currency step (minor units). */
export function convertMinor(minor: number, from: string, to: string, rate: number, stepMinor = 1) {
  const f = asCurrency(from), t = asCurrency(to);
  if (f === t) return minor;
  const raw = f === 'USD' ? minor * rate : minor / rate;
  const step = Math.max(1, stepMinor);
  return Math.round(raw / step) * step;
}

/** Replace "{currency}" in CMS text with the active currency code. */
export function withCurrency(text: string, currency: string) {
  return text.replaceAll('{currency}', asCurrency(currency));
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
    WALLET_INSUFFICIENT: 'Not enough available in your wallet (balance plus any credit limit). Top up your wallet and try again.',
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
    // ADDON-41 shared parts
    INSUFFICIENT_FUNDS: 'Not enough in the wallet. Add funds by bank transfer and try again.',
    SLIP_REQUIRED: 'Attach the transfer slip (PDF, JPG or PNG) before sending.',
    BANK_REF_REQUIRED: 'Enter the bank reference from the statement.',
    REASON_REQUIRED: 'Add a reason.',
    NOTE_REQUIRED: 'Add a note explaining the decision.',
    ALREADY_DECIDED: 'This approval was already decided.',
    STEP_UP_REQUIRED: 'Enter your 2FA code again to do this.',
    MANAGER_LIMITS_NOT_SET: 'Ask the owner to set your own approval limit first.',
    ABOVE_MANAGER_LIMIT: 'The order limit is above your own amount limit. The owner has to set it.',
    BELOW_MANAGER_MARGIN: 'The minimum margin is below your own minimum. The owner has to set it.',
    NOT_A_MANAGER: 'Limits can only be set for account managers.',
    STAFF_CANNOT_BE_CUSTOMER: 'A staff account cannot belong to a customer company. Use a separate account.',
    CUSTOMER_CANNOT_BE_STAFF: 'This account belongs to a customer company. Create a separate staff account.',
    AUDIT_APPEND_ONLY: 'The activity log cannot be changed.',
  };
  // ADDON-27 publish gate: the reason after the code is already plain language
  if (code === 'IMPORT_PUBLISH_BLOCKED') return m.slice(m.indexOf(':') + 1).trim().replace(/^./, (c) => c.toUpperCase()) + '.';
  return map[code] ?? m;
}

export const COUNTRY_NAMES: Record<string, string> = {
  CN: 'China', DE: 'Germany', VN: 'Vietnam', LK: 'Sri Lanka', MY: 'Malaysia', TR: 'Türkiye', NL: 'Netherlands', AE: 'United Arab Emirates',
  US: 'United States', GB: 'United Kingdom', IN: 'India', SA: 'Saudi Arabia', FR: 'France', ES: 'Spain', IT: 'Italy', BR: 'Brazil',
  AU: 'Australia', CA: 'Canada', JP: 'Japan', KR: 'South Korea', SG: 'Singapore', ZA: 'South Africa', NG: 'Nigeria', EG: 'Egypt',
  QA: 'Qatar', KW: 'Kuwait', OM: 'Oman', BH: 'Bahrain', PK: 'Pakistan', BD: 'Bangladesh', ID: 'Indonesia', TH: 'Thailand', PH: 'Philippines', MX: 'Mexico', PL: 'Poland',
  // ADDON-31: Turnkey buyer markets (Gulf, Africa, South Asia)
  KE: 'Kenya', GH: 'Ghana', TZ: 'Tanzania', UG: 'Uganda', ET: 'Ethiopia', RW: 'Rwanda', CI: "Côte d'Ivoire", SN: 'Senegal', CM: 'Cameroon', ZM: 'Zambia',
  AO: 'Angola', MA: 'Morocco', DZ: 'Algeria', TN: 'Tunisia', LY: 'Libya', JO: 'Jordan', LB: 'Lebanon', IQ: 'Iraq', YE: 'Yemen', NP: 'Nepal',
  AF: 'Afghanistan', MV: 'Maldives', KH: 'Cambodia', MM: 'Myanmar', SD: 'Sudan', DJ: 'Djibouti', SO: 'Somalia', MZ: 'Mozambique', ZW: 'Zimbabwe',
};


/** Product status as shown to staff: a draft that is waiting for a supplier quote / still in development says so (6 Nov 2026). */
export function productStatusView(status: string | null | undefined, listingStatus?: string | null): { status: string; label?: string; tone?: 'amber' | 'gray' } {
  const s = status ?? 'draft';
  if (s === 'draft' && listingStatus === 'needs_quote') return { status: 'needs_quote', label: 'Needs quote', tone: 'amber' };
  if (s === 'draft' && listingStatus === 'in_development') return { status: 'in_development', label: 'In development', tone: 'gray' };
  return { status: s };
}
