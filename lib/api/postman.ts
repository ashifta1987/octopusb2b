import { deref } from './json-schema';
import { buildOpenApi, buildSupplierOpenApi, operationId, OPERATIONS, PUBLIC_TAGS, SUPPLIER_OPERATIONS, SUPPLIER_TAGS, type Op } from './openapi';

/**
 * Postman v2.1 collections + environments generated from the OpenAPI operation lists (SPEC §15.2).
 * The repository is the source of truth: scripts/postman-sync.mjs writes postman/*.json and pushes them to the
 * Postman workspace. Never edit the collections by hand in Postman.
 *
 * Keep this module free of server-only / Next imports: scripts/postman-sync.mjs loads it with plain Node.
 */

export const DEFAULT_BASE_URL = 'https://api.octopusb2b.com/v1';
export const POSTMAN_SCHEMA = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
export const COLLECTION_IDS = { public: 'b3f1c1c4-0c7a-4d38-9d1e-0c70b2b00001', supplier: 'b3f1c1c4-0c7a-4d38-9d1e-0c70b2b00002' } as const;
export const ENVIRONMENT_IDS = { sandbox: 'b3f1c1c4-0c7a-4d38-9d1e-0c70b2b0e001', live: 'b3f1c1c4-0c7a-4d38-9d1e-0c70b2b0e002' } as const;
export const VERIFY_FOLDER = 'Webhooks · verify signature';

/** Saved example responses keyed by operationId (postman/examples.json, generated from seed data). */
export type Examples = Record<string, { status: number; body: unknown }>;

const js = (src: string) => src.replace(/^\n/, '').replace(/\s+$/, '').split('\n');

// ───────── Collection-level pre-request: OAuth client-credentials token cache + Idempotency-Key ─────────
const PRE_REQUEST = js(`
// Octopus B2B — collection pre-request (generated from the repository; do not edit in Postman).
// 1) Adds an Idempotency-Key to every POST. 2) Fetches + caches an OAuth client-credentials token.
(function () {
  var bypass = pm.variables.get('vercel_bypass');
  if (bypass) pm.request.headers.upsert({ key: 'x-vercel-protection-bypass', value: bypass });
  if (pm.request.method === 'POST' && !pm.request.url.getPath().endsWith('/oauth/token') && !pm.request.headers.has('Idempotency-Key')) {
    pm.request.headers.upsert({ key: 'Idempotency-Key', value: pm.variables.replaceIn('{{$guid}}') });
  }
  if (pm.request.auth && pm.request.auth.type === 'noauth') return;
  var base = String(pm.variables.get('base_url') || '').replace(/\\/$/, '');
  // Supplier API lives next to the public API: …/v1 → …/supplier/v1 (unless the environment overrides it).
  if (!(pm.environment && pm.environment.get && pm.environment.get('supplier_base_url'))) pm.variables.set('supplier_base_url', base.replace(/\\/v1$/, '/supplier/v1'));
  var clientId = pm.variables.get('client_id');
  var secret = pm.variables.get('client_secret');
  function share(token) {
    if (pm.environment && pm.environment.has && pm.environment.has('access_token')) pm.environment.set('access_token', token);
  }
  var cached = pm.collectionVariables.get('access_token');
  var exp = Number(pm.collectionVariables.get('access_token_expires_at') || 0);
  if (cached && pm.collectionVariables.get('access_token_client') === clientId && Date.now() < exp - 60000) { share(cached); return; }
  if (!base || !clientId || !secret) { console.warn('Octopus B2B: set base_url, client_id and client_secret in the environment.'); return; }
  var headers = [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded' }];
  if (bypass) headers.push({ key: 'x-vercel-protection-bypass', value: bypass });
  pm.sendRequest({
    url: base + '/oauth/token',
    method: 'POST',
    header: headers,
    body: { mode: 'urlencoded', urlencoded: [
      { key: 'grant_type', value: 'client_credentials' },
      { key: 'client_id', value: clientId },
      { key: 'client_secret', value: secret }
    ] }
  }, function (err, res) {
    if (err || res.code !== 200) { console.error('Octopus B2B: token request failed', err || res.text()); return; }
    var j = res.json();
    pm.collectionVariables.set('access_token', j.access_token);
    pm.collectionVariables.set('access_token_client', clientId);
    pm.collectionVariables.set('access_token_expires_at', String(Date.now() + Number(j.expires_in || 3600) * 1000));
    share(j.access_token);
  });
})();
`);

/** Recursive "every amount carries a currency" check (mirrors findBareAmounts in lib/api/money.ts). */
const CURRENCY_TEST = js(`
pm.test('every amount carries a currency', function () {
  var bad = [];
  (function walk(v, p) {
    if (Array.isArray(v)) { v.forEach(function (x, i) { walk(x, p + '[' + i + ']'); }); return; }
    if (!v || typeof v !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(v, 'amount_minor') && !(typeof v.currency === 'string' && /^[A-Z]{3}$/.test(v.currency))) bad.push(p);
    Object.keys(v).forEach(function (k) { if (/_cents$/.test(k)) bad.push(p + '.' + k); walk(v[k], p + '.' + k); });
  })(body, '$');
  pm.expect(bad, 'amounts without currency: ' + bad.join(', ')).to.eql([]);
});
`);

type Chain = { set?: string; requires?: string[] };

/** Variables chained between requests so a fresh fork runs top to bottom with only client_id/client_secret. */
const CHAINS: Record<string, Chain> = {
  getSettingsCurrency: { set: `if (body.data && body.data.currency) { pm.collectionVariables.set('currency', body.data.currency); if (pm.environment && pm.environment.has && pm.environment.has('currency')) pm.environment.set('currency', body.data.currency); }` },
  getProducts: { set: `if (body.data && body.data[0]) pm.collectionVariables.set('product_id', body.data[0].id);` },
  getProductsById: { requires: ['product_id'] },
  getRfqs: { set: `if (body.data && body.data[0]) pm.collectionVariables.set('rfq_id', body.data[0].id);` },
  getRfqsById: { requires: ['rfq_id'] },
  getQuotes: {
    set: `var open = (body.data || []).filter(function (q) { return (q.status === 'sent' || q.status === 'viewed') && new Date(q.valid_until) > new Date(); });
pm.collectionVariables.set('quote_id', open[0] ? open[0].id : '');`,
  },
  postOrders: { requires: ['quote_id'] },
  getOrders: { set: `if (body.data && body.data[0]) pm.collectionVariables.set('order_id', body.data[0].id);` },
  getOrdersById: { requires: ['order_id'], set: `pm.collectionVariables.set('shipment_id', body.data && body.data.shipments && body.data.shipments[0] ? body.data.shipments[0].id : '');` },
  getShipmentsByIdTracking: { requires: ['shipment_id'] },
  postWebhooks: { set: `if (body.data) { pm.collectionVariables.set('webhook_id', body.data.id); pm.collectionVariables.set('webhook_secret', body.data.secret || ''); }` },
  getWebhooksById: { requires: ['webhook_id'] },
  patchWebhooksById: { requires: ['webhook_id'] },
  postWebhooksByIdTest: { requires: ['webhook_id'] },
  deleteWebhooksById: { requires: ['webhook_id'], set: `pm.collectionVariables.set('webhook_id', '');` },
};

const PATH_VARS: Record<string, string> = { '/products': 'product_id', '/orders': 'order_id', '/rfqs': 'rfq_id', '/shipments': 'shipment_id', '/webhooks': 'webhook_id' };

function skipScript(vars: string[]) {
  return js(`
(function () {
  var missing = ${JSON.stringify(vars)}.filter(function (v) { return !pm.variables.get(v); });
  if (missing.length) {
    console.log('Skipped: run the list request first to set ' + missing.join(', '));
    if (pm.execution && pm.execution.skipRequest) pm.execution.skipRequest();
  }
})();
`);
}

function testScript(op: Op, components: Record<string, unknown>) {
  const ok = [op.status ?? 200, ...(op.alsoOk ?? [])];
  const id = operationId(op);
  const lines = [
    `// Generated from OpenAPI operation ${id} — do not edit in Postman.`,
    `var expected = ${JSON.stringify(ok)};`,
    `pm.test('status is ' + expected.join(' or '), function () { pm.expect(expected).to.include(pm.response.code); });`,
    `var text = pm.response.text();`,
    `var body = null;`,
    `try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }`,
  ];
  if (op.response) {
    const schema = deref({ $ref: `#/components/schemas/${op.response}` }, components);
    lines.push(
      `if (pm.response.code === ${op.status ?? 200}) {`,
      `  var schema = ${JSON.stringify(schema)};`,
      `  pm.test('response matches the OpenAPI schema (${op.response})', function () { pm.response.to.have.jsonSchema(schema); });`,
      `}`,
    );
  }
  if (op.alsoOk?.length) {
    const problem = deref({ $ref: '#/components/schemas/Problem' }, components);
    lines.push(
      `if (${JSON.stringify(op.alsoOk)}.indexOf(pm.response.code) !== -1) {`,
      `  var problemSchema = ${JSON.stringify(problem)};`,
      `  pm.test('documented problem+json', function () { pm.response.to.have.jsonSchema(problemSchema); });`,
      `}`,
    );
  }
  lines.push(`if (body !== null) {`, ...CURRENCY_TEST.map((l) => '  ' + l), `}`);
  const chain = CHAINS[id]?.set;
  if (chain) lines.push(`if (body && pm.response.code < 300) {`, ...chain.split('\n').map((l) => '  ' + l), `}`);
  return lines;
}

/** Example value synthesised from a schema (fallback when postman/examples.json has no saved response). */
export function sampleFromSchema(s: unknown, depth = 0): unknown {
  if (!s || typeof s !== 'object' || depth > 12) return null;
  const o = s as Record<string, unknown>;
  if ('const' in o) return o.const;
  if (Array.isArray(o.enum)) return o.enum[0];
  if (Array.isArray(o.allOf)) return Object.assign({}, ...o.allOf.map((x) => sampleFromSchema(x, depth + 1) as object));
  if (Array.isArray(o.anyOf)) return sampleFromSchema(o.anyOf[0], depth + 1);
  const t = Array.isArray(o.type) ? o.type[0] : o.type;
  if (t === 'object' || o.properties) {
    const props = (o.properties ?? {}) as Record<string, unknown>;
    if ('amount_minor' in props && 'currency' in props) {
      const base: Record<string, unknown> = { amount_minor: 19000, currency: 'USD' };
      if (props.converted) base.converted = { amount_minor: 19000, currency: 'USD', fx_rate_id: null };
      return base;
    }
    return Object.fromEntries(Object.entries(props).map(([k, v]) => [k, sampleFromSchema(v, depth + 1)]));
  }
  if (t === 'array') return [sampleFromSchema(o.items, depth + 1)];
  if (t === 'integer') return 1;
  if (t === 'number') return 7.1;
  if (t === 'boolean') return true;
  if (t === 'string') return 'string';
  return null;
}

type Kind = 'public' | 'supplier';

function urlFor(op: Op, kind: Kind) {
  const host = kind === 'public' ? '{{base_url}}' : '{{supplier_base_url}}';
  const path = op.path.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const root = Object.keys(PATH_VARS).find((p) => op.path.startsWith(p + '/'));
    return `{{${root ? PATH_VARS[root] : name}}}`;
  });
  const query = (op.query ?? []).map((q) => ({ key: q.name, value: '', description: q.description, disabled: true }));
  return { raw: host + path, host: [host], path: path.split('/').filter(Boolean), ...(query.length ? { query } : {}) };
}

function requestItem(op: Op, kind: Kind, components: Record<string, unknown>, examples: Examples) {
  const id = operationId(op);
  const body = op.postmanExample ?? op.example;
  const request = {
    method: op.method.toUpperCase(),
    header: [{ key: 'Accept', value: 'application/json' }, ...(op.body ? [{ key: 'Content-Type', value: 'application/json' }] : [])],
    url: urlFor(op, kind),
    ...(op.body ? { body: { mode: 'raw', raw: JSON.stringify(body ?? {}, null, 2), options: { raw: { language: 'json' } } } } : {}),
    description: `${op.summary}\n\nScopes (any of): ${op.scopes.join(', ')}${op.method === 'post' ? '\n\nThe collection adds an `Idempotency-Key` header automatically.' : ''}`,
  };
  const status = op.status ?? 200;
  const saved = examples[`${kind === 'supplier' ? 'supplier.' : ''}${id}`];
  const exBody = saved?.body ?? (op.response ? sampleFromSchema(deref({ $ref: `#/components/schemas/${op.response}` }, components)) : null);
  const exStatus = saved?.status ?? status;
  const requires = CHAINS[id]?.requires;
  return {
    id: `${kind}-${id}`,
    name: op.summary,
    request,
    event: [
      ...(kind === 'public' && requires ? [{ listen: 'prerequest', script: { type: 'text/javascript', exec: skipScript(requires) } }] : []),
      { listen: 'test', script: { type: 'text/javascript', exec: testScript(op, components) } },
    ],
    response: [
      {
        name: saved ? `${exStatus} · from seed data` : `${exStatus} · example`,
        originalRequest: request,
        status: STATUS_TEXT[exStatus] ?? 'OK',
        code: exStatus,
        _postman_previewlanguage: exBody === null ? 'text' : 'json',
        header: exBody === null ? [] : [{ key: 'Content-Type', value: exStatus >= 400 ? 'application/problem+json' : 'application/json' }],
        body: exBody === null ? '' : JSON.stringify(exBody, null, 2),
      },
    ],
  };
}

const STATUS_TEXT: Record<number, string> = { 200: 'OK', 201: 'Created', 202: 'Accepted', 204: 'No Content', 403: 'Forbidden', 404: 'Not Found', 501: 'Not Implemented' };

function tokenItem(examples: Examples) {
  const request = {
    method: 'POST',
    auth: { type: 'noauth' },
    header: [{ key: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
    url: { raw: '{{base_url}}/oauth/token', host: ['{{base_url}}'], path: ['oauth', 'token'] },
    body: {
      mode: 'urlencoded',
      urlencoded: [
        { key: 'grant_type', value: 'client_credentials' },
        { key: 'client_id', value: '{{client_id}}' },
        { key: 'client_secret', value: '{{client_secret}}' },
      ],
    },
    description: 'OAuth 2 client credentials. You rarely need to call this yourself: the collection pre-request script fetches and caches the token.',
  };
  const ex = examples.postOauthToken?.body ?? { access_token: 'eyJhbGciOiJIUzI1NiJ9.…', token_type: 'Bearer', expires_in: 3600, scope: 'catalog:read orders:read', mode: 'test' };
  return {
    id: 'auth-postOauthToken',
    name: 'Get access token (client credentials)',
    request,
    event: [
      {
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: js(`
pm.test('status is 200', function () { pm.expect([200]).to.include(pm.response.code); });
var body = pm.response.json();
pm.test('bearer token issued', function () { pm.expect(body.token_type).to.eql('Bearer'); });
pm.collectionVariables.set('access_token', body.access_token);
pm.collectionVariables.set('access_token_client', pm.variables.get('client_id'));
pm.collectionVariables.set('access_token_expires_at', String(Date.now() + Number(body.expires_in || 3600) * 1000));
if (pm.environment && pm.environment.has && pm.environment.has('access_token')) pm.environment.set('access_token', body.access_token);
`),
        },
      },
    ],
    response: [{ name: '200 · token', originalRequest: request, status: 'OK', code: 200, _postman_previewlanguage: 'json', header: [{ key: 'Content-Type', value: 'application/json' }], body: JSON.stringify(ex, null, 2) }],
  };
}

/** Sample `settings.currency_changed` delivery used by the signature-verification example. */
export const SAMPLE_WEBHOOK_EVENT = {
  id: 'evt_5f1c0e2a9b7d4c3e',
  type: 'settings.currency_changed',
  created_at: '2026-11-01T00:00:00.000Z',
  livemode: false,
  data: { source_event: 'settings.currency_changed', object: 'currency_switch', from: 'USD', to: 'CNY', currency: 'CNY', rate: { base: 'USD', quote: 'CNY', rate: 7.1, fx_rate_id: null }, wallet_option: 'keep' },
};

const VERIFY_DOC = [
  'Every delivery carries `Octopus-Signature: t=<unix seconds>,v1=<hex>` where `v1 = HMAC-SHA256(endpoint secret, "<t>.<raw request body>")`.',
  'Reject the request when the signature does not match or when |now − t| > 300 seconds. Always compute the HMAC over the **raw** body bytes.',
  '',
  '**Try it with a Postman mock server:** create a mock server from this collection (Mock servers → Create → select this collection), copy its URL into the `mock_url` variable and send the request below. The pre-request script signs the body with `webhook_secret` (set automatically by "Register a webhook endpoint", or any test value) exactly like Octopus B2B does; the test script verifies it the way your receiver should; the mock replies with the saved example.',
  '',
  'Node.js:',
  '```js',
  "const crypto = require('crypto');",
  'function verify(rawBody, header, secret) {',
  "  const p = Object.fromEntries(header.split(',').map((kv) => kv.split('=')));",
  '  if (Math.abs(Date.now() / 1000 - Number(p.t)) > 300) return false;',
  "  const expected = crypto.createHmac('sha256', secret).update(`${p.t}.${rawBody}`).digest('hex');",
  "  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(p.v1 || ''));",
  '}',
  '```',
  '',
  'Python:',
  '```python',
  'import hmac, hashlib, time',
  'def verify(raw_body: bytes, header: str, secret: str) -> bool:',
  "    p = dict(kv.split('=', 1) for kv in header.split(','))",
  "    if abs(time.time() - int(p['t'])) > 300: return False",
  "    expected = hmac.new(secret.encode(), f\"{p['t']}.\".encode() + raw_body, hashlib.sha256).hexdigest()",
  "    return hmac.compare_digest(expected, p.get('v1', ''))",
  '```',
].join('\n');

function verifyFolder() {
  const raw = JSON.stringify(SAMPLE_WEBHOOK_EVENT, null, 2);
  const request = {
    method: 'POST',
    auth: { type: 'noauth' },
    header: [{ key: 'Content-Type', value: 'application/json' }, { key: 'Octopus-Event', value: 'settings.currency_changed' }],
    url: { raw: '{{mock_url}}/octopus/webhooks', host: ['{{mock_url}}'], path: ['octopus', 'webhooks'] },
    body: { mode: 'raw', raw, options: { raw: { language: 'json' } } },
    description: 'Simulates an Octopus B2B webhook delivery to your receiver (or a Postman mock server) with a valid Octopus-Signature header.',
  };
  return {
    name: VERIFY_FOLDER,
    description: VERIFY_DOC,
    item: [
      {
        id: 'verify-signed-delivery',
        name: 'Signed delivery → receiver (mock server)',
        request,
        event: [
          {
            listen: 'prerequest',
            script: {
              type: 'text/javascript',
              exec: js(`
// Signs the raw body exactly like Octopus B2B: v1 = HMAC-SHA256(secret, t + '.' + body).
(function () {
  if (!pm.variables.get('mock_url')) {
    console.log('Skipped: create a Postman mock server from this collection and set mock_url.');
    if (pm.execution && pm.execution.skipRequest) pm.execution.skipRequest();
    return;
  }
  var CryptoJS = require('crypto-js');
  var secret = pm.variables.get('webhook_secret') || 'whsec_test_example';
  var raw = pm.request.body.raw;
  var t = Math.floor(Date.now() / 1000);
  var v1 = CryptoJS.HmacSHA256(t + '.' + raw, secret).toString(CryptoJS.enc.Hex);
  pm.request.headers.upsert({ key: 'Octopus-Signature', value: 't=' + t + ',v1=' + v1 });
})();
`),
            },
          },
          {
            listen: 'test',
            script: {
              type: 'text/javascript',
              exec: js(`
// What your receiver must do: recompute the HMAC over the raw body and compare; reject stale timestamps.
var CryptoJS = require('crypto-js');
var header = String(pm.request.headers.get('Octopus-Signature') || '');
var parts = {};
header.split(',').forEach(function (kv) { var i = kv.indexOf('='); parts[kv.slice(0, i)] = kv.slice(i + 1); });
var secret = pm.variables.get('webhook_secret') || 'whsec_test_example';
var expected = CryptoJS.HmacSHA256(parts.t + '.' + pm.request.body.raw, secret).toString(CryptoJS.enc.Hex);
pm.test('Octopus-Signature verifies (HMAC-SHA256 of "t.body")', function () { pm.expect(parts.v1).to.eql(expected); });
pm.test('timestamp within 300 s', function () { pm.expect(Math.abs(Date.now() / 1000 - Number(parts.t)) <= 300).to.eql(true); });
pm.test('receiver acknowledged with 2xx', function () { pm.expect([200, 201, 202, 204]).to.include(pm.response.code); });
`),
            },
          },
        ],
        response: [
          {
            name: '200 · mock server acknowledges',
            originalRequest: request,
            status: 'OK',
            code: 200,
            _postman_previewlanguage: 'json',
            header: [{ key: 'Content-Type', value: 'application/json' }],
            body: JSON.stringify({ received: true }, null, 2),
          },
        ],
      },
    ],
  };
}

const QUICKSTART = [
  '**Octopus B2B API v1** — generated from the OpenAPI document in the Octopus B2B repository on every release. Do not edit in Postman: changes are overwritten.',
  '',
  'Quick start (5 minutes):',
  '1. Fork this collection and the **Sandbox** environment.',
  '2. In Octopus B2B → Account → Developer, create an API client and a **test** key (`oct_test_…`).',
  '3. Paste the client id into `client_id` and the key into `client_secret` (Sandbox environment — keep them as secret, current values only).',
  '4. Send **Catalog → Search live products**. The collection fetches and caches the OAuth token for you and adds `Idempotency-Key` to POSTs.',
  '',
  'Every request has tests for the status code, the response schema and that every amount carries a currency (`{ "amount_minor": 19000, "currency": "USD" }`).',
  'Test keys read real catalogue and your own data; writes are simulated (`"simulated": true`).',
].join('\n');

function variables(kind: Kind, baseUrl: string) {
  return [
    { key: 'base_url', value: baseUrl, type: 'string' },
    ...(kind === 'supplier' ? [{ key: 'supplier_base_url', value: baseUrl.replace(/\/v1$/, '/supplier/v1'), type: 'string' }] : []),
    { key: 'client_id', value: '', type: 'string' },
    { key: 'client_secret', value: '', type: 'secret' },
    { key: 'access_token', value: '', type: 'secret' },
    { key: 'access_token_expires_at', value: '0', type: 'string' },
    { key: 'access_token_client', value: '', type: 'string' },
    { key: 'currency', value: '', type: 'string' },
    ...(kind === 'public'
      ? ['product_id', 'rfq_id', 'quote_id', 'order_id', 'shipment_id', 'webhook_id', 'webhook_secret', 'mock_url'].map((key) => ({ key, value: '', type: key === 'webhook_secret' ? 'secret' : 'string' }))
      : [{ key: 'rfq_id', value: '', type: 'string' }]),
    { key: 'vercel_bypass', value: '', type: 'secret' },
  ];
}

function collection(kind: Kind, opts: { baseUrl?: string; examples?: Examples }) {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const examples = opts.examples ?? {};
  const doc = kind === 'public' ? buildOpenApi('https://octopusb2b.com') : buildSupplierOpenApi('https://octopusb2b.com');
  const components = doc.components.schemas as Record<string, unknown>;
  const ops = kind === 'public' ? OPERATIONS : SUPPLIER_OPERATIONS;
  const tags = kind === 'public' ? PUBLIC_TAGS : SUPPLIER_TAGS;
  const folders: { name: string; description?: string; item: unknown[] }[] = tags.map((tag) => ({
    name: tag,
    item: tag === 'Auth' ? [tokenItem(examples)] : ops.filter((o) => o.tag === tag).map((o) => requestItem(o, kind, components, examples)),
  }));
  if (kind === 'public') folders.push(verifyFolder());
  return {
    info: {
      _postman_id: COLLECTION_IDS[kind],
      name: kind === 'public' ? 'Octopus B2B API v1' : 'Octopus B2B Supplier API v1',
      description:
        kind === 'public'
          ? QUICKSTART
          : 'Supplier API (bulk product sync, stock/price updates, quoting). Returns 403 SUPPLIER_PORTAL_DISABLED until the supplier portal opens. Same OAuth client credentials as the public API. Generated from the repository — do not edit in Postman.',
      schema: POSTMAN_SCHEMA,
      version: doc.info.version,
    },
    auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{access_token}}', type: 'string' }] },
    event: [{ listen: 'prerequest', script: { type: 'text/javascript', exec: PRE_REQUEST } }],
    variable: variables(kind, baseUrl),
    item: folders,
  };
}

export function buildPublicCollection(opts: { baseUrl?: string; examples?: Examples } = {}) {
  return collection('public', opts);
}

export function buildSupplierCollection(opts: { baseUrl?: string; examples?: Examples } = {}) {
  return collection('supplier', opts);
}

/** @deprecated kept for /api/v1/postman.json callers: `baseUrl` is the site origin. */
export function buildPostman(siteUrl: string, examples?: Examples) {
  return buildPublicCollection({ baseUrl: `${siteUrl.replace(/\/$/, '')}/api/v1`, examples });
}

/** Sandbox / Live environments — secrets are always shipped EMPTY (real customer keys never go into shared environments). */
export function buildEnvironment(kind: 'sandbox' | 'live', opts: { baseUrl?: string } = {}) {
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  return {
    id: ENVIRONMENT_IDS[kind],
    name: kind === 'sandbox' ? 'Octopus B2B · Sandbox' : 'Octopus B2B · Live',
    values: [
      { key: 'base_url', value: baseUrl, type: 'default', enabled: true },
      { key: 'client_id', value: '', type: 'default', enabled: true },
      { key: 'client_secret', value: '', type: 'secret', enabled: true },
      { key: 'access_token', value: '', type: 'secret', enabled: true },
      { key: 'currency', value: '', type: 'default', enabled: true },
      { key: 'webhook_secret', value: '', type: 'secret', enabled: true },
      { key: 'mock_url', value: '', type: 'default', enabled: true },
    ],
    _postman_variable_scope: 'environment',
  };
}

/** Everything scripts/postman-sync.mjs writes into postman/ (relative path → JSON). */
export function buildPostmanFiles(examples: Examples = {}) {
  return {
    'openapi.json': buildOpenApi('https://octopusb2b.com'),
    'supplier-openapi.json': buildSupplierOpenApi('https://octopusb2b.com'),
    'octopus-b2b-api-v1.postman_collection.json': buildPublicCollection({ examples }),
    'octopus-b2b-supplier-api-v1.postman_collection.json': buildSupplierCollection({ examples }),
    'sandbox.postman_environment.json': buildEnvironment('sandbox'),
    'live.postman_environment.json': buildEnvironment('live'),
  } as Record<string, unknown>;
}
