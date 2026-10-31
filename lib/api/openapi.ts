import { z } from 'zod';
import { API_SCOPES, ApproveQuote, ServiceRequest, SubmitRfq, WEBHOOK_EVENTS, WebhookEndpointCreate, WebhookEndpointUpdate } from '@/lib/contracts';

/**
 * OpenAPI 3.1 document for the public API. Request bodies are generated from the shared Zod contracts
 * (z.toJSONSchema); response schemas are hand-written below. Also drives the Postman collection.
 */
const schema = (s: z.ZodType) => {
  const j = z.toJSONSchema(s, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete j.$schema;
  return j;
};

type Op = {
  method: 'get' | 'post' | 'patch' | 'delete';
  path: string;
  summary: string;
  tag: string;
  scopes: string[];
  query?: { name: string; description: string; schema?: Record<string, unknown> }[];
  pathParams?: { name: string; description: string }[];
  body?: z.ZodType;
  example?: unknown;
  response: string; // component schema name
  status?: number;
};

export const OPERATIONS: Op[] = [
  {
    method: 'get', path: '/products', summary: 'Search live products', tag: 'Catalog', scopes: ['catalog:read'], response: 'ProductList',
    query: [
      { name: 'q', description: 'Full-text search' },
      { name: 'category', description: 'Category id or slug (includes sub-categories)' },
      { name: 'page', description: 'Page (1-based)', schema: { type: 'integer', minimum: 1, default: 1 } },
      { name: 'per_page', description: 'Page size (max 100)', schema: { type: 'integer', minimum: 1, maximum: 100, default: 24 } },
      { name: 'ready_to_ship', description: 'true/false', schema: { type: 'string', enum: ['true', 'false'] } },
      { name: 'dropship', description: 'Octopus Dropship tag: true/false', schema: { type: 'string', enum: ['true', 'false'] } },
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
  { method: 'post', path: '/orders', summary: 'Create an order from a quote (issues the proforma invoice)', tag: 'Orders', scopes: ['orders:write'], body: ApproveQuote, response: 'OrderEnvelope', status: 201, example: { quoteId: '00000000-0000-4000-8000-000000000000' } },
  { method: 'get', path: '/orders/{id}', summary: 'Order detail with timeline, documents and shipments', tag: 'Orders', scopes: ['orders:read'], response: 'OrderEnvelope', pathParams: [{ name: 'id', description: 'Order id or code (ORD-…)' }] },
  { method: 'get', path: '/shipments/{id}/tracking', summary: 'Shipment tracking events', tag: 'Shipments', scopes: ['shipments:read', 'orders:read'], response: 'TrackingEnvelope', pathParams: [{ name: 'id', description: 'Shipment id, SHP- code or tracking number' }] },
  { method: 'get', path: '/wallet', summary: 'Wallet balance and ledger lines', tag: 'Wallet', scopes: ['wallet:read'], response: 'WalletEnvelope', query: [{ name: 'page', description: 'Page' }, { name: 'per_page', description: 'Page size' }] },
  { method: 'get', path: '/service-requests', summary: 'List service requests', tag: 'Services', scopes: ['orders:read'], response: 'ServiceRequestList' },
  { method: 'post', path: '/service-requests', summary: 'Request a service (sample, QC, certification, 3PL, dropship)', tag: 'Services', scopes: ['orders:write'], body: ServiceRequest, response: 'ServiceRequestEnvelope', status: 201, example: { serviceCode: 'qc', details: { notes: 'Pre-shipment inspection' } } },
  { method: 'get', path: '/webhooks', summary: 'List webhook endpoints', tag: 'Webhooks', scopes: ['webhooks:manage'], response: 'WebhookList' },
  { method: 'post', path: '/webhooks', summary: 'Register a webhook endpoint (secret returned once)', tag: 'Webhooks', scopes: ['webhooks:manage'], body: WebhookEndpointCreate, response: 'WebhookEnvelope', status: 201, example: { url: 'https://example.com/octopus/webhooks', events: ['order.updated', 'shipment.tracking'] } },
  { method: 'get', path: '/webhooks/{id}', summary: 'Webhook endpoint with recent deliveries', tag: 'Webhooks', scopes: ['webhooks:manage'], response: 'WebhookEnvelope', pathParams: [{ name: 'id', description: 'Endpoint id' }] },
  { method: 'patch', path: '/webhooks/{id}', summary: 'Update a webhook endpoint', tag: 'Webhooks', scopes: ['webhooks:manage'], body: WebhookEndpointUpdate, response: 'WebhookEnvelope', pathParams: [{ name: 'id', description: 'Endpoint id' }], example: { active: false } },
  { method: 'delete', path: '/webhooks/{id}', summary: 'Delete a webhook endpoint', tag: 'Webhooks', scopes: ['webhooks:manage'], response: '', status: 204, pathParams: [{ name: 'id', description: 'Endpoint id' }] },
  { method: 'post', path: '/webhooks/{id}/test', summary: 'Send a signed ping event', tag: 'Webhooks', scopes: ['webhooks:manage'], response: 'WebhookTestEnvelope', pathParams: [{ name: 'id', description: 'Endpoint id' }] },
];

const money = { type: 'integer', description: 'USD cents' };
const ts = { type: 'string', format: 'date-time' };
const nullable = (s: Record<string, unknown>) => ({ anyOf: [s, { type: 'null' }] });
const list = (ref: string, paged = true) => ({
  type: 'object',
  required: ['data'],
  properties: { data: { type: 'array', items: { $ref: `#/components/schemas/${ref}` } }, ...(paged ? { meta: { $ref: '#/components/schemas/PageMeta' } } : {}) },
});
const envelope = (ref: string) => ({
  type: 'object',
  required: ['data'],
  properties: { data: { $ref: `#/components/schemas/${ref}` }, simulated: { type: 'boolean', description: 'true when a test key was used — nothing was written' } },
});

const SCHEMAS: Record<string, unknown> = {
  Problem: {
    type: 'object',
    description: 'RFC 7807 problem details',
    properties: { type: { type: 'string' }, title: { type: 'string' }, status: { type: 'integer' }, code: { type: 'string' }, detail: { type: 'string' }, errors: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, message: { type: 'string' } } } } },
  },
  PageMeta: { type: 'object', properties: { page: { type: 'integer' }, per_page: { type: 'integer' }, total: { type: 'integer' }, total_pages: { type: 'integer' } } },
  Supplier: { type: 'object', description: 'Suppliers are identified by code and country only', properties: { code: { type: 'string', example: 'OCT-1101' }, country: { type: 'string', example: 'CN' }, verified: { type: 'boolean' } } },
  Product: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' }, slug: { type: 'string' }, title: { type: 'string' }, description: nullable({ type: 'string' }), category_id: nullable({ type: 'string' }),
      unit: { type: 'string' }, moq: { type: 'integer' }, lead_time_days: nullable({ type: 'integer' }), incoterm: nullable({ type: 'string' }), origin_country: nullable({ type: 'string' }),
      hs_code: nullable({ type: 'string' }), image_url: nullable({ type: 'string' }), from_price_cents: nullable(money), currency: { const: 'USD' }, ready_to_ship: { type: 'boolean' },
      octopus_dropship: { type: 'boolean' }, supplier: { $ref: '#/components/schemas/Supplier' },
    },
  },
  ProductDetailData: {
    allOf: [
      { $ref: '#/components/schemas/Product' },
      {
        type: 'object',
        properties: {
          price_tiers: { type: 'array', items: { type: 'object', properties: { min_qty: { type: 'integer' }, unit_price_cents: money } } },
          specs: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' } } } },
          media: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, kind: { type: 'string' }, alt: nullable({ type: 'string' }) } } },
          tags: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, slug: { type: 'string' }, kind: { type: 'string' } } } },
          certificates: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, issuer: nullable({ type: 'string' }), expires_at: nullable({ type: 'string' }) } } },
        },
      },
    ],
  },
  Category: { type: 'object', properties: { id: { type: 'string' }, parent_id: nullable({ type: 'string' }), name: { type: 'string' }, slug: { type: 'string' }, level: { type: 'integer', minimum: 1, maximum: 4 }, hs_code: nullable({ type: 'string' }), sort: { type: 'integer' } } },
  Quote: {
    type: 'object',
    properties: {
      id: { type: 'string' }, code: { type: 'string', example: 'QT-1001-1' }, rfq_id: { type: 'string' }, unit_price_cents: money, quantity: { type: 'integer' }, incoterm: { type: 'string' },
      lead_time_days: nullable({ type: 'integer' }), shipping_cents: money, total_cents: money, currency: { const: 'USD' }, notes: nullable({ type: 'string' }),
      status: { enum: ['draft', 'sent', 'viewed', 'approved', 'rejected', 'expired', 'superseded'] }, valid_until: ts, supplier: { $ref: '#/components/schemas/Supplier' },
    },
  },
  Rfq: {
    type: 'object',
    properties: {
      id: { type: 'string' }, code: { type: 'string', example: 'RFQ-1001' }, title: { type: 'string' }, details: nullable({ type: 'string' }), quantity: { type: 'integer' }, unit: { type: 'string' },
      status: { enum: ['draft', 'submitted', 'assigned', 'quoting', 'quoted', 'accepted', 'expired', 'cancelled'] }, fee_usd_cents: money, product_id: nullable({ type: 'string' }),
      destination_country: nullable({ type: 'string' }), destination_city: nullable({ type: 'string' }), incoterm: nullable({ type: 'string' }), target_price_cents: nullable(money),
      expires_at: nullable(ts), created_at: ts, quotes: { type: 'array', items: { $ref: '#/components/schemas/Quote' } },
    },
  },
  Order: {
    type: 'object',
    properties: {
      id: { type: 'string' }, code: { type: 'string', example: 'ORD-2202' }, pi_number: { type: 'string' },
      status: { enum: ['pi_issued', 'deposit_pending', 'deposit_paid', 'confirmed', 'in_production', 'qc', 'balance_pending', 'balance_paid', 'ready_to_ship', 'shipped', 'delivered', 'closed', 'cancelled', 'disputed'] },
      title: { type: 'string' }, quantity: { type: 'integer' }, unit_price_cents: money, shipping_cents: money, total_cents: money, deposit_pct: { type: 'integer' }, deposit_cents: money,
      paid_cents: money, balance_cents: money, currency: { const: 'USD' }, incoterm: nullable({ type: 'string' }), supplier: { $ref: '#/components/schemas/Supplier' },
      events: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string' }, title: { type: 'string' }, body: nullable({ type: 'string' }), created_at: ts } } },
      documents: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, doc_type: { type: 'string' }, number: { type: 'string' }, amount_cents: nullable(money), status: { type: 'string' }, created_at: ts } } },
      shipments: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, code: { type: 'string' }, tracking_no: nullable({ type: 'string' }), status: { type: 'string' }, eta: nullable({ type: 'string' }) } } },
      created_at: ts,
    },
  },
  Tracking: {
    type: 'object',
    properties: {
      id: { type: 'string' }, code: { type: 'string' }, order_code: nullable({ type: 'string' }), carrier_code: { type: 'string' }, tracking_no: nullable({ type: 'string' }),
      status: { enum: ['draft', 'priced', 'created', 'label_ready', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'exception', 'returned'] }, eta: nullable({ type: 'string' }),
      events: { type: 'array', items: { type: 'object', properties: { status: { type: 'string' }, description: nullable({ type: 'string' }), location: nullable({ type: 'string' }), occurred_at: ts } } },
    },
  },
  Wallet: {
    type: 'object',
    properties: {
      balance_cents: money, currency: { const: 'USD' }, wallet_enabled: { type: 'boolean' },
      entries: { type: 'array', items: { type: 'object', properties: { id: { type: 'integer' }, direction: { enum: ['credit', 'debit'] }, amount_cents: money, memo: { type: 'string' }, journal: { type: 'string' }, created_at: ts } } },
    },
  },
  ServiceRequestObj: {
    type: 'object',
    properties: {
      id: { type: 'string' }, code: { type: 'string' }, service_code: { type: 'string' }, status: { enum: ['requested', 'paid', 'accepted', 'in_progress', 'report_ready', 'completed', 'rejected', 'refunded'] },
      fee_usd_cents: money, paid_via: { type: 'string' }, details: { type: 'object' }, created_at: ts,
    },
  },
  Webhook: {
    type: 'object',
    properties: {
      id: { type: 'string' }, url: { type: 'string' }, events: { type: 'array', items: { enum: [...WEBHOOK_EVENTS] } }, active: { type: 'boolean' },
      secret: { type: 'string', description: 'Only returned when the endpoint is created' }, created_at: ts,
    },
  },
  WebhookEvent: {
    type: 'object',
    description: 'Body POSTed to your endpoint. Verify header `Octopus-Signature: t=<unix>,v1=<hex>` = HMAC-SHA256(secret, "<t>.<raw body>"), reject if |now - t| > 300 s.',
    properties: { id: { type: 'string' }, type: { enum: [...WEBHOOK_EVENTS, 'ping'] }, created_at: ts, livemode: { type: 'boolean' }, data: { type: 'object' } },
  },
  WebhookTestEnvelope: { type: 'object', properties: { data: { type: 'object', properties: { delivered: { type: 'boolean' }, response_status: nullable({ type: 'integer' }), error: nullable({ type: 'string' }), event_id: { type: 'string' } } } } },
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

const problemRef = (d: string) => ({ description: d, content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } });

export function buildOpenApi(baseUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const parameters: unknown[] = [
      ...(op.pathParams ?? []).map((p) => ({ name: p.name, in: 'path', required: true, description: p.description, schema: { type: 'string' } })),
      ...(op.query ?? []).map((q) => ({ name: q.name, in: 'query', required: false, description: q.description, schema: q.schema ?? { type: 'string' } })),
    ];
    if (op.method === 'post') parameters.push({ name: 'Idempotency-Key', in: 'header', required: true, description: 'Unique key per logical request (e.g. a UUID). Replays return the stored response.', schema: { type: 'string', maxLength: 255 } });
    const status = String(op.status ?? 200);
    paths[op.path] ??= {};
    paths[op.path][op.method] = {
      tags: [op.tag],
      summary: op.summary,
      operationId: `${op.method}${op.path.replace(/\{(\w+)\}/g, 'By_$1').replace(/[^a-zA-Z0-9]+(.)?/g, (_m, c: string | undefined) => (c ? c.toUpperCase() : ''))}`,
      security: [{ oauth2: op.scopes }, { apiKey: [] }],
      description: `Scopes (any of): ${op.scopes.join(', ')}`,
      parameters,
      ...(op.body ? { requestBody: { required: true, content: { 'application/json': { schema: schema(op.body), ...(op.example ? { example: op.example } : {}) } } } } : {}),
      responses: {
        [status]: op.response ? { description: 'OK', content: { 'application/json': { schema: { $ref: `#/components/schemas/${op.response}` } } } } : { description: 'No content' },
        400: problemRef('Bad request'),
        401: problemRef('Missing or invalid credentials'),
        403: problemRef('Insufficient scope or KYC required for live keys'),
        404: problemRef('Not found'),
        ...(op.body ? { 422: problemRef('Validation failed') } : {}),
        429: { ...problemRef('Rate limited (60/min per key)'), headers: { 'Retry-After': { schema: { type: 'integer' } } } },
      },
    };
  }
  paths['/oauth/token'] = {
    post: {
      tags: ['Auth'],
      summary: 'Get an access token (OAuth 2 client credentials, 1 hour)',
      operationId: 'postOauthToken',
      security: [],
      requestBody: {
        required: true,
        content: {
          'application/x-www-form-urlencoded': {
            schema: { type: 'object', required: ['grant_type', 'client_id', 'client_secret'], properties: { grant_type: { const: 'client_credentials' }, client_id: { type: 'string', example: 'cli_0123456789abcdef' }, client_secret: { type: 'string', description: 'An API key of this client: oct_test_… or oct_live_…' }, scope: { type: 'string', description: 'Space-separated subset of the client scopes' } } },
          },
        },
      },
      responses: {
        200: { description: 'Token', content: { 'application/json': { schema: { type: 'object', properties: { access_token: { type: 'string' }, token_type: { const: 'Bearer' }, expires_in: { type: 'integer', example: 3600 }, scope: { type: 'string' }, mode: { enum: ['test', 'live'] } } } } } },
        400: problemRef('invalid_request / invalid_scope'),
        401: problemRef('invalid_client'),
      },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Octopus B2B Public API',
      version: '1.0.0',
      description: [
        'Catalogue, RFQs & quotes, orders, shipments & tracking, wallet, service requests and webhooks.',
        '',
        '* **Auth:** OAuth 2 client credentials (`POST /oauth/token`) → `Authorization: Bearer <token>`. An API key may also be sent directly as the bearer token.',
        '* **Keys:** `oct_test_…` = sandbox (reads real catalogue + your data; writes are simulated and return `"simulated": true`). `oct_live_…` = live, after KYC.',
        '* **Idempotency:** `Idempotency-Key` header required on every POST.',
        '* **Rate limit:** 60 requests/minute per key → `429` with `Retry-After`.',
        '* **Errors:** RFC 7807 `application/problem+json`.',
        '* **Money:** integer USD cents.',
        `* **Webhooks:** ${WEBHOOK_EVENTS.join(', ')}; signed with \`Octopus-Signature: t=…,v1=…\` (HMAC-SHA256), retried with backoff (1 m, 5 m, 30 m, 2 h, 6 h).`,
      ].join('\n'),
      contact: { name: 'Octopus B2B', email: 'support@octopusb2b.com', url: 'https://octopusb2b.com' },
    },
    servers: [{ url: `${baseUrl}/api/v1`, description: 'This deployment' }, { url: 'https://api.octopusb2b.com/v1', description: 'Production' }],
    tags: ['Auth', 'Catalog', 'RFQs & quotes', 'Orders', 'Shipments', 'Wallet', 'Services', 'Webhooks'].map((name) => ({ name })),
    paths,
    webhooks: Object.fromEntries(
      WEBHOOK_EVENTS.map((e) => [
        e,
        { post: { summary: `${e} event`, requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookEvent' } } } }, responses: { 200: { description: 'Return any 2xx to acknowledge' } } } },
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
