import { z } from 'zod';
import {
  Amount,
  API_SCOPES,
  ApproveQuote,
  CURRENCY_CODES,
  CurrencySettings,
  Price,
  ServiceRequest,
  SubmitRfq,
  SUPPLIER_SCOPES,
  SupplierInventoryUpdate,
  SupplierProductUpsert,
  SupplierQuoteCreate,
  WEBHOOK_EVENTS,
  WebhookEndpointCreate,
  WebhookEndpointUpdate,
} from '@/lib/contracts';

/**
 * OpenAPI 3.1 documents for the public API and the supplier API. Request bodies and the money components
 * (Amount, Price, CurrencySettings) are generated from the shared Zod contracts (z.toJSONSchema); the other response
 * schemas are written below. The same operation lists drive the Postman collections (lib/api/postman.ts).
 *
 * Keep this module free of server-only / Next imports: scripts/postman-sync.mjs loads it with plain Node.
 */
const schema = (s: z.ZodType) => {
  const j = z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete j.$schema;
  return j;
};

export type Op = {
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  summary: string;
  tag: string;
  scopes: string[];
  query?: { name: string; description: string; schema?: Record<string, unknown> }[];
  pathParams?: { name: string; description: string }[];
  body?: z.ZodType;
  example?: unknown;
  /** Postman request body when it differs from the OpenAPI example (uses {{variables}} chained from earlier requests). */
  postmanExample?: unknown;
  response: string; // component schema name ('' = no body)
  status?: number;
  /** Other documented statuses a healthy deployment may return (e.g. 403 while the supplier portal is closed). */
  alsoOk?: number[];
};

/** Postman folder order (SPEC §15.2). */
export const PUBLIC_TAGS = ['Auth', 'Settings', 'Catalog', 'RFQs & quotes', 'Orders', 'Shipments', 'Wallet & ledger', 'Service requests', 'Webhooks'] as const;

export const OPERATIONS: Op[] = [
  { method: 'get', path: '/settings/currency', summary: 'Platform currency and approved exchange rate', tag: 'Settings', scopes: ['catalog:read'], response: 'CurrencySettingsEnvelope' },
  {
    method: 'get', path: '/products', summary: 'Search live products', tag: 'Catalog', scopes: ['catalog:read'], response: 'ProductList',
    query: [
      { name: 'q', description: 'Full-text search' },
      { name: 'category', description: 'Category id or slug (includes sub-categories)' },
      { name: 'page', description: 'Page (1-based)', schema: { type: 'integer', minimum: 1, default: 1 } },
      { name: 'per_page', description: 'Page size (max 100)', schema: { type: 'integer', minimum: 1, maximum: 100, default: 24 } },
      { name: 'ready_to_ship', description: 'true/false', schema: { type: 'string', enum: ['true', 'false'] } },
      { name: 'dropship', description: 'Available for dropshipping: true/false', schema: { type: 'string', enum: ['true', 'false'] } },
    ],
  },
  { method: 'get', path: '/products/{id}', summary: 'Product detail with price tiers and specs', tag: 'Catalog', scopes: ['catalog:read'], response: 'ProductDetail', pathParams: [{ name: 'id', description: 'Product id or slug' }] },
  { method: 'get', path: '/categories', summary: 'Category tree (flat)', tag: 'Catalog', scopes: ['catalog:read'], response: 'CategoryList', query: [{ name: 'level', description: '1–4' }, { name: 'parent_id', description: 'Parent category id' }] },
  { method: 'get', path: '/rfqs', summary: 'List your RFQs', tag: 'RFQs & quotes', scopes: ['quotes:write', 'orders:read'], response: 'RfqList', query: [{ name: 'status', description: 'Filter by status' }, { name: 'page', description: 'Page' }, { name: 'per_page', description: 'Page size' }] },
  {
    method: 'post', path: '/rfqs', summary: 'Submit an RFQ', tag: 'RFQs & quotes', scopes: ['quotes:write'], body: SubmitRfq, response: 'RfqEnvelope', status: 201,
    example: { title: '5,000 pairs nitrile-coated work gloves', quantity: 5000, details: 'Size L, EN 388', destinationCountry: 'NL', destinationCity: 'Rotterdam', incoterm: 'FOB' },
  },
  { method: 'get', path: '/rfqs/{id}', summary: 'RFQ with its quotes', tag: 'RFQs & quotes', scopes: ['quotes:write', 'orders:read'], response: 'RfqEnvelope', pathParams: [{ name: 'id', description: 'RFQ id or code' }] },
  { method: 'get', path: '/quotes', summary: 'Quotes for an RFQ', tag: 'RFQs & quotes', scopes: ['quotes:write', 'orders:read'], response: 'QuoteList', query: [{ name: 'rfq_id', description: 'RFQ id or code' }] },
  { method: 'get', path: '/orders', summary: 'List your orders', tag: 'Orders', scopes: ['orders:read'], response: 'OrderList', query: [{ name: 'status', description: 'Filter by status' }, { name: 'page', description: 'Page' }, { name: 'per_page', description: 'Page size' }] },
  { method: 'post', path: '/orders', summary: 'Create an order from a quote (issues the proforma invoice)', tag: 'Orders', scopes: ['orders:write'], body: ApproveQuote, response: 'OrderEnvelope', status: 201, example: { quoteId: '3f0c1a52-8f5e-4c6b-9b7a-2d1e0f9a8b7c' }, postmanExample: { quoteId: '{{quote_id}}' } },
  { method: 'get', path: '/orders/{id}', summary: 'Order detail with timeline, documents and shipments', tag: 'Orders', scopes: ['orders:read'], response: 'OrderEnvelope', pathParams: [{ name: 'id', description: 'Order id or code (ORD-…)' }] },
  { method: 'get', path: '/shipments/{id}/tracking', summary: 'Shipment tracking events', tag: 'Shipments', scopes: ['shipments:read', 'orders:read'], response: 'TrackingEnvelope', pathParams: [{ name: 'id', description: 'Shipment id, SHP- code or tracking number' }] },
  {
    method: 'get', path: '/wallet', summary: 'Wallet balances per currency and ledger lines', tag: 'Wallet & ledger', scopes: ['wallet:read'], response: 'WalletEnvelope',
    query: [{ name: 'currency', description: 'Wallet whose ledger lines to list (default: platform currency)', schema: { type: 'string', enum: [...CURRENCY_CODES] } }, { name: 'page', description: 'Page' }, { name: 'per_page', description: 'Page size' }],
  },
  { method: 'get', path: '/service-requests', summary: 'List service requests', tag: 'Service requests', scopes: ['orders:read'], response: 'ServiceRequestList', query: [{ name: 'page', description: 'Page' }, { name: 'per_page', description: 'Page size' }] },
  { method: 'post', path: '/service-requests', summary: 'Request a service (sample, QC, certification, 3PL, dropship)', tag: 'Service requests', scopes: ['orders:write'], body: ServiceRequest, response: 'ServiceRequestEnvelope', status: 201, example: { serviceCode: 'qc', details: { notes: 'Pre-shipment inspection' } } },
  { method: 'get', path: '/webhooks', summary: 'List webhook endpoints', tag: 'Webhooks', scopes: ['webhooks:manage'], response: 'WebhookList' },
  { method: 'post', path: '/webhooks', summary: 'Register a webhook endpoint (secret returned once)', tag: 'Webhooks', scopes: ['webhooks:manage'], body: WebhookEndpointCreate, response: 'WebhookEnvelope', status: 201, example: { url: 'https://example.com/octopus/webhooks', events: ['order.updated', 'shipment.tracking', 'settings.currency_changed'] } },
  { method: 'get', path: '/webhooks/{id}', summary: 'Webhook endpoint with recent deliveries', tag: 'Webhooks', scopes: ['webhooks:manage'], response: 'WebhookEnvelope', pathParams: [{ name: 'id', description: 'Endpoint id' }] },
  { method: 'patch', path: '/webhooks/{id}', summary: 'Update a webhook endpoint', tag: 'Webhooks', scopes: ['webhooks:manage'], body: WebhookEndpointUpdate, response: 'WebhookEnvelope', pathParams: [{ name: 'id', description: 'Endpoint id' }], example: { active: false } },
  { method: 'post', path: '/webhooks/{id}/test', summary: 'Send a signed ping event', tag: 'Webhooks', scopes: ['webhooks:manage'], response: 'WebhookTestEnvelope', pathParams: [{ name: 'id', description: 'Endpoint id' }] },
  { method: 'delete', path: '/webhooks/{id}', summary: 'Delete a webhook endpoint', tag: 'Webhooks', scopes: ['webhooks:manage'], response: '', status: 204, pathParams: [{ name: 'id', description: 'Endpoint id' }] },
];

const SUPPLIER_UNAVAILABLE = [403, 501];

export const SUPPLIER_OPERATIONS: Op[] = [
  { method: 'get', path: '/products', summary: 'List your products (any status)', tag: 'Products', scopes: ['products:write'], response: 'SupplierProductList', alsoOk: SUPPLIER_UNAVAILABLE, query: [{ name: 'page', description: 'Page' }, { name: 'per_page', description: 'Page size' }] },
  {
    method: 'post', path: '/products', summary: 'Bulk upsert products by SKU (goes to moderation)', tag: 'Products', scopes: ['products:write'], body: SupplierProductUpsert, response: 'SupplierSyncResult', status: 202, alsoOk: SUPPLIER_UNAVAILABLE,
    example: { products: [{ sku: 'GLV-NIT-L', title: 'Nitrile-coated work gloves, size L', unit: 'pairs', moq: 1000, lead_time_days: 20, origin_country: 'CN', hs_code: '611610', price_tiers: [{ min_qty: 1000, unit_price: { amount_minor: 650, currency: 'CNY' } }, { min_qty: 5000, unit_price: { amount_minor: 580, currency: 'CNY' } }] }] },
  },
  {
    method: 'patch', path: '/inventory', summary: 'Update stock and prices by SKU', tag: 'Inventory', scopes: ['inventory:write'], body: SupplierInventoryUpdate, response: 'SupplierSyncResult', alsoOk: SUPPLIER_UNAVAILABLE,
    example: { items: [{ sku: 'GLV-NIT-L', stock: 120000, price_tiers: [{ min_qty: 1000, unit_price: { amount_minor: 640, currency: 'CNY' } }] }] },
  },
  { method: 'get', path: '/rfqs', summary: 'RFQs assigned to you', tag: 'RFQs & quotes', scopes: ['rfqs:read'], response: 'SupplierRfqList', alsoOk: SUPPLIER_UNAVAILABLE },
  {
    method: 'post', path: '/quotes', summary: 'Quote an assigned RFQ', tag: 'RFQs & quotes', scopes: ['quotes:write'], body: SupplierQuoteCreate, response: 'SupplierQuoteEnvelope', status: 201, alsoOk: SUPPLIER_UNAVAILABLE,
    example: { rfq_id: '3f0c1a52-8f5e-4c6b-9b7a-2d1e0f9a8b7c', unit_price: { amount_minor: 620, currency: 'CNY' }, quantity: 5000, incoterm: 'FOB', lead_time_days: 25, shipping: { amount_minor: 180000, currency: 'CNY' }, notes: 'EN 388 certified' },
    postmanExample: { rfq_id: '{{rfq_id}}', unit_price: { amount_minor: 620, currency: 'CNY' }, quantity: 5000, incoterm: 'FOB', lead_time_days: 25, shipping: { amount_minor: 180000, currency: 'CNY' }, notes: 'EN 388 certified' },
  },
  { method: 'get', path: '/orders', summary: 'Orders placed with you', tag: 'Orders', scopes: ['orders:read'], response: 'SupplierOrderList', alsoOk: SUPPLIER_UNAVAILABLE },
];

export const SUPPLIER_TAGS = ['Auth', 'Products', 'Inventory', 'RFQs & quotes', 'Orders'] as const;

const ts = { type: 'string', description: 'ISO 8601 timestamp' };
const str = { type: 'string' };
const int = { type: 'integer' };
const bool = { type: 'boolean' };
const nullable = (s: Record<string, unknown>) => ({ anyOf: [s, { type: 'null' }] });
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', ...(required.length ? { required } : {}), properties });
const list = (r: string, paged = true) => obj({ data: { type: 'array', items: ref(r) }, ...(paged ? { meta: ref('PageMeta') } : {}) }, ['data']);
const envelope = (r: string) => obj({ data: ref(r), simulated: { type: 'boolean', description: 'true when a test key was used — nothing was written' } }, ['data']);
const currency = { type: 'string', enum: [...CURRENCY_CODES], description: 'Currency the record is locked in' };

const MONEY_SCHEMAS: Record<string, unknown> = {
  Amount: { ...schema(Amount), description: 'Every amount in the API: integer minor units + ISO 4217 currency (USD or CNY).' },
  Price: { ...schema(Price), description: 'A catalogue price in the currency it was entered in, plus `converted` into the platform currency at the approved rate.' },
  CurrencySettings: schema(CurrencySettings),
};

const SCHEMAS: Record<string, unknown> = {
  ...MONEY_SCHEMAS,
  Problem: {
    type: 'object',
    description: 'RFC 7807 problem details',
    required: ['status', 'code'],
    properties: { type: str, title: str, status: int, code: str, detail: str, errors: { type: 'array', items: obj({ path: str, message: str }) } },
  },
  PageMeta: obj({ page: int, per_page: int, total: int, total_pages: int }, ['page', 'per_page', 'total']),
  Supplier: { ...obj({ code: { type: 'string', example: 'OCT-1101' }, country: { type: 'string', example: 'CN' }, verified: bool }, ['code', 'country']), description: 'Suppliers are identified by code and country only' },
  Product: obj(
    {
      id: str, slug: str, title: str, description: nullable(str), category_id: nullable(str), unit: str, moq: int, lead_time_days: nullable(int), incoterm: nullable(str),
      origin_country: nullable(str), hs_code: nullable(str), image_url: nullable(str), from_price: nullable(ref('Price')), currency: { ...currency, description: 'Currency the supplier entered the prices in' },
      ready_to_ship: bool, octopus_dropship: bool, supplier: nullable(ref('Supplier')),
    },
    ['id', 'slug', 'title', 'unit', 'moq', 'from_price', 'currency'],
  ),
  ProductDetailData: {
    allOf: [
      ref('Product'),
      obj(
        {
          price_tiers: { type: 'array', items: obj({ min_qty: int, unit_price: ref('Price') }, ['min_qty', 'unit_price']) },
          specs: { type: 'array', items: obj({ name: str, value: str }) },
          media: { type: 'array', items: obj({ url: str, kind: str, alt: nullable(str) }) },
          tags: { type: 'array', items: obj({ name: str, slug: str, kind: str }) },
          certificates: { type: 'array', items: obj({ name: str, issuer: nullable(str), expires_at: nullable(str) }) },
        },
        ['price_tiers', 'specs', 'media', 'tags', 'certificates'],
      ),
    ],
  },
  Category: obj({ id: str, parent_id: nullable(str), name: str, slug: str, level: { type: 'integer', minimum: 1, maximum: 4 }, hs_code: nullable(str), sort: int }, ['id', 'name', 'slug', 'level']),
  Quote: obj(
    {
      id: str, code: { type: 'string', example: 'QT-1001-1' }, rfq_id: str, quantity: int, incoterm: nullable(str), lead_time_days: nullable(int), notes: nullable(str),
      status: { enum: ['draft', 'sent', 'viewed', 'approved', 'rejected', 'expired', 'superseded'] }, valid_until: ts, created_at: ts,
      currency, fx_rate_id: nullable(str), unit_price: ref('Amount'), shipping: ref('Amount'), total: ref('Amount'), supplier: nullable(ref('Supplier')),
    },
    ['id', 'code', 'rfq_id', 'quantity', 'status', 'currency', 'unit_price', 'shipping', 'total'],
  ),
  Rfq: obj(
    {
      id: str, code: { type: 'string', example: 'RFQ-1001' }, title: str, details: nullable(str), quantity: int, unit: str,
      status: { enum: ['draft', 'submitted', 'assigned', 'quoting', 'quoted', 'accepted', 'expired', 'cancelled'] }, product_id: nullable(str),
      destination_country: nullable(str), destination_city: nullable(str), incoterm: nullable(str), expires_at: nullable(ts), created_at: ts, updated_at: ts,
      currency, fee: { ...ref('Amount'), description: 'RFQ fee charged (wallet) in the RFQ currency' }, target_price: nullable(ref('Amount')),
      quotes: { type: 'array', items: ref('Quote') },
    },
    ['id', 'code', 'title', 'quantity', 'status', 'currency', 'fee', 'target_price'],
  ),
  Order: obj(
    {
      id: str, code: { type: 'string', example: 'ORD-2202' }, pi_number: str,
      status: { enum: ['pi_issued', 'deposit_pending', 'deposit_paid', 'confirmed', 'in_production', 'qc', 'balance_pending', 'balance_paid', 'ready_to_ship', 'shipped', 'delivered', 'closed', 'cancelled', 'disputed'] },
      title: str, quantity: int, deposit_pct: { type: 'number' }, incoterm: nullable(str), quote_id: nullable(str), rfq_id: nullable(str), terms_version_id: nullable(str),
      currency, fx_rate_id: nullable(str), unit_price: ref('Amount'), shipping: ref('Amount'), total: ref('Amount'), deposit: ref('Amount'), paid: ref('Amount'), balance: ref('Amount'),
      supplier: nullable(ref('Supplier')),
      events: { type: 'array', items: obj({ kind: str, title: str, body: nullable(str), created_at: ts }) },
      documents: { type: 'array', items: obj({ id: str, doc_type: str, number: str, currency, amount: nullable(ref('Amount')), status: str, created_at: ts }, ['id', 'doc_type', 'amount']) },
      shipments: { type: 'array', items: obj({ id: str, code: str, tracking_no: nullable(str), status: str, eta: nullable(str), shipping_rate: nullable(ref('Amount')) }, ['id', 'code', 'status']) },
      created_at: ts,
    },
    ['id', 'code', 'status', 'currency', 'unit_price', 'shipping', 'total', 'deposit', 'paid', 'balance'],
  ),
  Tracking: obj(
    {
      id: str, code: str, order_id: nullable(str), order_code: nullable(str), service: str, service_code: nullable(str), tracking_no: nullable(str),
      status: { enum: ['draft', 'priced', 'created', 'label_ready', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned'] }, eta: nullable(str),
      events: { type: 'array', items: obj({ status: str, description: nullable(str), location: nullable(str), occurred_at: ts }) },
    },
    ['id', 'code', 'status', 'events'],
  ),
  Wallet: obj(
    {
      currency: { ...currency, description: 'Wallet whose `balance` and `entries` are shown' },
      platform_currency: { type: 'string', enum: [...CURRENCY_CODES], description: 'Charges use the wallet in this currency' },
      balance: ref('Amount'),
      balances: { type: 'array', items: ref('Amount'), description: 'One wallet per currency' },
      wallet_enabled: bool,
      entries: {
        type: 'array',
        items: obj({ id: int, direction: { enum: ['credit', 'debit'] }, amount: ref('Amount'), memo: nullable(str), journal: nullable(str), stream: nullable(str), ref_type: nullable(str), created_at: ts }, ['id', 'direction', 'amount']),
      },
    },
    ['currency', 'platform_currency', 'balance', 'balances', 'entries'],
  ),
  ServiceRequestObj: obj(
    {
      id: str, code: str, service_code: str, product_id: nullable(str), order_id: nullable(str),
      status: { enum: ['requested', 'paid', 'accepted', 'in_progress', 'report_ready', 'completed', 'rejected', 'refunded'] },
      currency, fx_rate_id: nullable(str), fee: ref('Amount'), paid_via: nullable(str), details: { type: 'object' }, created_at: ts, updated_at: ts,
    },
    ['id', 'code', 'service_code', 'status', 'currency', 'fee'],
  ),
  Webhook: obj(
    {
      id: str, url: str, events: { type: 'array', items: { enum: [...WEBHOOK_EVENTS] } }, active: bool,
      secret: { type: 'string', description: 'Only returned when the endpoint is created' }, created_at: ts,
      deliveries: { type: 'array', items: obj({ id: {}, event_type: str, response_status: nullable(int), attempts: int, delivered_at: nullable(ts), created_at: ts }) },
    },
    ['id', 'url', 'events', 'active'],
  ),
  WebhookEvent: {
    type: 'object',
    description: 'Body POSTed to your endpoint. Verify header `Octopus-Signature: t=<unix>,v1=<hex>` = HMAC-SHA256(secret, "<t>.<raw body>"), reject if |now - t| > 300 s.',
    required: ['id', 'type', 'created_at', 'data'],
    properties: { id: str, type: { enum: [...WEBHOOK_EVENTS, 'ping'] }, created_at: ts, livemode: bool, data: { type: 'object' } },
  },
  CurrencyChangedEvent: {
    allOf: [
      ref('WebhookEvent'),
      obj({
        type: { const: 'settings.currency_changed' },
        data: obj(
          { from: currency, to: currency, currency: { ...currency, description: 'New platform currency' }, rate: obj({ base: { const: 'USD' }, quote: { const: 'CNY' }, rate: { type: 'number' }, fx_rate_id: nullable(str) }), wallet_option: { enum: ['keep', 'convert'] } },
          ['from', 'to', 'rate'],
        ),
      }),
    ],
    description: 'Platform-wide event (no organization): sent to every endpoint subscribed to settings.currency_changed when Admin switches USD ↔ CNY.',
  },
  WebhookTestEnvelope: obj({ data: obj({ delivered: bool, response_status: nullable(int), error: nullable(str), event_id: str }, ['delivered', 'event_id']) }, ['data']),
  CurrencySettingsEnvelope: obj({ data: ref('CurrencySettings') }, ['data']),
  ProductList: list('Product'),
  ProductDetail: envelope('ProductDetailData'),
  CategoryList: list('Category', false),
  RfqList: list('Rfq'),
  RfqEnvelope: envelope('Rfq'),
  QuoteList: list('Quote', false),
  OrderList: list('Order'),
  OrderEnvelope: envelope('Order'),
  TrackingEnvelope: envelope('Tracking'),
  WalletEnvelope: envelope('Wallet'),
  ServiceRequestList: list('ServiceRequestObj'),
  ServiceRequestEnvelope: envelope('ServiceRequestObj'),
  WebhookList: list('Webhook', false),
  WebhookEnvelope: envelope('Webhook'),
};

const SUPPLIER_SCHEMAS: Record<string, unknown> = {
  ...MONEY_SCHEMAS,
  Problem: SCHEMAS.Problem,
  PageMeta: SCHEMAS.PageMeta,
  SupplierProduct: obj(
    { id: str, sku: nullable(str), title: str, status: str, currency, price_tiers: { type: 'array', items: obj({ min_qty: int, unit_price: ref('Amount') }, ['min_qty', 'unit_price']) }, updated_at: ts },
    ['id', 'title', 'status', 'currency'],
  ),
  SupplierSyncResult: obj({ data: obj({ accepted: int, rejected: int, errors: { type: 'array', items: obj({ sku: str, message: str }) } }, ['accepted', 'rejected']) }, ['data']),
  SupplierRfq: obj({ id: str, code: str, title: str, quantity: int, unit: str, incoterm: nullable(str), destination_country: nullable(str), currency, target_price: nullable(ref('Amount')), expires_at: nullable(ts) }, ['id', 'code', 'title', 'quantity', 'currency']),
  SupplierQuote: obj({ id: str, code: str, rfq_id: str, status: str, currency, unit_price: ref('Amount'), shipping: ref('Amount'), total: ref('Amount'), valid_until: ts }, ['id', 'code', 'rfq_id', 'currency', 'unit_price', 'total']),
  SupplierOrder: obj({ id: str, code: str, status: str, quantity: int, currency, total: ref('Amount'), created_at: ts }, ['id', 'code', 'status', 'currency', 'total']),
  SupplierProductList: list('SupplierProduct'),
  SupplierRfqList: list('SupplierRfq', false),
  SupplierQuoteEnvelope: envelope('SupplierQuote'),
  SupplierOrderList: list('SupplierOrder', false),
};

const problemRef = (d: string) => ({ description: d, content: { 'application/problem+json': { schema: ref('Problem') } } });

export const operationId = (op: Pick<Op, 'method' | 'path'>) =>
  `${op.method}${op.path.replace(/\{(\w+)\}/g, 'By_$1').replace(/[^a-zA-Z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ''))}`;

function buildPaths(ops: Op[], extraErrors: (op: Op) => Record<string, unknown> = () => ({})) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of ops) {
    const parameters: unknown[] = [
      ...(op.pathParams ?? []).map((p) => ({ name: p.name, in: 'path', required: true, description: p.description, schema: { type: 'string' } })),
      ...(op.query ?? []).map((q) => ({ name: q.name, in: 'query', required: false, description: q.description, schema: q.schema ?? { type: 'string' } })),
    ];
    if (op.method === 'post')
      parameters.push({ name: 'Idempotency-Key', in: 'header', required: true, description: 'Unique key per logical request (e.g. a UUID). Replays return the stored response.', schema: { type: 'string', maxLength: 255 } });
    const status = String(op.status ?? 200);
    paths[op.path] ??= {};
    paths[op.path][op.method] = {
      tags: [op.tag],
      summary: op.summary,
      operationId: operationId(op),
      security: [{ oauth2: op.scopes }, { apiKey: [] }],
      description: `Scopes (any of): ${op.scopes.join(', ')}`,
      parameters,
      ...(op.body ? { requestBody: { required: true, content: { 'application/json': { schema: schema(op.body), ...(op.example ? { example: op.example } : {}) } } } } : {}),
      responses: {
        [status]: op.response ? { description: 'OK', content: { 'application/json': { schema: ref(op.response) } } } : { description: 'No content' },
        400: problemRef('Bad request'),
        401: problemRef('Missing or invalid credentials'),
        403: problemRef('Insufficient scope or KYC required for live keys'),
        404: problemRef('Not found'),
        ...(op.body ? { 422: problemRef('Validation failed') } : {}),
        429: { ...problemRef('Rate limited (60/min per key)'), headers: { 'Retry-After': { schema: { type: 'integer' } } } },
        ...extraErrors(op),
      },
    };
  }
  return paths;
}

function tokenPath(baseUrl: string) {
  return {
    post: {
      tags: ['Auth'],
      summary: 'Get an access token (OAuth 2 client credentials, 1 hour)',
      operationId: 'postOauthToken',
      security: [],
      servers: [{ url: `${baseUrl}/api/v1` }],
      requestBody: {
        required: true,
        content: {
          'application/x-www-form-urlencoded': {
            schema: { type: 'object', required: ['grant_type', 'client_id', 'client_secret'], properties: { grant_type: { const: 'client_credentials' }, client_id: { type: 'string', example: 'cli_0123456789abcdef' }, client_secret: { type: 'string', description: 'An API key of this client: oct_test_… or oct_live_…' }, scope: { type: 'string', description: 'Space-separated subset of the client scopes' } } },
          },
        },
      },
      responses: {
        200: { description: 'Token', content: { 'application/json': { schema: { type: 'object', required: ['access_token', 'token_type', 'expires_in'], properties: { access_token: str, token_type: { const: 'Bearer' }, expires_in: { type: 'integer', example: 3600 }, scope: str, mode: { enum: ['test', 'live'] } } } } } },
        400: problemRef('invalid_request / invalid_scope'),
        401: problemRef('invalid_client'),
      },
    },
  };
}

const MONEY_DOC = '* **Money:** every amount is `{ "amount_minor": 19000, "currency": "USD" }` (minor units = cents / fen). Quotes, orders, invoices and service requests keep the currency they were created in; catalogue prices keep the supplier\'s currency and add a `converted` amount in the platform currency. `GET /settings/currency` returns the platform currency (USD or CNY) and the approved rate; the `settings.currency_changed` webhook announces a switch.';

export function buildOpenApi(baseUrl: string) {
  const paths = buildPaths(OPERATIONS);
  paths['/oauth/token'] = tokenPath(baseUrl);
  return {
    openapi: '3.1.0',
    info: {
      title: 'Octopus B2B Public API',
      version: '1.1.0',
      description: [
        'Catalogue, RFQs & quotes, orders, shipments & tracking, wallet, service requests, settings and webhooks.',
        '',
        '* **Auth:** OAuth 2 client credentials (`POST /oauth/token`) → `Authorization: Bearer <token>`. An API key may also be sent directly as the bearer token.',
        '* **Keys:** `oct_test_…` = sandbox (reads real catalogue + your data; writes are simulated and return `"simulated": true`). `oct_live_…` = live, after KYC.',
        '* **Idempotency:** `Idempotency-Key` header required on every POST.',
        '* **Rate limit:** 60 requests/minute per key → `429` with `Retry-After`.',
        '* **Errors:** RFC 7807 `application/problem+json`.',
        MONEY_DOC,
        `* **Webhooks:** ${WEBHOOK_EVENTS.join(', ')}; signed with \`Octopus-Signature: t=…,v1=…\` (HMAC-SHA256), retried with backoff (1 m, 5 m, 30 m, 2 h, 6 h).`,
        '* **Postman:** the official collections live in the Octopus B2B public workspace (generated from this document — never edited by hand).',
      ].join('\n'),
      contact: { name: 'Octopus B2B', email: 'support@octopusb2b.com', url: 'https://octopusb2b.com' },
    },
    servers: [{ url: `${baseUrl}/api/v1`, description: 'This deployment' }, { url: 'https://api.octopusb2b.com/v1', description: 'Production' }],
    tags: PUBLIC_TAGS.map((name) => ({ name })),
    paths,
    webhooks: Object.fromEntries(
      WEBHOOK_EVENTS.map((e) => [
        e,
        {
          post: {
            summary: `${e} event`,
            requestBody: { content: { 'application/json': { schema: ref(e === 'settings.currency_changed' ? 'CurrencyChangedEvent' : 'WebhookEvent') } } },
            responses: { 200: { description: 'Return any 2xx to acknowledge' } },
          },
        },
      ]),
    ),
    components: {
      securitySchemes: {
        oauth2: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: `${baseUrl}/api/v1/oauth/token`, scopes: Object.fromEntries(API_SCOPES.map((s) => [s, s])) } } },
        apiKey: { type: 'http', scheme: 'bearer', description: 'API key (oct_test_… / oct_live_…) used directly as bearer token' },
      },
      schemas: SCHEMAS,
    },
  };
}

export function buildSupplierOpenApi(baseUrl: string) {
  const paths = buildPaths(SUPPLIER_OPERATIONS, () => ({ 501: problemRef('Endpoint not implemented yet (coming soon)') }));
  paths['/oauth/token'] = tokenPath(baseUrl);
  return {
    openapi: '3.1.0',
    info: {
      title: 'Octopus B2B Supplier API',
      version: '1.0.0-beta',
      description: [
        'Bulk product sync, stock and price updates and quoting from your own ERP. Writes still pass moderation and the supplier switches.',
        '',
        '* **Status:** returns `403 SUPPLIER_PORTAL_DISABLED` until the supplier portal opens; endpoints then roll out (`501` until available).',
        '* **Auth:** same OAuth 2 client credentials as the public API (`POST /api/v1/oauth/token`) with supplier scopes.',
        MONEY_DOC.replace('Quotes, orders', 'Prices may be entered in USD or CNY (1688 suppliers often quote CNY). Quotes, orders'),
      ].join('\n'),
      contact: { name: 'Octopus B2B', email: 'support@octopusb2b.com', url: 'https://octopusb2b.com' },
    },
    servers: [{ url: `${baseUrl}/api/supplier/v1`, description: 'This deployment' }, { url: 'https://api.octopusb2b.com/supplier/v1', description: 'Production' }],
    tags: SUPPLIER_TAGS.map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        oauth2: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: `${baseUrl}/api/v1/oauth/token`, scopes: Object.fromEntries(SUPPLIER_SCOPES.map((s) => [s, s])) } } },
        apiKey: { type: 'http', scheme: 'bearer', description: 'Supplier API key used directly as bearer token' },
      },
      schemas: SUPPLIER_SCHEMAS,
    },
  };
}

export type OpenApiDoc = ReturnType<typeof buildOpenApi>;
