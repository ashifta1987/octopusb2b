import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Postman saved examples from seed data (SPEC §15.2) + live contract check.
 * Calls the REAL route handlers with a temporary sandbox (oct_test_) key of the demo buyer org, in collection order,
 * validates every response against the OpenAPI schema and the "every amount carries a currency" rule, and — when
 * WRITE_POSTMAN_EXAMPLES=1 — writes postman/examples.json (then run `node scripts/postman-sync.mjs --no-push`).
 *
 *   WRITE_POSTMAN_EXAMPLES=1 npx vitest run --config tests/vitest.integration.config.ts tests/integration/postman-examples.test.ts
 */
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => void Promise.resolve().then(fn), connection: async () => {} }));

const { createAdminClient } = await import('@/lib/supabase/server');
const { generateApiKey } = await import('@/lib/api/keys');
const { buildOpenApi, operationId, OPERATIONS } = await import('@/lib/api/openapi');
const { deref, validate } = await import('@/lib/api/json-schema');
const { findBareAmounts } = await import('@/lib/api/money');

const BASE = 'http://localhost:3000';
type Handler = (req: Request, ctx: { params: Promise<Record<string, unknown>> }) => Promise<Response>;

const ROUTES: Record<string, () => Promise<Record<string, unknown>>> = {
  '/settings/currency': () => import('@/app/api/v1/settings/currency/route'),
  '/products': () => import('@/app/api/v1/products/route'),
  '/products/{id}': () => import('@/app/api/v1/products/[id]/route'),
  '/categories': () => import('@/app/api/v1/categories/route'),
  '/rfqs': () => import('@/app/api/v1/rfqs/route'),
  '/rfqs/{id}': () => import('@/app/api/v1/rfqs/[id]/route'),
  '/quotes': () => import('@/app/api/v1/quotes/route'),
  '/orders': () => import('@/app/api/v1/orders/route'),
  '/orders/{id}': () => import('@/app/api/v1/orders/[id]/route'),
  '/shipments/{id}/tracking': () => import('@/app/api/v1/shipments/[id]/tracking/route'),
  '/wallet': () => import('@/app/api/v1/wallet/route'),
  '/service-requests': () => import('@/app/api/v1/service-requests/route'),
  '/webhooks': () => import('@/app/api/v1/webhooks/route'),
  '/webhooks/{id}': () => import('@/app/api/v1/webhooks/[id]/route'),
  '/webhooks/{id}/test': () => import('@/app/api/v1/webhooks/[id]/test/route'),
};

const sb = createAdminClient();
let orgId = '';
let clientRowId = '';
let clientId = '';
let testKey = '';
let token = '';
const examples: Record<string, { status: number; body: unknown }> = {};
const vars: Record<string, string> = {};
const doc = buildOpenApi('https://octopusb2b.com');
const components = doc.components.schemas as Record<string, unknown>;

/** Never ship secrets or tokens in saved examples. */
function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, k === 'secret' ? 'whsec_redacted_example_secret' : k === 'access_token' ? 'eyJhbGciOiJIUzI1NiJ9.example.signature' : scrub(x)]),
  );
}

beforeAll(async () => {
  const { data: u } = await sb.from('profiles').select('id').eq('email', 'buyer@demo.octopusb2b.com').single();
  const { data: m } = await sb.from('org_members').select('org_id').eq('user_id', u!.id).single();
  orgId = m!.org_id;
  const { data: c, error } = await sb
    .from('api_clients')
    .insert({ org_id: orgId, name: 'postman examples generator', scopes: ['catalog:read', 'quotes:write', 'orders:read', 'orders:write', 'shipments:read', 'wallet:read', 'webhooks:manage'] })
    .select('id, client_id')
    .single();
  if (error) throw error;
  clientRowId = c.id;
  clientId = c.client_id;
  const k = generateApiKey('test');
  testKey = k.key;
  const ins = await sb.from('api_keys').insert({ client_id: c.id, org_id: orgId, mode: 'test', prefix: k.prefix, key_hash: k.hash });
  if (ins.error) throw ins.error;
});

afterAll(async () => {
  await sb.from('idempotency_keys').delete().like('key', `api:${orgId}:test:pmex-%`);
  if (vars.webhook_id) await sb.from('webhook_endpoints').delete().eq('id', vars.webhook_id);
  await sb.from('webhook_endpoints').delete().eq('org_id', orgId).like('url', 'https://example.com/octopus/webhooks%');
  if (clientRowId) await sb.from('api_clients').delete().eq('id', clientRowId);
  if (process.env.WRITE_POSTMAN_EXAMPLES === '1') {
    const out = path.resolve(__dirname, '../../postman/examples.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const sorted = Object.fromEntries(Object.entries(examples).sort(([a], [b]) => a.localeCompare(b)));
    fs.writeFileSync(out, JSON.stringify(sorted, null, 2) + '\n');
    console.log(`wrote ${out} (${Object.keys(sorted).length} examples)`);
  }
});

describe('Postman examples from seed data', () => {
  it('token', async () => {
    const { POST } = await import('@/app/api/v1/oauth/token/route');
    const res = await POST(new Request(BASE + '/api/v1/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `grant_type=client_credentials&client_id=${clientId}&client_secret=${testKey}` }));
    expect(res.status).toBe(200);
    const j = await res.json();
    token = j.access_token;
    examples.postOauthToken = { status: 200, body: scrub(j) };
  });

  for (const op of OPERATIONS) {
    const id = operationId(op);
    it(`${op.method.toUpperCase()} ${op.path}`, async () => {
      const pathVar = op.path.startsWith('/products') ? vars.product_id : op.path.startsWith('/rfqs') ? vars.rfq_id : op.path.startsWith('/orders') ? vars.order_id : op.path.startsWith('/shipments') ? vars.shipment_id : vars.webhook_id;
      if (op.path.includes('{id}') && !pathVar) return; // nothing in the seed for this org
      if (id === 'postOrders' && !vars.quote_id) return;
      const url = BASE + '/api/v1' + op.path.replace('{id}', encodeURIComponent(pathVar ?? ''));
      const body = id === 'postOrders' ? { quoteId: vars.quote_id } : op.example;
      const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
      if (op.body) headers['Content-Type'] = 'application/json';
      if (op.method === 'post') headers['Idempotency-Key'] = 'pmex-' + crypto.randomUUID();
      const mod = await ROUTES[op.path]();
      const handler = mod[op.method.toUpperCase()] as Handler;
      const res = await handler(new Request(url, { method: op.method.toUpperCase(), headers, ...(op.body ? { body: JSON.stringify(body) } : {}) }), { params: Promise.resolve(pathVar ? { id: pathVar } : {}) });
      const text = await res.text();
      const json = text ? JSON.parse(text) : null;
      expect(res.status, text.slice(0, 500)).toBe(op.status ?? 200);
      if (op.response) {
        const errs = validate(deref({ $ref: `#/components/schemas/${op.response}` }, components), json);
        expect(errs, `${id} schema`).toEqual([]);
      }
      if (json) expect(findBareAmounts(json), `${id} amounts`).toEqual([]);

      // chain like the Postman collection does
      const d = json?.data;
      if (id === 'getProducts' && d?.[0]) vars.product_id = d[0].id;
      if (id === 'getRfqs' && d?.[0]) vars.rfq_id = d[0].id;
      if (id === 'getQuotes') vars.quote_id = (d ?? []).find((q: { status: string; valid_until: string }) => ['sent', 'viewed'].includes(q.status) && new Date(q.valid_until) > new Date())?.id ?? '';
      if (id === 'getOrders' && d?.[0]) vars.order_id = d[0].id;
      if (id === 'getOrdersById') vars.shipment_id = d?.shipments?.[0]?.id ?? '';
      if (id === 'postWebhooks') vars.webhook_id = d.id;
      if (id === 'deleteWebhooksById') vars.webhook_id = '';

      // keep examples short: first 2 list items
      let ex = json;
      if (ex && Array.isArray(ex.data) && ex.data.length > 2) ex = { ...ex, data: ex.data.slice(0, 2) };
      if (id === 'getProductsById' && ex?.data?.media?.length > 2) ex = { ...ex, data: { ...ex.data, media: ex.data.media.slice(0, 2) } };
      examples[id] = { status: res.status, body: scrub(ex) };
    });
  }
});
