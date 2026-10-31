import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

// `after()` needs a Next request scope; run the callback immediately in tests.
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => void Promise.resolve().then(fn), connection: async () => {} }));

const { createAdminClient } = await import('@/lib/supabase/server');
const { generateApiKey } = await import('@/lib/api/keys');
const { signPayload } = await import('@/lib/adapters');

const BASE = 'http://localhost:3000';
type Handler = (req: Request, ctx: { params: Promise<Record<string, unknown>> }) => Promise<Response>;
const call = async (h: Handler, path: string, init: RequestInit = {}, params: Record<string, unknown> = {}) => {
  const res = await h(new Request(BASE + path, init), { params: Promise.resolve(params) });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, headers: res.headers, body: body as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const sb = createAdminClient();
let orgId = '';
let clientRowId = '';
let clientId = '';
let testKey = '';
let token = '';
const auth = () => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  const { data: u } = await sb.from('profiles').select('id').eq('email', 'buyer@demo.octopusb2b.com').single();
  const { data: m } = await sb.from('org_members').select('org_id').eq('user_id', u!.id).single();
  orgId = m!.org_id;
  const { data: c, error } = await sb
    .from('api_clients')
    .insert({ org_id: orgId, name: 'vitest integration', scopes: ['catalog:read', 'quotes:write', 'orders:read', 'orders:write', 'shipments:read', 'wallet:read', 'webhooks:manage'] })
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
  await sb.from('idempotency_keys').delete().like('key', `api:${orgId}:test:vitest-%`);
  if (clientRowId) await sb.from('api_clients').delete().eq('id', clientRowId); // cascades api_keys
  await sb.from('webhook_endpoints').delete().eq('org_id', orgId).like('url', 'https://example.com/vitest%');
});

describe('auth', () => {
  it('rejects missing credentials with problem+json', async () => {
    const { GET } = await import('@/app/api/v1/products/route');
    const r = await call(GET as Handler, '/api/v1/products');
    expect(r.status).toBe(401);
    expect(r.headers.get('content-type')).toBe('application/problem+json');
  });
  it('issues a token with client credentials (form + basic)', async () => {
    const { POST } = await import('@/app/api/v1/oauth/token/route');
    const bad = await POST(new Request(BASE + '/api/v1/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: 'oct_test_' + 'a'.repeat(48) }) }));
    expect(bad.status).toBe(401);
    const res = await POST(new Request(BASE + '/api/v1/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: testKey }) }));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j).toMatchObject({ token_type: 'Bearer', expires_in: 3600, mode: 'test' });
    token = j.access_token;
    const basic = await POST(new Request(BASE + '/api/v1/oauth/token', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(`${clientId}:${testKey}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials&scope=catalog:read' }));
    expect((await basic.json()).scope).toBe('catalog:read');
  });
  it('accepts the API key directly as bearer', async () => {
    const { GET } = await import('@/app/api/v1/categories/route');
    const r = await call(GET as Handler, '/api/v1/categories', { headers: { Authorization: `Bearer ${testKey}` } });
    expect(r.status).toBe(200);
    expect(r.headers.get('octopus-mode')).toBe('test');
    expect(r.headers.get('x-ratelimit-limit')).toBe('60');
  });
  it('enforces scopes', async () => {
    const { POST } = await import('@/app/api/v1/oauth/token/route');
    const res = await POST(new Request(BASE + '/api/v1/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: testKey, scope: 'catalog:read' }) }));
    const narrow = (await res.json()).access_token;
    const { GET } = await import('@/app/api/v1/orders/route');
    const r = await call(GET as Handler, '/api/v1/orders', { headers: { Authorization: `Bearer ${narrow}` } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('INSUFFICIENT_SCOPE');
  });
});

describe('catalog', () => {
  let productId = '';
  it('searches live products; supplier is code + country only', async () => {
    const { GET } = await import('@/app/api/v1/products/route');
    const r = await call(GET as Handler, '/api/v1/products?per_page=5', { headers: auth() });
    expect(r.status).toBe(200);
    expect(r.body.data.length).toBeGreaterThan(0);
    const p = r.body.data[0];
    productId = p.id;
    expect(Object.keys(p.supplier).sort()).toEqual(['code', 'country', 'verified']);
    expect(JSON.stringify(r.body)).not.toMatch(/legal_name|contact_email|supplier_cost/);
    const s = await call(GET as Handler, '/api/v1/products?q=bolts', { headers: auth() });
    expect(s.status).toBe(200);
  });
  it('product detail has tiers and specs', async () => {
    const { GET } = await import('@/app/api/v1/products/[id]/route');
    const r = await call(GET as Handler, `/api/v1/products/${productId}`, { headers: auth() }, { id: productId });
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data.price_tiers)).toBe(true);
    expect(Array.isArray(r.body.data.specs)).toBe(true);
    const nf = await call(GET as Handler, '/api/v1/products/nope', { headers: auth() }, { id: 'nope' });
    expect(nf.status).toBe(404);
  });
});

describe('org data (strictly filtered by token org)', () => {
  it('orders list + detail + tracking + wallet + rfqs + quotes', async () => {
    const orders = await call((await import('@/app/api/v1/orders/route')).GET as Handler, '/api/v1/orders', { headers: auth() });
    expect(orders.status).toBe(200);
    expect(orders.body.data.length).toBeGreaterThan(0);
    const o = orders.body.data[0];
    const det = await call((await import('@/app/api/v1/orders/[id]/route')).GET as Handler, `/api/v1/orders/${o.code}`, { headers: auth() }, { id: o.code });
    expect(det.status).toBe(200);
    expect(Array.isArray(det.body.data.documents)).toBe(true);
    const ship = orders.body.data.length ? (await sb.from('shipments').select('code').eq('org_id', orgId).limit(1).maybeSingle()).data : null;
    if (ship) {
      const t = await call((await import('@/app/api/v1/shipments/[id]/tracking/route')).GET as Handler, `/api/v1/shipments/${ship.code}/tracking`, { headers: auth() }, { id: ship.code });
      expect(t.status).toBe(200);
      expect(t.body.data.events.length).toBeGreaterThan(0);
    }
    const w = await call((await import('@/app/api/v1/wallet/route')).GET as Handler, '/api/v1/wallet', { headers: auth() });
    expect(w.status).toBe(200);
    expect(w.body.data.balance).toMatchObject({ amount_minor: expect.any(Number), currency: expect.stringMatching(/^(USD|CNY)$/) });
    expect(Array.isArray(w.body.data.balances)).toBe(true);
    const rfqs = await call((await import('@/app/api/v1/rfqs/route')).GET as Handler, '/api/v1/rfqs', { headers: auth() });
    expect(rfqs.status).toBe(200);
    const quotes = await call((await import('@/app/api/v1/quotes/route')).GET as Handler, '/api/v1/quotes', { headers: auth() });
    expect(quotes.status).toBe(200);
  });
  it('cannot read another org’s order', async () => {
    const { data: foreign } = await sb.from('orders').select('id').neq('org_id', orgId).limit(1).maybeSingle();
    if (!foreign) return;
    const r = await call((await import('@/app/api/v1/orders/[id]/route')).GET as Handler, `/api/v1/orders/${foreign.id}`, { headers: auth() }, { id: foreign.id });
    expect(r.status).toBe(404);
  });
});

describe('writes (sandbox key → simulated) + idempotency', () => {
  const rfq = { title: 'Vitest gloves', quantity: 1000, destinationCountry: 'NL' };
  it('requires Idempotency-Key', async () => {
    const { POST } = await import('@/app/api/v1/rfqs/route');
    const r = await call(POST as Handler, '/api/v1/rfqs', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(rfq) });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
  it('simulates, replays and detects key reuse', async () => {
    const { POST } = await import('@/app/api/v1/rfqs/route');
    const key = 'vitest-' + crypto.randomUUID();
    const init = (body: unknown) => ({ method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });
    const a = await call(POST as Handler, '/api/v1/rfqs', init(rfq));
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.simulated).toBe(true);
    const b = await call(POST as Handler, '/api/v1/rfqs', init(rfq));
    expect(b.status).toBe(201);
    expect(b.headers.get('idempotent-replayed')).toBe('true');
    expect(b.body.data.id).toBe(a.body.data.id);
    const c = await call(POST as Handler, '/api/v1/rfqs', init({ ...rfq, quantity: 2 }));
    expect(c.status).toBe(422);
    const { count } = await sb.from('rfqs').select('id', { count: 'exact', head: true }).eq('title', rfq.title);
    expect(count).toBe(0);
  });
  it('validates bodies (422 with errors)', async () => {
    const { POST } = await import('@/app/api/v1/rfqs/route');
    const r = await call(POST as Handler, '/api/v1/rfqs', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json', 'Idempotency-Key': 'vitest-' + crypto.randomUUID() }, body: JSON.stringify({ title: 'x', quantity: -1 }) });
    expect(r.status).toBe(422);
    expect(r.body.errors.length).toBeGreaterThan(0);
  });
  it('simulated order from an open quote', async () => {
    const { data: q } = await sb.from('quotes').select('id, rfq:rfqs!inner(org_id)').eq('rfq.org_id', orgId).in('status', ['sent', 'viewed']).gt('valid_until', new Date().toISOString()).limit(1).maybeSingle();
    if (!q) return;
    const { POST } = await import('@/app/api/v1/orders/route');
    const r = await call(POST as Handler, '/api/v1/orders', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json', 'Idempotency-Key': 'vitest-' + crypto.randomUUID() }, body: JSON.stringify({ quoteId: q.id }) });
    expect(r.status).toBe(201);
    expect(r.body.simulated).toBe(true);
    expect(r.body.data.deposit.amount_minor).toBeGreaterThan(0);
    expect(r.body.data.deposit.currency).toBe(r.body.data.currency);
  });
});

describe('webhook endpoints', () => {
  it('create → get → patch → test ping → delete', async () => {
    const list = await import('@/app/api/v1/webhooks/route');
    const one = await import('@/app/api/v1/webhooks/[id]/route');
    const ping = await import('@/app/api/v1/webhooks/[id]/test/route');
    const created = await call(list.POST as Handler, '/api/v1/webhooks', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json', 'Idempotency-Key': 'vitest-' + crypto.randomUUID() }, body: JSON.stringify({ url: 'https://example.com/vitest-hook', events: ['order.updated'] }) });
    expect(created.status).toBe(201);
    expect(created.body.data.secret).toMatch(/^[0-9a-f]{48}$/);
    const id = created.body.data.id;
    const got = await call(one.GET as Handler, `/api/v1/webhooks/${id}`, { headers: auth() }, { id });
    expect(got.body.data.secret).toBeUndefined();
    const patched = await call(one.PATCH as Handler, `/api/v1/webhooks/${id}`, { method: 'PATCH', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ events: ['order.updated', 'shipment.tracking'] }) }, { id });
    expect(patched.body.data.events).toContain('shipment.tracking');
    const p = await call(ping.POST as Handler, `/api/v1/webhooks/${id}/test`, { method: 'POST', headers: { ...auth(), 'Idempotency-Key': 'vitest-' + crypto.randomUUID() } }, { id });
    expect(p.status).toBe(200);
    expect(typeof p.body.data.delivered).toBe('boolean');
    const del = await call(one.DELETE as Handler, `/api/v1/webhooks/${id}`, { method: 'DELETE', headers: auth() }, { id });
    expect(del.status).toBe(204);
  });
});

describe('docs, health, supplier API', () => {
  it('serves openapi.json and postman.json', async () => {
    const o = await (await import('@/app/api/v1/openapi.json/route')).GET(new Request(BASE + '/api/v1/openapi.json'));
    expect((await o.json()).openapi).toBe('3.1.0');
    const p = await (await import('@/app/api/v1/postman.json/route')).GET(new Request(BASE + '/api/v1/postman.json'));
    expect((await p.json()).info.schema).toContain('v2.1.0');
  });
  it('health pings the DB', async () => {
    const h = await (await import('@/app/api/health/route')).GET();
    expect(h.status).toBe(200);
  });
  it('supplier API is closed while the portal flag is off', async () => {
    const { GET } = await import('@/app/api/supplier/v1/[...path]/route');
    const r = await call(GET as Handler, '/api/supplier/v1/products', {}, { path: ['products'] });
    expect([403, 401, 501]).toContain(r.status);
    const { data } = await sb.from('site_settings').select('value').eq('key', 'supplier_portal_enabled').single();
    if (data?.value !== true) expect(r.body.code).toBe('SUPPLIER_PORTAL_DISABLED');
  });
});

describe('cron + incoming webhooks', () => {
  it('cron requires the secret; jobs run', async () => {
    const { GET } = await import('@/app/api/cron/[job]/route');
    expect((await call(GET as Handler, '/api/cron/expire-quotes', {}, { job: 'expire-quotes' })).status).toBe(401);
    const ok = await call(GET as Handler, '/api/cron/certificates', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }, { job: 'certificates' });
    expect(ok.status).toBe(200);
    const poll = await call(GET as Handler, '/api/cron/tracking-poll', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }, { job: 'tracking-poll' });
    expect(poll.status).toBe(200);
    const nf = await call(GET as Handler, '/api/cron/nope', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }, { job: 'nope' });
    expect(nf.status).toBe(404);
  });
  it('outbox worker processes due events', async () => {
    const { GET } = await import('@/app/api/cron/outbox/route');
    expect((await GET(new Request(BASE + '/api/cron/outbox'))).status).toBe(401);
    const res = await GET(new Request(BASE + '/api/cron/outbox', { headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } }));
    const j = await res.json();
    expect(res.status).toBe(200);
    expect(j.ok).toBe(true);
    expect(j.dead).toBe(0);
  });
  it('settings.currency_changed (no org) is delivered to every org subscribed to it', async () => {
    const http = await import('node:http');
    const got: { path: string; sig: string; body: string }[] = [];
    const server = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        got.push({ path: req.url ?? '', sig: String(req.headers['octopus-signature'] ?? ''), body: b });
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    // a second (temporary) organization proves the fan-out crosses orgs
    const { data: other, error: oe } = await sb.from('organizations').insert({ name: 'vitest broadcast org', country: 'NL' }).select('id').single();
    if (oe) throw oe;
    const { data: eps, error } = await sb
      .from('webhook_endpoints')
      .insert([
        { org_id: orgId, url: `http://127.0.0.1:${port}/a`, events: ['settings.currency_changed'], secret: 'sek-a' },
        { org_id: other!.id, url: `http://127.0.0.1:${port}/b`, events: ['settings.currency_changed'], secret: 'sek-b' },
        { org_id: other!.id, url: `http://127.0.0.1:${port}/not-subscribed`, events: ['order.updated'], secret: 'sek-c' },
      ])
      .select('id');
    if (error) throw error;
    const { data: ev, error: ee } = await sb
      .from('outbox_events')
      .insert({ event_type: 'settings.currency_changed', aggregate_type: 'currency_switch', aggregate_id: crypto.randomUUID(), payload: { from: 'USD', to: 'CNY', rate: 7.2, fx_rate_id: null, wallet_option: 'keep' } })
      .select('id')
      .single();
    if (ee) throw ee;
    try {
      const { processOutbox } = await import('@/lib/api/outbox');
      for (let i = 0; i < 6; i++) {
        await processOutbox(sb, 50);
        const { data: row } = await sb.from('outbox_events').select('status').eq('id', ev!.id).single();
        if (row?.status === 'done') break;
      }
      const { data: row } = await sb.from('outbox_events').select('status').eq('id', ev!.id).single();
      expect(row?.status).toBe('done');
      expect(got.map((g) => g.path).sort()).toEqual(['/a', '/b']);
      const a = got.find((g) => g.path === '/a')!;
      const body = JSON.parse(a.body);
      expect(body).toMatchObject({ type: 'settings.currency_changed', data: { from: 'USD', to: 'CNY', currency: 'CNY', rate: { base: 'USD', quote: 'CNY', rate: 7.2 } } });
      const { verifySignature } = await import('@/lib/adapters');
      expect(verifySignature(a.body, a.sig, 'sek-a')).toBe(true);
    } finally {
      server.close();
      await sb.from('webhook_endpoints').delete().in('id', (eps ?? []).map((e) => e.id));
      await sb.from('outbox_events').delete().eq('id', ev!.id);
      await sb.from('organizations').delete().eq('id', other!.id);
    }
  });
  it('yunexpress webhook verifies signature and handles unknown tracking numbers', async () => {
    const { POST } = await import('@/app/api/webhooks/yunexpress/route');
    const body = JSON.stringify({ events: [{ id: 'vitest-' + Date.now(), tracking_no: 'NO-SUCH-TRACKING', status: 'in_transit', description: 'x', time: new Date().toISOString() }] });
    expect((await POST(new Request(BASE, { method: 'POST', body, headers: { 'Octopus-Signature': 't=1,v1=bad' } }))).status).toBe(401);
    const secret = process.env.YUNEXPRESS_WEBHOOK_SECRET || process.env.WEBHOOK_SIGNING_SECRET!;
    const r = await POST(new Request(BASE, { method: 'POST', body, headers: { 'Octopus-Signature': signPayload(body, secret) } }));
    expect(r.status).toBe(200);
    expect((await r.json()).unknown).toEqual(['NO-SUCH-TRACKING']);
  });
  it('payment webhook verifies signature; unmatched top-up is acknowledged', async () => {
    const { POST } = await import('@/app/api/webhooks/payment/route');
    const body = JSON.stringify({ id: 'evt_vitest_' + Date.now(), type: 'topup.succeeded', data: { reference: 'NO-SUCH-REF', amount: 100 } });
    expect((await POST(new Request(BASE, { method: 'POST', body, headers: { 'Octopus-Signature': 't=1,v1=bad' } }))).status).toBe(401);
    const secret = process.env.PAYMENT_WEBHOOK_SECRET || process.env.WEBHOOK_SIGNING_SECRET!;
    const r = await POST(new Request(BASE, { method: 'POST', body, headers: { 'Octopus-Signature': signPayload(body, secret) } }));
    expect(r.status).toBe(200);
    expect((await r.json()).results[0].outcome).toBe('unmatched');
  });
});
