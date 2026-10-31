import { z } from 'zod';

/** Shared Zod contracts (SPEC §9): used by forms, Server Actions, RPC wrappers and the public API. */

const uuid = z.uuid();
const country = z.string().trim().length(2).transform((s) => s.toUpperCase());
const cents = z.number().int().nonnegative();

// ───────── Trade ─────────
export const SubmitRfq = z.object({
  title: z.string().trim().min(3).max(200),
  quantity: z.number().int().positive().max(100_000_000),
  details: z.string().trim().max(5000).optional().default(''),
  productId: uuid.optional(),
  destinationCountry: country.optional(),
  destinationCity: z.string().trim().max(120).optional(),
  targetPriceCents: cents.optional().describe('Target unit price in minor units of the platform currency (GET /settings/currency)'),
  incoterm: z.enum(['EXW', 'FOB', 'CIF', 'CFR', 'DAP', 'DDP', 'FCA']).optional(),
});
export type SubmitRfq = z.infer<typeof SubmitRfq>;

/** Approve a quote → proforma invoice + order. `acceptTermsVersionId` defaults to the currently published T&C. */
export const ApproveQuote = z.object({
  quoteId: uuid,
  acceptTermsVersionId: uuid.optional(),
});
export type ApproveQuote = z.infer<typeof ApproveQuote>;

// ───────── Services & wallet ─────────
export const ServiceRequest = z.object({
  serviceCode: z.string().trim().min(1).max(60),
  productId: uuid.optional(),
  details: z.record(z.string(), z.unknown()).optional().default({}),
});
export type ServiceRequest = z.infer<typeof ServiceRequest>;

export const TopUp = z.object({
  amountCents: z.number().int().min(100).max(100_000_000),
  method: z.enum(['bank_transfer', 'card']).default('bank_transfer'),
  reference: z.string().trim().max(120).optional(),
});
export type TopUp = z.infer<typeof TopUp>;

// ───────── Catalog ─────────
/** Query params arrive as strings, so numbers are coerced. */
export const ProductQuery = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(24),
  ready_to_ship: z.enum(['true', 'false']).optional(),
  dropship: z.enum(['true', 'false']).optional(),
});
export type ProductQuery = z.infer<typeof ProductQuery>;

export const Pagination = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  per_page: z.coerce.number().int().min(1).max(100).default(25),
});

// ───────── API & webhooks ─────────
export const API_SCOPES = [
  'catalog:read',
  'quotes:write',
  'orders:read',
  'orders:write',
  'shipments:read',
  'wallet:read',
  'webhooks:manage',
] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export const SUPPLIER_SCOPES = ['products:write', 'inventory:write', 'rfqs:read', 'quotes:write', 'orders:read'] as const;

/**
 * Public webhook events. `settings.currency_changed` (SPEC §15.1) is platform-wide: it is delivered to every
 * organization's endpoints that subscribe to it.
 */
export const WEBHOOK_EVENTS = ['order.updated', 'quote.created', 'shipment.tracking', 'service_request.updated', 'wallet.updated', 'settings.currency_changed'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

// ───────── Money (SPEC §15.1) ─────────
/** Supported currencies. Every amount in the API is `{ amount_minor, currency }` (minor units = cents / fen). */
export const CURRENCY_CODES = ['USD', 'CNY'] as const;
export const CurrencyCode = z.enum(CURRENCY_CODES);
export type CurrencyCode = z.infer<typeof CurrencyCode>;

export const Amount = z.object({
  amount_minor: z.number().int().describe('Integer minor units (cents / fen) of `currency`'),
  currency: CurrencyCode,
});
export type Amount = z.infer<typeof Amount>;

/** A catalogue price in the currency it was entered in, plus the same price converted to the platform currency. */
export const Price = Amount.extend({
  converted: Amount.extend({ fx_rate_id: z.string().nullable().describe('Approved fx_rates row used for the conversion') }).describe(
    'The price in the platform currency at the approved rate (equal to the original when the currencies match)',
  ),
});
export type Price = z.infer<typeof Price>;

export const CurrencySettings = z.object({
  currency: CurrencyCode.describe('Active platform currency — new quotes, invoices and charges use it'),
  rate: z.object({
    base: z.literal('USD'),
    quote: z.literal('CNY'),
    rate: z.number().positive().describe('CNY per 1 USD (approved billing rate)'),
    effective_from: z.string().nullable(),
    fx_rate_id: z.string().nullable(),
  }),
});
export type CurrencySettings = z.infer<typeof CurrencySettings>;

// ───────── Supplier API (SPEC §7 Supplier API) ─────────
const PriceTierInput = z.object({ min_qty: z.number().int().positive(), unit_price: Amount });

export const SupplierProductUpsert = z.object({
  products: z
    .array(
      z.object({
        sku: z.string().trim().min(1).max(80).describe('Your own SKU — the upsert key'),
        title: z.string().trim().min(3).max(200),
        description: z.string().trim().max(10_000).optional(),
        category_id: uuid.optional(),
        unit: z.string().trim().max(20).default('pcs'),
        moq: z.number().int().positive().default(1),
        lead_time_days: z.number().int().nonnegative().optional(),
        origin_country: country.optional(),
        hs_code: z.string().trim().max(12).optional(),
        price_tiers: z.array(PriceTierInput).min(1).max(10).describe('All tiers must use the same currency (USD or CNY)'),
      }),
    )
    .min(1)
    .max(500),
});
export type SupplierProductUpsert = z.infer<typeof SupplierProductUpsert>;

export const SupplierInventoryUpdate = z.object({
  items: z
    .array(z.object({ sku: z.string().trim().min(1).max(80), stock: z.number().int().nonnegative().optional(), price_tiers: z.array(PriceTierInput).max(10).optional() }))
    .min(1)
    .max(1000),
});
export type SupplierInventoryUpdate = z.infer<typeof SupplierInventoryUpdate>;

export const SupplierQuoteCreate = z.object({
  rfq_id: uuid,
  unit_price: Amount,
  quantity: z.number().int().positive(),
  incoterm: z.enum(['EXW', 'FOB', 'CIF', 'CFR', 'DAP', 'DDP', 'FCA']),
  lead_time_days: z.number().int().nonnegative(),
  shipping: Amount.optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type SupplierQuoteCreate = z.infer<typeof SupplierQuoteCreate>;

const httpsUrl = z
  .url()
  .refine((u) => u.startsWith('https://') || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u + '/'), {
    message: 'Webhook URL must use https (http only for localhost)',
  });

export const WebhookEndpointCreate = z.object({
  url: httpsUrl,
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).default(['order.updated']),
});
export type WebhookEndpointCreate = z.infer<typeof WebhookEndpointCreate>;

export const WebhookEndpointUpdate = z
  .object({
    url: httpsUrl.optional(),
    events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export type WebhookEndpointUpdate = z.infer<typeof WebhookEndpointUpdate>;

export const TokenRequest = z.object({
  grant_type: z.literal('client_credentials'),
  client_id: z.string().min(1).max(100),
  client_secret: z.string().min(1).max(200),
  scope: z.string().max(500).optional(),
});
export type TokenRequest = z.infer<typeof TokenRequest>;

/** Turns a ZodError into RFC 7807 `errors` entries. */
export function zodIssues(e: z.ZodError) {
  return e.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
}
