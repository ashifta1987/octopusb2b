/**
 * Octopus Dropship · Release 6 · Step 14 — pure helpers shared by server and client code (no imports from server-only modules).
 * Money is integer US cents. Nothing here invents a number: unknown stays null.
 */

export const usd = (cents: number | string | null | undefined): string =>
  cents == null || cents === '' ? '—' : `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Spreadsheet-safe CSV cell (formula characters, tabs and CR never lead a cell). */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  s = s.replace(/[\t\r]/g, ' ');
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export const csvLine = (cells: unknown[]): string => cells.map(csvCell).join(',');

// ───────── supplier portal: statuses and labels ─────────
export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

export const PRODUCT_STATUS: Record<string, { label: string; tone: Tone }> = {
  live: { label: 'Live', tone: 'ok' },
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'In review', tone: 'info' },
  in_review: { label: 'In review', tone: 'info' },
  rejected: { label: 'Changes asked', tone: 'warn' },
  paused: { label: 'Paused', tone: 'neutral' },
};
export const SUBMISSION_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'In review', tone: 'info' },
  auto_approved: { label: 'Auto approved', tone: 'ok' },
  approved: { label: 'Approved', tone: 'ok' },
  changes_asked: { label: 'Changes asked', tone: 'warn' },
  rejected: { label: 'Rejected', tone: 'bad' },
};
export const SUBMISSION_KIND: Record<string, string> = {
  new_product: 'New product', price_change: 'Price change', stock_update: 'Stock update', bulk_upload: 'Bulk upload',
};
export const ORDER_STATUS: Record<string, { label: string; tone: Tone }> = {
  to_ship: { label: 'Pack now', tone: 'warn' },
  shipped: { label: 'Shipped', tone: 'ok' },
  problem: { label: 'Problem reported', tone: 'bad' },
  cancelled: { label: 'Cancelled: do not ship', tone: 'bad' },
};
export const CARRIERS = [
  { value: 'yunexpress', label: 'YunExpress' },
  { value: '4px', label: '4PX' },
  { value: 'other', label: 'Other' },
] as const;
export const carrierLabel = (c: string | null | undefined) => CARRIERS.find((x) => x.value === c)?.label ?? '—';

export const countryName = (code: string | null | undefined): string => {
  if (!code) return '—';
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code; } catch { return code; }
};

export const PRODUCT_CATEGORIES = ['Home and kitchen', 'Pets', 'Electronics', 'Phone accessories', 'Lighting', 'Other'];

// ───────── bulk upload (CSV) ─────────
/** Template columns (SupplierBulkUpload.html): [key, header]. The keys are what ds14_bulk_group reads. */
export const TEMPLATE_COLUMNS: [string, string][] = [
  ['model_number', 'Model number'], ['product_name', 'Product name'], ['category', 'Category'], ['brand', 'Brand'], ['description', 'Description'],
  ['variant_option', 'Variant option'], ['variant_sku', 'Variant SKU'], ['cost', 'Cost (USD)'], ['stock', 'Stock'], ['weight_g', 'Weight (g)'],
  ['length_cm', 'Length (cm)'], ['width_cm', 'Width (cm)'], ['height_cm', 'Height (cm)'], ['hs_code', 'HS code'], ['country_of_origin', 'Country of origin'],
  ['battery', 'Battery (yes or no)'], ['liquid', 'Liquid (yes or no)'], ['image_links', 'Image links (separate with |)'], ['handling_days', 'Handling days'],
];
const HEADER_ALIASES: Record<string, string> = {
  model: 'model_number', model_no: 'model_number', sku: 'variant_sku', name: 'product_name', title: 'product_name', option: 'variant_option',
  cost_usd: 'cost', weight: 'weight_g', length: 'length_cm', width: 'width_cm', height: 'height_cm', hs: 'hs_code', origin: 'country_of_origin',
  image_links_separate_with: 'image_links', images: 'image_links', handling: 'handling_days', battery_yes_or_no: 'battery', liquid_yes_or_no: 'liquid',
  weight_g: 'weight_g', length_cm: 'length_cm', width_cm: 'width_cm', height_cm: 'height_cm',
};
export const MAX_BULK_ROWS = 500;
export const MAX_BULK_BYTES = 2_000_000;

/** RFC 4180 style CSV → rows of cells. Handles quotes, escaped quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const normHeader = (h: string) => {
  const k = h.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return HEADER_ALIASES[k] ?? k;
};

export type BulkParse = { rows: Record<string, string>[]; missing: string[]; unknown: string[]; error: string | null };
const REQUIRED = ['model_number', 'product_name', 'variant_sku', 'cost', 'stock'];

/** CSV text → row objects keyed by template keys. The first CSV row is the header, so row N here is spreadsheet row N + 1. */
export function parseBulkCsv(text: string): BulkParse {
  if (text.length > MAX_BULK_BYTES) return { rows: [], missing: [], unknown: [], error: 'The file is too large. Upload up to 2 MB (500 rows).' };
  const grid = parseCsv(text);
  if (grid.length < 2) return { rows: [], missing: [], unknown: [], error: 'The file has no data rows. Use the template and fill in at least one row.' };
  const keys = grid[0].map(normHeader);
  const known = new Set(TEMPLATE_COLUMNS.map(([k]) => k));
  const missing = REQUIRED.filter((k) => !keys.includes(k));
  const unknown = grid[0].filter((_, i) => !known.has(keys[i]));
  if (missing.length) return { rows: [], missing, unknown, error: `These columns are missing: ${missing.map((k) => TEMPLATE_COLUMNS.find(([x]) => x === k)?.[1] ?? k).join(', ')}. Download the template.` };
  if (grid.length - 1 > MAX_BULK_ROWS) return { rows: [], missing: [], unknown, error: `The file has ${grid.length - 1} rows. Upload up to ${MAX_BULK_ROWS} rows at a time.` };
  const rows = grid.slice(1).map((cells) => {
    const o: Record<string, string> = {};
    keys.forEach((k, i) => { if (known.has(k)) o[k] = (cells[i] ?? '').trim().slice(0, 2000); });
    return o;
  });
  return { rows, missing: [], unknown, error: null };
}

export const templateCsv = (): string => `${csvLine(TEMPLATE_COLUMNS.map(([, h]) => h))}\n`;

// ───────── sales partners ─────────
export type PartnerRule = { kind: 'percent_of_plan_fee' | 'fixed_per_merchant'; rate_bps: number | null; fixed_cents: number | null; months: number; payout: 'monthly' };
export const ruleText = (r: PartnerRule | null | undefined): string =>
  !r ? 'No rule set'
    : r.kind === 'percent_of_plan_fee' ? `${Number(((r.rate_bps ?? 0) / 100).toFixed(2))}% of the plan fee for ${r.months} month${r.months === 1 ? '' : 's'}, paid monthly`
      : `${usd(r.fixed_cents)} per merchant per month for ${r.months} month${r.months === 1 ? '' : 's'}, paid monthly`;
export const PARTNER_STATUS: Record<string, { label: string; tone: Tone }> = {
  invited: { label: 'Invited', tone: 'info' }, active: { label: 'Active', tone: 'ok' }, paused: { label: 'Paused', tone: 'warn' }, ended: { label: 'Ended', tone: 'neutral' },
};
export const PARTNER_KIND: Record<string, string> = { agency: 'Agency', influencer: 'Influencer', other: 'Other' };

// ───────── channels (Integrations / Connect a channel) ─────────
export type ChannelKey = 'shopify' | 'woocommerce' | 'wix' | 'tiktok_shop' | 'ebay' | 'amazon';
export type ChannelInfo = { key: ChannelKey; name: string; letter: string; how: string; notes: string[]; steps: string[]; region?: string };
/** Order and wording follow Integrations.html. Support per platform changes; each API is confirmed before it is built (owner decision: connections come last). */
export const CHANNELS: ChannelInfo[] = [
  { key: 'shopify', name: 'Shopify', letter: 'S', how: 'Install from Shopify, approve access', notes: ['Push products', 'Order sync and tracking', 'Stock and price sync'], steps: ['Install', 'Approve access', 'Test', 'Done'] },
  { key: 'woocommerce', name: 'WooCommerce', letter: 'W', how: 'Store address and access approval', notes: ['Push products', 'Order sync and tracking', 'Stock and price sync'], steps: ['Store address', 'Approve access', 'Test', 'Done'] },
  { key: 'wix', name: 'Wix', letter: 'W', how: 'Sign in to Wix and approve', notes: ['Push products', 'Order sync and tracking', 'Price sync (check support)'], steps: ['Sign in', 'Approve access', 'Test', 'Done'] },
  { key: 'tiktok_shop', name: 'TikTok Shop', letter: 'T', how: 'Seller sign in and approval', notes: ['Push products', 'Order sync and tracking', 'Available in selected countries only'], steps: ['Choose region', 'Sign in and approve', 'Choose shop', 'Done'] },
  { key: 'ebay', name: 'eBay', letter: 'e', how: 'Sign in to eBay and approve', notes: ['Push listings', 'Order sync and tracking', 'Category rules differ by country'], steps: ['Sign in', 'Approve access', 'Test', 'Done'] },
  { key: 'amazon', name: 'Amazon', letter: 'A', how: 'Seller account authorization', notes: ['Needs approved seller account', 'Category approval may apply', 'Planned after other channels'], steps: [] },
];
export const CHANNEL_KEYS = CHANNELS.map((c) => c.key);
export const isChannel = (k: string): k is ChannelKey => (CHANNEL_KEYS as string[]).includes(k);
export const CONNECT_BLOCKED_REASON = 'Connections open in the store-connection release.';
/** Planned capability matrix (design). Not live: shown under "Planned support". */
export const CAPABILITIES: { feature: string; values: Record<ChannelKey, 'Planned'> }[] = [
  'Push products', 'Import orders', 'Send tracking', 'Stock sync', 'Price sync', 'Cancellations and refunds',
].map((feature) => ({ feature, values: Object.fromEntries(CHANNEL_KEYS.map((k) => [k, 'Planned'])) as Record<ChannelKey, 'Planned'> }));

export type ChannelSettings = { sync_stock: boolean; sync_prices: boolean; send_tracking: boolean; cancel_on_store_cancel: boolean };
export const DEFAULT_CHANNEL_SETTINGS: ChannelSettings = { sync_stock: true, sync_prices: true, send_tracking: true, cancel_on_store_cancel: true };
export const SETTING_LABELS: { key: keyof ChannelSettings; label: string; hint: string }[] = [
  { key: 'sync_stock', label: 'Sync stock automatically', hint: 'Stock levels follow Octopus availability once the store is connected.' },
  { key: 'sync_prices', label: 'Sync prices from pricing rules', hint: 'Prices follow your Pricing and sync rules.' },
  { key: 'send_tracking', label: 'Send tracking to the store', hint: 'The buyer gets the tracking number from your store.' },
  { key: 'cancel_on_store_cancel', label: 'Cancel orders when the store cancels', hint: 'A store cancellation stops the order here if it is not packed yet.' },
];

// ───────── docs ─────────
export const DOC_KIND: Record<string, string> = { certificate: 'Certificate', test_report: 'Test report', hs_document: 'HS document', msds: 'Safety data sheet', other: 'Other' };
export const DOC_STATUS: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Waiting for review', tone: 'info' }, verified: { label: 'Verified', tone: 'ok' }, rejected: { label: 'Rejected', tone: 'bad' }, expired: { label: 'Expired', tone: 'warn' },
};
export const DOC_MAX_BYTES = 10 * 1024 * 1024;

/** File type from the first bytes (never the file name or the browser's type). */
export function detectDocType(b: Uint8Array): { mime: 'application/pdf' | 'image/png' | 'image/jpeg'; ext: 'pdf' | 'png' | 'jpg' } | null {
  if (b.length >= 5 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d) return { mime: 'application/pdf', ext: 'pdf' };
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return { mime: 'image/png', ext: 'png' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  return null;
}

export const fmtDay = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '—');
